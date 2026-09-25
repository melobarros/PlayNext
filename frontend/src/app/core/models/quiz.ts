/**
 * Domain types for the onboarding quiz (feature 001).
 *
 * These mirror the frozen persistence contract in
 * `specs/001-onboarding-quiz/contracts/preference-storage.md`. Later features
 * (002 deck, 003 watchlist, 004 migration) consume the same shapes, so changes
 * here are contract changes.
 */

/** The three content kinds offered on step 1 (FR-002). */
export type MediaType = 'movie' | 'tv' | 'anime';

/** Display labels for `MediaType`, kept next to the type they describe. */
export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  movie: 'Movie',
  tv: 'TV Show',
  anime: 'Anime',
};

/**
 * A single quiz dimension's answer.
 *
 * `any` is the explicit "Any / No preference" chip (FR-005). It is exclusive:
 * when true, `values` MUST be empty.
 */
export interface DimensionChoice<T extends string> {
  values: T[];
  any: boolean;
}

export type QuizStatus = 'in-progress' | 'completed';

/** The quiz always has exactly three steps (FR-001). */
export type QuizStep = 1 | 2 | 3;

export const QUIZ_STEP_COUNT = 3;

/** The persisted document — one per visitor, stored locally. */
export interface QuizState {
  schemaVersion: 1;
  status: QuizStatus;
  step: QuizStep;
  mediaType: DimensionChoice<MediaType>;
  genre: DimensionChoice<string>;
  provider: DimensionChoice<string>;
  /** "Show content on other platforms" — off by default (FR-006). */
  includeUnownedProviders: boolean;
  /** ISO 8601; set when `status` becomes `completed`. */
  completedAt?: string;
  /** ISO 8601; refreshed on every write (used for newest-wins in 004). */
  updatedAt: string;
}

/**
 * The quiz's output, as consumed by the recommendation deck (002).
 * A read view over a completed `QuizState` — never stored separately.
 */
export interface Preference {
  mediaType: DimensionChoice<MediaType>;
  genre: DimensionChoice<string>;
  provider: DimensionChoice<string>;
  includeUnownedProviders: boolean;
  completedAt: string;
}

/** A selectable genre (step 2). */
export interface Genre {
  id: string;
  displayName: string;
}

/** A selectable streaming service (step 3). */
export interface StreamingProvider {
  id: string;
  displayName: string;
  /** ISO 3166-1 alpha-2 region codes where this provider is relevant. */
  regions: string[];
}

/** The static option lists shown by the quiz. */
export interface QuizOptions {
  mediaTypes: MediaType[];
  genres: Genre[];
  providers: StreamingProvider[];
  /** Shown when the region-relevant list cannot be loaded (FR-013). */
  fallbackProviders: StreamingProvider[];
}
