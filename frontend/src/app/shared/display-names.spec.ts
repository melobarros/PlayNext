import { displayNames } from './display-names';

/**
 * Tests for id-to-name resolution.
 *
 * Extracted from `card.ts` when the watchlist row needed the same thing
 * (003 research.md D11 — extracted, not copied). The rules are small and both
 * of them are about *not* showing the visitor something meaningless: a raw id
 * on screen is a data fault the visitor cannot act on.
 */

const NAMES = new Map([
  ['netflix', 'Netflix'],
  ['max', 'Max'],
  ['horror', 'Horror'],
]);

describe('displayNames', () => {
  it('resolves each id to its display name, in order', () => {
    expect(displayNames(['max', 'netflix'], NAMES)).toEqual(['Max', 'Netflix']);
  });

  it('drops an id the option lists do not know', () => {
    // Printing it raw would put `a-defunct-service` in front of the visitor.
    // Genres and providers are stored as ids so a preference and a title are
    // directly comparable; an unrecognised one is a fault, and the card
    // degrades rather than reporting it (data-model.md: ignored, not fatal).
    expect(displayNames(['netflix', 'hbo-max-legacy'], NAMES)).toEqual(['Netflix']);
  });

  it('lists a name once however many ids produced it', () => {
    // One service reached through two availability entries is one badge.
    expect(displayNames(['netflix', 'netflix'], NAMES)).toEqual(['Netflix']);
  });

  it('is empty for no ids, and for ids that all resolve to nothing', () => {
    // Empty is what lets the caller render "Not on your services" rather than
    // an empty list, so it has to be a real answer and not an error.
    expect(displayNames([], NAMES)).toEqual([]);
    expect(displayNames(['unknown', 'also-unknown'], NAMES)).toEqual([]);
  });

  it('resolves across vocabularies, which is why it is not provider-specific', () => {
    // The card uses it for genres as well as providers. One function, one set
    // of rules — a genre list that deduplicated differently from a provider
    // list would be the kind of divergence nobody notices until it matters.
    expect(displayNames(['horror', 'netflix'], NAMES)).toEqual(['Horror', 'Netflix']);
  });
});
