import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, map, Observable, of, tap } from 'rxjs';
import { AccountState } from '../models/account-state';
import {
  emptyPendingDocument,
  isValidPendingDocument,
  SYNC_PENDING_STORAGE_KEY,
  SyncOperation,
  toSyncBody,
} from '../models/sync';
import { AccountCache } from './account-cache';
import { API_BASE_URL, AuthService } from './auth.service';
import { Connectivity } from './connectivity';
import { WriteSink } from './write-sink';

/** What became of a push or a replay. */
export type SyncOutcome =
  | { ok: true }
  | { ok: false; reason: 'refused'; message: string }
  | { ok: false; reason: 'deferred' };

/** Used when a refusal arrives without wording of its own. */
const REFUSED_MESSAGE = 'That change could not be saved to your account.';

/**
 * The write side of the account (FR-017, SC-010).
 *
 * One endpoint, reached three ways — a live change, a replayed queue, and (via
 * the auth call, not here) a guest migration. That is the API's own design
 * (`contracts/api.md`), and this service's job is to not spoil it: everything
 * it sends is a `GuestStatePayload`, so the server applies one merge rule to
 * all three and the client never has to know which case it is in.
 *
 * **Failure is classified, not merely caught.** The two ways a push fails want
 * opposite responses, and conflating them is the mistake this class exists to
 * avoid:
 *
 * - A **`400`** means the body is wrong. It will be wrong the same way next
 *   time, so it is surfaced as `refused` and *not* queued — a queue that grows
 *   a permanently-rejected operation retries it on every future sync, forever.
 * - A **network failure or a `5xx`** means the server was not reachable or not
 *   working. Nothing about the request is wrong, so it is `deferred` and
 *   queued, and the visitor's decision survives the outage (FR-017).
 *
 * A `401` lands in the second bucket rather than getting special handling
 * here: re-authenticating is the interceptor's concern (T041), and queueing a
 * change until the session is refreshed is the right answer if it is not.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly cache = inject(AccountCache);
  private readonly sink = inject(WriteSink);
  private readonly connectivity = inject(Connectivity);

  /** Used when LocalStorage is unavailable (blocked or private browsing). */
  private memoryFallback: string | null = null;

  private readonly queued = signal<SyncOperation[]>([]);

  /** The operations still waiting for the account, oldest first. */
  readonly pending = this.queued.asReadonly();

  constructor() {
    // The sink is the only inbox — a local write announces itself and nothing
    // else in the app knows sync exists (research D9). Subscribed once rather
    // than only while signed in, because the alternative is a subscription
    // that tracks the session, and a subscription that has to be re-established
    // is a subscription that can be missed. `push` is where the session check
    // lives, so a guest's write costs one function call and stops.
    this.sink.observe((operation) => {
      this.push([operation]).subscribe();
    });

    this.queued.set(this.storedQueue());

    // The queue's other way out (FR-017, SC-010): a change made offline applies
    // "automatically when the connection returns", and this is that moment —
    // the only one that is neither a boot nor a tap. `SessionBoot` drains at
    // boot; between the two, a queued change is never more than one reconnect
    // or one launch away from the account.
    //
    // A second long-lived subscription beside the sink's, for the same reason:
    // both are the write path staying open for as long as the app is, and a
    // subscription that had to be re-established is one that can be missed.
    this.connectivity.cameOnline.pipe(takeUntilDestroyed()).subscribe(() => this.retryQueue());
  }

  /**
   * Replays the queue when the connection returns, if there is a session.
   *
   * The session check is not decoration. A queue outlives the session on
   * purpose — an expired one keeps it for the next sign-in to merge — so
   * sending on every reconnect would fire a write with no credential whenever a
   * signed-out visitor's flaky connection twitched, and the `401` that came
   * back would say nothing about a session that is already over.
   */
  private retryQueue(): void {
    if (!this.auth.isSignedIn()) return;

    this.replay().subscribe();
  }

  /**
   * Sends changes to the account, queueing them if it cannot be reached.
   *
   * Never errors: every failure is an outcome the caller can act on, and an
   * Observable that errored would leave the sink's subscription — which has no
   * error handler and no business having one — to be torn down by the first
   * flaky network.
   */
  push(operations: readonly SyncOperation[]): Observable<SyncOutcome> {
    // Nothing to send, or nobody to send it to. A guest's writes are not lost
    // by this — they are in the device document, which is exactly what the
    // next sign-in migrates.
    if (operations.length === 0 || !this.auth.isSignedIn()) return of({ ok: true });

    return this.post(operations).pipe(
      tap((state) => this.cache.write(state)),
      map((): SyncOutcome => ({ ok: true })),
      catchError((error: unknown) => of(this.refuseOrDefer(operations, error))),
    );
  }

  /**
   * Sends the queue, and empties it on confirmation (FR-017).
   *
   * The queue is cleared on success and left alone on failure — deliberately
   * *not* re-enqueued. It is already the record of what has not been sent, so
   * re-adding the operations would double it on every failed attempt, and a
   * queue that grows every time the network is down never drains.
   */
  replay(): Observable<SyncOutcome> {
    const operations = this.storedQueue();

    if (operations.length === 0) return of({ ok: true });

    return this.post(operations).pipe(
      tap((state) => {
        this.cache.write(state);
        this.clearQueue();
      }),
      map((): SyncOutcome => ({ ok: true })),
      catchError((error: unknown) => of(this.explain(error))),
    );
  }

  /**
   * Drops the queue without sending it.
   *
   * For sign-out, which deletes the account's device data (SC-007) after
   * warning if this is non-empty — the warning belongs to the caller, because
   * only the caller knows it is about to discard something.
   */
  clearQueue(): void {
    this.memoryFallback = null;
    this.queued.set([]);

    try {
      this.storage()?.removeItem(SYNC_PENDING_STORAGE_KEY);
    } catch {
      // Nothing to do — the in-memory queue is already cleared.
    }
  }

  private post(operations: readonly SyncOperation[]): Observable<AccountState> {
    return this.http.post<AccountState>(`${this.baseUrl}/api/me/sync`, toSyncBody(operations));
  }

  /** A failed push: the body is the client's fault, or the connection is nobody's. */
  private refuseOrDefer(operations: readonly SyncOperation[], error: unknown): SyncOutcome {
    const outcome = this.explain(error);

    if (!outcome.ok && outcome.reason === 'deferred') this.enqueue(operations);

    return outcome;
  }

  private explain(error: unknown): SyncOutcome {
    if (error instanceof HttpErrorResponse && error.status === 400) {
      const body = error.error as { errors?: string[] } | null;

      return { ok: false, reason: 'refused', message: body?.errors?.[0] ?? REFUSED_MESSAGE };
    }

    return { ok: false, reason: 'deferred' };
  }

  /** Appends, preserving order. Never deduplicates — see `sync.ts`. */
  private enqueue(operations: readonly SyncOperation[]): void {
    this.writeQueue([...this.storedQueue(), ...operations]);
  }

  private writeQueue(operations: SyncOperation[]): void {
    const serialized = JSON.stringify({ ...emptyPendingDocument(), operations });

    try {
      this.storage()?.setItem(SYNC_PENDING_STORAGE_KEY, serialized);
    } catch {
      // Non-fatal: the queue stays in memory so the session continues.
    }

    this.memoryFallback = serialized;
    this.queued.set(operations);
  }

  /**
   * The stored queue, or an empty list.
   *
   * A document that fails the contract — unknown version, unparseable JSON, an
   * operation this build cannot read — discards the **whole** queue, matching
   * the 001/002 fail-safe rule: replaying a half-understood queue would apply
   * some of the visitor's changes and silently drop the rest, and the queue is
   * a copy rather than the only record — the device document still holds every
   * one of those decisions.
   */
  private storedQueue(): SyncOperation[] {
    const raw = this.readRaw();

    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isValidPendingDocument(parsed)) return parsed.operations;
      } catch {
        // Unparseable — fall through to the reset below.
      }

      this.clearQueue();
    }

    return [];
  }

  private readRaw(): string | null {
    try {
      const stored = this.storage()?.getItem(SYNC_PENDING_STORAGE_KEY);
      if (stored !== null && stored !== undefined) return stored;
    } catch {
      // Fall back to memory below.
    }

    return this.memoryFallback;
  }

  /** Returns LocalStorage, or null when the browser refuses to provide it. */
  private storage(): Storage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }
}
