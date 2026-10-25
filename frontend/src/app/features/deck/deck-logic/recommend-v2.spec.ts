import { Interaction, InteractionState } from '../../../core/models/interaction';
import { FIXTURE_CATALOG } from '../../../core/models/media-catalog.fixture';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import { rankTitlesV2 } from './recommend-v2';

/**
 * Tests for the candidate engine
 * (`specs/010-deterministic-engine-v2/contracts/ranking-engine.md`).
 *
 * The engine stays a pure function, so it is tested as one: no `TestBed`, no
 * DOM, no clock. Each scoring term is isolated by holding every other term
 * constant — most files below give every title the same rating and vote count,
 * which makes the calibrated quality term a constant and leaves the term under
 * test as the only thing that can reorder the deck.
 */

const RATED_AT = '2026-09-26T10:00:00.000Z';

function rated(state: InteractionState): Interaction {
  return { state, updatedAt: RATED_AT };
}

/** A title with sensible defaults, so each test states only what it cares about. */
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

/** A completed preference with everything set to "Any". */
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

/** Three positively rated titles in one genre — the minimum era/runtime evidence. */
function tasteAnchors(overrides: Partial<MediaTitle> = {}): MediaTitle[] {
  return [
    title('anchor-1', { genres: ['comedy'], ...overrides }),
    title('anchor-2', { genres: ['comedy'], ...overrides }),
    title('anchor-3', { genres: ['comedy'], ...overrides }),
  ];
}

const noInteractions: Record<string, Interaction> = {};

describe('rankTitlesV2 — the weighted genre term (FR-004)', () => {
  it('lets a strong one-genre match outrank a weak two-genre match', () => {
    // Equal vote counts keep the calibrated quality honest: 3.25 versus 7.75.
    // Genre match is worth 4, so the one-match title wins 11.75 to 11.25 — the
    // tiered incumbent could never do this (its tier key dominated).
    const catalog = [
      title('two-match', { genres: ['horror', 'thriller'], rating: 1 }),
      title('one-match', { genres: ['horror'], rating: 10 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference({ genre: { values: ['horror', 'thriller'], any: false } }),
      noInteractions,
      [],
    );

    expect(result.map((t) => t.id)).toEqual(['one-match', 'two-match']);
  });

  it('ranks more selected-genre matches higher when other terms are equal', () => {
    const catalog = [
      title('one-match', { genres: ['horror'] }),
      title('two-matches', { genres: ['horror', 'thriller'] }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference({ genre: { values: ['horror', 'thriller'], any: false } }),
      noInteractions,
      [],
    );

    expect(result.map((t) => t.id)).toEqual(['two-matches', 'one-match']);
  });

  it('contributes nothing when the visitor chose Any', () => {
    // Every term is equal, so the id tiebreak decides — and a title with three
    // genres gets no lift over one with none.
    const catalog = [
      title('bbb', { genres: ['horror', 'thriller', 'drama'] }),
      title('aaa', { genres: [] }),
    ];

    const result = rankTitlesV2(catalog, preference(), noInteractions, []);

    expect(result.map((t) => t.id)).toEqual(['aaa', 'bbb']);
  });
});

describe('rankTitlesV2 — history affinity (FR-005, D4)', () => {
  it('lifts a title wearing a genre the visitor loved', () => {
    const catalog = [
      title('loved-horror', { genres: ['horror'] }),
      title('aaa-drama', { genres: ['drama'] }),
      title('zzz-horror', { genres: ['horror'] }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'loved-horror': rated('loved') },
      [],
    );

    // The rated title itself is gone (the Feedback Loop), and its genre lifts a
    // title the visitor has never rated above a higher-id one with no signal.
    expect(result.map((t) => t.id)).toEqual(['zzz-horror', 'aaa-drama']);
  });

  it('divides a title’s affinity by its distinct genre count', () => {
    // Both candidates carry horror; one also carries two unrelated genres, so
    // its average affinity is a third of the narrow title's. Without the
    // normalization a many-tagged title would collect more evidence for free.
    const catalog = [
      title('signal', { genres: ['horror'] }),
      title('zzz-narrow', { genres: ['horror'] }),
      title('aaa-wide', { genres: ['horror', 'comedy', 'drama'] }),
    ];

    const result = rankTitlesV2(catalog, preference(), { signal: rated('loved') }, []);

    expect(result.map((t) => t.id)).toEqual(['zzz-narrow', 'aaa-wide']);
  });

  it('counts a duplicated genre tag once', () => {
    const catalog = [
      title('signal', { genres: ['horror'] }),
      title('aaa-dup', { genres: ['horror', 'horror'] }),
      title('zzz-narrow', { genres: ['horror'] }),
    ];

    const result = rankTitlesV2(catalog, preference(), { signal: rated('loved') }, []);

    // Same affinity, same quality — the ids decide, not the duplicate tag.
    expect(result.map((t) => t.id)).toEqual(['aaa-dup', 'zzz-narrow']);
    expect(result[0].score).toBe(result[1].score);
  });

  it.each(['loved', 'liked', 'wantToWatch'] as const)(
    'counts %s as positive',
    (state) => {
      const catalog = [
        title('rated-horror', { genres: ['horror'] }),
        title('aaa-drama', { genres: ['drama'] }),
        title('zzz-horror', { genres: ['horror'] }),
      ];

      const result = rankTitlesV2(catalog, preference(), { 'rated-horror': rated(state) }, []);

      expect(result.map((t) => t.id)).toEqual(['zzz-horror', 'aaa-drama']);
    },
  );

  it('is neutral for watchingNow — having watched says nothing about wanting more', () => {
    const catalog = [
      title('watched-horror', { genres: ['horror'] }),
      title('aaa-drama', { genres: ['drama'] }),
      title('zzz-horror', { genres: ['horror'] }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'watched-horror': rated('watchingNow') },
      [],
    );

    expect(result.map((t) => t.id)).toEqual(['aaa-drama', 'zzz-horror']);
  });

  it('sinks titles wearing a genre the visitor rejected', () => {
    const catalog = [
      title('rejected-horror', { genres: ['horror'] }),
      title('aaa-horror', { genres: ['horror'] }),
      title('bbb-drama', { genres: ['drama'] }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'rejected-horror': rated('disliked') },
      [],
    );

    expect(result.map((t) => t.id)).toEqual(['bbb-drama', 'aaa-horror']);
  });
});

describe('rankTitlesV2 — era affinity (FR-006)', () => {
  it('ranks a title closer to the visitor’s era higher', () => {
    const catalog = [
      ...tasteAnchors({ releaseYear: 1995 }),
      title('era-miss', { genres: ['drama'], releaseYear: 1960 }),
      title('era-hit', { genres: ['drama'], releaseYear: 1996 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'anchor-1': rated('loved'), 'anchor-2': rated('liked'), 'anchor-3': rated('wantToWatch') },
      [],
    );

    expect(result.map((t) => t.id)).toEqual(['era-hit', 'era-miss']);
  });

  it('is neutral with fewer than three positively rated titles', () => {
    const catalog = [
      title('anchor-1', { genres: ['comedy'], releaseYear: 1995 }),
      title('anchor-2', { genres: ['comedy'], releaseYear: 1995 }),
      title('aaa-old', { genres: ['drama'], releaseYear: 1930 }),
      title('zzz-new', { genres: ['drama'], releaseYear: 1995 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'anchor-1': rated('loved'), 'anchor-2': rated('loved') },
      [],
    );

    expect(result[0].score).toBe(result[1].score);
    expect(result.map((t) => t.id)).toEqual(['aaa-old', 'zzz-new']);
  });

  it('takes its centre from positives only, not rejections', () => {
    const catalog = [
      ...tasteAnchors({ releaseYear: 1995 }),
      title('rejected-anchor', { genres: ['comedy'], releaseYear: 1930 }),
      title('era-hit', { genres: ['drama'], releaseYear: 1996 }),
      title('era-miss', { genres: ['drama'], releaseYear: 1970 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      {
        'anchor-1': rated('loved'),
        'anchor-2': rated('loved'),
        'anchor-3': rated('loved'),
        'rejected-anchor': rated('disliked'),
      },
      [],
    );

    expect(result.map((t) => t.id)).toEqual(['era-hit', 'era-miss']);
  });

  it('cannot reorder anything when every title shares a release year', () => {
    const catalog = [
      ...tasteAnchors({ releaseYear: 2020 }),
      title('aaa', { genres: ['drama'], releaseYear: 2020 }),
      title('bbb', { genres: ['drama'], releaseYear: 2020 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'anchor-1': rated('loved'), 'anchor-2': rated('loved'), 'anchor-3': rated('loved') },
      [],
    );

    expect(result[0].score).toBe(result[1].score);
  });
});

describe('rankTitlesV2 — runtime affinity (FR-007)', () => {
  it('ranks a title closer to the visitor’s runtime higher', () => {
    const catalog = [
      title('anchor-1', { genres: ['comedy'], runtimeMinutes: 90 }),
      title('anchor-2', { genres: ['comedy'], runtimeMinutes: 100 }),
      title('anchor-3', { genres: ['comedy'], runtimeMinutes: 110 }),
      title('runtime-miss', { genres: ['drama'], runtimeMinutes: 220 }),
      title('runtime-hit', { genres: ['drama'], runtimeMinutes: 100 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'anchor-1': rated('loved'), 'anchor-2': rated('loved'), 'anchor-3': rated('loved') },
      [],
    );

    expect(result.map((t) => t.id)).toEqual(['runtime-hit', 'runtime-miss']);
  });

  it('is neutral when fewer than three positives carry a runtime', () => {
    const catalog = [
      title('anchor-1', { genres: ['comedy'], runtimeMinutes: 100 }),
      title('anchor-2', { genres: ['comedy'] }),
      title('aaa-short', { genres: ['drama'], runtimeMinutes: 100 }),
      title('zzz-long', { genres: ['drama'], runtimeMinutes: 220 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'anchor-1': rated('loved'), 'anchor-2': rated('loved') },
      [],
    );

    expect(result[0].score).toBe(result[1].score);
  });

  it('is neutral when the positively rated titles carry no runtime at all', () => {
    const catalog = [
      ...tasteAnchors(),
      title('aaa-short', { genres: ['drama'], runtimeMinutes: 80 }),
      title('zzz-long', { genres: ['drama'], runtimeMinutes: 240 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'anchor-1': rated('loved'), 'anchor-2': rated('loved'), 'anchor-3': rated('loved') },
      [],
    );

    expect(result[0].score).toBe(result[1].score);
    for (const ranked of result) expect(Number.isFinite(ranked.score)).toBe(true);
  });
});

describe('rankTitlesV2 — calibrated quality (FR-008, D5)', () => {
  it('pulls a zero-vote title exactly to the catalog mean rating', () => {
    const catalog = [
      title('zero', { rating: 1, voteCount: 0 }),
      title('a', { rating: 9, voteCount: 100 }),
      title('b', { rating: 3, voteCount: 100 }),
    ];

    const result = rankTitlesV2(catalog, preference(), noInteractions, []);

    // With no genre, service, or history terms, the score is the prior itself.
    expect(result.find((t) => t.id === 'zero')?.score).toBeCloseTo(13 / 3, 6);
  });

  it('does not let a lone 10.0 outrank a well-established 8.0', () => {
    const catalog = [
      title('anchor-1', { rating: 7 }),
      title('anchor-2', { rating: 7 }),
      title('anchor-3', { rating: 7 }),
      title('anchor-4', { rating: 7 }),
      title('anchor-5', { rating: 7 }),
      title('loud', { rating: 10, voteCount: 1 }),
      title('established', { rating: 8, voteCount: 1000 }),
    ];

    const result = rankTitlesV2(catalog, preference(), noInteractions, []);

    expect(result.findIndex((t) => t.id === 'established')).toBeLessThan(
      result.findIndex((t) => t.id === 'loud'),
    );
  });

  it('ranks a better-rated title above a worse-rated one at equal confidence', () => {
    const catalog = [
      title('worse', { rating: 7, voteCount: 5000 }),
      title('better', { rating: 9, voteCount: 5000 }),
    ];

    const result = rankTitlesV2(catalog, preference(), noInteractions, []);

    expect(result.map((t) => t.id)).toEqual(['better', 'worse']);
  });
});

describe('rankTitlesV2 — cold start and edge cases (FR-014)', () => {
  it('orders by quiz selection and quality alone when nothing has been rated', () => {
    const catalog = [
      title('weak-match', { genres: ['horror'], rating: 1 }),
      title('strong-match', { genres: ['horror'], rating: 10 }),
      title('off-genre', { genres: ['comedy'], rating: 10 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference({ genre: { values: ['horror'], any: false } }),
      noInteractions,
      [],
    );

    // The selection admits only horror; quality decides among the matches.
    expect(result.map((t) => t.id)).toEqual(['strong-match', 'weak-match']);
    expect(result.every((t) => t.reasonCode === 'genre-picked')).toBe(true);
  });

  it('keeps era and runtime neutral when only rejections exist', () => {
    const catalog = [
      title('rejected', { genres: ['comedy'], releaseYear: 1930 }),
      title('aaa-old', { genres: ['drama'], releaseYear: 1930 }),
      title('zzz-new', { genres: ['drama'], releaseYear: 2020 }),
    ];

    const result = rankTitlesV2(catalog, preference(), { rejected: rated('disliked') }, []);

    expect(result[0].score).toBe(result[1].score);
  });

  it('never throws or empties the deck because history is missing', () => {
    const catalog = [title('a'), title('b'), title('c')];

    expect(rankTitlesV2(catalog, preference(), noInteractions, [])).toHaveLength(3);
    expect(rankTitlesV2([], preference(), noInteractions, [])).toEqual([]);
  });
});

describe('rankTitlesV2 — determinism and purity', () => {
  it('produces the same order from a reversed catalog', () => {
    const reversed = [...FIXTURE_CATALOG].reverse();

    const forward = rankTitlesV2(FIXTURE_CATALOG, preference(), noInteractions, []);
    const backward = rankTitlesV2(reversed, preference(), noInteractions, []);

    expect(backward.map((t) => t.id)).toEqual(forward.map((t) => t.id));
  });

  it('breaks ties by id ascending', () => {
    const sameScore = { rating: 8, voteCount: 1000, genres: ['horror'] };
    const shuffled = [title('ccc', sameScore), title('aaa', sameScore), title('bbb', sameScore)];

    expect(rankTitlesV2(shuffled, preference(), noInteractions, []).map((t) => t.id)).toEqual([
      'aaa',
      'bbb',
      'ccc',
    ]);
  });

  it('never mutates its inputs', () => {
    const catalog = [title('bbb', { genres: ['horror'] }), title('aaa', { genres: ['horror'] })];
    const preferences = preference({ genre: { values: ['horror'], any: false } });
    const interactions = { bbb: rated('loved') };
    const shown = ['ccc'];

    const before = structuredClone({ catalog, preferences, interactions, shown });

    rankTitlesV2(catalog, preferences, interactions, shown);

    expect(catalog).toEqual(before.catalog);
    expect(preferences).toEqual(before.preferences);
    expect(interactions).toEqual(before.interactions);
    expect(shown).toEqual(before.shown);
  });

  it('gives every ranked title a finite score', () => {
    const result = rankTitlesV2(FIXTURE_CATALOG, preference(), noInteractions, []);

    expect(result.length).toBeGreaterThan(0);
    for (const ranked of result) expect(Number.isFinite(ranked.score)).toBe(true);
  });
});

describe('rankTitlesV2 — the availability term (D8)', () => {
  it('lifts a title on a selected service when other platforms are allowed', () => {
    const catalog = [
      title('aaa-unavailable', { availability: [] }),
      title('zzz-netflix', { availability: on('netflix') }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference({
        provider: { values: ['netflix'], any: false },
        includeUnownedProviders: true,
      }),
      noInteractions,
      [],
    );

    expect(result.map((t) => t.id)).toEqual(['zzz-netflix', 'aaa-unavailable']);
  });
});

describe('rankTitlesV2 — the performance guard (D10)', () => {
  it('ranks a 2 000-title catalog twenty times inside a generous ceiling', () => {
    const genres = ['horror', 'comedy', 'drama', 'animation', 'thriller', 'romance'];
    const catalog = Array.from({ length: 2000 }, (_, index) =>
      title(`title-${String(index).padStart(4, '0')}`, {
        genres: [genres[index % genres.length]],
        releaseYear: 1980 + (index % 45),
        rating: 5 + (index % 50) / 10,
        voteCount: (index * 137) % 100000,
      }),
    );

    const started = performance.now();
    for (let run = 0; run < 20; run += 1) {
      rankTitlesV2(catalog, preference(), noInteractions, []);
    }
    const elapsed = performance.now() - started;

    // Generous: this catches an accidental quadratic change, not a slow CI box.
    expect(elapsed).toBeLessThan(3000);
  });
});
