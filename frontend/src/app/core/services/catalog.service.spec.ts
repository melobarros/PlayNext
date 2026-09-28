import { TestBed } from '@angular/core/testing';
import { lastValueFrom, Observable, of, throwError } from 'rxjs';
import { FIXTURE_CATALOG } from '../models/media-catalog.fixture';
import { MediaTitle } from '../models/media-title';
import { GENRES, STREAMING_PROVIDERS } from '../models/quiz-options.data';
import { CATALOG_SOURCE, CatalogService, CatalogSource } from './catalog.service';

/**
 * A catalog source the test can break on demand.
 *
 * This exists because a real source cannot be made to fail from here: the live
 * one is an HTTP call to our own API, and a spec that wanted a 503 out of it
 * would have to stand up a server to get one. So the failure is produced
 * instead of assumed — the cached-copy fallback (FR-013) is the one path in
 * `CatalogService` that nothing else can reach.
 *
 * It answers from the fixture rather than from a hand-rolled pair of titles, so
 * the catalog flowing through the fallback is the one the ranking specs rank.
 * A double with a catalog of its own would let the service pass these tests
 * while doing something the real catalog breaks.
 */
class ControllableSource implements CatalogSource {
  /** Every region the service asked for, in order — the client's entire region job. */
  readonly regions: string[] = [];

  /** Flip to make the next load fail, the way an unreachable provider would. */
  failing = false;

  /** How many times the source was asked, for the "tried, then fell back" case. */
  calls = 0;

  load(region: string): Observable<MediaTitle[]> {
    this.calls++;
    this.regions.push(region);

    return this.failing
      ? throwError(() => new Error('provider unreachable'))
      : of(FIXTURE_CATALOG.slice());
  }
}

/**
 * `CatalogService` is what remains of the Milestone 1 seam, and these tests are
 * about the *shape* of the contract as much as its contents: the source is an
 * Observable so the deck's loading and fallback flow is real rather than
 * retrofitted — which is what let the bundled array be replaced by an HTTP call
 * to our own API (005) without a single component changing.
 *
 * What it deliberately no longer covers is regional behaviour. Narrowing a
 * catalog to a region, and refusing a region that is not one, moved to the
 * server along with the catalog (contracts/catalog.md) and is settled there by
 * the region integration tests. All the client owes on that front is the region
 * code it derived, handed over unmodified — asserted below.
 *
 * The last block is a data-integrity guard on the fixture. Nothing else checks
 * that its genre and provider ids are still spec 001's, and if they ever drift
 * the filters in `rankTitles` stop matching — silently, with no error anywhere.
 * That failure mode is worth a handful of assertions.
 */
describe('CatalogService', () => {
  let service: CatalogService;
  let source: ControllableSource;

  beforeEach(() => {
    source = new ControllableSource();
    TestBed.configureTestingModule({
      providers: [{ provide: CATALOG_SOURCE, useValue: source }],
    });
    service = TestBed.inject(CatalogService);
  });

  describe('loadTitles', () => {
    it('returns an Observable, not an array (the seam the swap went through)', () => {
      expect(service.loadTitles('BR')).toBeInstanceOf(Observable);
    });

    it('emits the catalog and completes (FR-001)', async () => {
      const titles = await lastValueFrom(service.loadTitles('BR'));

      expect(titles.length).toBe(FIXTURE_CATALOG.length);
    });

    it('emits the same list for the same region every time (FR-011 input)', async () => {
      const first = await lastValueFrom(service.loadTitles('BR'));
      const second = await lastValueFrom(service.loadTitles('BR'));

      expect(second.map((title) => title.id)).toEqual(first.map((title) => title.id));
    });

    it('names the region on the way out and does not touch it (FR-005)', async () => {
      // Which titles a region gets — and which regions are refused — is the
      // server's call now, so the client's whole job is to say the code it
      // derived. Uppercasing or defaulting it here would quietly put a second
      // owner on a rule the contract gives one, and a client that started
      // sending "br" would stop failing loudly.
      await lastValueFrom(service.loadTitles('BR'));
      await lastValueFrom(service.loadTitles('US'));

      expect(source.regions).toEqual(['BR', 'US']);
    });

    it('hands out a copy, so a caller cannot reorder the catalog', async () => {
      const borrowed = await lastValueFrom(service.loadTitles('BR'));
      borrowed.length = 0;

      const reread = await lastValueFrom(service.loadTitles('BR'));
      expect(reread.length).toBe(FIXTURE_CATALOG.length);
    });
  });

  describe('when the provider cannot be reached (FR-013, US4 scenario 1)', () => {
    /** Loads once successfully — the visitor has been here before. */
    async function warmTheCache(): Promise<void> {
      source.failing = false;
      await lastValueFrom(service.loadTitles('BR'));
    }

    it('serves the titles it already had, rather than nothing', async () => {
      await warmTheCache();
      const before = (await lastValueFrom(service.loadTitles('BR'))).map((title) => title.id);

      source.failing = true;
      const during = await lastValueFrom(service.loadTitles('BR'));

      expect(during.map((title) => title.id)).toEqual(before);
    });

    it('says so, so the deck can show a notice rather than lie (SC-006)', async () => {
      await warmTheCache();
      expect(service.usingCachedTitles()).toBe(false);

      source.failing = true;
      await lastValueFrom(service.loadTitles('BR'));

      expect(service.usingCachedTitles()).toBe(true);
    });

    it('stops saying so once the provider answers again', async () => {
      await warmTheCache();
      source.failing = true;
      await lastValueFrom(service.loadTitles('BR'));

      source.failing = false;
      await lastValueFrom(service.loadTitles('BR'));

      expect(service.usingCachedTitles()).toBe(false);
    });

    it('completes instead of erroring, so the deck still has something to show', async () => {
      // The fallback is not an error path for callers. If this rethrew, the
      // deck's `subscribe` would never fire and the visitor would sit on an
      // empty screen with no card and no explanation.
      source.failing = true;

      await expect(lastValueFrom(service.loadTitles('BR'))).resolves.toBeDefined();
    });

    it('falls back only after actually trying', async () => {
      await warmTheCache();
      const before = source.calls;

      source.failing = true;
      await lastValueFrom(service.loadTitles('BR'));

      // A cached answer that was never preceded by an attempt is not a
      // fallback, it is a cache with no expiry — and it would never refresh.
      expect(source.calls).toBe(before + 1);
    });

    it('hands out a copy on the fallback path too', async () => {
      await warmTheCache();
      source.failing = true;

      const borrowed = await lastValueFrom(service.loadTitles('BR'));
      borrowed.length = 0;

      const reread = await lastValueFrom(service.loadTitles('BR'));
      expect(reread.length).toBe(FIXTURE_CATALOG.length);
    });
  });

  describe('the fixture the specs rank against', () => {
    it('gives every title a unique, non-empty id', () => {
      const ids = FIXTURE_CATALOG.map((title) => title.id);

      expect(ids.every((id) => id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('uses only spec 001 genre ids, so filter 2 can match', () => {
      const known = new Set(GENRES.map((genre) => genre.id));
      const used = [...new Set(FIXTURE_CATALOG.flatMap((title) => title.genres))];

      expect(used.filter((id) => !known.has(id))).toEqual([]);
    });

    it('uses only spec 001 provider ids, so filter 3 and the badges can match', () => {
      const known = new Set(STREAMING_PROVIDERS.map((provider) => provider.id));
      const used = [
        ...new Set(FIXTURE_CATALOG.flatMap((t) => t.availability.map((a) => a.providerId))),
      ];

      expect(used.filter((id) => !known.has(id))).toEqual([]);
    });

    it('gives every availability entry an absolute link to the official service', () => {
      const entries = FIXTURE_CATALOG.flatMap((title) => title.availability);

      expect(entries.every((entry) => entry.deepLinkUrl.startsWith('https://'))).toBe(true);
    });

    it('keeps the shapes the later stories exercise (T006 authoring constraints)', () => {
      const noTrailer = FIXTURE_CATALOG.filter((title) => title.trailerUrl === undefined);
      const noProviders = FIXTURE_CATALOG.filter((title) => title.availability.length === 0);

      // US2 scenario 4 and filter 3 respectively. Without these in the fixture
      // those paths would lose the only catalog-shaped title that reaches them.
      expect(noTrailer.length).toBeGreaterThanOrEqual(3);
      expect(noProviders.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps the D7 shrinkage anchors that T014 asserts against', () => {
      const loud = FIXTURE_CATALOG.filter((title) => title.rating === 10);
      const established = FIXTURE_CATALOG.filter((title) => title.rating === 8.4);

      // A lone 10.0 from a handful of votes, and a well-established 8.4. The
      // weighting is (rating x votes + 6.5 x 500) / (votes + 500), so these
      // land at 6.53 and 8.40 — the assertion has real headroom rather than
      // resting on a rounding error.
      expect(loud.some((title) => title.voteCount < 10)).toBe(true);
      expect(established.some((title) => title.voteCount > 10_000)).toBe(true);
    });
  });
});
