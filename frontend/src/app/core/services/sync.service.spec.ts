import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AccountState } from '../models/account-state';
import { INTERACTION_STORAGE_KEY } from '../models/interaction';
import { RateOperation, SYNC_PENDING_STORAGE_KEY, SyncOperation } from '../models/sync';
import { AuthService } from './auth.service';
import { InteractionStore } from './interaction-store';
import { PreferenceStore } from './preference-store';
import { SyncService } from './sync.service';

/**
 * Contract tests for the write half of `specs/004-guest-auth-migration/contracts/`.
 *
 * Two documents are pinned here, and they are worth reading together because
 * the pair *is* the offline story (FR-017, SC-010):
 *
 * - `api.md` — one write endpoint whose semantics are the merge rule, so a
 *   live change, a replayed queue and a guest migration are not three code
 *   paths that have to agree but one call made three times.
 * - `device-storage.md` — the queue is cleared only after the server confirms,
 *   a `400` is never retried, and a network failure leaves it intact.
 *
 * The failure classification is the part most likely to be got wrong, because
 * "it didn't work" collapses three different situations into one. A refused
 * body is the *client's* mistake and will be refused identically forever; an
 * unreachable server is nobody's mistake and is worth retrying. Queueing the
 * first turns one malformed operation into a permanent, silently-failing tax
 * on every future replay; dropping the second loses a decision the visitor
 * actually made.
 */
describe('SyncService', () => {
  let service: SyncService;
  let http: HttpTestingController;
  let auth: AuthService;
  let interactions: InteractionStore;
  let preferences: PreferenceStore;

  const USER_ID = '0e7d2c41-9f3a-4b8e-a1c6-5d0f9e2b3a11';
  const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signature-part';
  const EARLIER = '2026-09-27T10:00:00.000Z';
  const LATER = '2026-09-27T11:00:00.000Z';

  /** An account that has rated nothing; the state a fresh sign-in returns. */
  const EMPTY_STATE: AccountState = { interactions: {}, history: [], preferences: null };

  const RATE: RateOperation = {
    kind: 'rate',
    titleId: 'arrival',
    state: 'loved',
    updatedAt: EARLIER,
  };

  const RATE_AGAIN: RateOperation = { ...RATE, state: 'disliked', updatedAt: LATER };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(SyncService);
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    interactions = TestBed.inject(InteractionStore);
    preferences = TestBed.inject(PreferenceStore);
  });

  afterEach(() => {
    // What makes the negative claims real: a test that says "nothing is sent"
    // only means something because an unexpected request would fail here.
    //
    // Cleared first, because a failing `verify()` throws and the clear below it
    // would then never run — leaving a queue on the device for the next spec
    // file, whose unexpected requests then fail too. One real failure turns
    // into a dozen unrelated ones, which is the worst possible moment to make a
    // suite hard to read.
    localStorage.clear();
    http.verify();
  });

  /** Puts one operation in the queue by failing a push. */
  function queueOne(): void {
    service.push([RATE]).subscribe();
    http.expectOne('/api/me/sync').error(new ProgressEvent('error'));
  }

  /** Signs in, and takes the session envelope off the wire. */
  function signIn(state: AccountState = EMPTY_STATE): void {
    auth.signIn('visitor@example.com', 'Correct-Horse-9!').subscribe();
    http
      .expectOne('/api/auth/login')
      .flush({ userId: USER_ID, email: 'visitor@example.com', accessToken: ACCESS_TOKEN, state });
  }

  /** The queue as it is actually stored — the only copy that survives a reload. */
  function queued(): SyncOperation[] {
    const raw = localStorage.getItem(SYNC_PENDING_STORAGE_KEY);
    if (raw === null) return [];

    return (JSON.parse(raw) as { operations: SyncOperation[] }).operations;
  }

  describe('a signed-in change', () => {
    it('pushes the changed items to the one write endpoint', () => {
      signIn();

      let outcome: unknown;
      service.push([RATE]).subscribe((value) => (outcome = value));

      const request = http.expectOne('/api/me/sync');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        interactions: { arrival: { state: 'loved', updatedAt: EARLIER } },
      });

      request.flush(EMPTY_STATE);
      expect(outcome).toEqual({ ok: true });
    });

    it('takes the merged state back into the device as its cache', () => {
      signIn();

      service.push([RATE]).subscribe();

      http.expectOne('/api/me/sync').flush({
        interactions: {
          arrival: { state: 'loved', updatedAt: EARLIER },
          dune: { state: 'wantToWatch', updatedAt: EARLIER },
        },
        history: [{ titleId: 'arrival', chosenAt: EARLIER }],
        preferences: null,
      });

      const cached = interactions.read();
      expect(Object.keys(cached.interactions).sort()).toEqual(['arrival', 'dune']);
      expect(cached.history).toEqual([{ titleId: 'arrival', chosenAt: EARLIER }]);
    });

    it('sends an unrating as a removal, never as a rating that went missing', () => {
      signIn();

      service.push([RATE, { kind: 'remove', titleId: 'arrival', updatedAt: LATER }]).subscribe();

      const request = http.expectOne('/api/me/sync');
      const body = request.request.body;

      // The fold keeps only the later claim, so the title leaves as a removal.
      // Sent as an absent key instead, the server would read the body as "no
      // opinion about arrival" and the account's rating would survive — the
      // opposite of what the visitor did, and silently so.
      expect(body.removals).toEqual([{ titleId: 'arrival', updatedAt: LATER }]);
      expect(body.interactions).toBeUndefined();

      request.flush(EMPTY_STATE);
    });

    it('keeps only the newest claim for a title rated twice', () => {
      signIn();

      service.push([RATE, RATE_AGAIN]).subscribe();

      const request = http.expectOne('/api/me/sync');
      expect(request.request.body.interactions).toEqual({
        arrival: { state: 'disliked', updatedAt: LATER },
      });

      request.flush(EMPTY_STATE);
    });
  });

  describe('a store write while signed in', () => {
    it('reaches the account without the store knowing that auth exists', () => {
      signIn();

      interactions.record('arrival', 'loved');

      // The store wrote its own document and said so; nothing in the store
      // named an account, a URL or a token (research D9).
      expect(interactions.read().interactions['arrival'].state).toBe('loved');

      const request = http.expectOne('/api/me/sync');
      expect(request.request.body.interactions['arrival'].state).toBe('loved');

      request.flush(EMPTY_STATE);
    });

    it('does not push the account its own state straight back', () => {
      signIn();

      interactions.record('arrival', 'loved');

      // Caching a response is not a decision by the visitor, and the cache
      // write reaches the same two stores the visitor's writes do. Were either
      // of them to announce it, this push would trigger the next one — a sync
      // loop with no end, and a request storm on the visitor's connection.
      // Nothing below asserts that; `http.verify()` in afterEach is what fails
      // if a second request was made.
      http.expectOne('/api/me/sync').flush({
        interactions: { arrival: { state: 'loved', updatedAt: EARLIER } },
        history: [],
        preferences: {
          mediaType: { values: ['movie'], any: false },
          genre: { values: ['sci-fi'], any: false },
          provider: { values: ['netflix'], any: false },
          includeUnownedProviders: false,
          completedAt: EARLIER,
          updatedAt: EARLIER,
        },
      });

      // Both halves of the cache write landed, so both paths were exercised.
      expect(interactions.read().interactions['arrival'].state).toBe('loved');
      expect(preferences.read()!.status).toBe('completed');
    });
  });

  describe('when the server cannot be reached', () => {
    it('queues the change and leaves the local write in place', () => {
      signIn();

      let outcome: unknown;
      service.push([RATE]).subscribe((value) => (outcome = value));

      http.expectOne('/api/me/sync').error(new ProgressEvent('error'));

      // FR-017: the visitor's decision is not lost just because the network
      // was. The device document is the copy they keep working from.
      expect(outcome).toEqual({ ok: false, reason: 'deferred' });
      expect(queued()).toEqual([RATE]);
    });

    it('keeps the operations in the order they happened', () => {
      signIn();

      service.push([RATE]).subscribe();
      http.expectOne('/api/me/sync').error(new ProgressEvent('error'));

      service.push([{ kind: 'history', titleId: 'arrival', chosenAt: LATER }]).subscribe();
      http.expectOne('/api/me/sync').error(new ProgressEvent('error'));

      expect(queued().map((operation) => operation.kind)).toEqual(['rate', 'history']);
    });

    it('does not overwrite a queued operation when a second push also fails', () => {
      signIn();

      service.push([RATE]).subscribe();
      http.expectOne('/api/me/sync').error(new ProgressEvent('error'));

      service.push([RATE_AGAIN]).subscribe();
      http.expectOne('/api/me/sync').error(new ProgressEvent('error'));

      // Never deduplicated on the device: two ratings of one title are two
      // decisions, and which one wins is the server's newest-wins call to make
      // (device-storage.md).
      expect(queued()).toEqual([RATE, RATE_AGAIN]);
    });
  });

  describe('when the body is refused', () => {
    it('surfaces the reason and queues nothing', () => {
      signIn();

      let outcome: { ok: boolean; reason?: string; message?: string } | undefined;
      service.push([RATE]).subscribe((value) => (outcome = value));

      http
        .expectOne('/api/me/sync')
        .flush(
          { code: 'invalid-payload', errors: ['A title cannot be both rated and removed.'] },
          { status: 400, statusText: 'Bad Request' },
        );

      expect(outcome).toEqual({
        ok: false,
        reason: 'refused',
        message: 'A title cannot be both rated and removed.',
      });

      // The body is the client's mistake and would be refused identically on
      // every replay, so queueing it would tax every future sync forever.
      expect(queued()).toEqual([]);
    });
  });

  /**
   * The queue's other way out (FR-017, SC-010).
   *
   * `replay()` was written in T029 and tested in T027 — whose wording was
   * "replay on reconnect" — but nothing called it on a reconnect, or on boot,
   * or anywhere except sign-out, which discards the queue rather than sending
   * it. So the change the queue exists to protect was the one most likely to be
   * thrown away, and the two moments it belonged at are exactly the two.
   *
   * The requirement names this one: changes made offline MUST apply
   * *automatically when the connection returns*. A queue that waits for the
   * next launch does not meet that, which matters most for the case it was
   * written for — an installed app that stays open for days.
   */
  describe('when the connection comes back', () => {
    /** What the browser does when the connection drops or returns. */
    function browserReports(state: 'online' | 'offline'): void {
      window.dispatchEvent(new Event(state));
    }

    it('sends what was queued while it was down (FR-017)', () => {
      signIn();
      queueOne();

      expect(queued()).toHaveLength(1);

      // Nothing else happens: no tap, no reload, no second request to carry it.
      browserReports('offline');
      browserReports('online');

      const drain = http.expectOne('/api/me/sync');

      expect(drain.request.body).toEqual({
        interactions: { arrival: { state: 'loved', updatedAt: EARLIER } },
      });

      drain.flush(EMPTY_STATE);

      expect(queued()).toEqual([]);
    });

    it('sends nothing when the connection drops', () => {
      signIn();
      queueOne();

      browserReports('offline');

      // `http.verify()` in `afterEach` is the assertion. Going offline is not a
      // moment to attempt a send, and a retry that could not tell the two
      // events apart would spend a request per drop for nothing.
      expect(queued()).toHaveLength(1);
    });

    it('sends nothing when there is no session left to send it with', () => {
      signIn();
      queueOne();

      // A queue outlives the session on purpose: an expired one keeps it for
      // the next sign-in, which is the path that already knows how to merge a
      // device's state into an account (`device-storage.md`).
      auth.expire();

      browserReports('offline');
      browserReports('online');

      // Sending it here would be a write with no credential, and its 401 would
      // say nothing about a session that is already over.
      expect(queued()).toHaveLength(1);
    });
  });

  describe('replay', () => {
    it('clears the queue once the server confirms', () => {
      signIn();
      queueOne();

      // The precondition, asserted. Clearing an already-empty queue would
      // satisfy the assertion at the end while proving nothing.
      expect(queued()).toHaveLength(1);

      let outcome: unknown;
      service.replay().subscribe((value) => (outcome = value));

      const request = http.expectOne('/api/me/sync');
      expect(request.request.body).toEqual({
        interactions: { arrival: { state: 'loved', updatedAt: EARLIER } },
      });

      request.flush(EMPTY_STATE);

      expect(outcome).toEqual({ ok: true });
      expect(queued()).toEqual([]);
    });

    it('keeps the queue when the replay fails rather than queueing it twice', () => {
      signIn();
      queueOne();

      service.replay().subscribe();
      http.expectOne('/api/me/sync').error(new ProgressEvent('error'));

      // Re-enqueueing on failure would double the queue on every attempt, and
      // the queue is already the record of what has not been sent.
      expect(queued()).toEqual([RATE]);
    });

    it('sends nothing when the queue is empty', () => {
      signIn();

      let outcome: unknown;
      service.replay().subscribe((value) => (outcome = value));

      expect(outcome).toEqual({ ok: true });
      // `http.verify()` in afterEach is what makes this a real claim.
    });
  });

  describe('while signed out', () => {
    it('sends nothing and queues nothing', () => {
      interactions.record('arrival', 'loved');

      // There is no account to reach, so there is nothing to push and nothing
      // to retry. The device document is the only copy, and it is the thing
      // the next sign-in migrates.
      expect(interactions.read().interactions['arrival'].state).toBe('loved');
      expect(localStorage.getItem(INTERACTION_STORAGE_KEY)).not.toBeNull();
      expect(queued()).toEqual([]);
    });
  });
});
