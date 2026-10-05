import {
  INTERACTION_STATES,
  INTERACTION_STATE_LABELS,
  isRated,
  isRejection,
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

    it('shows the positive trio under Liked and both rejections under Disliked', () => {
      // FR-001: the two merged tabs, and the reason each entry carries its own
      // state label rather than the tab's. `wantToWatch` joined the Liked tab on
      // 2026-09-30 when its own tab was removed — it stays listed because the
      // documents that hold it were written by a build that offered the tab.
      expect(surfaceFor('loved')).toBe('loved');
      expect(surfaceFor('liked')).toBe('loved');
      expect(surfaceFor('wantToWatch')).toBe('loved');
      expect(surfaceFor('disliked')).toBe('disliked');
      expect(surfaceFor('notInterested')).toBe('disliked');
    });

    it('puts Watching Now on the history and on no tab', () => {
      // FR-004: it is set only by the deck's Watch Now action, so it is never
      // one of the ratings a tab collects.
      expect(surfaceFor('watchingNow')).toBe('history');
      expect(WATCHLIST_TABS.flatMap((tab) => tab.states)).not.toContain('watchingNow');
    });

    it('renders two tabs, both of them marked as tabs', () => {
      expect(WATCHLIST_TABS.map((tab) => tab.id)).toEqual(['loved', 'disliked']);
    });

    it('names each surface for the visitor', () => {
      expect(WATCHLIST_TABS.map((tab) => tab.label)).toEqual(['Liked', 'Disliked']);
      expect(WATCHLIST_SURFACES.find((s) => s.id === 'history')?.label).toBe('History');
    });
  });

  describe('the rejection rule (the affinity signal)', () => {
    it('counts exactly Disliked and Not Interested as rejections', () => {
      // Restated in one place so that adding a state forces a deliberate
      // decision about whether the deck should read it as "less like this".
      const rejections = INTERACTION_STATES.filter(isRejection);

      expect(rejections).toEqual(['disliked', 'notInterested']);
    });

    it('leaves the states that are not a judgement out of it', () => {
      // A merged watchlist tab must not imply a merged rule: Liked is listed
      // under Loved, and neither is a rejection. `watchingNow` is neither
      // positive nor negative — having watched something says nothing yet about
      // whether the visitor wants more of it.
      expect(isRejection('liked')).toBe(false);
      expect(isRejection('loved')).toBe(false);
      expect(isRejection('wantToWatch')).toBe(false);
      expect(isRejection('watchingNow')).toBe(false);
    });
  });

  describe('the eligibility rule', () => {
    it('keeps out every title the visitor has rated, and only those', () => {
      // Deliberately *not* a state list, and this loop is the assertion: every
      // state in the vocabulary excludes its title, so a seventh state is
      // covered the day it is declared rather than the day someone remembers
      // to add it here. Un-rated is the only thing that is eligible, which is
      // what makes Undo — a delete — a complete way back in.
      for (const state of INTERACTION_STATES) {
        expect(isRated({ state, updatedAt: '2026-09-29T00:00:00.000Z' })).toBe(true);
      }

      expect(isRated(undefined)).toBe(false);
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
