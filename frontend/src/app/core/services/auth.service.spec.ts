import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AccountState } from '../models/account-state';
import { INTERACTION_STORAGE_KEY } from '../models/interaction';
import { QuizState } from '../models/quiz';
import { SESSION_SCHEMA_VERSION, SESSION_STORAGE_KEY } from '../models/session';
import { AuthService } from './auth.service';
import { InteractionStore } from './interaction-store';
import { PreferenceStore } from './preference-store';
import { QUIZ_STATE_STORAGE_KEY } from './preference-store';
import { sessionInterceptor } from './session.interceptor';

/**
 * Contract tests for the client half of `specs/004-guest-auth-migration/contracts/api.md`.
 *
 * The centerpiece is the token test. Everything else here is about the request
 * the service builds and the marker it writes; that one is about what must
 * *never* exist. A credential in LocalStorage is readable by any script on the
 * origin, so an XSS that steals a 30-day refresh token is a full account
 * takeover — which is why it is asserted by walking the whole store rather
 * than by checking that one expected key is absent. A test that only looks
 * where it expects to find nothing cannot catch the key it did not expect.
 */
describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let interactions: InteractionStore;
  let preferences: PreferenceStore;

  /**
   * A distinctive token value, so a substring search for it in LocalStorage is
   * meaningful.
   *
   * Deliberately **not** JWT-shaped. Nothing decodes it — the tests compare it
   * and put it in a `Bearer` header — so the shape bought nothing and cost
   * something: a literal that looks like a real token is reported as a leaked
   * credential by secret scanners on every pull request that touches this file.
   * The value only has to be unmistakable, and this one cannot be mistaken for
   * anything a server would issue.
   */
  const ACCESS_TOKEN = 'test-access-token-not-a-credential';
  const REFRESH_TOKEN = 'refresh-token-value-that-must-stay-in-the-cookie';
  const USER_ID = '0e7d2c41-9f3a-4b8e-a1c6-5d0f9e2b3a11';

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    interactions = TestBed.inject(InteractionStore);
    preferences = TestBed.inject(PreferenceStore);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  /** The session envelope every way in returns (api.md). */
  function sessionBody(state: unknown = { interactions: {}, history: [], preferences: null }) {
    return { userId: USER_ID, email: 'visitor@example.com', accessToken: ACCESS_TOKEN, state };
  }

  /** Answers a request with a session and drains it, so callers can assert after. */
  function grantSession(request: TestRequest, state?: unknown) {
    request.flush(sessionBody(state), {
      headers: { 'Set-Cookie': `playnext.refresh=${REFRESH_TOKEN}; HttpOnly` },
    });
  }

  /** A completed quiz, the only form the account stores (data-model.md). */
  function completedQuizState(overrides: Partial<QuizState> = {}): QuizState {
    return {
      schemaVersion: 1,
      status: 'completed',
      step: 3,
      mediaType: { values: ['movie'], any: false },
      genre: { values: ['sci-fi'], any: false },
      provider: { values: [], any: true },
      includeUnownedProviders: false,
      completedAt: '2026-09-27T09:00:00.000Z',
      updatedAt: '2026-09-27T09:00:00.000Z',
      ...overrides,
    };
  }

  function readSessionMarker(): Record<string, unknown> | null {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);

    return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
  }

  describe('the guest document it sends', () => {
    it('attaches the device ratings, history and preferences to registration (US1)', () => {
      interactions.record('arrival', 'loved');
      interactions.recordWatch('dune');
      preferences.write(completedQuizState());

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();

      const request = http.expectOne('/api/auth/register');

      expect(request.request.method).toBe('POST');
      expect(request.request.body.email).toBe('visitor@example.com');
      expect(request.request.body.password).toBe('Correct-Horse-9!');

      const guest = request.request.body.guest;

      expect(guest.interactions.arrival.state).toBe('loved');
      expect(guest.history).toEqual([
        expect.objectContaining({ titleId: 'dune' }),
      ]);
      expect(guest.preferences.mediaType).toEqual({ values: ['movie'], any: false });
      expect(guest.preferences.genre).toEqual({ values: ['sci-fi'], any: false });
      expect(guest.preferences.includeUnownedProviders).toBe(false);

      grantSession(request);
    });

    it('sends the guest document in the API shape, not the stored one', () => {
      // The two shapes differ on purpose: the quiz document is versioned and
      // carries `status`/`step`, and the server's validator rejects neither a
      // version nor a status it does not know about — it simply has no use for
      // them. Forwarding the stored document verbatim would ship device
      // bookkeeping into an account record.
      preferences.write(
        completedQuizState({
          mediaType: { values: ['tv'], any: false },
          genre: { values: [], any: true },
          provider: { values: ['netflix'], any: false },
          includeUnownedProviders: true,
        }),
      );

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();

      const request = http.expectOne('/api/auth/register');
      const guest = request.request.body.guest;

      expect(guest.preferences.schemaVersion).toBeUndefined();
      expect(guest.preferences.status).toBeUndefined();
      expect(guest.preferences.step).toBeUndefined();

      grantSession(request);
    });

    it('omits the guest document entirely when there is nothing to migrate (US1 scenario 4)', () => {
      // Omitting rather than sending an empty object: `guest` is optional in
      // the contract, and a body that says "here is nothing" invites a reader
      // to conclude the device was consulted.
      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();

      const request = http.expectOne('/api/auth/register');

      expect(request.request.body.guest).toBeUndefined();

      grantSession(request);
    });

    it('attaches the guest document to sign-in too', () => {
      interactions.record('arrival', 'loved');

      service.signIn('visitor@example.com', 'Correct-Horse-9!').subscribe();

      const request = http.expectOne('/api/auth/login');

      expect(request.request.body.guest.interactions.arrival.state).toBe('loved');

      grantSession(request);
    });

    it('sends the Google credential with the guest document', () => {
      interactions.record('arrival', 'loved');

      service.signInWithGoogle('google-id-token').subscribe();

      const request = http.expectOne('/api/auth/google');

      expect(request.request.body.credential).toBe('google-id-token');
      expect(request.request.body.guest.interactions.arrival.state).toBe('loved');

      grantSession(request);
    });
  });

  describe('the session marker', () => {
    it('writes it on registration with exactly the contract fields', () => {
      // Asserted as an exact key set rather than by checking the fields we
      // expect: the way a token gets into LocalStorage is somebody adding a
      // field, and a test that names only the good fields cannot see it.
      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();

      grantSession(http.expectOne('/api/auth/register'));

      const marker = readSessionMarker();

      expect(marker).not.toBeNull();
      expect(marker!['schemaVersion']).toBe(SESSION_SCHEMA_VERSION);
      expect(marker!['userId']).toBe(USER_ID);
      expect(marker!['email']).toBe('visitor@example.com');
      expect(typeof marker!['signedInAt']).toBe('string');
      expect(Number.isNaN(Date.parse(marker!['signedInAt'] as string))).toBe(false);
      expect(Object.keys(marker!).sort()).toEqual(['email', 'schemaVersion', 'signedInAt', 'userId']);
    });

    it('does not write it when registration is refused', () => {
      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();

      http
        .expectOne('/api/auth/register')
        .flush({ code: 'email-taken', errors: ['That email already has an account. Sign in instead.'] }, {
          status: 409,
          statusText: 'Conflict',
        });

      expect(readSessionMarker()).toBeNull();
    });

    it('deletes it on sign-out (SC-007)', () => {
      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(http.expectOne('/api/auth/register'));

      expect(readSessionMarker()).not.toBeNull();

      service.signOut().subscribe();

      http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });

      expect(readSessionMarker()).toBeNull();
    });
  });

  describe('credentials never reach storage (research D6)', () => {
    it('leaves no token anywhere in LocalStorage after signing in', () => {
      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(http.expectOne('/api/auth/register'));

      const dump = Object.keys(localStorage)
        .map((key) => `${key}=${localStorage.getItem(key) ?? ''}`)
        .join('\n');

      expect(dump).not.toContain(ACCESS_TOKEN);
      expect(dump).not.toContain(REFRESH_TOKEN);
      expect(dump.toLowerCase()).not.toContain('access_token');
      expect(dump.toLowerCase()).not.toContain('refreshtoken');
    });

    it('keeps the access token in memory only', () => {
      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(http.expectOne('/api/auth/register'));

      // In memory, so the interceptor can attach it…
      expect(service.accessToken()).toBe(ACCESS_TOKEN);

      // …and gone when the page reloads, which is the point of memory-only.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });

      expect(TestBed.inject(AuthService).accessToken()).toBeNull();
    });

    it('reports the signed-in visitor from the marker, not from the token', () => {
      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(http.expectOne('/api/auth/register'));

      expect(service.session()?.email).toBe('visitor@example.com');
      expect(service.isSignedIn()).toBe(true);
    });
  });

  describe('the cookie-authenticated endpoints', () => {
    it('sends the CSRF header on refresh — without it the server answers 400', () => {
      service.refresh().subscribe();

      const request = http.expectOne('/api/auth/refresh');

      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('X-Requested-With')).toBe('playnext');

      request.flush({ accessToken: ACCESS_TOKEN });
    });

    it('takes the rotated access token from refresh', () => {
      service.refresh().subscribe();

      http.expectOne('/api/auth/refresh').flush({ accessToken: ACCESS_TOKEN });

      expect(service.accessToken()).toBe(ACCESS_TOKEN);
    });

    it('sends the CSRF header on sign-out', () => {
      service.signOut().subscribe();

      const request = http.expectOne('/api/auth/logout');

      expect(request.request.headers.get('X-Requested-With')).toBe('playnext');

      request.flush(null, { status: 204, statusText: 'No Content' });
    });
  });

  describe('failures the Profile screen has to explain', () => {
    it('reports a taken email as a value, not an error (FR-008)', () => {
      let outcome: unknown;

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe((value) => (outcome = value));

      http
        .expectOne('/api/auth/register')
        .flush({ code: 'email-taken', errors: ['That email already has an account. Sign in instead.'] }, {
          status: 409,
          statusText: 'Conflict',
        });

      expect(outcome).toEqual(
        expect.objectContaining({ ok: false, reason: 'email-taken' }),
      );
      expect((outcome as { message: string }).message).toContain('Sign in');
    });

    it('reports a lockout with the wait, which is the one actionable refusal (FR-011)', () => {
      let outcome: unknown;

      service.signIn('visitor@example.com', 'Correct-Horse-9!').subscribe((value) => (outcome = value));

      http.expectOne('/api/auth/login').flush(
        { code: 'locked', errors: ['Too many attempts. Try again in 15 minutes.'], retryAfterSeconds: 900 },
        { status: 401, statusText: 'Unauthorized' },
      );

      expect(outcome).toEqual(
        expect.objectContaining({ ok: false, reason: 'locked', retryAfterSeconds: 900 }),
      );
    });

    it('gives wrong credentials a friendly message and does not throw (FR-011)', () => {
      let outcome: unknown;
      let errored = false;

      service.signIn('visitor@example.com', 'wrong').subscribe({
        next: (value) => (outcome = value),
        error: () => (errored = true),
      });

      http.expectOne('/api/auth/login').flush(
        { code: 'invalid-credentials', errors: ['Those details did not match an account.'] },
        { status: 401, statusText: 'Unauthorized' },
      );

      // A refused sign-in is an outcome the screen renders, not an exception
      // the screen has to catch — the difference decides whether a component
      // that forgot a try/catch shows a blank page.
      expect(errored).toBe(false);
      expect(outcome).toEqual(expect.objectContaining({ ok: false, reason: 'invalid-credentials' }));
    });

    it('treats an unreachable server as offline rather than as bad credentials', () => {
      // FR-016/FR-017: the visitor is told their connection is the problem, not
      // their password. Conflating the two would send them to reset a password
      // that was never wrong.
      let outcome: unknown;

      service.signIn('visitor@example.com', 'Correct-Horse-9!').subscribe((value) => (outcome = value));

      http
        .expectOne('/api/auth/login')
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

      expect(outcome).toEqual(expect.objectContaining({ ok: false, reason: 'offline' }));
    });

    it('reports a successful registration as ok', () => {
      let outcome: unknown;

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe((value) => (outcome = value));

      grantSession(http.expectOne('/api/auth/register'));

      expect(outcome).toEqual(expect.objectContaining({ ok: true }));
    });
  });

  describe('the device cache it writes back (research D3/D7)', () => {
    /** The canonical state as the API returns it, after merging the guest in. */
    function canonicalState(overrides: Partial<AccountState> = {}): AccountState {
      return {
        interactions: { arrival: { state: 'loved', updatedAt: '2026-09-27T10:00:00.000Z' } },
        history: [{ titleId: 'arrival', chosenAt: '2026-09-27T10:00:00.000Z' }],
        preferences: {
          mediaType: { values: ['movie'], any: false },
          genre: { values: ['sci-fi'], any: false },
          provider: { values: [], any: true },
          includeUnownedProviders: false,
          completedAt: '2026-09-27T09:00:00.000Z',
          updatedAt: '2026-09-27T09:00:00.000Z',
        },
        ...overrides,
      };
    }

    it('takes the server copy as the cache, not just the ratings it sent', () => {
      // The device rated one title; the account already had another. The
      // server merges the two and returns the whole, so the cache ends up
      // holding a title the device never had — which is what shows the write
      // is the server's copy rather than an echo of the local document.
      interactions.record('dune', 'liked');

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(
        http.expectOne('/api/auth/register'),
        canonicalState({
          interactions: {
            arrival: { state: 'loved', updatedAt: '2026-09-27T10:00:00.000Z' },
            dune: { state: 'liked', updatedAt: '2026-09-27T10:05:00.000Z' },
          },
        }),
      );

      const cached = interactions.read().interactions;

      expect(cached['arrival'].state).toBe('loved');
      expect(cached['dune'].state).toBe('liked');
    });

    it('lets the account win an argument about a title both sides have rated', () => {
      // research D4's newest-wins has already been applied by the server, so
      // whatever comes back is the answer. A device that kept its own value
      // would disagree with the account about a title it just finished
      // syncing, which is the one thing a cache must never do.
      interactions.record('arrival', 'disliked');

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(
        http.expectOne('/api/auth/register'),
        canonicalState({
          interactions: {
            arrival: { state: 'loved', updatedAt: '2026-09-27T11:00:00.000Z' },
          },
        }),
      );

      expect(interactions.read().interactions['arrival'].state).toBe('loved');
    });

    it('replaces the watching history rather than appending to it', () => {
      interactions.recordWatch('dune');

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(http.expectOne('/api/auth/register'), canonicalState());

      // The server already merged the device's entry in. Appending would
      // duplicate it — `(titleId, chosenAt)` is the history's identity
      // (research D4), so the copy that arrives is the whole list.
      expect(interactions.read().history).toEqual([
        { titleId: 'arrival', chosenAt: '2026-09-27T10:00:00.000Z' },
      ]);
    });

    it('restores the quiz as a completed document the deck can read', () => {
      // The account stores a `Preference` — no `status`, no `step`, no schema
      // version. The device's key holds a `QuizState`, and 001's validator
      // rejects anything missing them, so the write-back has to rebuild the
      // wrapper. Getting that wrong reads back as "never took the quiz", which
      // would empty the deck for a visitor who just signed in.
      //
      // The device's answers are deliberately different from the account's:
      // identical fixtures would let the leftover document pass for the
      // restored one, and the test would prove nothing.
      preferences.write(
        completedQuizState({
          mediaType: { values: ['tv'], any: false },
          genre: { values: [], any: true },
        }),
      );

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(http.expectOne('/api/auth/register'), canonicalState());

      const restored = preferences.read();

      expect(restored?.status).toBe('completed');
      expect(restored?.step).toBe(3);
      expect(restored?.mediaType).toEqual({ values: ['movie'], any: false });
      expect(restored?.genre).toEqual({ values: ['sci-fi'], any: false });
    });

    it('clears the quiz when the account has none, so the cache holds one answer', () => {
      preferences.write(completedQuizState());

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(http.expectOne('/api/auth/register'), canonicalState({ preferences: null }));

      // `null` is the account saying it never completed the quiz. Keeping the
      // device's copy would leave two answers to a question the account has
      // already answered (Principle IV) — and the deck would rank against a
      // preference the account does not have.
      expect(preferences.read()).toBeNull();
    });

    it('does not touch the cache while the request is in flight (research D7)', () => {
      // The reason the guest documents survive sign-in at all: clearing them
      // as the request is sent would drop the visitor's data in the window
      // before the server's copy arrives.
      interactions.record('arrival', 'loved');
      preferences.write(completedQuizState());

      const ratingsBefore = localStorage.getItem(INTERACTION_STORAGE_KEY);
      const quizBefore = localStorage.getItem(QUIZ_STATE_STORAGE_KEY);

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();

      expect(localStorage.getItem(INTERACTION_STORAGE_KEY)).toBe(ratingsBefore);
      expect(localStorage.getItem(QUIZ_STATE_STORAGE_KEY)).toBe(quizBefore);

      grantSession(http.expectOne('/api/auth/register'), canonicalState());
    });

    it('survives a canonical state that does not match the contract', () => {
      interactions.record('arrival', 'loved');

      service.register('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(
        http.expectOne('/api/auth/register'),
        { interactions: null } as unknown as AccountState,
      );

      // The stores validate on read and fail safe, so a payload the client
      // cannot make sense of costs the cache and nothing else. The session is
      // the server's answer and stands on its own.
      expect(service.isSignedIn()).toBe(true);
      expect(interactions.read().interactions).toEqual({});
    });
  });

  /**
   * The interceptor (FR-015, research D12).
   *
   * Two jobs, tested apart because they fail apart. **Attaching the token** is
   * silent when it breaks: `GET /me/state` and `POST /me/sync` would simply go
   * out unauthenticated, the server would answer 401, and the visitor would be
   * told their session expired when it never lapsed. **The 401 chain** is the
   * noisy half — a refresh that is retried for the wrong reason, or not retried
   * for the right one, is visible only here.
   *
   * This block configures its own client, because the outer one has no
   * interceptor and the interceptor *is* the subject.
   */
  describe('the session interceptor', () => {
    /** What the refresh returns in place of the token `grantSession` handed out. */
    const RENEWED = 'test-renewed-access-token-not-a-credential';

    const CACHED = {
      interactions: { arrival: { state: 'loved', updatedAt: '2026-09-27T10:00:00.000Z' } },
      history: [{ titleId: 'arrival', chosenAt: '2026-09-27T10:00:00.000Z' }],
      preferences: null,
    };

    beforeEach(() => {
      // The outer module is replaced rather than extended: `provideHttpClient`
      // cannot be configured twice, and a test that left the outer client in
      // place would drive every request through a chain with no interceptor in
      // it and pass whatever this file did.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([sessionInterceptor])),
          provideHttpClientTesting(),
        ],
      });

      service = TestBed.inject(AuthService);
      http = TestBed.inject(HttpTestingController);
    });

    /** Signs in for real, so a token exists in memory for the chain to use. */
    function signInWithToken(): void {
      service.signIn('visitor@example.com', 'Correct-Horse-9!').subscribe();
      grantSession(http.expectOne('/api/auth/login'), CACHED);
    }

    /** Runs an authenticated API request and records how it ended. */
    function call(url: string): { failed: boolean; error: unknown } {
      const result = { failed: false, error: undefined as unknown };

      TestBed.inject(HttpClient)
        .get(url)
        .subscribe({
          next: () => undefined,
          error: (error: unknown) => {
            result.failed = true;
            result.error = error;
          },
        });

      return result;
    }

    it('carries the access token on an authenticated request', () => {
      // The defect this pins was invisible: nothing in the app attached the
      // token to `/me/state` or `/me/sync`, and no test noticed, because every
      // spec that made those calls answered them locally.
      signInWithToken();

      call('/api/me/state');

      const request = http.expectOne('/api/me/state');

      expect(request.request.headers.get('Authorization')).toBe(
        `Bearer ${ACCESS_TOKEN}`,
      );

      request.flush({});
    });

    it('leaves an unauthenticated request alone', () => {
      // Before any session exists there is no token, and a request that went
      // looking for one would be reading a signal that is `null` by design.
      call('/api/me/state');

      const request = http.expectOne('/api/me/state');

      expect(request.request.headers.has('Authorization')).toBe(false);

      request.flush({});
    });

    it('refreshes once and retries once when the token has expired (FR-015)', () => {
      signInWithToken();

      call('/api/me/state');
      http.expectOne('/api/me/state').flush(null, { status: 401, statusText: 'Unauthorized' });

      // The refresh is cookie-authenticated, so it carries the CSRF header and
      // no bearer — the chain must not try to fix the dead token with itself.
      const refresh = http.expectOne('/api/auth/refresh');

      expect(refresh.request.method).toBe('POST');
      expect(refresh.request.headers.get('X-Requested-With')).toBe('playnext');
      expect(refresh.request.headers.has('Authorization')).toBe(false);

      refresh.flush({ accessToken: RENEWED });

      // The retry is the *same* request with the *new* token: replaying the old
      // one would 401 again and prove nothing.
      const retry = http.expectOne('/api/me/state');

      expect(retry.request.headers.get('Authorization')).toBe(
        `Bearer ${RENEWED}`,
      );

      retry.flush({ ok: true });
    });

    it('retries once and then stops, even if the retry is refused too', () => {
      // The loop hazard. A second lap would mean refreshing against a token the
      // server issued seconds ago, and it would not terminate on a server that
      // keeps saying no — the visitor would watch a spinner and a request storm.
      signInWithToken();

      const result = call('/api/me/state');

      http.expectOne('/api/me/state').flush(null, { status: 401, statusText: 'Unauthorized' });
      http.expectOne('/api/auth/refresh').flush({ accessToken: RENEWED });

      // The retry fails in its own right.
      http.expectOne('/api/me/state').flush(null, { status: 401, statusText: 'Unauthorized' });

      http.expectNone('/api/auth/refresh');

      expect(result.failed).toBe(true);
    });

    it('drops to guest mode with the cached data intact when the refresh is refused', () => {
      // The spec's expired-session edge case, and the reason `expire` exists
      // apart from `signOut`: the visitor did not ask to leave, so the session
      // ends and nothing else does. SC-007's wipe is the *other* path.
      signInWithToken();

      const result = call('/api/me/state');

      http.expectOne('/api/me/state').flush(null, { status: 401, statusText: 'Unauthorized' });
      http
        .expectOne('/api/auth/refresh')
        .flush({ code: 'invalid-credentials' }, { status: 401, statusText: 'Unauthorized' });

      expect(service.isSignedIn()).toBe(false);
      expect(readSessionMarker()).toBeNull();

      // Everything the visitor was looking at is still there. A sign-out here
      // would have wiped it, and they would have lost ratings they never asked
      // to give up — the dead end Principle II forbids.
      expect(localStorage.getItem(INTERACTION_STORAGE_KEY)).not.toBeNull();
      expect(interactions.read().interactions['arrival']?.state).toBe('loved');

      // The original 401 reaches the caller rather than being swallowed: the
      // request did fail, and whoever asked is the one that knows what to do.
      expect(result.failed).toBe(true);
    });

    it('does not end the session when the refresh never reached the server', () => {
      // `RefreshOutcome` has three values for this. Status 0 is a request that
      // never arrived, which proves the connection failed and nothing about the
      // session — reading it as expiry would sign a visitor out for walking
      // into a lift, and their cached data would be orphaned on a device that
      // no longer believes it has an account.
      signInWithToken();

      const result = call('/api/me/state');

      http.expectOne('/api/me/state').flush(null, { status: 401, statusText: 'Unauthorized' });
      http.expectOne('/api/auth/refresh').error(new ProgressEvent('error'), { status: 0 });

      expect(service.isSignedIn()).toBe(true);
      expect(readSessionMarker()).not.toBeNull();
      expect(result.failed).toBe(true);
    });

    it('leaves a failure that is not an expiry alone', () => {
      // A 500 is the server having a bad day. Refreshing on it would spend a
      // rotation — and a rotation the server did not ask for is one the client
      // did not need.
      signInWithToken();

      const result = call('/api/me/state');

      http.expectOne('/api/me/state').flush(null, { status: 500, statusText: 'Server Error' });

      http.expectNone('/api/auth/refresh');
      expect(result.failed).toBe(true);
    });

    it('does not chain a 401 from an endpoint that establishes a session', () => {
      // `/auth/login` answering 401 means the password was wrong. Retrying it
      // would spend a second of the five attempts FR-011 allows, so three wrong
      // guesses would lock the account while the visitor was told they had two
      // left. The message would be a lie produced by the retry logic.
      service.signIn('visitor@example.com', 'wrong-password').subscribe();

      http
        .expectOne('/api/auth/login')
        .flush({ code: 'invalid-credentials' }, { status: 401, statusText: 'Unauthorized' });

      http.expectNone('/api/auth/refresh');
    });

    it('does not chain a 401 from change-password, which carries a token but is not an expiry', () => {
      // The narrow case, and the one a rule written as "retry authorized
      // requests" would get wrong: this call *does* have a bearer token, so it
      // looks exactly like a request whose token ran out. Its 401 is the
      // server's answer about the current password.
      signInWithToken();

      service.changePassword('wrong-current', 'Battery-Staple-7!').subscribe();

      const request = http.expectOne('/api/auth/change-password');

      expect(request.request.headers.get('Authorization')).toBe(
        `Bearer ${ACCESS_TOKEN}`,
      );

      request.flush({ code: 'invalid-credentials' }, { status: 401, statusText: 'Unauthorized' });

      http.expectNone('/api/auth/refresh');
      expect(service.isSignedIn()).toBe(true);
    });
  });
});
