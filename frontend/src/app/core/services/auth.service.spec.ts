import { provideHttpClient } from '@angular/common/http';
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

  /** A JWT-shaped token, so a substring search for it in LocalStorage is meaningful. */
  const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signature-part';
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
});
