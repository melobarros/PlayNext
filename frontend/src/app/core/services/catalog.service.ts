import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { catchError, Observable, of, tap } from 'rxjs';
import { MediaTitle } from '../models/media-title';
import { httpCatalogSource } from './http-catalog-source';

/**
 * Where titles come from.
 *
 * Exists as a seam so the FR-013 fallback can be *tested*. It was introduced
 * when the source answered from a bundled array and could not fail on its own
 * — spec 001's equivalent fallback went untested for exactly that reason and
 * turned out to be unreachable in the UI — and it has since earned its keep
 * again, by letting the real catalog arrive (constitution IV) without a single
 * component changing.
 */
export interface CatalogSource {
  load(region: string): Observable<MediaTitle[]>;
}

/**
 * The live catalog source: our own API.
 *
 * Registered with `providedIn: 'root'` so the app needs no configuration to
 * work. The factory runs in an injection context, which is why the source can
 * reach for `HttpClient` itself rather than being handed one from here.
 */
export const CATALOG_SOURCE = new InjectionToken<CatalogSource>('playnext.catalog-source', {
  providedIn: 'root',
  factory: httpCatalogSource,
});

/**
 * Supplies the titles the deck ranks.
 *
 * The catalog is real as of 005, and it comes from our own API — no component
 * calls a third-party media API, the credential stays on the server, and the
 * provider's responses are cached there (constitution IV, FR-001).
 *
 * What this service still owns, and the reason it did not simply disappear
 * when the source became HTTP, is the **fallback**. A load that fails completes
 * with the last good catalog instead of erroring, because the deck's only
 * reaction to an error would be an empty screen with no explanation — the dead
 * end constitution II forbids.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly source = inject(CATALOG_SOURCE);

  /**
   * The last catalog the provider handed over, kept for the fallback.
   *
   * A private copy, not the array the caller received: `loadTitles` promises a
   * detached array, and a caller that sorts or empties it must not thereby
   * rewrite what the fallback will serve.
   */
  private cached: MediaTitle[] | null = null;

  private readonly fellBack = signal(false);

  /**
   * Whether the titles on screen came from the cache because the provider could
   * not be reached (FR-013) — the deck's cue to show the offline-cached notice
   * rather than present stale results as live ones.
   *
   * True whenever a load fell back, including when nothing had been cached yet
   * and the fallback is therefore empty. The honest claim is about the
   * provider, not about the cache: "we could not reach it" stays true either
   * way, whereas staying silent would let the deck blame the visitor's filters
   * for a failure that was never theirs.
   */
  readonly usingCachedTitles = this.fellBack.asReadonly();

  /**
   * Loads the titles available to a region.
   *
   * The observable shape exists so the deck's loading and fallback flow is
   * real today rather than retrofitted later, mirroring
   * `QuizOptionsService.loadProviders`.
   *
   * **The fallback is not an error path for callers.** A failed load completes
   * with the cached titles instead of erroring, because the deck's only
   * reaction to an error would be an empty screen with no explanation — the
   * dead end constitution II forbids. `usingCachedTitles` carries the news
   * instead, so the deck can say what happened while still showing cards.
   *
   * The source is always asked, even when there is something cached. A cache
   * that short-circuits the request is not a fallback, it is a cache with no
   * expiry — it would never refresh, and the visitor would keep seeing the
   * catalog from their first visit forever.
   */
  loadTitles(region: string): Observable<MediaTitle[]> {
    return this.source.load(region).pipe(
      tap((titles) => {
        this.cached = copyOf(titles);
        this.fellBack.set(false);
      }),
      catchError(() => {
        this.fellBack.set(true);
        return of(copyOf(this.cached ?? []));
      }),
    );
  }
}

/**
 * A detached copy of the catalog.
 *
 * Detachment is a guarantee rather than a nicety: `loadTitles` hands the caller
 * an array it may freely sort, filter, or empty, and the same titles are kept
 * for the fallback. Sharing objects would let a caller's reordering quietly
 * become the cache's contents.
 *
 * One copier, used on both paths, so a nested field added to `MediaTitle` later
 * cannot be copied on one path and forgotten on the other.
 */
function copyOf(titles: readonly MediaTitle[]): MediaTitle[] {
  return titles.map((title) => ({
    ...title,
    genres: [...title.genres],
    availability: title.availability.map((entry) => ({ ...entry })),
  }));
}
