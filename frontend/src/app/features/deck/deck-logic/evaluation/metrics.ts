import { MediaTitle } from '../../../../core/models/media-title';
import { RankedDecision } from './types';

/**
 * The six measures the harness reports
 * (`specs/009-recommendation-telemetry/contracts/evaluation-harness.md`).
 *
 * Pure arithmetic on ids and genre sets: nothing here knows what a ranker is,
 * which is what lets a number in a report be re-derived by hand. Every measure
 * is stated once, in `[0, 1]`, and reads only the decision it is given — so a
 * surprising value points at the ranking, never at accumulated state.
 */

/** The cut-off every measure is named for. */
export const TOP_K = 10;

/**
 * The ideal DCG@10 for a session with this many relevant titles.
 *
 * The label count is capped at ten because positions past the tenth earn
 * nothing: a session with twelve labels and one with ten are worth the same to
 * a deck that only ever shows ten cards. Exposed because NDCG is a ratio, and a
 * ratio whose denominator cannot be read on its own is a number nobody can
 * check.
 */
export function idcgAt10(labelCount: number): number {
  const idealLabels = Math.min(Math.max(labelCount, 0), TOP_K);
  let total = 0;

  for (let rank = 1; rank <= idealLabels; rank++) {
    total += 1 / Math.log2(rank + 1);
  }

  return total;
}

/** The relevance of each of the first ten cards, best first. */
function relevanceAt10(decision: RankedDecision): boolean[] {
  return decision.ranked
    .slice(0, TOP_K)
    .map((titleId) => decision.labels.has(titleId));
}

/**
 * Binary-relevance NDCG@10: the discounted sum of what was relevant, over the
 * sum the perfect ordering would have earned.
 */
export function ndcgAt10(decision: RankedDecision): number {
  const ideal = idcgAt10(decision.labels.size);

  // No labels means nothing could have been relevant, and the decision is not
  // evaluated at all — `rankerMetrics` leaves it out before this is reached.
  if (ideal === 0) return 0;

  let dcg = 0;

  relevanceAt10(decision).forEach((relevant, index) => {
    if (relevant) dcg += 1 / Math.log2(index + 2);
  });

  return dcg / ideal;
}

/**
 * The reciprocal rank of the first relevant card, or 0.
 *
 * The measure answers "how far did the visitor have to look" — which is why it
 * reads only the first relevant card and ignores the rest.
 */
export function reciprocalRank(decision: RankedDecision): number {
  const first = relevanceAt10(decision).indexOf(true);

  return first === -1 ? 0 : 1 / (first + 1);
}

/** Whether any of the first ten cards was relevant. */
export function hitAt10(decision: RankedDecision): boolean {
  return relevanceAt10(decision).includes(true);
}

/**
 * The share of the ten-card window that was relevant.
 *
 * The denominator is ten, not the length of the list. A ranker that offered
 * four cards where ten were possible did not make four good offers out of four;
 * it left six of the window empty.
 */
export function precisionAt10(decision: RankedDecision): number {
  return relevanceAt10(decision).filter(Boolean).length / TOP_K;
}

/**
 * Distinct titles offered over distinct titles available.
 *
 * Reads every list it is given — including those from sessions nobody ever
 * labelled — because coverage is a property of what the ranker was willing to
 * show, not of whether the visitor responded. Ids the fixture does not hold are
 * ignored rather than credited, which keeps the measure in `[0, 1]`.
 */
export function coverage(
  lists: readonly (readonly string[])[],
  catalog: readonly MediaTitle[],
): number {
  const available = new Set(catalog.map((title) => title.id));

  if (available.size === 0) return 0;

  const offered = new Set<string>();

  for (const list of lists) {
    for (const titleId of list.slice(0, TOP_K)) {
      if (available.has(titleId)) offered.add(titleId);
    }
  }

  return offered.size / available.size;
}

/**
 * Jaccard similarity of two genre sets: shared genres over the union.
 *
 * Two empty sets count as similar rather than as incomparable. A list of
 * genre-less titles is one nothing can tell apart, so calling it diverse would
 * reward a ranker for a distinction it did not make.
 */
export function genreJaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);

  if (a.size === 0 && b.size === 0) return 1;

  let shared = 0;

  for (const genre of a) {
    if (b.has(genre)) shared++;
  }

  return shared / (a.size + b.size - shared);
}

/**
 * One minus the mean pairwise Jaccard of the genres in each list, averaged over
 * the lists that have at least two titles.
 *
 * A one-title list has no pair to compare, so it is skipped rather than scored
 * as 1: a ranker that offered a single card would otherwise look maximally
 * diverse for having made no choice at all.
 */
export function intraListDiversity(
  lists: readonly (readonly string[])[],
  catalog: readonly MediaTitle[],
): number {
  const genresOf = new Map(catalog.map((title) => [title.id, title.genres]));

  let total = 0;
  let scored = 0;

  for (const list of lists) {
    const top = list.slice(0, TOP_K);

    if (top.length < 2) continue;

    let similarity = 0;
    let pairs = 0;

    for (let left = 0; left < top.length; left++) {
      for (let right = left + 1; right < top.length; right++) {
        similarity += genreJaccard(
          genresOf.get(top[left]) ?? [],
          genresOf.get(top[right]) ?? [],
        );
        pairs++;
      }
    }

    total += 1 - similarity / pairs;
    scored++;
  }

  return scored === 0 ? 0 : total / scored;
}

/** The four ranking measures, averaged over the decisions that had labels. */
export interface RankingMetrics {
  ndcgAt10: number;
  mrr: number;
  hitRateAt10: number;
  precisionAt10: number;
  evaluatedDecisions: number;
}

/** An unweighted mean, and 0 when there is nothing to average. */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;

  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Averages the four ranking measures over the decisions that were evaluated.
 *
 * A decision with no label is not a zero — it is an impression nobody ever
 * liked or chose to watch, so it says nothing about the order it appeared in.
 * Counting it would rate a ranker on the visitor's silences.
 */
export function rankerMetrics(decisions: readonly RankedDecision[]): RankingMetrics {
  const evaluated = decisions.filter((decision) => decision.labels.size > 0);

  return {
    ndcgAt10: mean(evaluated.map(ndcgAt10)),
    mrr: mean(evaluated.map(reciprocalRank)),
    hitRateAt10: mean(evaluated.map((decision) => (hitAt10(decision) ? 1 : 0))),
    precisionAt10: mean(evaluated.map(precisionAt10)),
    evaluatedDecisions: evaluated.length,
  };
}
