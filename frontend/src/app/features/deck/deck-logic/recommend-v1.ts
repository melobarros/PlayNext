import { Interaction, InteractionState, isRejection } from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import type { ReasonCode } from '../../../core/models/telemetry';
import {
  GENRE_LABELS,
  POSITIVE_STATES,
  PROVIDER_LABELS,
  RankedTitle,
  compareIds,
  isEligible,
  isOnSelectedService,
  matchedGenres,
  mismatchedGenres,
  weightedRating,
} from './recommend-shared';

/**
 * The incumbent engine, `recommend-v1` (`specs/002-recommendation-deck/contracts/recommendation-engine.md`).
 *
 * Moved here verbatim when feature 010 added a second engine: the harness must
 * keep reporting the same incumbent row, and the deck must be able to serve
 * this order through `?engine=v1` while the rollout is evaluated. Its rules are
 * untouched — a rewrite would make every report that compares it to a candidate
 * compare two different yesterdays.
 *
 * A pure function, deliberately: it is the product's core asset and the reason
 * the deck is trustworthy, so both constitution invariants — Filter Enforcement
 * and the Feedback Loop — are provable by test rather than arguable. No Angular,
 * no DOM, no clock, no network, and **no randomness anywhere** (constitution VI).
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

/** The engine's version string, recorded on impressions produced by this order. */
export const RECOMMEND_V1_ENGINE_VERSION = 'recommend-v1';

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
 *
 * Every returned title carries its own `reason` (stage 4 below). The reason is
 * computed for all of them, not lazily for the one on screen: it reads the same
 * inputs the score did, so computing it here is what keeps the sentence and the
 * ordering from ever disagreeing.
 */
export function rankTitlesV1(
  catalog: readonly MediaTitle[],
  preferences: Preference,
  interactions: Readonly<Record<string, Interaction>>,
  shownTitleIds: readonly string[],
): RankedTitle[] {
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
    .map((scored) => ({
      // Spread rather than pick: a field added to `MediaTitle` later rides
      // along automatically instead of silently going missing on the card.
      ...scored.title,
      score: scored.within,
      ...reasonFor(scored.title, preferences, lovedGenres),
    }));
}

/**
 * Stage 4 — the reason, in the visitor's own words.
 *
 * One sentence, and only ever one: the deck's promise is that a card can be
 * justified, not that every term of the score is itemized. The precedence is
 * the order the visitor would recognize their own decision in — what they
 * *chose* in the quiz, then what their *ratings* have taught us, then the
 * service they already pay for. A title that landed on nothing but its
 * confidence-weighted rating gets `null`, which the card renders as silence.
 *
 * Every branch is guarded by a label lookup, so an id the option lists do not
 * know returns `null` rather than leaking `a-defunct-service` onto the card —
 * the same rule the card's own id→name mapping follows.
 */
function reasonFor(
  title: MediaTitle,
  preferences: Preference,
  lovedGenres: ReadonlySet<string>,
): { reason: string | null; reasonCode: ReasonCode } {
  // 1 — a genre from the quiz, named as the visitor chose it. Under a real
  // selection this is always available: filter 2 has already guaranteed that a
  // title reaching here overlaps the selection, so the only way past this
  // branch is a stored id with no label.
  if (!preferences.genre.any) {
    const picked = labelFor(title.genres, preferences.genre.values);
    if (picked !== null) {
      return { reason: `Because you picked ${picked}`, reasonCode: 'genre-picked' };
    }
  }

  // 2 — a genre the visitor's own ratings point at. Only reachable under
  // `Any`, where nothing was chosen and the feedback loop is the whole story.
  const loved = labelFor(title.genres, [...lovedGenres]);
  if (loved !== null) {
    return { reason: `Because you loved ${loved}`, reasonCode: 'genre-affinity' };
  }

  // 3 — the plainest reason of all, and the deck's founding constraint: it is
  // on a service they told us they have.
  const service = title.availability.find((entry) =>
    isOnSelectedService(entry.providerId, preferences),
  );
  const serviceLabel =
    service === undefined ? undefined : PROVIDER_LABELS.get(service.providerId);
  if (serviceLabel !== undefined) {
    return { reason: `On ${serviceLabel}, one of your services`, reasonCode: 'service' };
  }

  return { reason: null, reasonCode: 'none' };
}

/** The first of `ids` that is also a genre of this title, named. */
function labelFor(genres: readonly string[], ids: readonly string[]): string | null {
  const match = genres.find((genre) => ids.includes(genre));
  return match === undefined ? null : (GENRE_LABELS.get(match) ?? null);
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
 * Since filter 4 drops every rated title, *everything* this reads is dropped by
 * the time the sort runs. That is not a contradiction, it is the whole design:
 * the rated titles are gone from the deck precisely because they have already
 * said what they had to say, and this is where that gets heard.
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
    const state: InteractionState | undefined = interactions[title.id]?.state;
    if (state === undefined) continue;

    // `watchingNow` is neither: having watched something says nothing yet
    // about whether they want more of it.
    const target = POSITIVE_STATES.includes(state)
      ? lovedGenres
      : isRejection(state)
        ? dislikedGenres
        : undefined;

    if (target === undefined) continue;
    for (const genre of title.genres) target.add(genre);
  }

  return { lovedGenres, dislikedGenres };
}
