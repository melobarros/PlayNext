import { Interaction, InteractionState } from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import { rankTitlesV1 } from './recommend-v1';
import { rankTitlesV2 } from './recommend-v2';
import { eligibleTitles } from './recommend-shared';

/**
 * The constitution's two named invariants, proven against **both** engines
 * (010, SC-005).
 *
 * Eligibility lives in `recommend-shared.ts` precisely so this file can state
 * the guarantees once: whatever each engine does with the order, neither may
 * widen the pool. These tests are the reason a harness comparison measures
 * ranking rather than filtering.
 */

const RATED_AT = '2026-09-26T10:00:00.000Z';

function rated(state: InteractionState): Interaction {
  return { state, updatedAt: RATED_AT };
}

function title(id: string, overrides: Partial<MediaTitle> = {}): MediaTitle {
  return {
    id,
    title: id,
    releaseYear: 2020,
    mediaType: 'movie',
    genres: [],
    synopsis: '',
    rating: 8,
    voteCount: 1000,
    availability: [],
    ...overrides,
  };
}

function preference(overrides: Partial<Preference> = {}): Preference {
  return {
    mediaType: { values: [], any: true },
    genre: { values: [], any: true },
    provider: { values: [], any: true },
    includeUnownedProviders: false,
    completedAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  };
}

function on(providerId: string): MediaTitle['availability'] {
  return [{ providerId, deepLinkUrl: `https://example.test/${providerId}` }];
}

const ENGINES = [
  ['v1', rankTitlesV1] as const,
  ['v2', rankTitlesV2] as const,
];

const POOL = [
  title('netflix-horror', { genres: ['horror'], availability: on('netflix') }),
  title('hulu-comedy', { genres: ['comedy'], availability: on('hulu') }),
  title('disney-animation', { genres: ['animation'], availability: on('disney-plus') }),
  title('nowhere-drama', { genres: ['drama'], availability: [] }),
  title('star-horror', { genres: ['horror', 'thriller'], availability: on('star-plus') }),
];

describe.each(ENGINES)('%s — the hard filters are shared', (_name, rank) => {
  it('never returns a title off the selected services (Filter Enforcement)', () => {
    const preferences = preference({ provider: { values: ['netflix', 'disney-plus'], any: false } });

    const result = rank(POOL, preferences, {}, []);

    for (const ranked of result) {
      const available = ranked.availability.some((entry) =>
        ['netflix', 'disney-plus'].includes(entry.providerId),
      );
      expect(available).toBe(true);
    }
  });

  it('honors the retired-provider successor map', () => {
    const preferences = preference({ provider: { values: ['star-plus'], any: false } });

    const result = rank(POOL, preferences, {}, []);

    // The alias adds Disney+ to the selection; the literal star-plus id still
    // matches itself, exactly as it did in the incumbent.
    expect(result.map((t) => t.id).sort()).toEqual(['disney-animation', 'star-horror']);
  });

  it('widens to unavailable titles only when the visitor asked', () => {
    const preferences = preference({
      provider: { values: ['netflix'], any: false },
      includeUnownedProviders: true,
    });

    const result = rank(POOL, preferences, {}, []);

    expect(result.map((t) => t.id)).toContain('nowhere-drama');
  });

  it('never returns a title the visitor already rated, in any state (Feedback Loop)', () => {
    const interactions: Record<string, Interaction> = {
      'netflix-horror': rated('loved'),
      'hulu-comedy': rated('liked'),
      'disney-animation': rated('wantToWatch'),
      'nowhere-drama': rated('watchingNow'),
      'star-horror': rated('disliked'),
    };

    const result = rank(POOL, preference(), interactions, []);

    expect(result).toEqual([]);
  });

  it('never returns a title already advanced past in this loop', () => {
    const result = rank(POOL, preference(), {}, ['netflix-horror', 'star-horror']);

    expect(result.map((t) => t.id).sort()).toEqual([
      'disney-animation',
      'hulu-comedy',
      'nowhere-drama',
    ]);
  });

  it('returns exactly the shared eligible pool, whatever the order', () => {
    const preferences = preference({ genre: { values: ['horror', 'comedy'], any: false } });
    const interactions = { 'nowhere-drama': rated('liked') };
    const shown = ['hulu-comedy'];

    const ranked = rank(POOL, preferences, interactions, shown).map((t) => t.id).sort();
    const eligible = eligibleTitles(POOL, preferences, interactions, shown)
      .map((t) => t.id)
      .sort();

    expect(ranked).toEqual(eligible);
  });

  it('returns unique ids and never throws on an empty catalog', () => {
    const ids = rank(POOL, preference(), {}, []).map((t) => t.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(rank([], preference(), {}, [])).toEqual([]);
  });
});

describe('the two engines admit the same candidates', () => {
  it('differs in order at most, never in membership', () => {
    const preferences = preference({ genre: { values: ['horror', 'thriller'], any: false } });
    const interactions = { 'hulu-comedy': rated('loved') };
    const shown = ['nowhere-drama'];

    const v1 = rankTitlesV1(POOL, preferences, interactions, shown).map((t) => t.id).sort();
    const v2 = rankTitlesV2(POOL, preferences, interactions, shown).map((t) => t.id).sort();

    expect(v2).toEqual(v1);
  });
});
