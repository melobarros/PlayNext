import { createDeckSession, DeckSession } from '../../../core/models/deck-session';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import { advance, currentCard, loopFor, startNewLoop } from './deck-session';

/**
 * Tests for the loop's transitions.
 *
 * Pure functions, so no `TestBed` here. One consequence worth stating: these
 * tests prove the advance path has **nowhere** to record a rating (FR-004),
 * because a `DeckSession` has no field for one and `advance` returns nothing
 * else. The end-to-end version of that guarantee — that
 * `playnext:interactions` is still untouched after a rating-free swipe session
 * — belongs to the DOM-driven integration test in `deck.spec.ts` (T024), which
 * has a store to check.
 */

const STARTED_AT = '2026-09-26T10:00:00.000Z';

function session(shownTitleIds: string[] = []): DeckSession {
  return { ...createDeckSession(STARTED_AT), shownTitleIds };
}

function title(id: string): MediaTitle {
  return {
    id,
    title: id,
    releaseYear: 2020,
    mediaType: 'movie',
    genres: [],
    synopsis: '',
    rating: 7,
    voteCount: 1000,
    availability: [],
  };
}

/** What a ranked list looks like coming out of `rankTitles`. */
const ranked = [title('first'), title('second'), title('third')];

describe('advance', () => {
  it('appends the advanced-past id to shownTitleIds (FR-010)', () => {
    const next = advance(session(), 'first');

    expect(next.shownTitleIds).toEqual(['first']);
  });

  it('appends to what is already shown, in order', () => {
    const next = advance(session(['first']), 'second');

    expect(next.shownTitleIds).toEqual(['first', 'second']);
  });

  it('does not mutate the session it was given', () => {
    const before = session(['first']);

    advance(before, 'second');

    expect(before.shownTitleIds).toEqual(['first']);
  });

  it('records an id once, however many times it is advanced', () => {
    // Rapid successive taps must yield exactly one next card each, not a
    // duplicated history (spec Edge Cases).
    const once = advance(session(), 'first');
    const twice = advance(once, 'first');

    expect(twice.shownTitleIds).toEqual(['first']);
  });

  it('leaves startedAt alone — advancing is not a new loop', () => {
    const next = advance(session(), 'first');

    expect(next.startedAt).toBe(STARTED_AT);
    expect(next.schemaVersion).toBe(1);
  });

  it('has nowhere to record an interaction (FR-004)', () => {
    // A swipe is a neutral skip: no rating, no history entry. That is not a
    // rule the advance path has to remember — there is no field to put one in.
    expect(Object.keys(advance(session(), 'first')).sort()).toEqual([
      'schemaVersion',
      'shownTitleIds',
      'startedAt',
    ]);
  });
});

describe('currentCard', () => {
  it('is the top of the ranking when nothing has been shown', () => {
    expect(currentCard(session(), ranked)?.id).toBe('first');
  });

  it('skips an id the loop has already advanced past (FR-010)', () => {
    expect(currentCard(session(['first']), ranked)?.id).toBe('second');
  });

  it('excludes every shown id, not just the most recent', () => {
    expect(currentCard(session(['first', 'second']), ranked)?.id).toBe('third');
  });

  it('ignores a shown id the ranking no longer contains', () => {
    // An id can leave the ranking when a rating changes the filters. It must
    // not stop the loop from finding the next card.
    expect(currentCard(session(['a-retired-title']), ranked)?.id).toBe('first');
  });

  it('returns null when everything is shown, which drives the empty state (FR-014)', () => {
    expect(currentCard(session(['first', 'second', 'third']), ranked)).toBeNull();
  });

  it('returns null for an empty ranking rather than throwing', () => {
    expect(currentCard(session(), [])).toBeNull();
  });
});

describe('startNewLoop', () => {
  it('clears shownTitleIds', () => {
    expect(startNewLoop().shownTitleIds).toEqual([]);
  });

  it('starts a fresh loop with its own startedAt', () => {
    const next = startNewLoop('2026-09-26T12:00:00.000Z');

    expect(next.startedAt).toBe('2026-09-26T12:00:00.000Z');
    expect(next.schemaVersion).toBe(1);
  });

  it('carries no ratings forward, so exclusions keep applying (FR-009)', () => {
    // Deliberately identical to a first-visit session: the loop is throwaway,
    // and what the visitor rejected lives in the interaction document, which
    // this function never touches and could not reset if it wanted to.
    expect(Object.keys(startNewLoop()).sort()).toEqual([
      'schemaVersion',
      'shownTitleIds',
      'startedAt',
    ]);
  });
});

describe('loopFor', () => {
  /** Answers completed at `completedAt`, otherwise the deck's usual input. */
  function preference(completedAt: string): Preference {
    return {
      mediaType: { values: ['movie'], any: false },
      genre: { values: ['horror'], any: false },
      provider: { values: ['netflix'], any: false },
      includeUnownedProviders: false,
      completedAt,
    };
  }

  it('resumes a loop that belongs to the answers in force', () => {
    const saved = session(['first']);

    expect(loopFor(saved, preference('2026-09-26T09:00:00.000Z'))).toBe(saved);
  });

  it('starts a new loop when the quiz was completed again (FR-014)', () => {
    // The visitor hit the empty state, widened their answers and finished the
    // quiz. Their old walk was through a ranking produced by the *old*
    // answers, so resuming it would show the same shrivelled deck — the dead
    // end the reset exists to escape.
    const saved = session(['first', 'second']);

    const next = loopFor(saved, preference('2026-09-26T11:00:00.000Z'));

    expect(next.shownTitleIds).toEqual([]);
    expect(next.startedAt).not.toBe(saved.startedAt);
  });

  it('resumes rather than discards when the two timestamps are equal', () => {
    // Unreachable in practice — a retake takes three quiz steps, so its
    // `completedAt` is seconds after any loop it could be confused with. The
    // tie is pinned because it is the case an off-by-one hides in, and the
    // safer reading of an ambiguous comparison is to keep the visitor's loop
    // rather than throw their place away.
    const saved = session(['first']);

    expect(loopFor(saved, preference(STARTED_AT))).toBe(saved);
  });

  it('resumes when the loop started after the answers were completed', () => {
    // The ordinary case: quiz completed, deck opened a moment later.
    const saved = { ...session(['first']), startedAt: '2026-09-26T10:00:01.000Z' };

    expect(loopFor(saved, preference(STARTED_AT))).toBe(saved);
  });

  it('hands back the loop unchanged while the quiz is still in progress', () => {
    // No preference means no ranking to invalidate. The deck shows its
    // "finish the quiz" state, and the loop is left for the visitor to come
    // back to — `startRetake` deletes `completedAt`, so a retake in progress
    // must not be mistaken for a new set of answers.
    const saved = session(['first']);

    expect(loopFor(saved, null)).toBe(saved);
  });
});
