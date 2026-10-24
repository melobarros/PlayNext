import { DestroyRef, DOCUMENT, Injectable, inject, signal } from '@angular/core';
import {
  ActionEvent,
  ImpressionEvent,
  ReasonCode,
  TelemetryActionKind,
  TelemetryBatch,
} from '../models/telemetry';
import { AuthService } from '../services/auth.service';
import { TelemetrySendResult, TELEMETRY_TRANSPORT } from './telemetry-transport';
import { TelemetrySession } from './telemetry-session';

/**
 * The recommendation-event queue (009, T032).
 *
 * Fire-and-forget in the strict sense: recording an event does no I/O, returns
 * nothing, and cannot fail in a way the visitor sees. The swipe that triggered
 * it has already completed the moment a value is pushed onto the array, which
 * is what makes FR-006 achievable at all — there is no await between the
 * rating landing and the next card appearing.
 *
 * **In memory, never in browser storage.** The record already lives in one
 * place, the database, under one retention rule. A queue persisted to
 * LocalStorage would be a second copy of behavioural data with no purge job of
 * its own, and the spec's decision — "a lost tail is counted, not persisted" —
 * is only honest if there is nowhere else it could be. Closing the tab loses
 * at most one flush interval of events, and those were the last events of a
 * visit that is ending.
 *
 * **The queue is partitioned by anonymity.** Each event remembers whether the
 * visitor was signed in when it was recorded, and a flush takes only the run at
 * the front of the queue that shares that value. Signing in mid-visit must not
 * retroactively attach an account to the decks that were walked as a guest.
 *
 * **Failures are counted, never shown.** A batch that fails is retried twice
 * with backoff and then dropped, and the counters below record what was lost.
 * The deck reads none of them; they exist for the tests and for whoever has to
 * answer "is the intake working".
 */
@Injectable({ providedIn: 'root' })
export class RecommendationTelemetry {
  /** Flush once this many events are queued. */
  static readonly FLUSH_THRESHOLD_EVENTS = 20;

  /** Flush after this long with a non-empty queue. */
  static readonly FLUSH_INTERVAL_MS = 5000;

  /** The queue's ceiling; past it the oldest events are dropped and counted. */
  static readonly MAX_QUEUE_EVENTS = 500;

  /** Dwell is capped at five minutes: longer means the tab was left open. */
  static readonly MAX_DWELL_MS = 300_000;

  /** Retries after the first attempt. Two means three sends at most. */
  static readonly MAX_RETRIES = 2;

  /** The pause before each retry, in order. */
  static readonly RETRY_DELAYS_MS: readonly number[] = [1000, 2000];

  // The server's own per-batch limits, mirrored so a delayed flush never spends
  // a round trip being told 413.
  private static readonly MAX_IMPRESSIONS_PER_BATCH = 100;
  private static readonly MAX_ACTIONS_PER_BATCH = 200;

  private readonly transport = inject(TELEMETRY_TRANSPORT);
  private readonly sessions = inject(TelemetrySession);
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);

  private queue: QueuedEvent[] = [];

  /**
   * The most recent impression of each title in this tab.
   *
   * It is what lets an action name the impression it answers without the deck
   * ever handling event ids — including an undo, which arrives one card later
   * than the rating it reverses. Bounded by the number of distinct titles
   * shown, which is bounded by the catalog.
   */
  private readonly impressionIndex = new Map<string, { clientEventId: string; shownAtMs: number }>();

  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private flushing = false;

  private readonly counterState = signal<TelemetryCounters>({
    lostBatches: 0,
    lostEvents: 0,
    unlinkedActions: 0,
    droppedEvents: 0,
    skippedImpressions: 0,
  });

  /**
   * What went wrong, for the tests and the logs. Never rendered.
   *
   * A signal so a test can read it synchronously after driving the deck, and so
   * a future diagnostic view could observe it without the service growing an
   * event stream it does not need.
   */
  readonly counters = this.counterState.asReadonly();

  constructor() {
    // The page-hide flush is the last chance the queue gets. It is the one
    // flush that asks the transport for `keepalive`, because the document is
    // about to stop existing and an ordinary request would be cancelled with
    // it.
    const onVisibilityChange = (): void => {
      if (this.document.visibilityState === 'hidden') void this.flush(true);
    };

    this.document.addEventListener('visibilitychange', onVisibilityChange);

    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibilityChange);

      // The service is a root singleton, so this only runs when the
      // application itself is torn down — which is exactly when a timer left
      // behind would fire into a destroyed injector.
      this.clearFlushTimer();
    });
  }

  /**
   * Records one displayed card.
   *
   * A missing catalog version skips the record rather than storing a blank one:
   * the version is how a replay finds the catalog the card was ranked from, and
   * an impression without it cannot be replayed. The skip is counted, because
   * "quietly fewer rows than cards shown" is the kind of gap that makes an
   * evaluation untrustworthy months later.
   */
  recordImpression(details: ImpressionDetails): void {
    if (details.catalogVersion === null) {
      this.count('skippedImpressions');
      return;
    }

    const now = Date.now();
    const clientEventId = crypto.randomUUID();

    const impression: ImpressionEvent = {
      clientEventId,
      sessionId: this.sessions.id(),
      titleId: details.titleId,
      surface: 'deck',
      position: details.position,
      engineVersion: details.engineVersion,
      catalogVersion: details.catalogVersion,
      filterHash: details.filterHash,
      score: details.score,
      reasonCode: details.reasonCode,
      shownAt: new Date(now).toISOString(),
    };

    this.impressionIndex.set(details.titleId, { clientEventId, shownAtMs: now });

    this.enqueue({ type: 'impression', event: impression, anonymous: this.isAnonymous() });
  }

  /**
   * Records one response to a card the tab has already shown.
   *
   * The dwell is measured against the impression this action links to, from a
   * single clock — `Date.now()` for both the timestamp and the elapsed
   * milliseconds. Reading one clock for the pair is what keeps
   * `occurredAt - shownAt` equal to the stored `dwellMs`, which a system clock
   * change would otherwise quietly break.
   *
   * An action whose title has no impression in this tab (a card shown before a
   * reload, say) is counted as unlinked and dropped. The server would count it
   * the same way, but it would cost a round trip and a row-sized rejection to
   * learn what is knowable here.
   */
  recordAction(kind: TelemetryActionKind, titleId: string): void {
    const impression = this.impressionIndex.get(titleId);

    if (impression === undefined) {
      this.count('unlinkedActions');
      return;
    }

    const now = Date.now();

    const action: ActionEvent = {
      clientEventId: crypto.randomUUID(),
      impressionClientEventId: impression.clientEventId,
      kind,
      dwellMs: Math.min(
        RecommendationTelemetry.MAX_DWELL_MS,
        Math.max(0, Math.round(now - impression.shownAtMs)),
      ),
      occurredAt: new Date(now).toISOString(),
    };

    this.enqueue({ type: 'action', event: action, anonymous: this.isAnonymous() });
  }

  /**
   * Sends what is queued, one anonymity run at a time.
   *
   * Public because two callers outside a record need it: the visibility
   * listener above, and the tests — which drive it directly rather than waiting
   * on a timer. Idempotent under concurrency: a call that arrives while a flush
   * is in flight returns immediately, and the in-flight flush reschedules for
   * whatever it could not take.
   */
  async flush(keepalive = false): Promise<void> {
    if (this.flushing) return;

    const events = this.takeBatch();

    if (events.length === 0) {
      this.clearFlushTimer();
      return;
    }

    // The timer that was waiting for this batch has done its job.
    this.clearFlushTimer();

    this.flushing = true;

    try {
      await this.send(events, keepalive);
    } finally {
      this.flushing = false;

      // Anything recorded while this flush was in flight, or left behind
      // because it belonged to a different anonymity run, gets its own turn.
      // An empty queue needs no timer: the next `enqueue` schedules one.
      if (this.queue.length >= RecommendationTelemetry.FLUSH_THRESHOLD_EVENTS) {
        void this.flush();
      } else if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  private enqueue(event: QueuedEvent): void {
    this.queue.push(event);

    if (this.queue.length > RecommendationTelemetry.MAX_QUEUE_EVENTS) {
      // The oldest go first: the newest events describe the visit that is
      // still happening, and the queue is only this full because the intake
      // has stopped answering.
      const overflow = this.queue.length - RecommendationTelemetry.MAX_QUEUE_EVENTS;
      this.queue.splice(0, overflow);
      this.count('droppedEvents', overflow);
    }

    if (this.queue.length >= RecommendationTelemetry.FLUSH_THRESHOLD_EVENTS) {
      void this.flush();
      return;
    }

    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, RecommendationTelemetry.FLUSH_INTERVAL_MS);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer === null) return;

    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  /**
   * The longest run at the front of the queue that can go in one batch.
   *
   * Stops at an anonymity change, so a guest run is never sent with a token,
   * and at the server's count limits, so a backlog is drained over several
   * flushes instead of being refused as a whole.
   */
  private takeBatch(): QueuedEvent[] {
    const head = this.queue[0];
    if (head === undefined) return [];

    let count = 0;
    let impressions = 0;
    let actions = 0;

    while (count < this.queue.length) {
      const event = this.queue[count];

      if (event.anonymous !== head.anonymous) break;

      if (event.type === 'impression') {
        if (impressions === RecommendationTelemetry.MAX_IMPRESSIONS_PER_BATCH) break;
        impressions++;
      } else {
        if (actions === RecommendationTelemetry.MAX_ACTIONS_PER_BATCH) break;
        actions++;
      }

      count++;
    }

    return this.queue.splice(0, count);
  }

  /**
   * Sends one batch, retrying the way the contract allows.
   *
   * A 400 or 413 is permanent — retrying it would re-send a body the server has
   * already refused — while a network failure, a 429 or a 5xx is worth the two
   * retries. After that the batch is dropped and counted. Nothing here throws:
   * the caller is a fire-and-forget path, and an unhandled rejection would be
   * the one way this feature could become visible.
   */
  private async send(events: readonly QueuedEvent[], keepalive: boolean): Promise<void> {
    const batch: TelemetryBatch = {
      impressions: events.filter(isImpression).map((event) => event.event),
      actions: events.filter(isAction).map((event) => event.event),
    };

    // A signed-in run carries the token that is current *now*. If the visitor
    // has signed out since recording, there is no token and the batch goes
    // anonymously — the alternative would be stamping a stale credential on it.
    const token = events[0].anonymous ? null : this.auth.accessToken();

    for (let attempt = 0; ; attempt++) {
      const result = await this.attempt(batch, token, keepalive);

      if (result.status >= 200 && result.status < 300) return;

      const permanent = result.status === 400 || result.status === 413;

      if (permanent || attempt >= RecommendationTelemetry.MAX_RETRIES) {
        this.count('lostBatches');
        this.count('lostEvents', events.length);
        return;
      }

      await delay(RecommendationTelemetry.RETRY_DELAYS_MS[attempt]);
    }
  }

  private async attempt(
    batch: TelemetryBatch,
    token: string | null,
    keepalive: boolean,
  ): Promise<TelemetrySendResult> {
    try {
      return await this.transport.send(batch, token, keepalive);
    } catch {
      // No status means the request never completed; `0` is the transport's
      // vocabulary for that, and the retry rule treats it like any other
      // transient failure.
      return { status: 0, body: null };
    }
  }

  /**
   * Whether the visitor is a guest right now.
   *
   * Read per event rather than per flush, because the answer is a fact about
   * the moment the card was shown. That is what makes a sign-in mid-visit split
   * the queue instead of relabelling it.
   */
  private isAnonymous(): boolean {
    return this.auth.accessToken() === null;
  }

  private count(field: keyof TelemetryCounters, by = 1): void {
    this.counterState.update((counters) => ({ ...counters, [field]: counters[field] + by }));
  }
}

/** What the deck supplies when a card becomes current. */
export interface ImpressionDetails {
  titleId: string;
  /** One-based ordinal of the card in the walk. */
  position: number;
  engineVersion: string;
  /** The catalog's `fetchedAt`; `null` while no version is known. */
  catalogVersion: string | null;
  filterHash: string;
  score: number;
  reasonCode: ReasonCode;
}

/** What was lost, dropped, or could not be linked. Counters, never display. */
export interface TelemetryCounters {
  /** Batches dropped after the retry budget, or refused permanently. */
  lostBatches: number;

  /** Events carried by those batches. */
  lostEvents: number;

  /** Actions whose title had no impression in this tab. */
  unlinkedActions: number;

  /** Events pushed out of the full queue, oldest first. */
  droppedEvents: number;

  /** Impressions skipped because no catalog version was known. */
  skippedImpressions: number;
}

/**
 * One queued event.
 *
 * The wire shape is nested and the queue's own fields sit beside it, so
 * `anonymous` and `shownAtMs` can never be serialized into a request body: the
 * body is built from `event` alone and the contract's "unknown properties are
 * ignored" is never relied on to hide something the server should not see.
 */
type QueuedEvent =
  | { type: 'impression'; event: ImpressionEvent; anonymous: boolean }
  | { type: 'action'; event: ActionEvent; anonymous: boolean };

function isImpression(event: QueuedEvent): event is Extract<QueuedEvent, { type: 'impression' }> {
  return event.type === 'impression';
}

function isAction(event: QueuedEvent): event is Extract<QueuedEvent, { type: 'action' }> {
  return event.type === 'action';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
