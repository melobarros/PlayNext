import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, switchMap, tap } from 'rxjs';
import { AccountState } from '../models/account-state';
import { AccountCache } from './account-cache';
import { API_BASE_URL, AuthService } from './auth.service';
import { SyncService } from './sync.service';

/**
 * What opening the app turned out to mean for this visitor.
 *
 * Four answers, one per thing the Profile area has to be able to say, and no
 * fifth for the case in between — see `restore`.
 */
export type BootResult =
  { state: 'guest' } | { state: 'restored' } | { state: 'expired' } | { state: 'offline' };

/**
 * Picks up a session where the last visit left it (FR-015, FR-017, research
 * D12).
 *
 * A returning visitor's device holds a marker saying a session exists but no
 * credential — the access token died with the page and the refresh token is in
 * an httpOnly cookie the script cannot read. So the only way to find out
 * whether the session is still good is to ask, and that is what this does,
 * once, at start.
 *
 * The two ways that question can fail are not the same failure, and telling
 * them apart is the entire reason this is a service rather than three lines in
 * a component:
 *
 * - **The server refused** (`401`). The session is genuinely over. The marker
 *   goes, and the visitor becomes a guest again — but the *cached data stays*.
 *   They did not ask to leave, and emptying the device on their behalf would
 *   be a dead end with their own ratings on the other side of it (D12).
 * - **The server was not reached.** Nothing is known. The marker stays, the
 *   visitor is still signed in, and the app runs from the cache with the
 *   offline notice — signed-in offline mode, which is a state the app already
 *   supports rather than an error (FR-017).
 *
 * Once the session is confirmed it also **reconciles**: the account's state
 * comes down into the cache, and whatever this device recorded while it was
 * offline goes up (FR-017, SC-010).
 *
 * **Injecting `SyncService` is doing a second job here, and it is the kind that
 * does not announce itself.** That service's constructor is where `WriteSink`
 * gains its only observer, and nothing else in the app constructed it until the
 * Profile screen was opened — so a signed-in visitor who rated something from
 * the deck pushed nothing at all, in either direction: no request, no queued
 * operation, nothing to retry. No error either, because an observer-less sink is
 * simply a `Set` that stays empty (`write-sink.ts`). Boot is the right owner of
 * this: it is the one moment guaranteed to happen, and the sink has to be live
 * before the visitor's first tap, not after their first visit to a settings
 * screen.
 */
@Injectable({ providedIn: 'root' })
export class SessionBoot {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly cache = inject(AccountCache);
  private readonly sync = inject(SyncService);

  /**
   * Restores the session, if there is one to restore.
   *
   * There is deliberately **no `stale` outcome** for "the refresh worked but
   * the state pull did not". It is a real case — a connection that drops
   * mid-boot — but the answer to it is the one the app already gives: the
   * visitor is signed in and working from the cache they had, and the next
   * successful sync replaces it. A separate outcome would name a difference
   * nothing acts on (Principle II).
   */
  restore(): Observable<BootResult> {
    // The marker is the only thing that says a session might exist, and it is
    // read without any credential because it holds none (device-storage.md).
    if (!this.auth.isSignedIn()) return of({ state: 'guest' });

    return this.auth.refresh().pipe(
      switchMap((outcome) => {
        if (outcome === 'refused') {
          this.auth.expire();
          return of<BootResult>({ state: 'expired' });
        }

        if (outcome === 'unreachable') return of<BootResult>({ state: 'offline' });

        return this.reconcile();
      }),
    );
  }

  /**
   * Settles the device and the account against each other, down and then up.
   *
   * The pull brings the account's copy into the cache; the drain sends what
   * this device decided while it could not reach the server. Both are needed,
   * and the order between them is load-bearing.
   *
   * A failed pull is swallowed on purpose. The session is live — the server
   * just confirmed it — so signing the visitor out over a dropped state fetch
   * would be answering the wrong question. What they lose is freshness.
   */
  private reconcile(): Observable<BootResult> {
    return this.http.get<AccountState>(`${this.baseUrl}/api/me/state`).pipe(
      tap((state) => this.cache.write(state)),

      // `of(null)` rather than `EMPTY`, and the difference is not cosmetic:
      // `EMPTY` completes without emitting, so the drain below would never run
      // and the caller would never be told the boot succeeded. A failed pull is
      // a step to move past, not an ending.
      catchError(() => of<AccountState | null>(null)),

      // The drain goes *second*, so the account's merged answer is the last
      // thing written to the cache. Reversed, the older state fetch would land
      // on top of the sync and undo it on screen: the rating would reach the
      // account and disappear from the device that made it.
      //
      // This is also the one moment a stranded queue is guaranteed to be looked
      // at (FR-017, SC-010). `SyncService.replay()` was written for it in T029
      // and tested in T027, but nothing ever called it except the sign-out flow
      // — which discards the queue rather than sending it. So a change made
      // offline was queued, never retried, and thrown away by the only code
      // that touched it.
      switchMap(() => this.sync.replay()),

      map((): BootResult => ({ state: 'restored' })),
    );
  }
}
