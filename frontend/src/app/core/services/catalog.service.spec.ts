import { TestBed } from '@angular/core/testing';
import { lastValueFrom, Observable, of, throwError } from 'rxjs';
import { MEDIA_CATALOG } from '../models/media-catalog.data';
import { MediaTitle } from '../models/media-title';
import { GENRES, STREAMING_PROVIDERS } from '../models/quiz-options.data';
import { CATALOG_SOURCE, CatalogService, CatalogSource, localCatalogSource } from './catalog.service';

/**
 * A catalog source the test can break on demand.
 *
 * This exists because Milestone 1's source **cannot fail on its own**: it
 * answers from a bundled array, so there is no network to drop. Spec 001 left
 * its FR-013 fallback untested for exactly that reason and the UI turned out to
 * be unreachable — so rather than assume the failure can occur, this makes it
 * occur.
 *
 * It **delegates** to the real source for everything but the failure. A double
 * that answered from `MEDIA_CATALOG` itself would replace the region logic
 * rather than exercise it, and the tests above about narrowing availability
 * would pass while covering nothing.
 */
class ControllableSource implements CatalogSource {
  private readonly real = localCatalogSource();

  /** Flip to make the next load fail, the way an unreachable provider would. */
  failing = false;

  /** How many times the source was asked, for the "tried, then fell back" case. */
  calls = 0;

  load(region: string): Observable<MediaTitle[]> {
    this.calls++;
    return this.failing
      ? throwError(() => new Error('provider unreachable'))
      : this.real.load(region);
  }
}

/**
 * `CatalogService` is the Milestone 2 API seam (plan.md, constitution IV), so
 * these tests are about the *shape* of the contract as much as its contents:
 * the Observable exists today so that swapping local data for an HTTP call
 * touches no component.
 *
 * The second half is a data-integrity guard. Nothing else in the codebase
 * checks that the mock catalog's genre and provider ids are still spec 001's,
 * and if they ever drift the filters in `rankTitles` stop matching — silently,
 * with no error anywhere. That failure mode is worth a handful of assertions.
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
    it('returns an Observable, not an array (the Milestone 2 seam)', () => {
      expect(service.loadTitles('BR')).toBeInstanceOf(Observable);
    });

    it('emits the catalog and completes (FR-001)', async () => {
      const titles = await lastValueFrom(service.loadTitles('BR'));

      expect(titles.length).toBe(MEDIA_CATALOG.length);
    });

    it('emits the same list for the same region every time (FR-011 input)', async () => {
      const first = await lastValueFrom(service.loadTitles('BR'));
      const second = await lastValueFrom(service.loadTitles('BR'));

      expect(second.map((title) => title.id)).toEqual(first.map((title) => title.id));
    });

    it('is insensitive to region casing', async () => {
      const upper = await lastValueFrom(service.loadTitles('BR'));
      const lower = await lastValueFrom(service.loadTitles('br'));

      expect(lower.map((title) => title.id)).toEqual(upper.map((title) => title.id));
    });

    it('never strands a visitor in a region it knows nothing about', async () => {
      // Milestone 1 data is region-agnostic, so every region sees the whole
      // catalog. The rule that matters is "never a dead end" (constitution II):
      // an unrecognised region must not produce an empty deck.
      const titles = await lastValueFrom(service.loadTitles('ZZ'));

      expect(titles.length).toBe(MEDIA_CATALOG.length);
    });

    it('narrows availability to the providers that serve the region (FR-004)', async () => {
      const us = await lastValueFrom(service.loadTitles('US'));
      const br = await lastValueFrom(service.loadTitles('BR'));

      const providersIn = (titles: MediaTitle[]) =>
        new Set(titles.flatMap((title) => title.availability.map((entry) => entry.providerId)));

      // Hulu is US-only in spec 001's provider catalog. A Brazilian visitor
      // must never be shown a badge for a service the quiz never offered them.
      expect(providersIn(us).has('hulu')).toBe(true);
      expect(providersIn(br).has('hulu')).toBe(false);
      expect(providersIn(br).has('netflix')).toBe(true);
    });

    it('never drops a title for region reasons — the card degrades, it does not hide', async () => {
      const us = await lastValueFrom(service.loadTitles('US'));
      const br = await lastValueFrom(service.loadTitles('BR'));

      // Narrowing availability must not shorten the catalog. Whether a title
      // is eligible is filter 3's decision, not the catalog's (data-model.md).
      expect(br.map((title) => title.id)).toEqual(us.map((title) => title.id));
    });

    it('hands out a copy, so a caller cannot reorder the catalog', async () => {
      const borrowed = await lastValueFrom(service.loadTitles('BR'));
      borrowed.length = 0;

      const reread = await lastValueFrom(service.loadTitles('BR'));
      expect(reread.length).toBe(MEDIA_CATALOG.length);
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
      expect(reread.length).toBe(MEDIA_CATALOG.length);
    });
  });

  describe('the catalog it serves', () => {
    it('gives every title a unique, non-empty id', () => {
      const ids = MEDIA_CATALOG.map((title) => title.id);

      expect(ids.every((id) => id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('uses only spec 001 genre ids, so filter 2 can match', () => {
      const known = new Set(GENRES.map((genre) => genre.id));
      const used = [...new Set(MEDIA_CATALOG.flatMap((title) => title.genres))];

      expect(used.filter((id) => !known.has(id))).toEqual([]);
    });

    it('uses only spec 001 provider ids, so filter 3 and the badges can match', () => {
      const known = new Set(STREAMING_PROVIDERS.map((provider) => provider.id));
      const used = [
        ...new Set(MEDIA_CATALOG.flatMap((t) => t.availability.map((a) => a.providerId))),
      ];

      expect(used.filter((id) => !known.has(id))).toEqual([]);
    });

    it('gives every availability entry an absolute link to the official service', () => {
      const entries = MEDIA_CATALOG.flatMap((title) => title.availability);

      expect(entries.every((entry) => entry.deepLinkUrl.startsWith('https://'))).toBe(true);
    });

    it('keeps the shapes the later stories exercise (T006 authoring constraints)', () => {
      const noTrailer = MEDIA_CATALOG.filter((title) => title.trailerUrl === undefined);
      const noProviders = MEDIA_CATALOG.filter((title) => title.availability.length === 0);

      // US2 scenario 4 and filter 3 respectively. Without these in the real
      // catalog those paths would only ever be covered by fixtures.
      expect(noTrailer.length).toBeGreaterThanOrEqual(3);
      expect(noProviders.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps the D7 shrinkage anchors that T014 asserts against', () => {
      const loud = MEDIA_CATALOG.filter((title) => title.rating === 10);
      const established = MEDIA_CATALOG.filter((title) => title.rating === 8.4);

      // A lone 10.0 from a handful of votes, and a well-established 8.4. The
      // weighting is (rating x votes + 6.5 x 500) / (votes + 500), so these
      // land at 6.53 and 8.40 — the assertion has real headroom rather than
      // resting on a rounding error.
      expect(loud.some((title) => title.voteCount < 10)).toBe(true);
      expect(established.some((title) => title.voteCount > 10_000)).toBe(true);
    });
  });
});
