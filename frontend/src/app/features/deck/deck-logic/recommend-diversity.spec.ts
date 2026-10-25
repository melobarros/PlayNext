import { Interaction } from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import { coverage, intraListDiversity } from './evaluation/metrics';
import { personasFixture } from './evaluation/fixtures/personas';
import { incumbentRanker } from './evaluation/rankers';
import { replaySession } from './evaluation/replay';
import { Ranker } from './evaluation/types';
import { rankTitlesV1 } from './recommend-v1';
import { MMR_LAMBDA, MMR_WINDOW, rankTitlesV2 } from './recommend-v2';

/**
 * The diversity re-rank (US2,
 * `specs/010-deterministic-engine-v2/contracts/ranking-engine.md` § Diversity
 * re-rank).
 *
 * The engine sorts by score, then re-ranks the top window with maximal marginal
 * relevance: a card pays for being similar to a card already picked. These
 * tests state the parts that make that deterministic and safe — the order never
 * depends on the catalog's arrival order, nothing is injected or dropped, and
 * the catalogue beyond the window is untouched.
 */

const RATED_AT = '2026-09-26T10:00:00.000Z';

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

const noInteractions: Record<string, Interaction> = {};

const pad = (index: number): string => String(index).padStart(2, '0');

/**
 * Ten near-duplicates followed by ten distinct genre shapes, all with the same
 * score.
 *
 * Equal scores make the contrast exact: score order is the incumbent's id
 * order, so every id that moves between it and the candidate's order moved
 * because of similarity and nothing else.
 */
function nearDuplicateCatalog(): MediaTitle[] {
  const cluster = Array.from({ length: 10 }, (_, index) =>
    title(`a${pad(index + 1)}`, { genres: ['horror', 'thriller'] }),
  );
  const variety = [
    ['action'],
    ['comedy'],
    ['drama'],
    ['romance'],
    ['sci-fi'],
    ['animation'],
    ['documentary'],
    ['action', 'comedy'],
    ['drama', 'romance'],
    ['sci-fi', 'animation'],
  ];
  const distinct = variety.map((genres, index) => title(`b${pad(index + 1)}`, { genres }));

  return [...cluster, ...distinct];
}

const ids = (titles: readonly { id: string }[]): string[] => titles.map((entry) => entry.id);

describe('rankTitlesV2 — the diversity re-rank (US2)', () => {
  it('turns a near-duplicate ordering into a more varied top ten', () => {
    const catalog = nearDuplicateCatalog();

    const incumbent = rankTitlesV1(catalog, preference(), noInteractions, []);
    const candidate = rankTitlesV2(catalog, preference(), noInteractions, []);

    const incumbentTop = ids(incumbent).slice(0, 10);
    const candidateTop = ids(candidate).slice(0, 10);

    // The incumbent can only offer the cluster first: every score is equal, so
    // the id decides, and all ten leading ids carry the same genre pair.
    expect(new Set(incumbentTop)).toEqual(new Set(ids(catalog).slice(0, 10)));

    expect(intraListDiversity([candidateTop], catalog)).toBeGreaterThan(
      intraListDiversity([incumbentTop], catalog),
    );

    // The candidate pulls from both halves of the pool rather than trading one
    // near-duplicate for another.
    expect(candidateTop.some((id) => id.startsWith('a'))).toBe(true);
    expect(candidateTop.some((id) => id.startsWith('b'))).toBe(true);
  });

  it('is deterministic — two runs return the same order', () => {
    const catalog = nearDuplicateCatalog();

    const first = rankTitlesV2(catalog, preference(), noInteractions, []);
    const second = rankTitlesV2(catalog, preference(), noInteractions, []);

    expect(ids(second)).toEqual(ids(first));
  });

  it('does not depend on the order the catalog arrives in', () => {
    const catalog = nearDuplicateCatalog();
    const reversed = [...catalog].reverse();

    const forward = rankTitlesV2(catalog, preference(), noInteractions, []);
    const backward = rankTitlesV2(reversed, preference(), noInteractions, []);

    expect(ids(backward)).toEqual(ids(forward));
  });

  it('returns a permutation of the scored titles — nothing injected or dropped', () => {
    const catalog = nearDuplicateCatalog();

    const result = rankTitlesV2(catalog, preference(), noInteractions, []);

    expect(ids(result).slice().sort()).toEqual(ids(catalog).slice().sort());
    expect(new Set(ids(result)).size).toBe(catalog.length);
    for (const ranked of result) {
      expect(Number.isFinite(ranked.score)).toBe(true);
      expect(typeof ranked.reasonCode).toBe('string');
    }
  });

  it('keeps each card’s own score when the re-rank moves it', () => {
    // Two near-duplicates at the top, one slightly lower title with its own
    // genre, and a low-score floor so the window's min-max spread is real.
    const catalog = [
      title('a01', { genres: ['horror', 'thriller'], rating: 10 }),
      title('a02', { genres: ['horror', 'thriller'], rating: 10 }),
      title('b01', { genres: ['action'], rating: 9.9 }),
      title('z01', { genres: ['documentary'], rating: 1 }),
    ];

    const result = rankTitlesV2(catalog, preference(), noInteractions, []);

    // The near-duplicate penalty lifts `b01` above `a02`…
    expect(ids(result).slice(0, 3)).toEqual(['a01', 'b01', 'a02']);

    // …but the card still reports the score it was ranked by, not the MMR value.
    expect(result[1].score).toBeLessThan(result[2].score);
  });

  it(`re-ranks the first ${MMR_WINDOW} candidates and appends the rest in score order`, () => {
    // Two half-window blocks of near-duplicates fill the window; ten clearly
    // worse titles follow it. Every score in the window is equal, so its id
    // order and its score order are the same thing.
    const window = [
      ...Array.from({ length: 25 }, (_, index) =>
        title(`a${pad(index + 1)}`, { genres: ['horror', 'thriller'], rating: 9 }),
      ),
      ...Array.from({ length: 25 }, (_, index) =>
        title(`b${pad(index + 1)}`, { genres: ['action'], rating: 9 }),
      ),
    ];
    const beyond = Array.from({ length: 10 }, (_, index) =>
      title(`t${pad(index + 1)}`, { rating: 1 + index / 10 }),
    );

    const result = rankTitlesV2([...window, ...beyond], preference(), noInteractions, []);

    expect(result).toHaveLength(MMR_WINDOW + beyond.length);
    // Beyond the window nothing is reordered: descending rating, floored ids.
    expect(ids(result).slice(MMR_WINDOW)).toEqual(ids([...beyond].reverse()));
    // And the window itself was re-ranked relative to id/score order: the
    // second card alternates into the other block instead of repeating the first.
    expect(ids(result)[1]).toBe('b01');
    expect(ids(result).slice(0, MMR_WINDOW)).not.toEqual(ids(window));
  });

  it('treats the window boundary as exactly fifty — a fifty-first title is appended', () => {
    const window = Array.from({ length: MMR_WINDOW - 1 }, (_, index) =>
      title(`a${pad(index + 1)}`, { genres: ['horror', 'thriller'] }),
    );
    const window101 = title('b01', { genres: ['action'] });
    const beyond = title('zzz-beyond', { rating: 1 });

    const exactlyFifty = rankTitlesV2(
      [...window, window101],
      preference(),
      noInteractions,
      [],
    );
    const fiftyOne = rankTitlesV2(
      [...window, window101, beyond],
      preference(),
      noInteractions,
      [],
    );

    expect(exactlyFifty).toHaveLength(MMR_WINDOW);
    expect(exactlyFifty[1].id).toBe('b01');

    expect(fiftyOne).toHaveLength(MMR_WINDOW + 1);
    expect(fiftyOne[1].id).toBe('b01');
    expect(fiftyOne[MMR_WINDOW].id).toBe('zzz-beyond');
  });

  it('re-ranks a pool smaller than the window without error', () => {
    const catalog = [
      title('aaa-horror', { genres: ['horror'] }),
      title('bbb-horror', { genres: ['horror'] }),
      title('ccc-comedy', { genres: ['comedy'] }),
      title('ddd-drama', { genres: ['drama'] }),
      title('eee-animation', { genres: ['animation'] }),
    ];

    const result = rankTitlesV2(catalog, preference(), noInteractions, []);

    expect(ids(result).slice().sort()).toEqual(ids(catalog).slice().sort());
    expect(ids(result)[0]).toBe('aaa-horror');
  });

  it('pins the contract constants', () => {
    expect(MMR_WINDOW).toBe(50);
    expect(MMR_LAMBDA).toBe(0.75);
  });

  it('keeps the fixture’s coverage at 90% of the incumbent’s (SC-002)', () => {
    const candidate: Ranker = {
      name: 'candidate',
      engineVersion: 'recommend-v2',
      rank: (input) =>
        rankTitlesV2(input.catalog, input.preference, input.interactions, input.shownTitleIds),
    };

    const rankedBy = (ranker: Ranker): (readonly string[])[] =>
      personasFixture.sessions
        .flatMap((session) => replaySession(session, personasFixture.catalog, ranker))
        .map((decision) => decision.ranked);

    const incumbentCoverage = coverage(
      rankedBy(incumbentRanker),
      personasFixture.catalog,
    );
    const candidateCoverage = coverage(rankedBy(candidate), personasFixture.catalog);

    expect(candidateCoverage).toBeGreaterThanOrEqual(0.9 * incumbentCoverage);
  });
});
