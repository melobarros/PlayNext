import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { INTERACTION_STORAGE_KEY } from '../models/interaction';
import { createSessionDocument, SESSION_STORAGE_KEY } from '../models/session';
import { SYNC_PENDING_STORAGE_KEY } from '../models/sync';
import { AccountCache } from './account-cache';
import { AuthService } from './auth.service';
import { InteractionStore } from './interaction-store';
import { SessionBoot } from './session-boot';

/**
 * Boot-restore contract tests (FR-015, FR-017, research D12).
 *
 * The centerpiece is the pair of failures. A refresh that fails is not one
 * situation but two, and they want opposite things: a server that *refused*
 * means the session is over, while a server that was *never reached* means
 * nothing at all is known. Reading the second as the first signs a visitor out
 * for being on a train — and the visitor most likely to be on a train is the
 * one who just rated something offline.
 *
 * The other half is what expiry must *not* do. The visitor did not ask to
 * leave, so their cached ratings stay on the device (D12). Wiping here instead
 * of at sign-out is an easy slip, because the two paths differ by one call.
 */
describe('SessionBoot', () => {
  let boot: SessionBoot;
  let http: HttpTestingController;
  let auth: AuthService;
  let interactions: InteractionStore;

  const USER_ID = '0e7d2c41-9f3a-4b8e-a1c6-5d0f9e2b3a11';
  const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signature-part';
  const EARLIER = '2026-09-27T10:00:00.000Z';

  /**
   * Builds the app the way a page load does: the marker is already on the
   * device before anything is injected, because `AuthService` reads it in its
   * constructor. Writing it afterwards would produce a service that never saw
   * it, and every test here would then be exercising the guest path.
   */
  function bootDevice(
    options: { marker?: boolean; cached?: boolean; queued?: boolean } = {},
  ): void {
    const { marker = true, cached = true, queued = false } = options;

    localStorage.clear();

    if (marker) {
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify(createSessionDocument(USER_ID, 'visitor@example.com', EARLIER)),
      );
    }

    if (queued) {
      // A signed-in visitor who rated something with no connection: the local
      // document already holds the rating (`dune`), and this is the record of
      // what the account has not been told yet.
      localStorage.setItem(
        SYNC_PENDING_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          operations: [{ kind: 'rate', titleId: 'dune', state: 'loved', updatedAt: EARLIER }],
        }),
      );
    }

    if (cached) {
      localStorage.setItem(
        INTERACTION_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          interactions: { arrival: { state: 'loved', updatedAt: EARLIER } },
          history: [{ titleId: 'arrival', chosenAt: EARLIER }],
          updatedAt: EARLIER,
        }),
      );
    }

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    boot = TestBed.inject(SessionBoot);
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    interactions = TestBed.inject(InteractionStore);
    TestBed.inject(AccountCache);
  }

  /** Restores, and yields the result. */
  function restored(): unknown {
    let result: unknown;
    boot.restore().subscribe((value) => (result = value));

    return result;
  }

  afterEach(() => {
    // Cleared *before* verifying, not after. A failing `verify()` throws, and
    // the clear below it would then never run — leaving a queue or a marker on
    // the device for the next spec file to find. That turns one real failure
    // into a dozen unrelated ones, which is the worst possible time to make a
    // suite hard to read.
    localStorage.clear();
    http.verify();
  });

  describe('a visitor who has never signed in', () => {
    it('asks nothing and stays a guest', () => {
      bootDevice({ marker: false });

      expect(restored()).toEqual({ state: 'guest' });

      // No marker, so there is no session to check on — and `http.verify()`
      // is what proves no refresh was attempted anyway.
    });
  });

  describe('a returning signed-in visitor', () => {
    it('refreshes and takes the account state into the cache', () => {
      bootDevice();

      let result: unknown;
      boot.restore().subscribe((value) => (result = value));

      http.expectOne('/api/auth/refresh').flush({ accessToken: ACCESS_TOKEN });

      const pull = http.expectOne('/api/me/state');
      expect(pull.request.method).toBe('GET');
      pull.flush({
        interactions: {
          arrival: { state: 'loved', updatedAt: EARLIER },
          dune: { state: 'wantToWatch', updatedAt: EARLIER },
        },
        history: [{ titleId: 'arrival', chosenAt: EARLIER }],
        preferences: null,
      });

      expect(result).toEqual({ state: 'restored' });
      expect(Object.keys(interactions.read().interactions).sort()).toEqual(['arrival', 'dune']);
    });

    it('stays signed in when the state fetch fails after a good refresh', () => {
      bootDevice();

      let result: unknown;
      boot.restore().subscribe((value) => (result = value));

      http.expectOne('/api/auth/refresh').flush({ accessToken: ACCESS_TOKEN });
      http.expectOne('/api/me/state').error(new ProgressEvent('error'));

      // The server just confirmed the session, so dropping it over a dropped
      // *second* request would answer the wrong question. What the visitor
      // loses is freshness, not their session or their data.
      expect(result).toEqual({ state: 'restored' });
      expect(auth.isSignedIn()).toBe(true);
      expect(interactions.read().interactions['arrival'].state).toBe('loved');
    });
  });

  /**
   * The queue's only way out (FR-017, SC-010).
   *
   * `SyncService.replay()` existed from T029 and was tested from T027, but
   * nothing ever *called* it except the sign-out flow — and sign-out discards
   * the queue rather than sending it. So a change made offline was queued,
   * never retried, and then thrown away by the one code path that touched it:
   * the queue lost exactly the change it was created to protect.
   *
   * Boot is the trigger because boot is where a live session is confirmed, and
   * a queue can only exist for a session. The device's own copy already holds
   * the change — operations are queued *after* the local write applies — so a
   * drain that fails costs nothing, and the next sign-in merges it anyway.
   */
  describe('the queue a connection left behind', () => {
    it('sends what was queued while the connection was down (FR-017)', () => {
      bootDevice({ queued: true });

      let result: unknown;
      boot.restore().subscribe((value) => (result = value));

      http.expectOne('/api/auth/refresh').flush({ accessToken: ACCESS_TOKEN });

      // The account's copy as it stands — it has `arrival` and knows nothing
      // about the offline rating, which is the whole reason the queue exists.
      http.expectOne('/api/me/state').flush({
        interactions: { arrival: { state: 'loved', updatedAt: EARLIER } },
        history: [{ titleId: 'arrival', chosenAt: EARLIER }],
        preferences: null,
      });

      const drain = http.expectOne('/api/me/sync');

      expect(drain.request.method).toBe('POST');
      expect(drain.request.body.interactions['dune']).toEqual({
        state: 'loved',
        updatedAt: EARLIER,
      });

      drain.flush({
        interactions: {
          arrival: { state: 'loved', updatedAt: EARLIER },
          dune: { state: 'loved', updatedAt: EARLIER },
        },
        history: [{ titleId: 'arrival', chosenAt: EARLIER }],
        preferences: null,
      });

      // The pull goes first and the drain second, so the account's *merged*
      // answer is the last thing written to the cache. Draining first would
      // leave the older pull response on top and quietly undo the sync — the
      // rating would reach the account and vanish from the device showing it.
      expect(localStorage.getItem(SYNC_PENDING_STORAGE_KEY)).toBeNull();
      expect(interactions.read().interactions['dune'].state).toBe('loved');
      expect(interactions.read().interactions['arrival'].state).toBe('loved');
      expect(result).toEqual({ state: 'restored' });
    });

    it('asks for nothing when there is nothing queued', () => {
      bootDevice();

      boot.restore().subscribe();
      http.expectOne('/api/auth/refresh').flush({ accessToken: ACCESS_TOKEN });
      http.expectOne('/api/me/state').flush({ interactions: {}, history: [], preferences: null });

      // The empty case is the ordinary one, and `http.verify()` in `afterEach`
      // is what proves no `/api/me/sync` went out — a drain that fired on every
      // boot would be a write request per page load for nothing.
      expect(localStorage.getItem(SYNC_PENDING_STORAGE_KEY)).toBeNull();
    });

    it('keeps the queue when the drain cannot be sent', () => {
      bootDevice({ queued: true });

      let result: unknown;
      boot.restore().subscribe((value) => (result = value));

      http.expectOne('/api/auth/refresh').flush({ accessToken: ACCESS_TOKEN });
      http.expectOne('/api/me/state').flush({ interactions: {}, history: [], preferences: null });
      http.expectOne('/api/me/sync').error(new ProgressEvent('error'));

      // Nothing was lost and nothing was claimed: the queue still holds the
      // change, and the visitor is still signed in and still booted. A failed
      // drain is not a failed boot — the two are different questions.
      expect(localStorage.getItem(SYNC_PENDING_STORAGE_KEY)).not.toBeNull();
      expect(result).toEqual({ state: 'restored' });
      expect(auth.isSignedIn()).toBe(true);
    });

    it('still drains when the state pull failed', () => {
      bootDevice({ queued: true });

      boot.restore().subscribe();

      http.expectOne('/api/auth/refresh').flush({ accessToken: ACCESS_TOKEN });
      http.expectOne('/api/me/state').error(new ProgressEvent('error'));

      // The pull is the disposable half — it costs freshness. The queue holds
      // changes the account has never seen, so it gets its own attempt rather
      // than being dropped along with a request it has nothing to do with.
      http.expectOne('/api/me/sync').flush({
        interactions: { dune: { state: 'loved', updatedAt: EARLIER } },
        history: [],
        preferences: null,
      });

      expect(localStorage.getItem(SYNC_PENDING_STORAGE_KEY)).toBeNull();
    });

    it('does not send it when the session is over', () => {
      bootDevice({ queued: true });

      boot.restore().subscribe();
      http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

      // There is no account to send it to, and the queue must survive to be
      // merged by the next sign-in — which is the path that already handles
      // "the device has state the account does not". Draining here would be a
      // write with no credential, and clearing it would be the same loss the
      // sign-out warning exists to prevent, minus the warning.
      expect(localStorage.getItem(SYNC_PENDING_STORAGE_KEY)).not.toBeNull();
    });
  });

  /**
   * The sink's only observer, which used to arrive far too late.
   *
   * `WriteSink` announces a local write to whoever is listening, and the
   * listener is `SyncService` — registered in its constructor. Nothing
   * constructed it but the Profile screen, so a signed-in visitor who rated a
   * title from the deck pushed nothing: the sink had no observer, `notify` ran
   * its loop zero times, and the change sat in the device document with no
   * request and nothing queued. Nothing failed, which is why nothing said so.
   *
   * Boot is where the fix belongs and where this is asserted, because boot is
   * the one thing that certainly happens before the first tap.
   */
  describe('the write sink', () => {
    it('has a listener from boot, not from the first visit to Profile', () => {
      bootDevice();

      boot.restore().subscribe();
      http.expectOne('/api/auth/refresh').flush({ accessToken: ACCESS_TOKEN });
      http.expectOne('/api/me/state').flush({ interactions: {}, history: [], preferences: null });

      // A rating taken on the deck, minutes later. Nothing has opened the
      // Profile screen in this page load and nothing ever will.
      interactions.record('dune', 'loved');

      const push = http.expectOne('/api/me/sync');

      expect(push.request.body.interactions['dune'].state).toBe('loved');
      push.flush({
        interactions: { dune: { state: 'loved', updatedAt: EARLIER } },
        history: [],
        preferences: null,
      });

      expect(interactions.read().interactions['dune'].state).toBe('loved');
    });
  });

  describe('a session the server refuses', () => {
    it('drops the marker and reports the expiry', () => {
      bootDevice();

      let result: unknown;
      boot.restore().subscribe((value) => (result = value));

      http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(result).toEqual({ state: 'expired' });
      expect(auth.isSignedIn()).toBe(false);
      expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    });

    it('leaves the cached data on the device (D12)', () => {
      bootDevice();

      boot.restore().subscribe();
      http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

      // The visitor did not ask to leave; their session ran out while they
      // were away. Emptying the device would be a dead end with their own
      // ratings on the other side of it.
      const cached = interactions.read();
      expect(cached.interactions['arrival'].state).toBe('loved');
      expect(cached.history).toHaveLength(1);
      expect(localStorage.getItem(INTERACTION_STORAGE_KEY)).not.toBeNull();
    });
  });

  describe('a server that cannot be reached', () => {
    it('reports offline and keeps the session', () => {
      bootDevice();

      let result: unknown;
      boot.restore().subscribe((value) => (result = value));

      http.expectOne('/api/auth/refresh').error(new ProgressEvent('error'));

      // Nothing is known about the session, so nothing is concluded about it.
      // The marker stays and the app runs from the cache — signed-in offline
      // mode (FR-017), which is a state the app supports, not an error.
      expect(result).toEqual({ state: 'offline' });
      expect(auth.isSignedIn()).toBe(true);
      expect(localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
    });

    it('treats a server error as unreachable rather than as a refusal', () => {
      bootDevice();

      let result: unknown;
      boot.restore().subscribe((value) => (result = value));

      http
        .expectOne('/api/auth/refresh')
        .flush(null, { status: 503, statusText: 'Service Unavailable' });

      // A 5xx is the server having a bad day, not the session being over.
      expect(result).toEqual({ state: 'offline' });
      expect(auth.isSignedIn()).toBe(true);
    });

    it('keeps the cached data, which is all the visitor can use', () => {
      bootDevice();

      boot.restore().subscribe();
      http.expectOne('/api/auth/refresh').error(new ProgressEvent('error'));

      expect(interactions.read().interactions['arrival'].state).toBe('loved');
    });
  });
});
