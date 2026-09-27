import { MediaType } from './quiz';

/**
 * A watchable title, as the deck sees it (002).
 *
 * Read-only in this slice: titles come from the catalog, never from the
 * visitor. Field rules mirror `specs/002-recommendation-deck/data-model.md`.
 *
 * Genre ids and provider ids are reused verbatim from spec 001's catalog
 * (`GENRES`, `STREAMING_PROVIDERS`) so a preference and a title are directly
 * comparable — there is no mapping table anywhere in the codebase.
 */
export interface MediaTitle {
  /** Stable, unique, non-empty. The key every other entity references. */
  id: string;
  /** Non-empty display name. */
  title: string;
  /** 4-digit release year. `0` is not valid. */
  releaseYear: number;
  mediaType: MediaType;
  /** Genre ids from spec 001's `GENRES`. May be empty. */
  genres: string[];
  /** May be empty; the card degrades to title + metadata. */
  synopsis: string;
  /** 0–10, one decimal. Display value — never the sole ranking input. */
  rating: number;
  /** ≥ 0. Confidence weight, so a lone 10.0 cannot outrank a well-established 8.5. */
  voteCount: number;
  runtimeMinutes?: number;
  /**
   * Optional. **Absent is a normal state, not an error** — Match Found must
   * work with or without a trailer (FR-008, US2 scenario 4).
   */
  trailerUrl?: string;
  /** Optional. Absent or failing to load → the generated placeholder (FR-016). */
  posterUrl?: string;
  /**
   * Where the title can be watched. May be empty — the card degrades, it does
   * not hide.
   */
  availability: StreamingAvailability[];
}

/**
 * One place a title can be watched.
 *
 * Region is deliberately **not** a field: `CatalogService.loadTitles(region)`
 * returns titles already scoped to the visitor's region, so no component ever
 * filters by it.
 */
export interface StreamingAvailability {
  /** A spec 001 provider id. Unknown ids are ignored by filters, not fatal. */
  providerId: string;
  /** Absolute URL to the **official** service. PlayNext hosts nothing. */
  deepLinkUrl: string;
}
