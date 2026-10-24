import { HttpClient, HttpParams } from '@angular/common/http';
import { inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { CatalogQuery } from '../models/catalog-query';
import { MediaTitle } from '../models/media-title';
import { MediaType } from '../models/quiz';
import { API_BASE_URL } from './auth.service';
import { CatalogPage, CatalogSource } from './catalog.service';

/**
 * The catalog payload, as `GET /api/catalog` writes it
 * (`specs/008-catalog-normalization/contracts/catalog-api.md`; the shape is
 * unchanged from 005's contract).
 *
 * Its own types rather than the server's C# records, which is the point of a
 * contract: the wire is a document this client reads, and nothing about the
 * shape the server happens to hold should be able to reach into the deck.
 */
export interface CatalogResponse {
  region: string;
  fetchedAt: string;
  titles: WireTitle[];
}

/**
 * A title on the wire.
 *
 * The three optional fields are `| null` here and `?:` on `MediaTitle`. That
 * difference is the whole reason this interface exists rather than a cast:
 * JSON has no `undefined`, so an absent poster arrives as `null`, and the two
 * are not interchangeable in a codebase where "absent" drives the placeholder.
 */
export interface WireTitle {
  id: string;
  title: string;
  releaseYear: number;
  mediaType: MediaType;
  genres: string[];
  synopsis: string;
  rating: number;
  voteCount: number;
  runtimeMinutes: number | null;
  trailerUrl: string | null;
  posterUrl: string | null;
  availability: { providerId: string; deepLinkUrl: string }[];
}

/**
 * The live catalog source: our own API, which is the only thing that talks to
 * the provider (constitution IV, FR-001).
 *
 * A region is a **parameter** rather than a filter. The server returns titles
 * already scoped to it, so this function's whole job is to name the region and
 * the optional dimensions on the way out and translate the answer on the way
 * back — no title is dropped, reordered, or narrowed here.
 *
 * Each dimension travels as one comma-separated value, exactly as the contract
 * spells it. An empty dimension is omitted rather than sent empty: the server
 * would ignore it anyway, and a URL that says what it means is easier to read
 * in a log.
 *
 * Errors are deliberately not caught. `CatalogService` is where the
 * cached-copy fallback lives, and it can only do its job if a failure arrives
 * as a failure; an empty array returned from here would be indistinguishable
 * from a region that genuinely has nothing.
 */
export function httpCatalogSource(): CatalogSource {
  const http = inject(HttpClient);
  const baseUrl = inject(API_BASE_URL);

  return {
    load: (region: string, query: CatalogQuery = {}): Observable<CatalogPage> =>
      http
        .get<CatalogResponse>(`${baseUrl}/api/catalog`, { params: toParams(region, query) })
        .pipe(map(catalogPageFromWire)),
  };
}

/**
 * One catalog response as the deck's page — the titles and the snapshot they
 * came from (009).
 *
 * The version travels with the titles because it describes them: a replay that
 * compared this deck against some other snapshot's catalog would be measuring
 * the catalog's churn rather than the ranker.
 */
export function catalogPageFromWire(response: CatalogResponse): CatalogPage {
  return { titles: catalogTitlesFromWire(response), version: response.fetchedAt };
}

/**
 * The titles of a catalog response, translated for the deck.
 *
 * Exported because the parity harness (`deck-logic/parity/catalog-parity.spec.ts`)
 * has to rank **exactly** what the app ranks: two captured responses, one
 * mapping. A harness with its own copy of this translation could pass while the
 * real one drifted, which is the failure parity exists to catch.
 */
export function catalogTitlesFromWire(response: CatalogResponse): MediaTitle[] {
  return response.titles.map(toMediaTitle);
}

/**
 * The request's query string, from the region and whatever dimensions were
 * asked for.
 *
 * `HttpParams` percent-encodes the commas; the server decodes them before it
 * splits, so `netflix,max` on this side is the two-value list the contract
 * describes on the other.
 */
function toParams(region: string, query: CatalogQuery): HttpParams {
  let params = new HttpParams().set('region', region);

  const add = (name: string, values: readonly string[] | undefined): void => {
    if (values === undefined || values.length === 0) return;
    params = params.set(name, values.join(','));
  };

  add('services', query.services);
  add('genres', query.genres);
  add('mediaTypes', query.mediaTypes);
  add('ids', query.ids);

  return params;
}

/**
 * One wire title as the deck's `MediaTitle`.
 *
 * Arrays and badge objects are copied rather than passed through. The deck
 * sorts titles and reads badges, and a caller mutating either must not be able
 * to reach back into the response object — the same detachment `CatalogService`
 * guarantees for its cache, for the same reason.
 */
function toMediaTitle(title: WireTitle): MediaTitle {
  return {
    id: title.id,
    title: title.title,
    releaseYear: title.releaseYear,
    mediaType: title.mediaType,
    genres: [...title.genres],
    synopsis: title.synopsis,
    rating: title.rating,
    voteCount: title.voteCount,

    // `null` on the wire is "absent" in the model, and the model spells absent
    // `undefined`. Normalizing here means no component has to know that the
    // transport has a second way of saying nothing.
    runtimeMinutes: title.runtimeMinutes ?? undefined,
    trailerUrl: title.trailerUrl ?? undefined,
    posterUrl: title.posterUrl ?? undefined,

    availability: title.availability.map((entry) => ({ ...entry })),
  };
}
