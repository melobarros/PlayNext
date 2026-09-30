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
 * A `DeckSession` has no field in which one could be smuggled; ratings live in
 * the interaction document, and this one only remembers what has been *seen*.
 */
export function advance(session: DeckSession, titleId: string): DeckSession {
  if (session.shownTitleIds.includes(titleId)) return session;

  return { ...session, shownTitleIds: [...session.shownTitleIds, titleId] };
}

/**
 * Undoes one advance: puts the title back at the front of the walk.
 *
 * The other half of `advance`, and it exists for the same reason the card is
 * derived rather than stored. Un-showing an id is all it takes to bring that
 * card back — `currentCard` walks the ranking in order and returns the first
 * title not in `shownTitleIds`, so a rewound id is simply eligible again, and
 * it reappears in its original position because the ranking never changed.
 * Nothing is re-sorted and no cursor is restored, because there is no cursor.
 *
 * An id that is not in the walk returns the session **by reference**. That is
 * not a micro-optimisation: the caller writes whatever comes back, and handing
 * it a fresh object with identical contents would turn "nothing happened" into
 * a disk write with a new `startedAt`-adjacent identity. Same reference means
 * `goTo` can be called unconditionally and still be a no-op.
 *
 * The persisted shape is untouched — `shownTitleIds` is still the only field
 * this module writes, so a document saved before Undo existed stays valid.
 */
export function rewind(session: DeckSession, titleId: string): DeckSession {
  if (!session.shownTitleIds.includes(titleId)) return session;

  return {
    ...session,
    shownTitleIds: session.shownTitleIds.filter((shown) => shown !== titleId),
  };
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
 *
 * Generic over the ranked item so it can hand back whatever the ranking
 * produced — a `RankedTitle` arrives as a `RankedTitle`, `reason` and all —
 * without this module having to know what the engine decided to attach. The
 * only thing the walk needs from an item is its id.
 */
export function currentCard<T extends MediaTitle>(
  session: DeckSession,
  ranked: readonly T[],
): T | null {
  return ranked.find((title) => !session.shownTitleIds.includes(title.id)) ?? null;
}

/**
 * Begins a fresh loop from Match Found, or after the deck runs dry.
 *
 * Intentionally identical to a first-visit session. Nothing needs carrying
 * over: the ratings that drive exclusions and affinity live in the interaction
 * document, so they keep applying to the new loop without this function
 * touching them (FR-009 and the spec's state transitions).
 *
 * What this clears is `shownTitleIds` and only that — "seen, no opinion". Every
 * rated title stays out, which is what makes the loop genuinely new rather than
 * merely reshuffled: a visitor who taps Watch Now and starts a new loop should
 * not be handed the film they just chose, and would be if a restart also
 * cleared the ratings.
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
