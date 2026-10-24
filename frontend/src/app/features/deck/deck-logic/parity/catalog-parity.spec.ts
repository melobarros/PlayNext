import { GENRES, MEDIA_TYPES, STREAMING_PROVIDERS } from '../../../../core/models/quiz-options.data';
import { MediaTitle } from '../../../../core/models/media-title';
import { MediaType, Preference } from '../../../../core/models/quiz';
import {
  CatalogResponse,
  catalogTitlesFromWire,
} from '../../../../core/services/http-catalog-source';
import { rankTitles } from '../recommend';

/**
 * The migration parity harness (feature 008, FR-008 and SC-001).
 *
 * Moving the catalog from one JSON snapshot per region to normalized rows is
 * only acceptable if the deck cannot tell the difference. The integration suite
 * proves the two responses are field-identical for one migrated version; this
 * harness proves the stronger claim — that the **client's ranked output** is
 * identical for the quiz matrix, not merely that the input looks the same.
 *
 * The two fixtures are captured by the quickstart, scenario 1:
 *
 *   frontend/src/app/features/deck/deck-logic/parity/fixtures/snapshot.json
 *   frontend/src/app/features/deck/deck-logic/parity/fixtures/normalized.json
 *
 * They are gitignored: they are a capture of one deployed region at one
 * moment, not source. When they are absent this suite skips with the message
 * below rather than failing — an empty fixtures directory is a checkout that
 * has not run the capture, not a broken build.
 *
 * The matrix is generated, never hand-written: 3 media types × 9 genres ×
 * 11 services, plus one all-any answer. It spans the same combinations the quiz
 * can produce, so a reviewer can reproduce SC-001's "100+ combinations" by
 * reading the three loops below.
 */

const FIXTURES = import.meta.glob<CatalogResponse>('./fixtures/*.json', {
  eager: true,
  import: 'default',
});

const SNAPSHOT = FIXTURES['./fixtures/snapshot.json'];
const NORMALIZED = FIXTURES['./fixtures/normalized.json'];

const READY = SNAPSHOT !== undefined && NORMALIZED !== undefined;

/** The deck's copy of a captured response, through the live wire mapping. */
function titlesOf(response: CatalogResponse | undefined): MediaTitle[] {
  return response === undefined ? [] : catalogTitlesFromWire(response);
}

const SNAPSHOT_TITLES = titlesOf(SNAPSHOT);
const NORMALIZED_TITLES = titlesOf(NORMALIZED);

/** A fixed timestamp: the ranker must not depend on when the capture ran. */
const CAPTURED_AT = '2026-01-01T00:00:00.000Z';

/** One answer per dimension, the way the quiz produces it. */
function answers(mediaType: MediaType, genreId: string, providerId: string): Preference {
  return {
    mediaType: { values: [mediaType], any: false },
    genre: { values: [genreId], any: false },
    provider: { values: [providerId], any: false },
    includeUnownedProviders: false,
    completedAt: CAPTURED_AT,
  };
}

/** Every dimension left to us, which is its own (and the widest) combination. */
const ALL_ANY: Preference = {
  mediaType: { values: [], any: true },
  genre: { values: [], any: true },
  provider: { values: [], any: true },
  includeUnownedProviders: false,
  completedAt: CAPTURED_AT,
};

/**
 * Ranks both catalogs for one answer and asserts the same ids in the same
 * order.
 *
 * The interaction document is empty on purpose: parity is about the catalog,
 * and injecting ratings would make the matrix depend on a second input that
 * the migration does not change. The same reasoning applies to the walk
 * (`shownTitleIds`): both sides start at the beginning of the loop.
 */
function expectSameRanking(preference: Preference): void {
  const fromSnapshot = rankTitles(SNAPSHOT_TITLES, preference, {}, []);
  const fromNormalized = rankTitles(NORMALIZED_TITLES, preference, {}, []);

  expect(fromNormalized.map((title) => title.id)).toEqual(
    fromSnapshot.map((title) => title.id),
  );
}

if (!READY) {
  it.skip(
    'catalog parity skipped: capture snapshot.json and normalized.json into ' +
      'deck-logic/parity/fixtures/ (specs/008-catalog-normalization/quickstart.md, scenario 1)',
    () => {},
  );
}

describe.skipIf(!READY)('catalog parity (FR-008, SC-001)', () => {
  for (const mediaType of MEDIA_TYPES) {
    describe(mediaType, () => {
      for (const genre of GENRES) {
        for (const provider of STREAMING_PROVIDERS) {
          it(`${genre.id} + ${provider.id}`, () => {
            expectSameRanking(answers(mediaType, genre.id, provider.id));
          });
        }
      }
    });
  }

  it('every dimension left to us', () => {
    expectSameRanking(ALL_ANY);
  });
});
