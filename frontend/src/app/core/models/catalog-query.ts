import { MediaType, Preference } from './quiz';
import { RETIRED_PROVIDER_SUCCESSORS } from './quiz-options.data';

/**
 * The optional dimensions of a catalog request (feature 008,
 * `specs/008-catalog-normalization/contracts/catalog-api.md`).
 *
 * Every dimension is optional and independent, and the server ANDs the ones it
 * receives: services and genres are ORed within their own list, then intersected
 * with each other and with `ids`. The request never carries a ranking — the
 * deck re-ranks whatever arrives — which is why this shape has no ordering and
 * no paging.
 *
 * It lives in `core/models` rather than beside the HTTP source because the deck
 * builds one from the visitor's answers, the screens build `ids` ones from what
 * they have stored, and both must agree about the vocabulary the server accepts.
 */
export interface CatalogQuery {
  /** Service ids (`netflix`), any of which a title may be on. */
  readonly services?: readonly string[];
  /** Quiz genre ids (`horror`), any of which a title may carry. */
  readonly genres?: readonly string[];
  /** Presentation media types: `movie`, `tv`, `anime`. */
  readonly mediaTypes?: readonly MediaType[];
  /** Exact title ids to resolve, active version first, then the archive. */
  readonly ids?: readonly string[];
}

/**
 * The targeted pool the deck asks for under these answers.
 *
 * A dimension the visitor left to us is **omitted**, not sent as "everything":
 * `any` is the absence of a selection, and sending an empty or exhaustive list
 * would make the server do work to answer a question nobody asked. "Show
 * content on other platforms" removes the service dimension for the same
 * reason — it widens what the visitor will be shown, so the pool must not be
 * scoped to the services they picked.
 *
 * Retired services are translated to their successors (`star-plus` →
 * `disney-plus`) before they reach the server, exactly as the availability
 * filter in `recommend.ts` already does. The server has no `star-plus` rows —
 * the service is gone — so sending the stored id would return an empty pool for
 * a visitor whose preference predates the closure, which is the dead end the
 * successor map exists to prevent. The client-side filter still applies for
 * display; this only keeps the two sides asking the same question.
 */
export function catalogQueryFor(preference: Preference): CatalogQuery {
  const query: { services?: string[]; genres?: string[]; mediaTypes?: MediaType[] } = {};

  if (!preference.provider.any && !preference.includeUnownedProviders) {
    query.services = [...new Set(preference.provider.values.map(successorOf))];
  }

  if (!preference.genre.any) {
    query.genres = [...preference.genre.values];
  }

  if (!preference.mediaType.any) {
    query.mediaTypes = [...preference.mediaType.values];
  }

  return query;
}

/** The service the visitor's id means today, when it is one that was retired. */
function successorOf(providerId: string): string {
  return RETIRED_PROVIDER_SUCCESSORS[providerId] ?? providerId;
}
