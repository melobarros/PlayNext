import { createDeckSession, DeckSession } from '../../../core/models/deck-session';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';

/**
 * The loop's transitions (T018) — distinct from the *document* the same name
 * describes in `core/models/deck-session.ts`. This file holds the behaviour
 * over that shape; that one holds the shape and its storage key.
 *
 * Pure functions with no cursor anywhere. The current card is **derived** from
 * the ranking rather than stored, which is what makes "refresh mid-deck retains
 * the current position" true for free: recomputing after a reload yields the
 * same card, with no stored position to disagree with the ranked list
 * (research.md D5).
 */

/**
 * Records that the visitor moved past a card.
 *
 * Advancing the same id twice is a no-op rather than a duplicate. That matters
 * for the spec's rapid-tap edge case: two fast taps on the advance action must
 * produce two cards, not one card and a doubled history entry.
 *
 * Note what this does *not* do — and structurally cannot do: record a rating.
 * A swipe is a neutral skip (FR-004), and a `DeckSession` has no field in which
 * a rating could be smuggled.
 */
export function advance(session: DeckSession, titleId: string): DeckSession {
  if (session.shownTitleIds.includes(titleId)) return session;

  return { ...session, shownTitleIds: [...session.shownTitleIds, titleId] };
}

/**
 * The card to show, or `null` when the visitor has seen everything eligible.
 *
 * The ranking is expected to arrive already filtered by `rankTitles`, which
 * drops shown ids as its filter 5. This excludes them a second time on
 * purpose: FR-010 is a promise the visitor experiences directly — nothing
 * repeats within a loop — and re-checking here makes that promise hold at the
 * point of display regardless of how the ranking was produced. A `null` result
 * is a normal value: it is what the empty state renders (FR-014), not an error.
 */
export function currentCard(
  session: DeckSession,
  ranked: readonly MediaTitle[],
): MediaTitle | null {
  return ranked.find((title) => !session.shownTitleIds.includes(title.id)) ?? null;
}

/**
 * Begins a fresh loop from Match Found, or after the deck runs dry.
 *
 * Intentionally identical to a first-visit session. Nothing needs carrying
 * over: the ratings that drive exclusions and affinity live in the interaction
 * document, so they keep applying to the new loop without this function
 * touching them (FR-009 and the spec's state transitions).
 */
export function startNewLoop(now: Date | string = new Date()): DeckSession {
  return createDeckSession(now);
}

/**
 * The loop the visitor is entitled to resume, given the answers in force.
 *
 * A loop is a walk through a ranked list, and that ranking is derived from the
 * quiz answers (FR-011). Answer the quiz again and the list changes underneath
 * the walk: `shownTitleIds` names titles the new ranking may not contain, so
 * resuming yields a deck that is part walk-through and part fresh — and when
 * the visitor arrived here by widening narrow filters, it yields the same
 * shrunken deck they were trying to escape (FR-014, constitution II).
 *
 * So a saved loop is resumed only while it postdates the answers that produced
 * it. Timestamps say that without a new field on the persisted document:
 * `startedAt` and `completedAt` are both fixed-width ISO-8601 UTC strings, which
 * compare lexicographically in chronological order.
 *
 * Note what this does *not* do: erase anything. The old loop simply stops
 * applying and the next advance overwrites it. That is what makes "completing
 * the quiz starts a new loop" hold for **every** route into a retake — the quiz
 * summary has its own retake action — rather than only for the one the empty
 * state happens to take.
 *
 * A tie resolves to resuming. It is unreachable in practice, and an ambiguous
 * comparison should never be the reason a visitor loses their place.
 */
export function loopFor(session: DeckSession, preference: Preference | null): DeckSession {
  if (preference === null) return session;

  return session.startedAt >= preference.completedAt ? session : startNewLoop();
}
