import {
  eligibleTitles,
  rankTitles,
  RECOMMEND_ENGINE_VERSION,
  weightedRating,
} from '../recommend';
import { Ranker, RankerInput } from './types';

/**
 * The three ranking rules the harness compares
 * (`specs/009-recommendation-telemetry/contracts/evaluation-harness.md`).
 *
 * The incumbent and the baseline read the *same* candidate pool — the baseline
 * asks `eligibleTitles` rather than re-implementing the five filters — so a
 * report compares orderings and never filters. A baseline with a different pool
 * would make the difference between the two rows unreadable: part ranking, part
 * eligibility.
 */

/** Title-id order, the tie-break every ranker ends with. */
function byTitleId(left: { id: string }, right: { id: string }): number {
  if (left.id === right.id) return 0;

  return left.id < right.id ? -1 : 1;
}

/**
 * The shipped engine.
 *
 * A thin wrapper on purpose: the row named `incumbent` has to be the ranker the
 * deck actually runs, or the report is a comparison between three tools and the
 * product.
 */
export const incumbentRanker: Ranker = {
  name: 'incumbent',
  engineVersion: RECOMMEND_ENGINE_VERSION,
  rank: (input: RankerInput) =>
    rankTitles(input.catalog, input.preference, input.interactions, input.shownTitleIds),
};

/**
 * The popularity baseline: the same pool, ordered by confidence-weighted
 * rating.
 *
 * Popularity rather than raw rating, because raw rating is the measure a lone
 * 10.0 from twelve votes wins; `weightedRating` is the product's own answer to
 * that and is reused rather than restated, so the baseline cannot drift from
 * the term the incumbent also weighs.
 *
 * It is personalized only by eligibility — what the visitor can watch — never
 * by what they rated.
 */
export const popularityRanker: Ranker = {
  name: 'popularity',
  engineVersion: 'popularity-v1',
  rank: (input: RankerInput) =>
    [...eligibleTitles(input.catalog, input.preference, input.interactions, input.shownTitleIds)]
      .sort(
        (left, right) =>
          weightedRating(right) - weightedRating(left) || byTitleId(left, right),
      ),
};

/**
 * A deliberately bad candidate: the incumbent's ordering, back to front.
 *
 * Its purpose is to show the report can tell a good order from a bad one. It is
 * the exact inverse rather than a different bad idea, so whatever the incumbent
 * placed first this places last — which is the sharpest possible statement that
 * the measures are reading order and not just membership.
 *
 * It is exported because the suite uses it; it is not a suggestion.
 */
export const invertedRanker: Ranker = {
  name: 'candidate-inverted',
  engineVersion: 'candidate-inverted-v1',
  rank: (input: RankerInput) =>
    rankTitles(
      input.catalog,
      input.preference,
      input.interactions,
      input.shownTitleIds,
    ).reverse(),
};
