import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Genre, MediaType, StreamingProvider } from '../models/quiz';
import {
  FALLBACK_PROVIDERS,
  GENRES,
  MEDIA_TYPES,
  RETIRED_PROVIDERS,
  STREAMING_PROVIDERS,
} from '../models/quiz-options.data';

/**
 * Supplies the quiz's selectable options.
 *
 * Everything the quiz renders comes through here, so Milestone 2 can replace
 * the static data with the REST API without touching a single component
 * (constitution, Principle IV).
 */
@Injectable({ providedIn: 'root' })
export class QuizOptionsService {
  getMediaTypes(): MediaType[] {
    return [...MEDIA_TYPES];
  }

  getGenres(): Genre[] {
    return [...GENRES];
  }

  /**
   * Loads the streaming providers relevant to a region.
   *
   * Milestone 1 emits the static list synchronously; the observable shape
   * exists so the components' loading/retry/fallback flow (FR-013) is real
   * today and needs no rewrite when this becomes an HTTP call.
   */
  loadProviders(region: string): Observable<StreamingProvider[]> {
    return of(this.providersFor(region));
  }

  /** The region-relevant providers, filtered from the static catalog. */
  providersFor(region: string): StreamingProvider[] {
    const normalized = region.toUpperCase();
    return STREAMING_PROVIDERS.filter(
      (provider) =>
        provider.regions.includes('GLOBAL') || provider.regions.includes(normalized),
    );
  }

  /**
   * The popular default list shown after a failed load and a failed retry, so
   * the visitor is never stranded on a broken step (FR-013).
   */
  getFallbackProviders(): StreamingProvider[] {
    return [...FALLBACK_PROVIDERS];
  }

  /**
   * The full provider catalog, used to turn saved ids into display names even
   * when the visitor's region list is narrower than what they once picked.
   *
   * Retired services are included, and that is the whole reason this method is
   * not just `providersFor('GLOBAL')`: a saved preference may name a service
   * the quiz no longer offers, and dropping it here would render the visitor's
   * own selection as nothing. It is not offered for *selection* — that list is
   * `STREAMING_PROVIDERS` — only named.
   */
  getProvidersById(): StreamingProvider[] {
    return [...STREAMING_PROVIDERS, ...RETIRED_PROVIDERS];
  }
}
