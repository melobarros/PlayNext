import { Interaction, InteractionState } from '../../../../core/models/interaction';
import { MediaTitle } from '../../../../core/models/media-title';
import { TelemetryActionKind } from '../../../../core/models/telemetry';
import { TOP_K, coverage, intraListDiversity, rankerMetrics } from './metrics';
import { incumbentRanker, popularityRanker } from './rankers';
import {
  EvaluationFixture,
  EvaluationReport,
  FixtureEvent,
  FixtureSession,
  RankedDecision,
  Ranker,
  RankerReport,
} from './types';

/**
 * Temporal replay and evaluation
 * (`specs/009-recommendation-telemetry/contracts/evaluation-harness.md`).
 *
 * A recorded session is a list of impressions and actions. To score a ranker
 * against it, each impression has to be put back into the situation it happened
 * in: the ratings the visitor had by then, the titles the walk had already
 * spent, and the titles it was about to like. Nothing is re-ranked
 * retrospectively — a card is judged against the state that produced it, or the
 * fixture is just a list of preferences and the report says nothing about how
 * the deck behaved.
 */

/** One decision, and where in the log it happened. */
export interface SessionDecision extends RankedDecision {
  sessionId: string;
  /** Index of the impression event in `session.events`. */
  eventIndex: number;
  /** The title the deck was showing. */
  titleId: string;
}

/** The interaction state a deck action writes. `skip` and `undo` write none. */
function stateFor(kind: TelemetryActionKind): InteractionState | null {
  if (kind === 'liked') return 'liked';
  if (kind === 'disliked') return 'disliked';
  if (kind === 'watch_now') return 'watchingNow';

  return null;
}

/**
 * Where the walk stops: just past the first `watch_now`, or the end of the log.
 *
 * A Watch Now opens Match Found and ends the deck session, so anything recorded
 * after it belongs to a session that had already finished — replayed literally
 * it would invent decisions that never happened.
 */
function walkEnd(events: readonly FixtureEvent[]): number {
  const chosen = events.findIndex(
    (event) => event.type === 'action' && event.kind === 'watch_now',
  );

  return chosen === -1 ? events.length : chosen + 1;
}

/**
 * The titles this impression's visitor went on to like or watch.
 *
 * Only actions *after* the impression count, and only the two that say "this is
 * what I wanted". A later dislike is a label too, in the sense that it is a
 * decision, but it is a decision that the card was wrong — it is not a reason
 * the card should have been retrievable.
 */
function labelsAfter(
  events: readonly FixtureEvent[],
  impressionIndex: number,
  end: number,
): ReadonlySet<string> {
  const labels = new Set<string>();

  for (let index = impressionIndex + 1; index < end; index++) {
    const event = events[index];

    if (event.type === 'action' && (event.kind === 'liked' || event.kind === 'watch_now')) {
      labels.add(event.titleId);
    }
  }

  return labels;
}

/** A title that left the deck, in the order it left. */
function leaveDeck(walk: string[], titleId: string): void {
  if (!walk.includes(titleId)) walk.push(titleId);
}

/** Puts a title back on the deck, keeping the rest of the walk in order. */
function rejoinDeck(walk: string[], titleId: string): void {
  const position = walk.indexOf(titleId);

  if (position !== -1) walk.splice(position, 1);
}

/**
 * Replays one session against one ranker.
 *
 * The state is built forward, event by event, and each impression snapshots it
 * for the ranker. Undo is the one action that reads history rather than writing
 * it, so each title carries a stack of the states its actions replaced: the
 * contract's "restoring any prior state", which matters because the deck lets a
 * visitor reverse a decision and the next card must be ranked as if that
 * decision had never been made.
 */
export function replaySession(
  session: FixtureSession,
  catalog: readonly MediaTitle[],
  ranker: Ranker,
): SessionDecision[] {
  const events = session.events;
  const end = walkEnd(events);

  const interactions: Record<string, Interaction> = { ...session.initialInteractions };

  // One stack per title, of the interaction the action replaced — `null` when
  // there was none. Empty stack and absent entry are different answers: the
  // first means "undone back to nothing", the second "never touched".
  const replaced: Record<string, (Interaction | null)[]> = {};

  const walk: string[] = [];
  const decisions: SessionDecision[] = [];

  for (let index = 0; index < end; index++) {
    const event = events[index];

    if (event.type === 'impression') {
      const ranked = ranker.rank({
        catalog,
        preference: session.preference,
        interactions: { ...interactions },
        shownTitleIds: [...walk],
      });

      decisions.push({
        sessionId: session.sessionId,
        eventIndex: index,
        titleId: event.titleId,
        ranked: ranked.slice(0, TOP_K).map((title) => title.id),
        labels: labelsAfter(events, index, end),
      });

      continue;
    }

    const state = stateFor(event.kind);

    if (state === null) {
      if (event.kind === 'skip') {
        // No interaction, but the card still left the deck — and an undo of a
        // skip has to restore the walk without pretending a state was written.
        (replaced[event.titleId] ??= []).push(interactions[event.titleId] ?? null);
        leaveDeck(walk, event.titleId);
        continue;
      }

      // Undo: give back what the answered action replaced, and put the title
      // back on the deck. An undo with nothing recorded under it still removes
      // the entry, which is what the deck's own undo does.
      const stack = replaced[event.titleId];
      const prior = stack?.pop();

      if (prior === null || prior === undefined) {
        delete interactions[event.titleId];
      } else {
        interactions[event.titleId] = prior;
      }

      rejoinDeck(walk, event.titleId);
      continue;
    }

    (replaced[event.titleId] ??= []).push(interactions[event.titleId] ?? null);
    interactions[event.titleId] = { state, updatedAt: event.occurredAt };

    // A Watch Now ends the walk rather than consuming a card from it; the loop
    // above stops at that event anyway, so this only matters for a log whose
    // final event is the choice itself.
    if (event.kind !== 'watch_now') leaveDeck(walk, event.titleId);
  }

  return decisions;
}

/** The reports, one per ranker, with the incumbent and baseline always first. */
function rankersFor(candidate: Ranker): Ranker[] {
  const rankers = [incumbentRanker, popularityRanker, candidate];
  const seen = new Set<string>();

  // Deduplicated by name: asking to evaluate the incumbent is a legitimate
  // call, and two identical rows would read as two different results.
  return rankers.filter((ranker) => {
    if (seen.has(ranker.name)) return false;

    seen.add(ranker.name);

    return true;
  });
}

/**
 * Replays the whole fixture against every ranker and reports the six measures.
 *
 * The incumbent and the popularity baseline are always included: a candidate's
 * number means nothing without the reference it is a candidate *to*. Two runs
 * over the same fixture return deep-equal reports — nothing here reads a clock,
 * a random source, or a hash-ordered map.
 */
export function evaluate(fixture: EvaluationFixture, candidate: Ranker): EvaluationReport {
  const report = rankersFor(candidate).map((ranker): RankerReport => {
    const decisions: SessionDecision[] = [];

    for (const session of fixture.sessions) {
      decisions.push(...replaySession(session, fixture.catalog, ranker));
    }

    const metrics = rankerMetrics(decisions);
    const lists = decisions.map((decision) => decision.ranked);

    return {
      name: ranker.name,
      engineVersion: ranker.engineVersion,
      ...metrics,
      coverage: coverage(lists, fixture.catalog),
      intraListDiversity: intraListDiversity(lists, fixture.catalog),
      sessions: fixture.sessions.length,
    };
  });

  return {
    fixtureId: fixture.fixtureId,
    catalogVersion: fixture.catalogVersion,
    report,
  };
}
