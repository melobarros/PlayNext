import { Interaction, isRejection } from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import type { ReasonCode } from '../../../core/models/telemetry';
import {
  GENRE_LABELS,
  POSITIVE_STATES,
  PROVIDER_LABELS,
  RATING_PRIOR,
  RATING_PRIOR_WEIGHT,
  RankedTitle,
  compareIds,
  isAvailableOnSelectedService,
  isEligible,
  isOnSelectedService,
  isScorable,
  matchedGenres,
  mismatchedGenres,
} from './recommend-shared';

/**
 * The candidate engine, `recommend-v2`
 * (`specs/010-deterministic-engine-v2/contracts/ranking-engine.md`).
 *
 * One score replaces v1's two-key tier. The selection is still a hard filter —
 * every card matches a picked genre when any were picked — but a match is now
 * worth a weight rather than a rank above which nothing may climb, so a title
 * strong on quality, era, or the visitor's own history can outrank a weaker
 * title that happens to carry one more tag.
 *
 * Everything it knows comes from the catalog it is handed: genres, release
 * year, runtime, rating, and vote count. No keywords, cast, or language — the
 * wire does not carry them, and inventing a term for data the catalog lacks
 * would be a lie with a coefficient (010, D2).
 *
 * Pure by construction: no clock, no network, no randomness, no cached profile.
 * Every arithmetic operation is `+ − × ÷` or `Math.max`, so two devices compute
 * the same double bit for bit and the id tiebreak decides every tie (010, D3).
 */

/** Score weight for each selected genre the title matches. */
const GENRE_MATCH_WEIGHT = 4;

/** Score weight for the title's average genre affinity, in [-1, 1]. */
const HISTORY_WEIGHT = 6;

/**
 * Demotion for each selectable genre the title wears that the visitor did not
 * pick. Kept at v1's value: it is the same statement about the same selection.
 */
const MISMATCHED_GENRE_PENALTY = 10;

/**
 * A small lift for a title on a service the visitor selected.
 *
 * v1 gave this term no weight and still said "on one of your services", which
 * made the sentence a claim the score never made (010, D8). The weight only
 * reorders under "show other platforms", where it is the one differentiator
 * between otherwise equal titles, and it is what makes the reason honest.
 */
const SERVICE_WEIGHT = 1;

/** Score weight for era fit, in [0, 1] (FR-006). */
const ERA_WEIGHT = 2.5;

/** The era distance, in years, at which fit reaches zero — a linear kernel (D3). */
const ERA_SPAN_YEARS = 20;

/** How many positive ratings make an era centre trustworthy. */
const MIN_ERA_EVIDENCE = 3;

/** Score weight for runtime fit, in [0, 1] (FR-007). */
const RUNTIME_WEIGHT = 1.5;

/** The runtime distance, in minutes, at which fit reaches zero. */
const RUNTIME_SPAN_MINUTES = 45;

/** How many positively rated titles must carry a runtime. */
const MIN_RUNTIME_EVIDENCE = 3;

/** The engine's version string, recorded on impressions produced by this order. */
export const RECOMMEND_V2_ENGINE_VERSION = 'recommend-v2';

/**
 * How many leading candidates the diversity re-rank considers (US2).
 *
 * Beyond the window the scores are too far apart to trade for variety: a card
 * worth a fraction of the one before it is not improved by being different, it
 * is improved by being better. The tail keeps score order untouched.
 */
export const MMR_WINDOW = 50;

/**
 * How much of the re-rank's value is relevance rather than novelty (US2).
 *
 * `0.75` keeps the score the senior term: a title has to be nearly a clone of
 * one already picked before similarity outweighs a close score gap.
 */
export const MMR_LAMBDA = 0.75;

/**
 * The visitor's taste, derived from their ratings on every call.
 *
 * `genreWeights` is signed: a positive state adds one, a rejection subtracts
 * one, so a genre the visitor rejected sinks a title it never rated. A genre
 * repeated on one title counts once — a duplicated tag is not stronger taste.
 *
 * `watchingNow` contributes nothing: having watched something says nothing yet
 * about whether they want more of it (002's decision, 010 D11).
 */
interface TasteProfile {
  readonly genreWeights: ReadonlyMap<string, number>;
  readonly positiveCount: number;
  readonly eraCentre: number | null;
  readonly runtimeCentre: number | null;
  readonly runtimeEvidence: number;
}

/** The catalog's own quality yardstick (FR-008, D5). */
interface QualityPrior {
  readonly rating: number;
  readonly votes: number;
}

/**
 * Ranks the catalog for a visitor, best first.
 *
 * Two stages: one score decides the order, then the leading candidates are
 * re-ranked for variety so the top of the deck does not spend its ten cards on
 * near-duplicates (US2). The reason is attached after both stages, so the card
 * shows the same sentence whatever position the re-rank gave it.
 *
 * Returns a new array every call and never mutates its inputs. An empty result
 * is a normal value — it drives the empty state (FR-014), it is not an error.
 */
export function rankTitlesV2(
  catalog: readonly MediaTitle[],
  preferences: Preference,
  interactions: Readonly<Record<string, Interaction>>,
  shownTitleIds: readonly string[],
): RankedTitle[] {
  const profile = tasteProfile(catalog, interactions);
  const prior = qualityPrior(catalog);

  const scored: ScoredTitle[] = catalog
    .filter((title) => isEligible(title, preferences, interactions, shownTitleIds))
    .map((title) => ({
      title,
      score: scoreTitle(title, preferences, profile, prior),
    }))
    .sort((a, b) => b.score - a.score || compareIds(a.title.id, b.title.id));

  return diversify(scored).map((entry) => ({
    // Spread rather than pick: a field added to `MediaTitle` later rides
    // along automatically instead of silently going missing on the card.
    ...entry.title,
    score: entry.score,
    ...reasonFor(entry.title, preferences, profile),
  }));
}

/** Every scored term, in the contract's order (010, `ranking-engine.md`). */
function scoreTitle(
  title: MediaTitle,
  preferences: Preference,
  profile: TasteProfile,
  prior: QualityPrior,
): number {
  return (
    GENRE_MATCH_WEIGHT * matchedGenres(title, preferences) +
    HISTORY_WEIGHT * normalizedAffinity(title, profile) -
    MISMATCHED_GENRE_PENALTY * mismatchedGenres(title, preferences) +
    SERVICE_WEIGHT * (isAvailableOnSelectedService(title, preferences) ? 1 : 0) +
    ERA_WEIGHT * eraFit(title, profile) +
    RUNTIME_WEIGHT * runtimeFit(title, profile) +
    calibratedQuality(title, prior)
  );
}

/**
 * The title's genre affinity, divided by its distinct genre count (D4).
 *
 * The division is what stops a many-tagged title from collecting more evidence
 * than a tightly tagged one carrying the same signal. Distinct genres only: a
 * duplicate tag is not a second opinion.
 */
function normalizedAffinity(title: MediaTitle, profile: TasteProfile): number {
  const distinct = new Set(title.genres);
  if (distinct.size === 0) return 0;

  let total = 0;
  for (const genre of distinct) total += profile.genreWeights.get(genre) ?? 0;

  return total / distinct.size;
}

/**
 * `max(0, 1 − |year − centre| / 20)` — a linear kernel (D3), neutral until
 * three positive ratings give the centre something to stand on (FR-006).
 */
function eraFit(title: MediaTitle, profile: TasteProfile): number {
  if (profile.eraCentre === null || profile.positiveCount < MIN_ERA_EVIDENCE) return 0;

  const gap = title.releaseYear - profile.eraCentre;
  const distance = Math.max(gap, -gap);

  return Math.max(0, 1 - distance / ERA_SPAN_YEARS);
}

/**
 * `max(0, 1 − |runtime − centre| / 45)`, neutral until three positively rated
 * titles carry a runtime (FR-007). It never speaks as a reason: "because you
 * like 98-minute films" is not a sentence the card can honestly show.
 */
function runtimeFit(title: MediaTitle, profile: TasteProfile): number {
  if (
    profile.runtimeCentre === null ||
    profile.runtimeEvidence < MIN_RUNTIME_EVIDENCE ||
    typeof title.runtimeMinutes !== 'number'
  ) {
    return 0;
  }

  const gap = title.runtimeMinutes - profile.runtimeCentre;
  const distance = Math.max(gap, -gap);

  return Math.max(0, 1 - distance / RUNTIME_SPAN_MINUTES);
}

/**
 * Confidence-weighted rating whose prior is the catalog's own mean (D5).
 *
 * A fixed prior means the same thing on a catalog of obscure shorts and one of
 * blockbusters where it should mean different things. Computing it from the
 * argument keeps the engine pure — the harness replays see the fixture's own
 * means — while still pulling a lone high rating toward the middle.
 */
function calibratedQuality(title: MediaTitle, prior: QualityPrior): number {
  return (
    (title.rating * title.voteCount + prior.rating * prior.votes) /
    (title.voteCount + prior.votes)
  );
}

/** The catalog's mean rating and mean vote count, floored at one vote. */
function qualityPrior(catalog: readonly MediaTitle[]): QualityPrior {
  let count = 0;
  let ratingTotal = 0;
  let voteTotal = 0;

  for (const title of catalog) {
    if (!isScorable(title)) continue;
    count += 1;
    ratingTotal += title.rating;
    voteTotal += title.voteCount;
  }

  if (count === 0) return { rating: RATING_PRIOR, votes: RATING_PRIOR_WEIGHT };

  return { rating: ratingTotal / count, votes: Math.max(1, voteTotal / count) };
}

/**
 * Stage 4 — the reason, in the visitor's own words.
 *
 * One sentence, and only ever one. Every branch fires only when the feature it
 * names contributed **positively** to this card's score (FR-010): the picked
 * genre because the match term is positive by filter, affinity because the
 * averaged weight is above zero, the era because the era term is above zero,
 * the service because the availability term is one. A card that ranked on
 * nothing but its quality says nothing.
 *
 * Every branch is guarded by a label lookup, so an id the option lists do not
 * know returns `null` rather than leaking `a-defunct-service` onto the card.
 */
function reasonFor(
  title: MediaTitle,
  preferences: Preference,
  profile: TasteProfile,
): { reason: string | null; reasonCode: ReasonCode } {
  // 1 — a genre from the quiz, named as the visitor chose it. Under a real
  // selection filter 2 guarantees the match, so the only way past this branch
  // is a stored id with no label.
  if (!preferences.genre.any) {
    const picked = labelFor(title.genres, preferences.genre.values);
    if (picked !== null) {
      return { reason: `Because you picked ${picked}`, reasonCode: 'genre-picked' };
    }
  }

  // 2 — a genre the visitor's own ratings point at. The average must be above
  // zero, and the named genre must be one of the positive contributors: under
  // `Any`, a title may carry a loved and a rejected genre at once, and naming
  // the rejected one would be the accidental lie this feature exists to stop.
  if (normalizedAffinity(title, profile) > 0) {
    const loved = labelForPositive(title.genres, profile.genreWeights);
    if (loved !== null) {
      return { reason: `Because you loved ${loved}`, reasonCode: 'genre-affinity' };
    }
  }

  // 3 — the era the visitor's own ratings point at. `eraFit` is zero until
  // three positive ratings give the centre something to stand on, so reaching
  // this branch is itself the evidence. The decade named is the card's own
  // release year, not the centre's: the card explains itself.
  if (eraFit(title, profile) > 0) {
    const decade = Math.floor(title.releaseYear / 10) * 10;

    return {
      reason: `Because you loved ${decade}s titles`,
      reasonCode: 'era-affinity',
    };
  }

  // 4 — the service they told us they have. Guarded by the same predicate that
  // awarded the term, so the sentence is true of the score, not merely of the
  // availability list.
  if (isAvailableOnSelectedService(title, preferences)) {
    const service = title.availability.find((entry) =>
      isOnSelectedService(entry.providerId, preferences),
    );
    const serviceLabel =
      service === undefined ? undefined : PROVIDER_LABELS.get(service.providerId);
    if (serviceLabel !== undefined) {
      return { reason: `On ${serviceLabel}, one of your services`, reasonCode: 'service' };
    }
  }

  return { reason: null, reasonCode: 'none' };
}

/** The first of `ids` that is also a genre of this title, named. */
function labelFor(genres: readonly string[], ids: readonly string[]): string | null {
  const match = genres.find((genre) => ids.includes(genre));
  return match === undefined ? null : (GENRE_LABELS.get(match) ?? null);
}

/**
 * The first genre of this title whose weight is positive, named.
 *
 * Skips a positive genre with no label rather than giving up on the sentence:
 * the affinity it contributed is still real, and another labelled genre can
 * still say it honestly.
 */
function labelForPositive(
  genres: readonly string[],
  weights: ReadonlyMap<string, number>,
): string | null {
  for (const genre of genres) {
    if ((weights.get(genre) ?? 0) <= 0) continue;
    const label = GENRE_LABELS.get(genre);
    if (label !== undefined) return label;
  }

  return null;
}

/** Builds the derived profile. Exported through the tests' behavior, not the API. */
function tasteProfile(
  catalog: readonly MediaTitle[],
  interactions: Readonly<Record<string, Interaction>>,
): TasteProfile {
  const genreWeights = new Map<string, number>();
  let positiveCount = 0;
  let yearTotal = 0;
  let runtimeTotal = 0;
  let runtimeEvidence = 0;

  for (const title of catalog) {
    const state = interactions[title.id]?.state;
    if (state === undefined) continue;

    const positive = POSITIVE_STATES.includes(state);
    if (!positive && !isRejection(state)) continue; // watchingNow says nothing.

    const weight = positive ? 1 : -1;
    for (const genre of new Set(title.genres)) {
      genreWeights.set(genre, (genreWeights.get(genre) ?? 0) + weight);
    }

    if (!positive) continue;

    positiveCount += 1;
    yearTotal += title.releaseYear;

    if (typeof title.runtimeMinutes === 'number' && Number.isFinite(title.runtimeMinutes)) {
      runtimeTotal += title.runtimeMinutes;
      runtimeEvidence += 1;
    }
  }

  return {
    genreWeights,
    positiveCount,
    eraCentre: positiveCount > 0 ? yearTotal / positiveCount : null,
    runtimeCentre: runtimeEvidence > 0 ? runtimeTotal / runtimeEvidence : null,
    runtimeEvidence,
  };
}

/** A candidate and the score it will report, before the diversity re-rank. */
interface ScoredTitle {
  readonly title: MediaTitle;
  readonly score: number;
}

/**
 * Maximal marginal relevance over the leading window (US2).
 *
 * The first card is the best-scored one; every card after it is chosen by
 * `λ·relevance − (1 − λ)·similarity-to-the-most-similar-card-already-picked`.
 * Relevance is min-max normalized over the window, so the re-rank compares
 * positions in this deck rather than absolute scores. Ties go to the earlier
 * entry in score order — the loop only replaces the leader on a strictly
 * greater value — which keeps the whole stage a total order (SC-003).
 *
 * Nothing beyond the window is touched, and no candidate is added or dropped:
 * this stage changes order, never membership.
 */
function diversify(scored: readonly ScoredTitle[]): ScoredTitle[] {
  const window = scored.slice(0, MMR_WINDOW);

  if (window.length < 2) return [...scored];

  let min = window[0].score;
  let max = window[0].score;

  for (const entry of window) {
    if (entry.score < min) min = entry.score;
    if (entry.score > max) max = entry.score;
  }

  const spread = max - min;
  const relevance = window.map((entry) =>
    spread === 0 ? 1 : (entry.score - min) / spread,
  );

  // The window arrives in score order, so its first entry has the maximum
  // relevance — the contract's "first, the highest r" with the original-order
  // tiebreak already decided.
  const picked: number[] = [0];
  const chosen: boolean[] = window.map(() => false);
  chosen[0] = true;

  while (picked.length < window.length) {
    let best = -1;
    let bestValue = 0;

    for (let index = 0; index < window.length; index++) {
      if (chosen[index]) continue;

      let closest = 0;
      for (const pick of picked) {
        const similarity = genreSimilarity(window[index].title.genres, window[pick].title.genres);
        if (similarity > closest) closest = similarity;
      }

      const value = MMR_LAMBDA * relevance[index] - (1 - MMR_LAMBDA) * closest;

      // Strictly greater: an equal value keeps the earlier candidate, which is
      // the original score order — the deterministic tiebreak.
      if (best === -1 || value > bestValue) {
        best = index;
        bestValue = value;
      }
    }

    chosen[best] = true;
    picked.push(best);
  }

  return [...picked.map((index) => window[index]), ...scored.slice(MMR_WINDOW)];
}

/**
 * Jaccard over two genre sets, **zero when both are empty**.
 *
 * Deliberately not the harness's `genreJaccard`: the diversity measure treats
 * two genre-less titles as similar, because a ranker showing nothing but those
 * made no distinction it can be credited for. Here the question is whether
 * picking one makes another redundant, and two empty sets give no evidence
 * either way — so the re-rank charges no similarity for them.
 */
function genreSimilarity(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);

  let shared = 0;
  for (const genre of a) if (b.has(genre)) shared += 1;

  const union = a.size + b.size - shared;

  return union === 0 ? 0 : shared / union;
}

