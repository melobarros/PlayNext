import {
  INTERACTION_STATES,
  INTERACTION_STATE_LABELS,
  isExcluding,
  surfaceFor,
  WATCHLIST_SURFACES,
  WATCHLIST_TABS,
} from './interaction';

/**
 * Tests for the rating vocabulary's structure.
 *
 * One assertion here is load-bearing beyond the others: **every state has
 * exactly one surface**. That is the guard against a rating being recorded and
 * then hidden, which is precisely the defect the clarification of 2026-09-26
 * fixed for `notInterested` — a title the visitor could rate Not Interested,
 * which then appeared in no tab and was excluded from the deck, leaving no way
 * back. A state added to the vocabulary without a surface would reintroduce it,
 * and this file is what fails when someone does that.
 */

describe('the rating vocabulary', () => {
  describe('watchlist surfaces', () => {
    it('gives every state exactly one surface', () => {
      for (const state of INTERACTION_STATES) {
        const surfaces = WATCHLIST_SURFACES.filter((surface) => surface.states.includes(state));

        expect(surfaces.map((surface) => surface.id)).toEqual([surfaceFor(state)]);
      }
    });

    it('lists no state that is not in the vocabulary', () => {
      const listed = WATCHLIST_SURFACES.flatMap((surface) => surface.states);

      for (const state of listed) {
        expect(INTERACTION_STATES).toContain(state);
      }
    });

    it('never lists the same state twice', () => {
      const listed = WATCHLIST_SURFACES.flatMap((surface) => surface.states);

      expect(new Set(listed).size).toBe(listed.length);
    });

    it('shows Liked under the Loved tab and Not Interested under the Disliked one', () => {
      // FR-001: the two merged tabs, and the reason each entry carries its own
      // state label rather than the tab's.
      expect(surfaceFor('liked')).toBe('loved');
      expect(surfaceFor('notInterested')).toBe('disliked');
    });

    it('puts Watching Now on the history and on no tab', () => {
      // FR-004: it is set only by the deck's Watch Now action, so it is never
      // one of the ratings a tab collects.
      expect(surfaceFor('watchingNow')).toBe('history');
      expect(WATCHLIST_TABS.flatMap((tab) => tab.states)).not.toContain('watchingNow');
    });

    it('renders three tabs, all of them marked as tabs', () => {
      expect(WATCHLIST_TABS.map((tab) => tab.id)).toEqual(['wantToWatch', 'loved', 'disliked']);
    });

    it('names each surface for the visitor', () => {
      expect(WATCHLIST_TABS.map((tab) => tab.label)).toEqual([
        'Want to Watch',
        'Loved',
        'Disliked',
      ]);
      expect(WATCHLIST_SURFACES.find((s) => s.id === 'history')?.label).toBe('History');
    });
  });

  describe('the exclusion rule', () => {
    it('excludes exactly Disliked and Not Interested', () => {
      // 003 FR-007: the deck's exclusion rule, restated so that adding a state
      // forces a deliberate decision about whether it excludes.
      const excluding = INTERACTION_STATES.filter(isExcluding);

      expect(excluding).toEqual(['disliked', 'notInterested']);
    });

    it('leaves every non-excluding state eligible', () => {
      // A merged tab must not imply a merged rule: Liked is listed under Loved
      // but does not exclude, and Want to Watch excludes nothing either.
      expect(isExcluding('liked')).toBe(false);
      expect(isExcluding('loved')).toBe(false);
      expect(isExcluding('wantToWatch')).toBe(false);
    });
  });

  describe('state labels', () => {
    it('labels every state', () => {
      for (const state of INTERACTION_STATES) {
        expect(INTERACTION_STATE_LABELS[state]).toBeTruthy();
      }
    });
  });
});
