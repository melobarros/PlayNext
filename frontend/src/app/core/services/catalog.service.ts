import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { catchError, Observable, of, tap } from 'rxjs';
import { MEDIA_CATALOG } from '../models/media-catalog.data';
import { MediaTitle } from '../models/media-title';
import { STREAMING_PROVIDERS } from '../models/quiz-options.data';

/**
 * Where titles come from.
 *
 * Exists as a seam so the FR-013 fallback can be *tested*. Milestone 1's source
 * cannot fail on its own — it answers from a bundled array, so there is no
 * network to drop — and spec 001's equivalent fallback went untested for
 * exactly that reason and turned out to be unreachable in the UI. A test can
 * substitute a source that fails on demand; nothing else does.
 *
 * It is also where Milestone 2's HTTP call lands: `load` becomes the REST
 * request, and no component changes (plan.md, constitution IV).
 */
export interface CatalogSource {
  load(region: string): Observable<MediaTitle[]>;
}

/**
 * The live catalog source.
 *
 * Registered with `providedIn: 'root'` so the app needs no configuration to
 * work — an unused injection token is a trap, and this one has a real default.
 */
export const CATALOG_SOURCE = new InjectionToken<CatalogSource>('playnext.catalog-source', {
  providedIn: 'root',
  factory: localCatalogSource,
});

/**
 * The Milestone 1 source: the bundled catalog, sliced by region.
 *
 * Exported so a test double can fail *around* it rather than reimplement it.
 * A double that answered from `MEDIA_CATALOG` itself would quietly stop
 * covering the region logic the moment this function changed — and the region
 * rules are spec 001's, not this file's to restate.
 */
export function localCatalogSource(): CatalogSource {
  return { load: (region) => of(titlesFor(region)) };
}

/**
 * Supplies the titles the deck ranks.
 *
 * This is **the** Milestone 2 seam (plan.md, constitution IV): it returns an
 * `Observable` even though Milestone 1 data is local and emits synchronously,
 * so the swap to a REST call happens here and touches no component. Nothing
 * outside this service imports the catalog data module.
 *
 * Components never call a third-party media API. When this becomes an HTTP
 * call, the API key stays on the server (constitution IV) and the responses
 * are cached server-side.
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

/**
 * The region-scoped catalog.
 *
 * Region is scoped through **availability**, not through the title: a title
 * carries no region field of its own (data-model.md), and one that cannot be
 * watched locally is still a title the visitor may want to know about. So
 * narrowing here removes providers, never titles — dropping a title for
 * region reasons would hide it from the deck entirely, whereas an empty
 * availability list leaves the card readable and lets filter 3 make the
 * eligibility call.
 *
 * This reuses spec 001's provider regions so the badges on a card can only
 * ever name services the quiz already offered that visitor (FR-004). A
 * badge for a service they were never shown would be a dead link at best.
 *
 * Returns fresh objects on every call, so a caller that sorts the deck or
 * edits a title in place cannot disturb the shared catalog.
 */
function titlesFor(region: string): MediaTitle[] {
  const normalized = region.toUpperCase();

  return copyOf(
    MEDIA_CATALOG.map((title) => ({
      ...title,
      availability: title.availability.filter((entry) =>
        servesRegion(entry.providerId, normalized),
      ),
    })),
  );
}

/**
 * Whether a provider serves a region.
 *
 * An unknown provider id is **kept**, not dropped. The catalog already
 * filters out ids it cannot build a link for, so reaching that branch means
 * a provider was added to `STREAMING_PROVIDERS` without updating this
 * service — and erasing the entry would hide the mistake rather than show it.
 */
function servesRegion(providerId: string, region: string): boolean {
  const provider = STREAMING_PROVIDERS.find((candidate) => candidate.id === providerId);

  return (
    provider === undefined ||
    provider.regions.includes('GLOBAL') ||
    provider.regions.includes(region)
  );
}
