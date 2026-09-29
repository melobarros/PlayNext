import { Interaction, InteractionState, isExcluding } from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import { GENRES, RETIRED_PROVIDER_SUCCESSORS } from '../../../core/models/quiz-options.data';

/**
 * The recommendation engine
 * (`specs/002-recommendation-deck/contracts/recommendation-engine.md`).
 *
 * A pure function, deliberately: it is the product's core asset and the reason
 * the deck is trustworthy, so both constitution invariants — Filter Enforcement
 * and the Feedback Loop — are provable by test rather than arguable. No Angular,
 * no DOM, no clock, no network, and **no randomness anywhere**. A new loop feels
 * fresh because the visitor's own ratings changed the scores, not because a dice
 * roll did (constitution VI).
 *
 * The Milestone 2 backend reimplements this in the Domain layer, which is why
 * it is written to be read by someone porting it: every term is a named
 * constant and every rule maps to a numbered filter in the contract.
 */

/** Score weight for each net genre the visitor's own ratings point at. */
const HISTORY_AFFINITY_WEIGHT = 6;

/**
 * Demotion for each selectable genre a title wears that the visitor did not
 * pick — the difference between "a comedy" and "a kids animation filed under
 * comedy". Chosen against the two terms it sits between: it outweighs the
 * widest rating gap a mega-vote title can open over a mid-rated one, and it
 * stays below two loved genres (2 × 6), so the visitor's own ratings still
 * speak louder than one unselected tag. It can only reorder *within* a match
 * tier, which is why it needs no guard against the tier above it.
 */
const MISMATCHED_GENRE_PENALTY = 10;

/** The quiz's own genre vocabulary — the ids a visitor can actually select. */
const SELECTABLE_GENRE_IDS: ReadonlySet<string> = new Set(GENRES.map((genre) => genre.id));

/**
 * Confidence-weighted rating: pulls low-evidence titles toward the middle, so a
 * lone 10.0 from a handful of votes cannot top the deck. The prior is a 6.5
 * rating over 500 votes — standard, explainable to a stakeholder, and computed
 * identically every time.
 */
const RATING_PRIOR = 6.5;
const RATING_PRIOR_WEIGHT = 500;

/** States that mean "more like this". `watchingNow` is deliberately neither. */
const POSITIVE_STATES: readonly InteractionState[] = ['loved', 'liked', 'wantToWatch'];

/**
 * Ranks the catalog for a visitor, best first.
 *
 * The order is two keys deep, not one score: how many of the visitor's genres
 * the title matches, then a within-tier score. Making the tier its own key
 * rather than a weighted term is what makes "rom-coms first, animations when
 * those run out" a property of the comparator instead of an arithmetic
 * argument — no affinity total or rating gap can ever carry a title past the
 * tier above it, whatever the catalog holds.
 *
 * Returns a new array every call and never mutates its inputs. An empty result
 * is a normal value — it drives the empty state (FR-014), it is not an error.
 */
export function rankTitles(
  catalog: readonly MediaTitle[],
  preferences: Preference,
  interactions: Readonly<Record<string, Interaction>>,
  shownTitleIds: readonly string[],
): MediaTitle[] {
  const { lovedGenres, dislikedGenres } = genreSignals(catalog, interactions);

  return catalog
    .filter((title) => isEligible(title, preferences, interactions, shownTitleIds))
    .map((title) => ({
      title,
      matches: matchedGenres(title, preferences),
      within:
        HISTORY_AFFINITY_WEIGHT * historyAffinity(title, lovedGenres, dislikedGenres) -
        MISMATCHED_GENRE_PENALTY * mismatchedGenres(title, preferences) +
        weightedRating(title),
    }))
    .sort(
      (a, b) =>
        b.matches - a.matches || b.within - a.within || compareIds(a.title.id, b.title.id),
    )
    .map((scored) => scored.title);
}

/**
 * Stage 1 — the five hard filters. A title is dropped when any one holds;
 * order is irrelevant, a drop is a drop.
 */
function isEligible(
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
    !isOnSelectedService(title, preferences)
  ) {
    return false;
  }

  // 4 — previously rejected (FR-009, Feedback Loop invariant). The only place
  // exclusion is decided, and it reads the *current* state, so spec 003's
  // re-rating un-excludes a title with no extra mechanism.
  if (isRejected(interactions[title.id])) return false;

  // 5 — already advanced past this loop (FR-010).
  return !shownTitleIds.includes(title.id);
}

function isScorable(title: MediaTitle): boolean {
  return (
    typeof title.id === 'string' &&
    title.id.length > 0 &&
    Number.isFinite(title.rating) &&
    Number.isFinite(title.voteCount) &&
    title.voteCount >= 0
  );
}

/** Filter 4's question, asked of a possibly-absent rating. */
function isRejected(interaction: Interaction | undefined): boolean {
  return interaction !== undefined && isExcluding(interaction.state);
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
function isOnSelectedService(title: MediaTitle, preferences: Preference): boolean {
  return title.availability.some((entry) =>
    preferences.provider.values.some(
      (selected) =>
        selected === entry.providerId ||
        RETIRED_PROVIDER_SUCCESSORS[selected] === entry.providerId,
    ),
  );
}

/** Stage 2's tier key. Plain overlap: more of what they asked for ranks higher. */
function matchedGenres(title: MediaTitle, preferences: Preference): number {
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
function mismatchedGenres(title: MediaTitle, preferences: Preference): number {
  if (preferences.genre.any) return 0;
  return title.genres.filter(
    (genre) => SELECTABLE_GENRE_IDS.has(genre) && !preferences.genre.values.includes(genre),
  ).length;
}

/**
 * Stage 2, term 2 — the feedback loop's positive/negative signal.
 *
 * Derived from the visitor's own ratings, and it **may be negative**: a title
 * wearing genres the visitor rejected sinks. Rejected *titles* are already gone
 * by filter 4; this is how their taste generalizes past the specific titles
 * they rejected.
 *
 * It counts every genre a title wears, tags included, and is left unbounded:
 * the tier key above it is what keeps a loved-genre total from carrying a title
 * past a better match, so no clamp is needed here to say that.
 */
function historyAffinity(
  title: MediaTitle,
  lovedGenres: ReadonlySet<string>,
  dislikedGenres: ReadonlySet<string>,
): number {
  const loved = title.genres.filter((genre) => lovedGenres.has(genre)).length;
  const disliked = title.genres.filter((genre) => dislikedGenres.has(genre)).length;

  return loved - disliked;
}

/**
 * The genres the visitor's ratings point at, gathered from the **whole**
 * catalog — including titles the filters will go on to drop. Computing this
 * after filtering would throw away the very signal the term exists to carry.
 *
 * A rated id the catalog does not know contributes nothing, which is correct:
 * we cannot infer a genre from a title we cannot see.
 */
function genreSignals(
  catalog: readonly MediaTitle[],
  interactions: Readonly<Record<string, Interaction>>,
): { lovedGenres: Set<string>; dislikedGenres: Set<string> } {
  const lovedGenres = new Set<string>();
  const dislikedGenres = new Set<string>();

  for (const title of catalog) {
    const state = interactions[title.id]?.state;
    if (state === undefined) continue;

    // `watchingNow` is neither: having watched something says nothing yet
    // about whether they want more of it.
    const target = POSITIVE_STATES.includes(state)
      ? lovedGenres
      : isExcluding(state)
        ? dislikedGenres
        : undefined;

    if (target === undefined) continue;
    for (const genre of title.genres) target.add(genre);
  }

  return { lovedGenres, dislikedGenres };
}

/** Stage 2, term 3 — quality, confidence-weighted (see the constants above). */
function weightedRating(title: MediaTitle): number {
  return (
    (title.rating * title.voteCount + RATING_PRIOR * RATING_PRIOR_WEIGHT) /
    (title.voteCount + RATING_PRIOR_WEIGHT)
  );
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
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
