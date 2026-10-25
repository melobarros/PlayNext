import { Interaction, InteractionState, isRated } from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import type { ReasonCode } from '../../../core/models/telemetry';
import {
  GENRES,
  RETIRED_PROVIDERS,
  RETIRED_PROVIDER_SUCCESSORS,
  STREAMING_PROVIDERS,
} from '../../../core/models/quiz-options.data';

/**
 * What every ranking engine shares: who is a candidate, how a genre selection
 * is read, and the id tiebreak (010, research D1).
 *
 * Eligibility lives here — once, imported by both engines — so a harness
 * comparison measures ordering and never the filter, and a new filter cannot be
 * added to one engine and forgotten in the other. This module was extracted
 * verbatim from `recommend.ts` when the second engine arrived; the comments
 * moved with the code because they explain rules that are still true.
 */

/** The quiz's own genre vocabulary — the ids a visitor can actually select. */
const SELECTABLE_GENRE_IDS: ReadonlySet<string> = new Set(
  GENRES.map((genre) => genre.id),
);

/**
 * Id → the word a visitor would say, for the reason line.
 *
 * Retired services are in here too, for the same reason they are in the
 * successor map: a title's availability is whatever the server last saw, and an
 * id this app no longer offers must still resolve to a name rather than to
 * itself.
 */
export const GENRE_LABELS: ReadonlyMap<string, string> = new Map(
  GENRES.map((genre) => [genre.id, genre.displayName]),
);

export const PROVIDER_LABELS: ReadonlyMap<string, string> = new Map(
  [...STREAMING_PROVIDERS, ...RETIRED_PROVIDERS].map((provider) => [
    provider.id,
    provider.displayName,
  ]),
);

/** States that mean "more like this". `watchingNow` is deliberately neither. */
export const POSITIVE_STATES: readonly InteractionState[] = ['loved', 'liked', 'wantToWatch'];

/**
 * Confidence-weighted rating: pulls low-evidence titles toward the middle, so a
 * lone 10.0 from a handful of votes cannot top the deck. The prior is a 6.5
 * rating over 500 votes — standard, explainable to a stakeholder, and computed
 * identically every time.
 *
 * v2 calibrates its prior to the catalog it ranks (010, D5); this fixed prior
 * remains the popularity baseline's yardstick on purpose, so two reports stay
 * comparable.
 */
export const RATING_PRIOR = 6.5;
export const RATING_PRIOR_WEIGHT = 500;

/**
 * A ranked title, plus the one-line answer to "why is this card here?".
 *
 * The reason is decided by the engine rather than derived in the card because
 * it is a statement about this ranking: it names the selection or the rating
 * signal that actually placed the title, and only the engine knows which of
 * those fired. It rides along on the returned value so `MediaTitle` stays purely
 * the storage-and-transport shape — a `reason` on the wire would be a claim the
 * API does not make, and the card would be guessing at it.
 *
 * `null` is the honest answer for a title that ranked on nothing in particular:
 * a deck is allowed to contain cards we cannot justify, and the card shows
 * nothing rather than inventing a reason.
 */
export interface RankedTitle extends MediaTitle {
  reason: string | null;
  /**
   * The number that placed the card (009).
   *
   * It is exposed so an impression can record *why* the card sat where it did,
   * and it is the value the harness and any future ranker are compared against.
   * v1 called it the within-tier term because its first key was a separate
   * tier; v2 has one score, and the field keeps the same meaning for the record.
   */
  score: number;
  /**
   * The branch that produced `reason` (009).
   *
   * `none` exactly when `reason` is null, which is what makes the stored code
   * and the sentence on the card two views of one decision rather than two
   * claims that could drift apart.
   */
  reasonCode: ReasonCode;
}

/**
 * The candidates a ranking engine would have been willing to show, in catalog
 * order (009).
 *
 * The popularity baseline in the offline harness must rank the *same* pool as
 * the engines, or the comparison would measure the filter rather than the
 * ordering. It asks this instead of re-implementing the filters, so a new
 * filter cannot be added to one and forgotten in the other.
 */
export function eligibleTitles(
  catalog: readonly MediaTitle[],
  preferences: Preference,
  interactions: Readonly<Record<string, Interaction>>,
  shownTitleIds: readonly string[],
): MediaTitle[] {
  return catalog.filter((title) => isEligible(title, preferences, interactions, shownTitleIds));
}

/**
 * The five hard filters. A title is dropped when any one holds; order is
 * irrelevant, a drop is a drop.
 */
export function isEligible(
  title: MediaTitle,
  preferences: Preference,
  interactions: Readonly<Record<string, Interaction>>,
  shownTitleIds: readonly string[],
): boolean {
  // A title that cannot be scored is filtered out rather than allowed to
  // produce NaN, which would corrupt the sort for every other title.
  if (!isScorable(title)) return false;

  // 1 — media type (FR-005).
  if (!preferences.mediaType.any && !preferences.mediaType.values.includes(title.mediaType)) {
    return false;
  }

  // 2 — genre (FR-005).
  if (!preferences.genre.any && matchedGenres(title, preferences) === 0) return false;

  // 3 — availability (FR-006). The constitution's named invariant: we never
  // suggest something the visitor cannot watch, unless they explicitly asked
  // to see other platforms.
  if (
    !preferences.provider.any &&
    !preferences.includeUnownedProviders &&
    !isAvailableOnSelectedService(title, preferences)
  ) {
    return false;
  }

  // 4 — already rated (FR-009, Feedback Loop invariant). Every state, not just
  // the two rejections: a title the visitor has judged, saved or watched is
  // not an open question, and a new loop is a new *walk* rather than a fresh
  // memory. Reading presence is what makes this survive the loop boundary,
  // where filter 5 below is cleared and this one is not.
  if (isRated(interactions[title.id])) return false;

  // 5 — already advanced past this loop (FR-010). The one thing a new loop
  // does forget, which is the point: nothing is repeated *within* a loop, but
  // an unrated title is welcome back in the next one.
  return !shownTitleIds.includes(title.id);
}

export function isScorable(title: MediaTitle): boolean {
  return (
    typeof title.id === 'string' &&
    title.id.length > 0 &&
    Number.isFinite(title.rating) &&
    Number.isFinite(title.voteCount) &&
    title.voteCount >= 0
  );
}

/**
 * Filter 3's question, asked of the visitor's selected services **and their
 * successors**.
 *
 * The successor lookup is what keeps a saved preference for a service that no
 * longer exists from matching nothing: Star+ is gone and its catalog is
 * Disney+'s, so a visitor whose stored preference says `star-plus` is looking
 * for Disney+ titles whether or not they have heard the news. The alternative —
 * matching literally — is an empty deck for that visitor, every genre, with no
 * way to discover why.
 *
 * A direct match is still checked first and still wins; the alias only ever
 * *adds* titles to a selection, never removes one.
 */
export function isAvailableOnSelectedService(
  title: MediaTitle,
  preferences: Preference,
): boolean {
  return title.availability.some((entry) => isOnSelectedService(entry.providerId, preferences));
}

/**
 * One availability entry's half of that question, split out because the reason
 * line has to name the *specific* service it matched — "On Disney+, one of your
 * services" is only true of the entry that matched, and asking the title-level
 * question would tell you that something matched without saying what.
 */
export function isOnSelectedService(providerId: string, preferences: Preference): boolean {
  return preferences.provider.values.some(
    (selected) =>
      selected === providerId || RETIRED_PROVIDER_SUCCESSORS[selected] === providerId,
  );
}

/** Stage 2's tier key. Plain overlap: more of what they asked for ranks higher. */
export function matchedGenres(title: MediaTitle, preferences: Preference): number {
  if (preferences.genre.any) return 0;
  return title.genres.filter((genre) => preferences.genre.values.includes(genre)).length;
}

/**
 * Stage 2's demotion term — the other half of what a genre selection says.
 *
 * Picking comedy and romance is also a statement about animation, and a title
 * wearing a genre the visitor could have picked but did not starts lower than
 * one that stays inside the selection. This is what puts Shrek behind a
 * rom-com instead of letting vote count decide.
 *
 * `Any` carries no such statement — it is the absence of a selection, not a
 * choice against everything — so the term vanishes and the tier falls back to
 * affinity and rating.
 *
 * Only the quiz's selectable ids count. A slug tag (`family`, `fantasy`…) is
 * not a genre the visitor was offered, so a title carrying one has disobeyed
 * nothing and is never penalized for it.
 */
export function mismatchedGenres(title: MediaTitle, preferences: Preference): number {
  if (preferences.genre.any) return 0;
  return title.genres.filter(
    (genre) => SELECTABLE_GENRE_IDS.has(genre) && !preferences.genre.values.includes(genre),
  ).length;
}

/**
 * Stage 3 — the id tiebreak.
 *
 * This is what makes FR-011 real. Without it the sequence would depend on
 * `Array.prototype.sort` stability and on the order the catalog happened to
 * arrive in, so the same preferences could produce a different deck on a
 * different device. Compared with `<`/`>` rather than `localeCompare` so the
 * order is byte-for-byte identical everywhere, independent of locale.
 */
export function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Stage 2, term 3 — quality, confidence-weighted (see the constants above). */
export function weightedRating(title: MediaTitle): number {
  return (
    (title.rating * title.voteCount + RATING_PRIOR * RATING_PRIOR_WEIGHT) /
    (title.voteCount + RATING_PRIOR_WEIGHT)
  );
}
