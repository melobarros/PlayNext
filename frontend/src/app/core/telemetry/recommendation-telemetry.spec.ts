import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../services/auth.service';
import { RecommendationTelemetry } from './recommendation-telemetry';
import { TelemetrySession } from './telemetry-session';
import { TELEMETRY_TRANSPORT, TelemetrySendResult, TelemetryTransport } from './telemetry-transport';
import { TelemetryBatch } from '../models/telemetry';

/**
 * The queue and the flush policy (T023, research D8).
 *
 * Everything here is about the two promises the service makes to the deck: that
 * recording is synchronous and cannot fail in a way the visitor sees, and that
 * what it sends is a faithful, partitioned, bounded copy of what happened. The
 * transport is faked rather than `fetch`-stubbed so each test can decide
 * exactly what the server answered — and so a test that forgets to look at the
 * network cannot accidentally make one.
 */

type Reply = TelemetrySendResult | 'network';

class FakeTransport implements TelemetryTransport {
  readonly calls: { batch: TelemetryBatch; accessToken: string | null; keepalive: boolean }[] = [];

  private replies: Reply[] = [];

  /** Answers each send with the next reply; a 202 once the list runs out. */
  replyWith(...replies: Reply[]): void {
    this.replies.push(...replies);
  }

  /** Every impression that reached the wire, in order. */
  get sentImpressions() {
    return this.calls.flatMap((call) => call.batch.impressions);
  }

  /** Every action that reached the wire, in order. */
  get sentActions() {
    return this.calls.flatMap((call) => call.batch.actions);
  }

  async send(
    batch: TelemetryBatch,
    accessToken: string | null,
    keepalive: boolean,
  ): Promise<TelemetrySendResult> {
    this.calls.push({ batch, accessToken, keepalive });

    const reply = this.replies.shift() ?? { status: 202, body: null };

    if (reply === 'network') throw new TypeError('Failed to fetch');

    return reply;
  }
}

describe('RecommendationTelemetry', () => {
  let transport: FakeTransport;
  let service: RecommendationTelemetry;

  /** The signed-in token, or null. The service reads it once per event. */
  const token = signal<string | null>(null);

  /** One displayed card, with the fields the deck supplies. */
  function impression(titleId = 'alpha', overrides: Partial<{ catalogVersion: string | null }> = {}) {
    return {
      titleId,
      position: 1,
      engineVersion: 'recommend-v1',
      catalogVersion: '2026-10-24T17:07:32.000Z' as string | null,
      filterHash: '0123456789abcdef',
      score: 7.5,
      reasonCode: 'none' as const,
      ...overrides,
    };
  }

  /**
   * Runs pending promise continuations without advancing the clock.
   *
   * A flush with no retry is a chain of awaits with no timer in it, so the
   * clock has nothing to do with when it finishes — only the microtask queue
   * does.
   */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 200; turn++) await Promise.resolve();
  }

  beforeEach(() => {
    sessionStorage.clear();
    token.set(null);
    transport = new FakeTransport();

    TestBed.configureTestingModule({
      providers: [
        { provide: TELEMETRY_TRANSPORT, useValue: transport },
        { provide: AuthService, useValue: { accessToken: token.asReadonly() } },
      ],
    });

    service = TestBed.inject(RecommendationTelemetry);

    // Installed after the TestBed builds: the service itself creates no timer
    // until an event is recorded, and Angular's own machinery should keep the
    // real clock.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the flush threshold', () => {
    it('sends twenty queued events as one batch, without waiting for the timer', async () => {
      for (let index = 0; index < 20; index++) {
        service.recordImpression(impression(`title-${index}`));
      }

      await settle();

      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0].batch.impressions).toHaveLength(20);
      expect(transport.calls[0].batch.actions).toHaveLength(0);
    });

    it('does not send nineteen', async () => {
      for (let index = 0; index < 19; index++) {
        service.recordImpression(impression(`title-${index}`));
      }

      await settle();

      expect(transport.calls).toHaveLength(0);
    });

    it('counts impressions and actions together toward the threshold', async () => {
      // The threshold is about queue pressure, not about which list is full: a
      // deck that produces ten cards and ten actions is exactly as much work as
      // one that produces twenty impressions.
      service.recordImpression(impression('alpha'));

      for (let index = 0; index < 19; index++) {
        service.recordAction('skip', 'alpha');
      }

      await settle();

      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0].batch.impressions).toHaveLength(1);
      expect(transport.calls[0].batch.actions).toHaveLength(19);
    });
  });

  describe('the five-second flush', () => {
    it('sends a smaller queue once the interval has passed', async () => {
      service.recordImpression(impression('alpha'));

      await vi.advanceTimersByTimeAsync(RecommendationTelemetry.FLUSH_INTERVAL_MS - 1);
      expect(transport.calls).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);
      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0].batch.impressions[0].titleId).toBe('alpha');
    });

    it('measures the interval from the first queued event, not from every event', async () => {
      // A visitor who swipes every second must not push the flush out forever:
      // the timer belongs to the queue, not to the last event, which is what
      // makes the flush happen while the deck is still busy.
      service.recordImpression(impression('alpha'));

      await vi.advanceTimersByTimeAsync(3000);
      service.recordImpression(impression('bravo'));

      await vi.advanceTimersByTimeAsync(2000);

      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0].batch.impressions.map((event) => event.titleId)).toEqual([
        'alpha',
        'bravo',
      ]);
    });

    it('restarts the interval after a flush', async () => {
      service.recordImpression(impression('alpha'));
      await vi.advanceTimersByTimeAsync(RecommendationTelemetry.FLUSH_INTERVAL_MS);

      service.recordImpression(impression('bravo'));
      await vi.advanceTimersByTimeAsync(RecommendationTelemetry.FLUSH_INTERVAL_MS);

      expect(transport.calls).toHaveLength(2);
    });
  });

  describe('failure handling (FR-007)', () => {
    it('retries a network failure twice and then drops the batch', async () => {
      transport.replyWith('network', 'network', 'network');

      service.recordImpression(impression('alpha'));

      const flush = service.flush();

      await vi.advanceTimersByTimeAsync(3000);
      await flush;

      // Three sends: the attempt and its two retries.
      expect(transport.calls).toHaveLength(3);
      expect(service.counters().lostBatches).toBe(1);
      expect(service.counters().lostEvents).toBe(1);
    });

    it('stops early when a retry succeeds', async () => {
      transport.replyWith('network', { status: 202, body: null });

      service.recordImpression(impression('alpha'));

      const flush = service.flush();
      await vi.advanceTimersByTimeAsync(1000);
      await flush;

      expect(transport.calls).toHaveLength(2);
      expect(service.counters().lostBatches).toBe(0);
      expect(service.counters().lostEvents).toBe(0);
    });

    it('retries a 5xx', async () => {
      transport.replyWith({ status: 503, body: null }, { status: 202, body: null });

      service.recordImpression(impression('alpha'));

      const flush = service.flush();
      await vi.advanceTimersByTimeAsync(1000);
      await flush;

      expect(transport.calls).toHaveLength(2);
      expect(service.counters().lostBatches).toBe(0);
    });

    it('retries a 429 rather than treating it as permanent', async () => {
      transport.replyWith({ status: 429, body: null }, { status: 202, body: null });

      service.recordImpression(impression('alpha'));

      const flush = service.flush();
      await vi.advanceTimersByTimeAsync(1000);
      await flush;

      expect(transport.calls).toHaveLength(2);
    });

    it('does not retry a 400', async () => {
      // The server has already read the body and refused it. Sending it again
      // would be three copies of the same invalid events.
      transport.replyWith({ status: 400, body: null });

      service.recordImpression(impression('alpha'));

      await service.flush();

      expect(transport.calls).toHaveLength(1);
      expect(service.counters().lostBatches).toBe(1);
      expect(service.counters().lostEvents).toBe(1);
    });

    it('does not retry a 413', async () => {
      transport.replyWith({ status: 413, body: null });

      service.recordImpression(impression('alpha'));

      await service.flush();

      expect(transport.calls).toHaveLength(1);
      expect(service.counters().lostBatches).toBe(1);
    });

    it('counts the events a lost batch carried, not the batches', async () => {
      transport.replyWith('network', 'network', 'network');

      service.recordImpression(impression('alpha'));
      service.recordImpression(impression('bravo'));
      service.recordAction('skip', 'alpha');

      const flush = service.flush();
      await vi.advanceTimersByTimeAsync(3000);
      await flush;

      expect(service.counters().lostBatches).toBe(1);
      expect(service.counters().lostEvents).toBe(3);
    });

    it('keeps accepting events after a lost batch', async () => {
      transport.replyWith({ status: 400, body: null });

      service.recordImpression(impression('alpha'));
      await service.flush();

      service.recordImpression(impression('bravo'));
      await service.flush();

      expect(transport.calls).toHaveLength(2);
      expect(transport.calls[1].batch.impressions[0].titleId).toBe('bravo');
    });
  });

  describe('the queue cap (FR-010)', () => {
    it('drops the oldest events past 500 and counts them', async () => {
      // The transport is held open for the first batch, so what accumulates
      // afterwards is exactly the queue this test is about.
      transport.replyWith({ status: 202, body: null });

      for (let index = 0; index < 521; index++) {
        service.recordImpression(impression(`title-${String(index).padStart(3, '0')}`));
      }

      expect(service.counters().droppedEvents).toBe(1);

      // Let the backlog drain: everything queued is sent, and the one event
      // that was dropped never reaches the wire.
      await settle();

      const sent = transport.sentImpressions.map((event) => event.titleId);

      expect(sent).not.toContain('title-020');
      expect(sent).toHaveLength(520);
      expect(sent[0]).toBe('title-000');
      expect(sent.at(-1)).toBe('title-520');
    });

    it('never caps a small queue', async () => {
      for (let index = 0; index < 10; index++) {
        service.recordImpression(impression(`title-${index}`));
      }

      expect(service.counters().droppedEvents).toBe(0);
    });
  });

  describe('dwell (FR-004)', () => {
    it('measures from the impression the action answers', async () => {
      service.recordImpression(impression('alpha'));

      await vi.advanceTimersByTimeAsync(2400);
      service.recordAction('liked', 'alpha');
      await service.flush();

      expect(transport.sentActions[0].dwellMs).toBe(2400);
    });

    it('caps a card left on screen for longer than five minutes', async () => {
      service.recordImpression(impression('alpha'));

      // Forty minutes later — the tab was left open over lunch.
      await vi.advanceTimersByTimeAsync(40 * 60 * 1000);
      service.recordAction('skip', 'alpha');
      await service.flush();

      expect(transport.sentActions[0].dwellMs).toBe(300_000);
    });

    it('never reports a negative dwell', async () => {
      // A clock that steps backwards (a device NTP correction) must not produce
      // a negative interval; the action still happened after the card.
      service.recordImpression(impression('alpha'));

      const realNow = Date.now;
      Date.now = () => realNow() - 10_000;

      try {
        service.recordAction('skip', 'alpha');
      } finally {
        Date.now = realNow;
      }

      await service.flush();

      expect(transport.sentActions[0].dwellMs).toBe(0);
    });
  });

  describe('linking (FR-005)', () => {
    it('links an undo to the earlier impression, not to the card on screen now', async () => {
      // The walk: alpha is rated, bravo is displayed, undo brings alpha back.
      // The undo has to name alpha's impression — the one it reverses — which
      // is the reason the deck records it before the rewind.
      service.recordImpression(impression('alpha'));
      service.recordAction('liked', 'alpha');
      service.recordImpression(impression('bravo'));
      service.recordAction('undo', 'alpha');

      await service.flush();

      const alpha = transport.sentImpressions.find((event) => event.titleId === 'alpha')!;
      const [liked, undone] = transport.sentActions;

      expect(liked.impressionClientEventId).toBe(alpha.clientEventId);
      expect(undone.impressionClientEventId).toBe(alpha.clientEventId);
      expect(undone.kind).toBe('undo');

      // The undo is its own event: the action it reverses is still there.
      expect(undone.clientEventId).not.toBe(liked.clientEventId);
    });

    it('counts an action for an unknown title as unlinked and sends nothing for it', async () => {
      service.recordAction('liked', 'never-shown');

      await service.flush();

      expect(transport.calls).toHaveLength(0);
      expect(service.counters().unlinkedActions).toBe(1);
    });

    it('uses the most recent impression when a card is shown again', async () => {
      // A card restored by undo is a new display. A later action belongs to the
      // second impression, because that is the one the visitor was looking at.
      service.recordImpression(impression('alpha'));
      service.recordImpression(impression('bravo'));
      service.recordImpression(impression('alpha'));

      service.recordAction('skip', 'alpha');
      await service.flush();

      const alphaImpressions = transport.sentImpressions.filter(
        (event) => event.titleId === 'alpha',
      );

      expect(alphaImpressions).toHaveLength(2);
      expect(transport.sentActions[0].impressionClientEventId).toBe(
        alphaImpressions[1].clientEventId,
      );
    });
  });

  describe('anonymous and signed-in runs (FR-002, D3)', () => {
    it('sends an anonymous run without a token, even after the visitor signs in', async () => {
      service.recordImpression(impression('alpha'));

      // The visitor signs in before the queue flushes. The impression was
      // recorded as a guest and must stay one.
      token.set('the-access-token');

      await service.flush();

      expect(transport.calls[0].accessToken).toBeNull();
    });

    it('sends a later signed-in run with the bearer token', async () => {
      service.recordImpression(impression('alpha'));
      token.set('the-access-token');
      service.recordImpression(impression('bravo'));

      await service.flush();
      await service.flush();

      expect(transport.calls).toHaveLength(2);
      expect(transport.calls[0].accessToken).toBeNull();
      expect(transport.calls[0].batch.impressions[0].titleId).toBe('alpha');
      expect(transport.calls[1].accessToken).toBe('the-access-token');
      expect(transport.calls[1].batch.impressions[0].titleId).toBe('bravo');
    });

    it('sends an anonymous run with no token at all', async () => {
      service.recordImpression(impression('alpha'));

      await service.flush();

      expect(transport.calls[0].accessToken).toBeNull();
    });

    it('sends every impression of a tab under the same session id', async () => {
      const sessionId = TestBed.inject(TelemetrySession).id();

      service.recordImpression(impression('alpha'));
      service.recordImpression(impression('bravo'));

      await service.flush();

      expect(transport.sentImpressions.map((event) => event.sessionId)).toEqual([
        sessionId,
        sessionId,
      ]);
    });
  });

  describe('the recorded card (US1 scenario 1)', () => {
    it('carries every field the deck supplied, unchanged', async () => {
      service.recordImpression({
        titleId: 'arrival',
        position: 3,
        engineVersion: 'recommend-v1',
        catalogVersion: '2026-10-24T17:07:32.000Z',
        filterHash: 'fedcba9876543210',
        score: 12.25,
        reasonCode: 'genre-picked',
      });

      await service.flush();

      const [sent] = transport.sentImpressions;

      expect(sent).toMatchObject({
        titleId: 'arrival',
        surface: 'deck',
        position: 3,
        engineVersion: 'recommend-v1',
        catalogVersion: '2026-10-24T17:07:32.000Z',
        filterHash: 'fedcba9876543210',
        score: 12.25,
        reasonCode: 'genre-picked',
      });
      expect(sent.clientEventId).toMatch(/^[0-9a-f-]{36}$/);
      expect(sent.shownAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('skips and counts an impression with no catalog version', async () => {
      service.recordImpression(impression('alpha', { catalogVersion: null }));

      await service.flush();

      expect(transport.calls).toHaveLength(0);
      expect(service.counters().skippedImpressions).toBe(1);
    });

    it('never sends the queue bookkeeping to the server', async () => {
      // `anonymous` and the dwell clock are the queue's own; the contract
      // ignores unknown properties, but relying on that would make the body
      // describe the visitor's auth state on every event.
      service.recordImpression(impression('alpha'));
      await service.flush();

      const body = transport.calls[0].batch.impressions[0] as unknown as Record<string, unknown>;

      expect(body).not.toHaveProperty('anonymous');
      expect(body).not.toHaveProperty('shownAtMs');
    });
  });

  describe('storage (FR-002, D8)', () => {
    it('keeps no queued event in sessionStorage or LocalStorage', async () => {
      service.recordImpression(impression('alpha'));
      service.recordAction('liked', 'alpha');

      await service.flush();

      const sent = transport.calls[0].batch.impressions[0];

      const values = [
        ...Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key) ?? ''),
        ...Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? ''),
      ];

      for (const value of values) {
        expect(value).not.toContain('alpha');
        expect(value).not.toContain(sent.clientEventId);
        expect(value).not.toContain('recommend-v1');
      }

      // The session id is the one thing that *is* stored — it is the tab's
      // identity, not an event.
      expect(sessionStorage.getItem(TelemetrySession.STORAGE_KEY)).toBe(
        TestBed.inject(TelemetrySession).id(),
      );
    });
  });
});
