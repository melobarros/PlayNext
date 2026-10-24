import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { catchError, Observable, of, tap } from 'rxjs';
import { CatalogQuery } from '../models/catalog-query';
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
 * component changing. Feature 008 extends the same seam with the optional
 * catalog dimensions rather than adding a second one.
 */
export interface CatalogSource {
  /**
   * One catalog request. The region is required; a query with no dimensions is
   * the general pool, which is the shape every pre-008 caller asks for.
   */
  load(region: string, query?: CatalogQuery): Observable<MediaTitle[]>;
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
   * The last good answer **per distinct request**, kept for the fallback.
   *
   * Keyed rather than a single slot because a view now asks more than one
   * question: the deck asks for a targeted pool and, separately, for the
   * visitor's rated ids. One slot would let each answer overwrite the other's
   * fallback, and a failed pool request would then serve rated titles as if
   * they were the pool.
   *
   * A private copy, not the array the caller received: `loadTitles` promises a
   * detached array, and a caller that sorts or empties it must not thereby
   * rewrite what the fallback will serve.
   */
  private readonly cached = new Map<string, MediaTitle[]>();

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
   * Loads the titles available to a region, optionally narrowed to a targeted
   * pool (`CatalogQuery`). No query is the general pool, which is what every
   * pre-008 caller asked for and still asks for.
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
   */
  loadTitles(region: string, query: CatalogQuery = {}): Observable<MediaTitle[]> {
    return this.load(region, query, true);
  }

  /**
   * The titles behind a list of ids — the watchlist, the history, the detail
   * view and Match Found each ask for exactly the ids they hold (feature 008,
   * contracts/catalog-api.md "Screen usage").
   *
   * An id the catalog no longer knows is simply absent from the answer; the
   * screens already render a row without a title rather than hiding it, so this
   * method does not manufacture a placeholder.
   *
   * **It never raises the cached-titles notice.** `usingCachedTitles` describes
   * the deck's *pool*, which is the one thing a visitor sees as a whole and
   * therefore the one thing that must not be passed off as live. An ids lookup
   * is supplementary — a failure leaves rows unresolved, which the screens say
   * themselves — and letting it flip the deck's notice would blame the pool for
   * a request the pool never made. The same cache still serves its own fallback,
   * so a repeated lookup of the same ids degrades the way a repeated pool load
   * does.
   */
  loadTitlesById(region: string, ids: readonly string[]): Observable<MediaTitle[]> {
    // Nothing asked, nothing fetched: an empty list is a complete answer, and a
    // request for it would be a round trip that could not change what is shown.
    if (ids.length === 0) return of([]);

    return this.load(region, { ids }, false);
  }

  /**
   * One request, cached under its own key and falling back to that key's last
   * good answer.
   *
   * `reportsFallback` is the difference between the two public methods above:
   * only a pool load is allowed to move `usingCachedTitles`.
   *
   * The source is always asked, even when there is something cached. A cache
   * that short-circuits the request is not a fallback, it is a cache with no
   * expiry — it would never refresh, and the visitor would keep seeing the
   * catalog from their first visit forever.
   */
  private load(
    region: string,
    query: CatalogQuery,
    reportsFallback: boolean,
  ): Observable<MediaTitle[]> {
    const key = queryKey(region, query);

    return this.source.load(region, query).pipe(
      tap((titles) => {
        this.cached.set(key, copyOf(titles));
        if (reportsFallback) this.fellBack.set(false);
      }),
      catchError(() => {
        if (reportsFallback) this.fellBack.set(true);
        return of(copyOf(this.cached.get(key) ?? []));
      }),
    );
  }
}

/**
 * A stable identity for one request, used to key the fallback cache.
 *
 * Dimensions are normalized the way the server reads them — duplicates removed,
 * order irrelevant — so the same question asked twice with its values in a
 * different order is one cache entry rather than two. Within a dimension the
 * contract is OR and across dimensions AND, and neither is sensitive to order.
 *
 * The region is part of the key because it scopes every answer: a pool cached
 * for BR is not an answer for US.
 */
function queryKey(region: string, query: CatalogQuery): string {
  const list = (values: readonly string[] | undefined): string =>
    values === undefined || values.length === 0
      ? ''
      : [...new Set(values)].sort().join(',');

  return [
    region,
    list(query.services),
    list(query.genres),
    list(query.mediaTypes),
    list(query.ids),
  ].join('|');
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
