import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { MediaTitle } from '../models/media-title';
import { MediaType } from '../models/quiz';
import { API_BASE_URL } from './auth.service';
import { CatalogSource } from './catalog.service';

/**
 * The catalog payload, as `GET /api/catalog` writes it
 * (`specs/005-tmdb-catalog/contracts/catalog.md`).
 *
 * Its own types rather than the server's C# records, which is the point of a
 * contract: the wire is a document this client reads, and nothing about the
 * shape the server happens to hold should be able to reach into the deck.
 */
interface CatalogResponse {
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
interface WireTitle {
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
 * already scoped to it, so this function's whole job is to name the region on
 * the way out and translate the answer on the way back — no title is dropped,
 * reordered, or narrowed here.
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
    load: (region: string): Observable<MediaTitle[]> =>
      http
        .get<CatalogResponse>(`${baseUrl}/api/catalog`, { params: { region } })
        .pipe(map((response) => response.titles.map(toMediaTitle))),
  };
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
