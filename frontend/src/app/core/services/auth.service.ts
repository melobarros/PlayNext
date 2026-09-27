import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { catchError, map, Observable, of, tap } from 'rxjs';
import {
  AccountState,
  GuestStatePayload,
  toGuestState,
  toPreferenceDocument,
} from '../models/account-state';
import {
  createSessionDocument,
  isValidSessionDocument,
  SESSION_STORAGE_KEY,
  SessionDocument,
} from '../models/session';
import { AccountCache } from './account-cache';
import { InteractionStore } from './interaction-store';
import { PreferenceStore } from './preference-store';

/**
 * Where the API lives.
 *
 * Defaults to the empty string — same origin — which is what production wants
 * (the PWA and the API are served from one Static Web Apps origin) and what the
 * dev server's proxy is for locally. A hard-coded `http://localhost:5003` would
 * work on exactly one machine and would then be shipped to the others.
 */
export const API_BASE_URL = new InjectionToken<string>('playnext.api-base-url', {
  providedIn: 'root',
  factory: () => '',
});

/**
 * The CSRF guard the two cookie-authenticated endpoints require
 * (contracts/api.md). A cross-origin caller cannot set a custom header without
 * a preflight this API's CORS policy refuses, which is what makes it a defence
 * rather than a formality.
 */
const CSRF_HEADER = { 'X-Requested-With': 'playnext' } as const;

/** The session envelope (`POST /auth/register|login|google`). */
interface SessionResponse {
  userId: string;
  email: string;
  accessToken: string;
  state: AccountState;
}

/** The refresh endpoint's response: a new access token, and nothing else. */
interface RefreshResponse {
  accessToken: string;
}

/** Why an attempt failed, in the terms the Profile screen has to explain. */
export type AuthFailureReason =
  | 'email-taken'
  | 'invalid-credentials'
  | 'locked'
  | 'invalid-payload'
  | 'offline'
  | 'unavailable';

/**
 * The result of a sign-in attempt.
 *
 * Failures are **values, not exceptions**. Every one of these is an outcome the
 * Profile screen renders a message for — a wrong password is not exceptional,
 * it is Tuesday — and an Observable that errored instead would leave the
 * friendly-message path as the one a component reaches only if it remembered a
 * `catchError`. The error channel stays for genuine bugs.
 */
export type AuthOutcome =
  | { ok: true }
  | { ok: false; reason: AuthFailureReason; message: string; retryAfterSeconds?: number };

/**
 * Server wording, used when a response carries no message of its own. These
 * are the client's fallbacks, not its primary text: the API's messages are
 * written for people and are passed through when present, so the two cannot
 * drift into saying different things about the same failure.
 */
const FALLBACK_MESSAGE: Record<AuthFailureReason, string> = {
  'email-taken': 'That email already has an account. Sign in instead.',
  'invalid-credentials': 'Those details did not match an account.',
  locked: 'Too many attempts. Try again in a few minutes.',
  'invalid-payload': 'That did not look right. Check the details and try again.',
  offline: "You're offline. Your ratings are safe on this device — try again when you reconnect.",
  unavailable: 'Something went wrong on our side. Try again in a moment.',
};

/** How a status code and an error body map onto a reason. */
function reasonFor(error: HttpErrorResponse): AuthFailureReason {
  // Status 0 is what the browser reports for a request that never reached a
  // server. Told apart from a 5xx on purpose: FR-016 wants the visitor to know
  // the problem is their connection, and conflating the two sends them looking
  // for a fault on our side that is not there.
  if (error.status === 0) return 'offline';

  const code = (error.error as { code?: string } | null)?.code;

  if (error.status === 409) return 'email-taken';
  if (error.status === 400) return 'invalid-payload';
  if (error.status === 401) return code === 'locked' ? 'locked' : 'invalid-credentials';

  return 'unavailable';
}

/**
 * The client half of auth (feature 004).
 *
 * Four responsibilities, and it is worth naming them because they are what
 * the tests pin:
 *
 * 1. **Attach the guest document** to every way in, so the merge happens on
 *    the server against data the device was actually carrying.
 * 2. **Hold the access token in memory, and only in memory.** It is a
 *    fifteen-minute credential; putting it in LocalStorage would trade a real
 *    XSS exposure for the convenience of surviving a reload, and a reload is
 *    handled instead by the refresh cookie.
 * 3. **Keep the marker that says a session exists** — so boot knows to try a
 *    silent refresh without any script ever reading a credential.
 * 4. **Cache the canonical state** the server returns, through `AccountCache`,
 *    so 001–003's read paths see the merge without knowing auth exists.
 *
 * The device's 001/002 documents are never *emptied* by signing in. Once a
 * session is live they are the *cache* of the account state (research D7), and
 * blanking them as the request is sent would drop the visitor's data in the
 * window before the server's copy arrives. What replaces them is the merge
 * itself, once it comes back — the cache is brought up to date, not cleared.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly interactions = inject(InteractionStore);
  private readonly preferences = inject(PreferenceStore);
  private readonly cache = inject(AccountCache);

  /** Used when LocalStorage is unavailable (blocked or private browsing). */
  private memoryFallback: string | null = null;

  private readonly signedIn = signal<SessionDocument | null>(null);

  /** The access token. In memory; `null` until a session exists. */
  private readonly token = signal<string | null>(null);

  /** Who is signed in, or `null`. */
  readonly session = this.signedIn.asReadonly();

  readonly isSignedIn = computed(() => this.signedIn() !== null);

  /** The current access token, for the interceptor that attaches it. */
  readonly accessToken = this.token.asReadonly();

  constructor() {
    this.signedIn.set(this.readMarker());
  }

  register(email: string, password: string): Observable<AuthOutcome> {
    return this.enter('register', { email, password });
  }

  signIn(email: string, password: string): Observable<AuthOutcome> {
    return this.enter('login', { email, password });
  }

  signInWithGoogle(credential: string): Observable<AuthOutcome> {
    return this.enter('google', { credential });
  }

  /**
   * Exchanges the refresh cookie for a new access token, and slides the
   * 30-day inactivity window (FR-015).
   *
   * Reports a boolean rather than an outcome: the caller is boot or a retry
   * after a 401, and both only need to know whether to carry on signed in.
   * The marker is left alone on failure — whether a failed refresh means
   * "expired" or "offline" is a decision for the caller that knows, not for
   * this method to guess (contracts/device-storage.md).
   */
  refresh(): Observable<boolean> {
    return this.http
      .post<RefreshResponse>(`${this.baseUrl}/api/auth/refresh`, null, { headers: CSRF_HEADER })
      .pipe(
        tap((response) => this.token.set(response.accessToken)),
        map(() => true),
        catchError(() => of(false)),
      );
  }

  /**
   * Ends the session (SC-007).
   *
   * The local marker is deleted whether or not the server call succeeds. The
   * visitor asked to be signed out, and leaving them signed in because the
   * network was down is the one outcome that is never acceptable — on a shared
   * device it is also the one that leaks.
   */
  signOut(): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/api/auth/logout`, null, { headers: CSRF_HEADER }).pipe(
      catchError(() => of(undefined)),
      tap(() => this.forget()),
      map(() => undefined),
    );
  }

  /** One path in: attach the guest document, then accept or explain. */
  private enter(path: string, credentials: Record<string, string>): Observable<AuthOutcome> {
    const guest = this.guestDocument();
    const body = guest === null ? credentials : { ...credentials, guest };

    return this.http.post<SessionResponse>(`${this.baseUrl}/api/auth/${path}`, body).pipe(
      tap((response) => this.accept(response)),
      map((): AuthOutcome => ({ ok: true })),
      catchError((error: unknown) => of(this.explain(error))),
    );
  }

  /**
   * The device's documents as the merge's incoming side, or `null` when there
   * is nothing to migrate (US1 scenario 4).
   */
  private guestDocument(): GuestStatePayload | null {
    const quiz = this.preferences.read();

    return toGuestState(
      this.interactions.read(),
      quiz === null ? null : toPreferenceDocument(quiz),
    );
  }

  /**
   * Takes the server's word for what the account now holds.
   *
   * The token and the marker come first, because they *are* the session and the
   * session is real the moment the server says so. The cache write is the
   * device catching up with a merge that has already happened, so a payload
   * this client cannot read costs the cache and nothing else
   * (contracts/device-storage.md failure semantics).
   */
  private accept(response: SessionResponse): void {
    this.token.set(response.accessToken);
    this.writeMarker(createSessionDocument(response.userId, response.email));
    this.cache.write(response.state);
  }

  private explain(error: unknown): AuthOutcome {
    if (!(error instanceof HttpErrorResponse)) {
      return { ok: false, reason: 'unavailable', message: FALLBACK_MESSAGE.unavailable };
    }

    const reason = reasonFor(error);
    const body = error.error as { errors?: string[]; retryAfterSeconds?: number } | null;
    const message = body?.errors?.[0] ?? FALLBACK_MESSAGE[reason];

    // Only a lockout carries a wait, and it is the one refusal the visitor can
    // act on — "try again in 15 minutes" is a different screen from "try
    // again", so the number travels with the outcome.
    return reason === 'locked'
      ? { ok: false, reason, message, retryAfterSeconds: body?.retryAfterSeconds ?? 0 }
      : { ok: false, reason, message };
  }

  private forget(): void {
    this.token.set(null);
    this.signedIn.set(null);
    this.memoryFallback = null;

    try {
      this.storage()?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Nothing to do — the in-memory copy is already cleared.
    }
  }

  private writeMarker(document: SessionDocument): void {
    const serialized = JSON.stringify(document);

    try {
      this.storage()?.setItem(SESSION_STORAGE_KEY, serialized);
    } catch {
      // Non-fatal: the session stays in memory so the app keeps working.
    }

    this.memoryFallback = serialized;
    this.signedIn.set(document);
  }

  /**
   * The stored marker, or `null`.
   *
   * A document that fails the contract — an unknown version, unparseable JSON
   * — is reported as no session and cleared, so the next boot is not asked to
   * make sense of it again (the 001/002 fail-safe rule).
   */
  private readMarker(): SessionDocument | null {
    const raw = this.readRaw();

    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isValidSessionDocument(parsed)) return parsed;
      } catch {
        // Unparseable — fall through to the reset below.
      }

      this.forget();
    }

    return null;
  }

  private readRaw(): string | null {
    try {
      const stored = this.storage()?.getItem(SESSION_STORAGE_KEY);
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
