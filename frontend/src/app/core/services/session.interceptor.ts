import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * The two things every request to this API needs and no caller should have to
 * remember: the credential it travels with, and what to do when the server says
 * that credential is no good (FR-015, research D12).
 *
 * **Attaching the token.** The access token lives in memory and in exactly one
 * place, `AuthService`. Every authenticated endpoint — `GET /me/state`,
 * `POST /me/sync`, `POST /auth/change-password` — would otherwise have to reach
 * into that service and build its own header, which is three copies of one
 * decision and three chances to forget.
 *
 * **The 401 chain.** A 401 on an authenticated call means the fifteen-minute
 * access token has run out, and the visitor has done nothing wrong. The
 * response is one silent refresh and one retry; if the refresh is *refused*,
 * the session is genuinely over and the client drops to signed-out guest mode
 * with the cached data intact — the spec's "session expired" edge case, where
 * the visitor is asked to sign in again and loses nothing. Signing out is the
 * opposite of that and is not this file's business (SC-007).
 *
 * One retry, never a loop: a retry that itself 401s has already been given a
 * fresh token, so a second lap would mean the server is refusing a credential
 * it just issued, and asking again would spin.
 */

/**
 * The auth namespace: where a 401 is an **answer, not an expiry**.
 *
 * `/auth/login` saying the password was wrong, `/auth/refresh` saying the cookie
 * is dead, `/auth/change-password` saying the current password was wrong. None
 * of these is a token running out, so the chain stops at the prefix and the
 * caller gets the response it asked for.
 *
 * The lockout makes this more than tidiness. `/auth/login` counts failures
 * against the account (FR-011), so a chain that retried a wrong password would
 * spend two of the five attempts the visitor is allowed — three wrong guesses
 * would block them while the message said they had two left. The refusal would
 * be a lie the retry logic told.
 */
const AUTH_NAMESPACE = '/api/auth/';

/**
 * The endpoints that establish or end a session, and have no use for a token.
 *
 * A separate list from the one above because the two rules genuinely differ:
 * `change-password` sits in the same namespace and *must* carry a token. So
 * "no token" is not "the auth namespace" — it is these five, each of which
 * authenticates with the refresh cookie or with the credentials in its own
 * body. Sending a bearer token to them would be a credential offered to an
 * endpoint that never asked, which is how a stale token ends up in a log.
 */
const COOKIE_OR_CREDENTIAL_PATHS = [
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/google',
  '/api/auth/refresh',
  '/api/auth/logout',
] as const;

export const sessionInterceptor: HttpInterceptorFn = (request, next) => {
  // Injected per request, inside the injection context the interceptor runs in.
  // `AuthService` holds the token and reaches the same `HttpClient` this
  // request came through — which is safe only because the chain below never
  // re-enters itself for a session endpoint.
  const auth = inject(AuthService);
  const token = auth.accessToken();

  const authorized =
    token === null || COOKIE_OR_CREDENTIAL_PATHS.some((path) => request.url.includes(path))
      ? request
      : request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

  if (request.url.includes(AUTH_NAMESPACE)) {
    return next(authorized);
  }

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }

      return auth.refresh().pipe(
        switchMap((outcome) => {
          if (outcome === 'refreshed') {
            return next(
              request.clone({ setHeaders: { Authorization: `Bearer ${auth.accessToken() ?? ''}` } }),
            );
          }

          // Refused: the server will not renew this session, so it is over.
          // `expire` rather than `signOut` — the marker goes, the cache stays,
          // and the Profile invites the visitor back (D12). Only a refusal:
          // `unreachable` means the refresh never arrived, which proves nothing
          // about the session, and treating it as expiry is what
          // `RefreshOutcome` exists to prevent — it would sign a visitor out
          // for walking into a lift.
          if (outcome === 'refused') auth.expire();

          // The original 401 travels on either way. The caller is the one that
          // knows what to do with it — a queued change stays queued, a state
          // read is retried on the next boot.
          return throwError(() => error);
        }),
      );
    }),
  );
};
