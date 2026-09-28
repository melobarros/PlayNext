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
  // "HBO Max", not "Max": the service renamed and TMDB now reports it that way
  // under a single id, so the quiz was the last place still calling it Max.
  { id: 'max', displayName: 'HBO Max', regions: ['GLOBAL'] },
  { id: 'apple-tv-plus', displayName: 'Apple TV+', regions: ['GLOBAL'] },
  { id: 'paramount-plus', displayName: 'Paramount+', regions: ['GLOBAL'] },
  { id: 'crunchyroll', displayName: 'Crunchyroll', regions: ['GLOBAL'] },
  { id: 'mubi', displayName: 'MUBI', regions: ['GLOBAL'] },
  { id: 'globoplay', displayName: 'Globoplay', regions: ['BR'] },
  { id: 'hulu', displayName: 'Hulu', regions: ['US'] },
  { id: 'peacock', displayName: 'Peacock', regions: ['US'] },
];

/**
 * Services the quiz no longer offers, but that saved preferences still name.
 *
 * Star+ was discontinued in Latin America and its catalog folded into Disney+;
 * TMDB stopped listing it altogether, so the server has nothing left to emit a
 * badge for. The option is gone from the list above because offering a visitor
 * a service that does not exist is wrong however the matching is arranged.
 *
 * These stay here for the *other* half of that: 001's storage contract is
 * frozen, so preferences already on visitors' devices contain `star-plus`, and
 * an id with no entry anywhere renders as nothing at all — a visitor would see
 * their own selection quietly shrink. Naming it is what lets the summary say
 * what happened to it.
 */
export const RETIRED_PROVIDERS: StreamingProvider[] = [
  { id: 'star-plus', displayName: 'Star+ (now Disney+)', regions: [] },
];

/**
 * Where a retired service's catalog went, by the visitor's own id for it.
 *
 * Read by the deck's availability filter (`recommend.ts`), and only there: the
 * alias has to be applied where a *preference* is matched against *what the
 * server reports*, and that is the single place the two meet. It cannot live on
 * the server, because the server would then have to emit a `star-plus` badge
 * pointing at a service that is gone.
 *
 * Without it, a visitor who picked only Star+ matches no title in any genre —
 * an empty deck with no way forward, which is the dead end the constitution
 * forbids and which is a worse outcome than a slightly imprecise match.
 */
export const RETIRED_PROVIDER_SUCCESSORS: Readonly<Record<string, string>> = {
  'star-plus': 'disney-plus',
};

/**
 * The popular default list shown when the region-relevant list cannot be
 * loaded and the retry also fails, so the visitor is never stranded on a
 * broken step (FR-013).
 *
 * A second list of the same services under the same ids, which makes it a
 * second place for a name to drift: it said "Max" for a while after `max` was
 * corrected above, so the same service was called two things depending on
 * whether the visitor's network worked. `Fallback_providers_agree_with_the_offered_ones`
 * exists so the next rename cannot land in only one of them.
 */
export const FALLBACK_PROVIDERS: StreamingProvider[] = [
  { id: 'netflix', displayName: 'Netflix', regions: ['GLOBAL'] },
  { id: 'prime-video', displayName: 'Prime Video', regions: ['GLOBAL'] },
  { id: 'disney-plus', displayName: 'Disney+', regions: ['GLOBAL'] },
  { id: 'max', displayName: 'HBO Max', regions: ['GLOBAL'] },
  { id: 'apple-tv-plus', displayName: 'Apple TV+', regions: ['GLOBAL'] },
  { id: 'crunchyroll', displayName: 'Crunchyroll', regions: ['GLOBAL'] },
];
