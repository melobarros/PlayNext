import { Genre, MediaType, StreamingProvider } from './quiz';

/**
 * Static quiz options for Milestone 1 (spec assumption: options come from
 * static app configuration until the backend serves them in Milestone 2).
 *
 * Components never read this module directly — they go through
 * `QuizOptionsService`, which is the seam the API swap will happen behind.
 */

/** The default region used when the visitor's region cannot be detected. */
export const DEFAULT_REGION = 'BR';

export const MEDIA_TYPES: MediaType[] = ['movie', 'tv', 'anime'];

export const GENRES: Genre[] = [
  { id: 'action', displayName: 'Action' },
  { id: 'comedy', displayName: 'Comedy' },
  { id: 'drama', displayName: 'Drama' },
  { id: 'horror', displayName: 'Horror' },
  { id: 'romance', displayName: 'Romance' },
  { id: 'sci-fi', displayName: 'Sci-Fi' },
  { id: 'thriller', displayName: 'Thriller' },
  { id: 'animation', displayName: 'Animation' },
  { id: 'documentary', displayName: 'Documentary' },
];

/**
 * Streaming services with the regions they serve. A provider with `GLOBAL`
 * is available in every region; otherwise the visitor's region must appear in
 * the list (FR-004).
 */
export const STREAMING_PROVIDERS: StreamingProvider[] = [
  { id: 'netflix', displayName: 'Netflix', regions: ['GLOBAL'] },
  { id: 'prime-video', displayName: 'Prime Video', regions: ['GLOBAL'] },
  { id: 'disney-plus', displayName: 'Disney+', regions: ['GLOBAL'] },
  { id: 'max', displayName: 'Max', regions: ['GLOBAL'] },
  { id: 'apple-tv-plus', displayName: 'Apple TV+', regions: ['GLOBAL'] },
  { id: 'paramount-plus', displayName: 'Paramount+', regions: ['GLOBAL'] },
  { id: 'crunchyroll', displayName: 'Crunchyroll', regions: ['GLOBAL'] },
  { id: 'mubi', displayName: 'MUBI', regions: ['GLOBAL'] },
  { id: 'globoplay', displayName: 'Globoplay', regions: ['BR'] },
  { id: 'star-plus', displayName: 'Star+', regions: ['BR', 'MX', 'AR', 'CO', 'CL'] },
  { id: 'hulu', displayName: 'Hulu', regions: ['US'] },
  { id: 'peacock', displayName: 'Peacock', regions: ['US'] },
];

/**
 * The popular default list shown when the region-relevant list cannot be
 * loaded and the retry also fails, so the visitor is never stranded on a
 * broken step (FR-013).
 */
export const FALLBACK_PROVIDERS: StreamingProvider[] = [
  { id: 'netflix', displayName: 'Netflix', regions: ['GLOBAL'] },
  { id: 'prime-video', displayName: 'Prime Video', regions: ['GLOBAL'] },
  { id: 'disney-plus', displayName: 'Disney+', regions: ['GLOBAL'] },
  { id: 'max', displayName: 'Max', regions: ['GLOBAL'] },
  { id: 'apple-tv-plus', displayName: 'Apple TV+', regions: ['GLOBAL'] },
  { id: 'crunchyroll', displayName: 'Crunchyroll', regions: ['GLOBAL'] },
];
