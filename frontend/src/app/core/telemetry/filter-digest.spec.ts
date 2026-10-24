import { Preference } from '../models/quiz';
import { filterDigest } from './filter-digest';

/**
 * The filter digest an impression records (009, research D7).
 *
 * The record must say *what* the deck was filtered to without storing the
 * filter: the selection is a preference document, and copying it into a log
 * would make the log a profile. A short opaque digest answers "were these two
 * decks ranked under the same filters?" — which is the only question a replay
 * needs — and answers nothing else.
 *
 * The tests that matter are the equivalences: order and repetition inside a
 * dimension carry no meaning (the contract is OR within a dimension), so they
 * must not produce a different digest; and every input that *does* change the
 * deck must produce one. A digest that collided across filters would silently
 * merge two different populations in an offline comparison.
 */
describe('filterDigest', () => {
  function preference(overrides: Partial<Preference> = {}): Preference {
    return {
      mediaType: { values: ['movie'], any: false },
      genre: { values: ['horror', 'thriller'], any: false },
      provider: { values: ['netflix', 'max'], any: false },
      includeUnownedProviders: false,
      completedAt: '2026-10-24T18:00:00.000Z',
      ...overrides,
    };
  }

  it('is sixteen lowercase hex characters', () => {
    expect(filterDigest('BR', preference())).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable: the same filters always give the same digest', () => {
    expect(filterDigest('BR', preference())).toBe(filterDigest('BR', preference()));
  });

  describe('what does not change it', () => {
    it('the order of the values inside a dimension', () => {
      // Across a dimension the contract is OR, which has no order. A digest
      // keyed on the array as typed would split one population in two.
      const ordered = preference();
      const reordered = preference({
        genre: { values: ['thriller', 'horror'], any: false },
        provider: { values: ['max', 'netflix'], any: false },
      });

      expect(filterDigest('BR', reordered)).toBe(filterDigest('BR', ordered));
    });

    it('a value repeated inside a dimension', () => {
      const once = preference();
      const twice = preference({ genre: { values: ['horror', 'thriller', 'horror'], any: false } });

      expect(filterDigest('BR', twice)).toBe(filterDigest('BR', once));
    });

    it('when the quiz was completed', () => {
      // Two visitors with the same answers and different quiz timestamps have
      // the same filters; `completedAt` is metadata about the visit, not about
      // the deck.
      const earlier = preference({ completedAt: '2026-01-01T00:00:00.000Z' });
      const later = preference({ completedAt: '2026-10-24T18:00:00.000Z' });

      expect(filterDigest('BR', later)).toBe(filterDigest('BR', earlier));
    });
  });

  describe('what does change it', () => {
    it('the region', () => {
      expect(filterDigest('US', preference())).not.toBe(filterDigest('BR', preference()));
    });

    it('the media type', () => {
      expect(
        filterDigest('BR', preference({ mediaType: { values: ['tv'], any: false } })),
      ).not.toBe(filterDigest('BR', preference()));
    });

    it('the genre selection', () => {
      expect(
        filterDigest('BR', preference({ genre: { values: ['horror'], any: false } })),
      ).not.toBe(filterDigest('BR', preference()));
    });

    it('the provider selection', () => {
      expect(
        filterDigest('BR', preference({ provider: { values: ['netflix'], any: false } })),
      ).not.toBe(filterDigest('BR', preference()));
    });

    it('including unowned providers', () => {
      expect(filterDigest('BR', preference({ includeUnownedProviders: true }))).not.toBe(
        filterDigest('BR', preference()),
      );
    });

    it('choosing Any rather than a selection', () => {
      // "Any" is not the same filter as a selection that happens to contain
      // everything: the first skips filter 2 entirely and the second still
      // ranks by match count.
      const any = preference({ genre: { values: [], any: true } });
      const selection = preference({ genre: { values: [], any: false } });

      expect(filterDigest('BR', any)).not.toBe(filterDigest('BR', selection));
    });

    it('a different value in the same position', () => {
      expect(
        filterDigest('BR', preference({ genre: { values: ['comedy', 'thriller'], any: false } })),
      ).not.toBe(filterDigest('BR', preference()));
    });
  });

  describe('the privacy rule', () => {
    it('contains no raw preference value', () => {
      const digest = filterDigest('BR', preference());

      // The digest is the only representation of the filters the record keeps.
      // If a value could survive into it, it would be a preference in the log.
      for (const value of ['horror', 'thriller', 'netflix', 'max', 'movie', 'BR']) {
        expect(digest).not.toContain(value);
      }
    });

    it('does not reveal the value when two filters differ by one character', () => {
      // A hidden prefix would make a near-identical input produce a
      // near-identical digest; a hash may not.
      const a = filterDigest('BR', preference({ genre: { values: ['horrorx'], any: false } }));
      const b = filterDigest('BR', preference({ genre: { values: ['horrory'], any: false } }));

      expect(a).not.toBe(b);
      expect(a.slice(0, 4)).not.toBe(b.slice(0, 4));
    });
  });
});
