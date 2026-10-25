import {
  ENGINE_VERSIONS,
  eligibleTitles,
  rankTitles,
  weightedRating,
} from '../recommend';
import { Ranker, RankerInput } from './types';

/**
 * The ranking rules the harness compares
 * (`specs/009-recommendation-telemetry/contracts/evaluation-harness.md`,
 * `specs/010-deterministic-engine-v2/contracts/ranking-engine.md`).
 *
 * The incumbent and the baseline read the *same* candidate pool — the baseline
 * asks `eligibleTitles` rather than re-implementing the five filters — so a
 * report compares orderings and never filters. A baseline with a different pool
 * would make the difference between the two rows unreadable: part ranking, part
 * eligibility.
 *
 * Every row is pinned to a version. The incumbent is v1 by name and forever:
 * after 010's T013 fallback left v1 as the deck's default, a row that merely
 * followed the default would still be the right ranking, but one that followed
 * a future default would silently stop being the yardstick the 009 fixture was
 * captured against.
 */

/** Title-id order, the tie-break every ranker ends with. */
function byTitleId(left: { id: string }, right: { id: string }): number {
  if (left.id === right.id) return 0;

  return left.id < right.id ? -1 : 1;
}

/**
 * The incumbent, `recommend-v1`.
 *
 * A thin wrapper on purpose: the row named `incumbent` has to be the ranker the
 * fixture was captured against, or every report after 010 compares the new
 * engine to a moving target.
 */
export const incumbentRanker: Ranker = {
  name: 'incumbent',
  engineVersion: ENGINE_VERSIONS.v1,
  rank: (input: RankerInput) =>
    rankTitles(input.catalog, input.preference, input.interactions, input.shownTitleIds, 'v1'),
};

/**
 * The candidate, `recommend-v2` — reachable on the deck through `?engine=v2`.
 *
 * Separate from the incumbent row on purpose: while the rollout is evaluated,
 * both numbers must appear on every run so the comparison survives in the
 * build log (FR-013). It is not the default: the T013 gate was measured and
 * missed, and the fallback keeps v1 serving the deck.
 */
export const candidateV2Ranker: Ranker = {
  name: 'candidate-v2',
  engineVersion: ENGINE_VERSIONS.v2,
  rank: (input: RankerInput) =>
    rankTitles(input.catalog, input.preference, input.interactions, input.shownTitleIds, 'v2'),
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
      'v1',
    ).reverse(),
};
