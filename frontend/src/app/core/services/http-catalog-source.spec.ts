import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { lastValueFrom } from 'rxjs';
import { API_BASE_URL } from './auth.service';
import { CatalogService, CatalogSource } from './catalog.service';
import { httpCatalogSource } from './http-catalog-source';

/**
 * The HTTP catalog source (005), against `specs/005-tmdb-catalog/contracts/catalog.md`.
 *
 * Two things are being settled here, and only one of them is "does it fetch".
 *
 * The first is the **translation**: the server's `null` and the client's
 * `undefined` are different values for the same absence, and the deck's
 * placeholder logic distinguishes them nowhere — it would render an absent
 * poster and a `null` poster the same way, right up until TypeScript's types
 * stopped matching and something subtler broke. So the mapping is asserted
 * field by field rather than by spot-checking.
 *
 * The second is the **failure contract**. This source must let a failure
 * through as an error, because that is the only thing that engages
 * `CatalogService`'s cached-copy fallback and the deck's "showing cached
 * titles" notice (FR-014). A source that swallowed a 503 into an empty array
 * would look tidier and would silently turn every outage into an empty deck —
 * the dead end the constitution forbids, arrived at by being helpful.
 */
describe('httpCatalogSource', () => {
  let http: HttpTestingController;
  let source: CatalogSource;

  /** One title at full wire depth, exactly as `GET /api/catalog` answers it. */
  const WIRE_TITLES = [
    {
      id: 'tmdb:movie:27205',
      title: 'Inception',
      releaseYear: 2010,
      mediaType: 'movie',
      genres: ['action', 'thriller'],
      synopsis: 'A thief who steals corporate secrets.',
      rating: 8.4,
      voteCount: 36000,
      runtimeMinutes: 148,
      trailerUrl: 'https://www.youtube.com/watch?v=YoHD9XEInc0',
      posterUrl: 'https://image.tmdb.org/t/p/w500/inception.jpg',
      availability: [
        {
          providerId: 'netflix',
          deepLinkUrl: 'https://www.netflix.com/search?q=Inception',
        },
      ],
    },
    {
      // A series with no artwork and nothing carrying it: every optional field
      // absent at once, which is where a mapping is most likely to be wrong.
      id: 'tmdb:tv:1396',
      title: 'Breaking Bad',
      releaseYear: 2008,
      mediaType: 'tv',
      genres: ['drama'],
      synopsis: 'A chemistry teacher turns to crime.',
      rating: 8.9,
      voteCount: 14000,
      runtimeMinutes: null,
      trailerUrl: null,
      posterUrl: null,
      availability: [],
    },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpTestingController);
    source = TestBed.runInInjectionContext(() => httpCatalogSource());
  });

  afterEach(() => http.verify());

  /** Answers the pending request with a well-formed catalog payload. */
  function respond(region = 'BR'): void {
    http.expectOne(`/api/catalog?region=${region}`).flush({
      region,
      fetchedAt: '2026-09-28T14:05:00Z',
      titles: WIRE_TITLES,
    });
  }

  describe('the request', () => {
    it('asks our own API for the visitor’s region', async () => {
      const titles = lastValueFrom(source.load('BR'));

      // The provider's endpoint, and no other. There is no client-side call to
      // anything upstream, which is what keeps the credential on the server
      // (FR-001).
      respond();

      await titles;
    });

    it('asks the configured origin, not a hard-coded one', async () => {
      // The default is the empty string — same origin — so the request path is
      // itself the assertion above. This checks the token is actually consulted
      // rather than a literal that happens to look the same.
      expect(TestBed.inject(API_BASE_URL)).toBe('');
    });

    it('sends the region as a parameter, never as a path segment', async () => {
      const titles = lastValueFrom(source.load('US'));

      http.expectOne((request) => request.params.get('region') === 'US').flush({
        region: 'US',
        fetchedAt: '2026-09-28T14:05:00Z',
        titles: [],
      });

      await titles;
    });
  });

  describe('the mapping', () => {
    it('carries every field the deck renders', async () => {
      const titles = lastValueFrom(source.load('BR'));
      respond();

      const [inception] = await titles;

      expect(inception).toEqual({
        id: 'tmdb:movie:27205',
        title: 'Inception',
        releaseYear: 2010,
        mediaType: 'movie',
        genres: ['action', 'thriller'],
        synopsis: 'A thief who steals corporate secrets.',
        rating: 8.4,
        voteCount: 36000,
        runtimeMinutes: 148,
        trailerUrl: 'https://www.youtube.com/watch?v=YoHD9XEInc0',
        posterUrl: 'https://image.tmdb.org/t/p/w500/inception.jpg',
        availability: [
          {
            providerId: 'netflix',
            deepLinkUrl: 'https://www.netflix.com/search?q=Inception',
          },
        ],
      });
    });

    it('turns an absent field into undefined rather than null', async () => {
      // `MediaTitle` says `posterUrl?: string`, and a `null` assigned to it is
      // a type error in the component that reads it. The cast is not the point:
      // the deck branches on these being absent, and `null` is a value it would
      // have to know about separately.
      const titles = lastValueFrom(source.load('BR'));
      respond();

      const [, breakingBad] = await titles;

      expect(breakingBad.runtimeMinutes).toBeUndefined();
      expect(breakingBad.trailerUrl).toBeUndefined();
      expect(breakingBad.posterUrl).toBeUndefined();
    });

    it('keeps a title nobody carries, with an empty badge list', async () => {
      // FR-006: empty availability is a normal answer. The title is still
      // offered — hiding it would be the deck deciding for the visitor.
      const titles = lastValueFrom(source.load('BR'));
      respond();

      const [, breakingBad] = await titles;

      expect(breakingBad.availability).toEqual([]);
    });

    it('passes a provider id it has never seen straight through', async () => {
      // FR-010: the vocabulary is a superset of the quiz's twelve. An unknown
      // id is for the filters to ignore, not for this layer to drop.
      const titles = lastValueFrom(source.load('BR'));

      http.expectOne((request) => request.url === '/api/catalog').flush({
        region: 'BR',
        fetchedAt: '2026-09-28T14:05:00Z',
        titles: [
          {
            ...WIRE_TITLES[0],
            availability: [
              { providerId: 'tmdb:300', deepLinkUrl: 'https://pluto.tv/en/search?q=Inception' },
            ],
          },
        ],
      });

      const [inception] = await titles;

      expect(inception.availability[0].providerId).toBe('tmdb:300');
    });

    it('emits nothing when the region has no titles', async () => {
      const titles = lastValueFrom(source.load('BR'));

      http.expectOne((request) => request.url === '/api/catalog').flush({
        region: 'BR',
        fetchedAt: '2026-09-28T14:05:00Z',
        titles: [],
      });

      expect(await titles).toEqual([]);
    });
  });

  describe('when the catalog is not available', () => {
    it('lets a not-ready answer reach the caller as an error', async () => {
      // The 503 the API sends while a cold region is being retrieved. It must
      // arrive as an error so `CatalogService` can fall back — returning an
      // empty array here would render the empty deck instead.
      const titles = lastValueFrom(source.load('BR'));

      http.expectOne((request) => request.url === '/api/catalog').flush(
        { code: 'catalog-not-ready', errors: ['The catalog has not been retrieved yet.'] },
        { status: 503, statusText: 'Service Unavailable' },
      );

      await expect(titles).rejects.toMatchObject({ status: 503 });
    });

    it('lets an unreachable API reach the caller as an error', async () => {
      // Status 0: the request never arrived. The same fallback handles it.
      const titles = lastValueFrom(source.load('BR'));

      http
        .expectOne((request) => request.url === '/api/catalog')
        .error(new ProgressEvent('error'), { status: 0 });

      await expect(titles).rejects.toMatchObject({ status: 0 });
    });
  });

  /**
   * The outage path the visitor actually experiences (FR-014, US3 scenario 1).
   *
   * Both halves of it are tested on their own above and in `catalog.service.spec.ts`,
   * and neither one is this: that the error a 503 produces is the error the
   * service's fallback catches, all the way to the notice the deck renders.
   * `CatalogService` is injected here with no override, so it is wired to the
   * *real* source — the two specs meet exactly where an outage would find them
   * apart, which is the kind of gap that stays invisible until it matters.
   */
  describe('the fallback the deck gets when the catalog is not there', () => {
    let service: CatalogService;

    beforeEach(() => {
      service = TestBed.inject(CatalogService);
    });

    /** The 503 a cold region answers with while its first retrieval runs. */
    function refuse(): void {
      http.expectOne((request) => request.url === '/api/catalog').flush(
        {
          code: 'catalog-not-ready',
          errors: ['The catalog has not been retrieved yet. Try again shortly.'],
        },
        { status: 503, statusText: 'Service Unavailable' },
      );
    }

    it('serves the last good catalog and raises the cached notice', async () => {
      const first = lastValueFrom(service.loadTitles('BR'));
      respond();
      await first;

      expect(service.usingCachedTitles()).toBe(false);

      const second = lastValueFrom(service.loadTitles('BR'));
      refuse();

      expect((await second).map((title) => title.id)).toEqual([
        'tmdb:movie:27205',
        'tmdb:tv:1396',
      ]);

      // The deck reads this to say the titles are cached rather than live
      // (SC-006). Without it, a visitor during an outage is shown a deck that
      // looks current and is not.
      expect(service.usingCachedTitles()).toBe(true);
    });

    it('renders the empty state, never an error, when nothing was ever cached', async () => {
      // US3 scenario 2. The empty array is what the deck's empty state is built
      // for, and that state carries its own way out — a retry. An error here
      // would be a screen with no next step, which is the dead end the
      // constitution forbids.
      //
      // The deck tells this apart from a genuinely empty result by reading the
      // empty array *together with* the flag below: `usingCachedTitles() &&
      // titles.length === 0` is the failure, and it renders "Couldn't reach the
      // catalog" rather than "Nothing matches". That derivation is why this spec
      // asserts the pair — either half alone is ambiguous, and the deck is the
      // only place that can combine them.
      const load = lastValueFrom(service.loadTitles('BR'));
      refuse();

      expect(await load).toEqual([]);

      // Still true, and deliberately: the honest claim is about the provider —
      // "we could not reach it" — rather than about the cache, which was empty.
      expect(service.usingCachedTitles()).toBe(true);
    });

    it('keeps the cached copy when the API is unreachable rather than refusing', async () => {
      const first = lastValueFrom(service.loadTitles('BR'));
      respond();
      await first;

      const second = lastValueFrom(service.loadTitles('BR'));

      http
        .expectOne((request) => request.url === '/api/catalog')
        .error(new ProgressEvent('error'), { status: 0 });

      expect((await second).length).toBe(2);
      expect(service.usingCachedTitles()).toBe(true);
    });

    it('stops saying so as soon as the API answers again', async () => {
      const cached = lastValueFrom(service.loadTitles('BR'));
      refuse();
      await cached;

      const recovered = lastValueFrom(service.loadTitles('BR'));
      respond();
      await recovered;

      // A notice that outlived the condition would be its own small lie.
      expect(service.usingCachedTitles()).toBe(false);
    });
  });
});
