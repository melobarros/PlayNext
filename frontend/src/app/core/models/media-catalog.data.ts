import { StreamingAvailability, MediaTitle } from './media-title';
import { MediaType } from './quiz';

/**
 * The Milestone 1 mock catalog (002).
 *
 * Three things about this file are deliberate and worth knowing before editing
 * it.
 *
 * **It is local, and it stays local.** No TMDB call, no CDN image, no external
 * media integration of any kind: constitution Principle IV keeps every
 * third-party media API behind the backend, and Milestone 1 has no backend.
 * `CatalogService` is the seam that Milestone 2 replaces; this file is the
 * data it will stop returning.
 *
 * **Genre and provider ids are spec 001's ids, verbatim.** A title's `genres`
 * are `GENRES` ids and its `availability[].providerId` are
 * `STREAMING_PROVIDERS` ids, so a `Preference` and a `MediaTitle` are directly
 * comparable. There is no mapping table anywhere in the codebase, and adding
 * one would be a regression (data-model.md).
 *
 * **The numbers are illustrative, not sourced.** Ratings and vote counts are
 * authored to make the ranking observable, not to report what TMDB says. In
 * particular the vote counts are deliberately spread across four orders of
 * magnitude so that the D7 confidence weighting is exercised by real catalog
 * data rather than only by test fixtures — see `midnight-static` and
 * `your-name` below.
 */

/**
 * Per-provider search URLs.
 *
 * A Milestone 1 title cannot have a real deep link: producing one needs a
 * JustWatch lookup, which is a backend concern we do not have yet. A search on
 * the official service is the honest stand-in — it is absolute, it is the
 * official destination, and it lands the visitor on the title even when a
 * provider changes its parameter name. Milestone 2 replaces these with genuine
 * per-title links from the API (T039's seam).
 *
 * Keyed by spec 001 provider id. A provider missing here is dropped from a
 * title's availability rather than producing a broken link, which is why this
 * map is the only place URL grammar lives.
 */
const PROVIDER_SEARCH_URLS: Record<string, (query: string) => string> = {
  netflix: (q) => `https://www.netflix.com/search?q=${q}`,
  'prime-video': (q) => `https://www.primevideo.com/search?phrase=${q}`,
  'disney-plus': (q) => `https://www.disneyplus.com/search?q=${q}`,
  max: (q) => `https://play.max.com/search?q=${q}`,
  'apple-tv-plus': (q) => `https://tv.apple.com/search?term=${q}`,
  'paramount-plus': (q) => `https://www.paramountplus.com/search/?q=${q}`,
  crunchyroll: (q) => `https://www.crunchyroll.com/search?q=${q}`,
  mubi: (q) => `https://mubi.com/en/search?query=${q}`,
  globoplay: (q) => `https://globoplay.globo.com/busca/?q=${q}`,
  'star-plus': (q) => `https://www.starplus.com/search?q=${q}`,
  hulu: (q) => `https://www.hulu.com/search?q=${q}`,
  peacock: (q) => `https://www.peacocktv.com/search?q=${q}`,
};

/** Where to send a visitor who wants the trailer. PlayNext hosts nothing. */
function trailerSearchUrl(title: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} trailer`)}`;
}

/** The six locally-authored placeholder posters in `public/posters/`. */
const POSTER_COUNT = 6;

function posterUrl(index: number): string {
  return `/posters/poster-${(index % POSTER_COUNT) + 1}.svg`;
}

/**
 * The authoring shape. Every field here is either copied straight onto
 * `MediaTitle` or expanded by `toMediaTitle`; nothing is derived that a
 * reviewer would want to see spelled out.
 */
interface CatalogSeed {
  id: string;
  title: string;
  releaseYear: number;
  mediaType: MediaType;
  genres: string[];
  rating: number;
  votes: number;
  synopsis: string;
  /** Episode runtime for series, total runtime for films. Optional. */
  runtime?: number;
  /** Spec 001 provider ids. Empty is legal — the card degrades, it does not hide. */
  providers: string[];
  /**
   * `0`–`5`, indexing the placeholder set. **Omit to leave `posterUrl`
   * undefined**, which is how the FR-016 placeholder path is exercised by real
   * catalog data instead of only by a test fixture.
   */
  poster?: number;
  /** Set to leave `trailerUrl` undefined (FR-008, US2 scenario 4). */
  noTrailer?: true;
}

/**
 * 48 titles: 20 films, 16 series, 12 anime.
 *
 * Kept sorted by `id` and grouped by media type so the file stays diffable —
 * the ranking sorts by score with an `id` tiebreak, so authoring order has no
 * effect on the deck and is free to optimize for readability.
 */
const CATALOG_SEEDS: readonly CatalogSeed[] = [
  // ---------------------------------------------------------------- films --
  {
    id: 'arrival',
    title: 'Arrival',
    releaseYear: 2016,
    mediaType: 'movie',
    genres: ['sci-fi', 'drama'],
    rating: 7.9,
    votes: 800_000,
    runtime: 116,
    providers: ['paramount-plus'],
    synopsis:
      'A linguist is recruited to talk to visitors whose language rewrites how she experiences time.',
    poster: 4,
  },
  {
    id: 'before-sunrise',
    title: 'Before Sunrise',
    releaseYear: 1995,
    mediaType: 'movie',
    genres: ['romance', 'drama'],
    rating: 8.1,
    votes: 340_000,
    runtime: 101,
    providers: ['max'],
    synopsis:
      'Two strangers walk Vienna until dawn and talk like it is the only thing keeping them alive.',
  },
  {
    id: 'dune-part-two',
    title: 'Dune: Part Two',
    releaseYear: 2024,
    mediaType: 'movie',
    genres: ['sci-fi', 'action'],
    rating: 8.5,
    votes: 600_000,
    runtime: 166,
    providers: ['max', 'prime-video'],
    synopsis: 'Paul Atreides becomes the thing he was warned about, and the desert approves.',
    poster: 3,
  },
  {
    id: 'everything-everywhere',
    title: 'Everything Everywhere All at Once',
    releaseYear: 2022,
    mediaType: 'movie',
    genres: ['sci-fi', 'comedy', 'action'],
    rating: 7.8,
    votes: 600_000,
    runtime: 139,
    providers: ['prime-video', 'mubi'],
    synopsis: 'A laundromat owner files her taxes across every version of her life at once.',
    poster: 1,
  },
  {
    id: 'free-solo',
    title: 'Free Solo',
    releaseYear: 2018,
    mediaType: 'movie',
    genres: ['documentary'],
    rating: 8.1,
    votes: 30_000,
    runtime: 100,
    providers: ['disney-plus'],
    synopsis: 'Alex Honnold climbs El Capitan without a rope, and the camera crew has to watch.',
    noTrailer: true,
  },
  {
    id: 'get-out',
    title: 'Get Out',
    releaseYear: 2017,
    mediaType: 'movie',
    genres: ['horror', 'thriller'],
    rating: 7.8,
    votes: 700_000,
    runtime: 104,
    providers: ['peacock', 'prime-video'],
    synopsis: 'Meeting the girlfriend’s parents goes exactly as badly as the warnings suggested.',
    poster: 4,
  },
  {
    id: 'grand-budapest',
    title: 'The Grand Budapest Hotel',
    releaseYear: 2014,
    mediaType: 'movie',
    genres: ['comedy', 'drama'],
    rating: 8.1,
    votes: 900_000,
    runtime: 99,
    providers: ['disney-plus'],
    synopsis:
      'A concierge and his lobby boy inherit a painting, a murder charge and a very precise aesthetic.',
    poster: 3,
  },
  {
    id: 'hereditary',
    title: 'Hereditary',
    releaseYear: 2018,
    mediaType: 'movie',
    genres: ['horror', 'drama'],
    rating: 7.3,
    votes: 400_000,
    runtime: 127,
    providers: ['max'],
    synopsis: 'A family funeral opens a inheritance nobody in the family agreed to accept.',
    poster: 6,
  },
  {
    id: 'inception',
    title: 'Inception',
    releaseYear: 2010,
    mediaType: 'movie',
    genres: ['sci-fi', 'action', 'thriller'],
    rating: 8.8,
    votes: 2_500_000,
    runtime: 148,
    providers: ['netflix'],
    synopsis: 'A thief who steals from dreams is asked to leave something behind instead.',
    poster: 5,
  },
  {
    id: 'la-la-land',
    title: 'La La Land',
    releaseYear: 2016,
    mediaType: 'movie',
    genres: ['romance', 'comedy', 'drama'],
    rating: 8.0,
    votes: 650_000,
    runtime: 128,
    providers: ['netflix', 'prime-video'],
    synopsis: 'Two people chase careers that keep scheduling themselves against each other.',
    poster: 3,
  },
  {
    id: 'mad-max-fury-road',
    title: 'Mad Max: Fury Road',
    releaseYear: 2015,
    mediaType: 'movie',
    genres: ['action', 'sci-fi'],
    rating: 8.1,
    votes: 1_100_000,
    runtime: 120,
    providers: ['max'],
    synopsis: 'A chase scene that lasts two hours and never once runs out of road.',
    poster: 4,
  },
  {
    // Synthetic, and deliberately so: no real title carries a 10.0 on a
    // handful of votes, and the D7 shrinkage assertion (T014) needs exactly
    // that shape. Its weighted rating is (10.0 x 4 + 6.5 x 500) / 504 = 6.53 —
    // well below `your-name`'s 8.40, which is the point.
    id: 'midnight-static',
    title: 'Midnight Static',
    releaseYear: 2025,
    mediaType: 'movie',
    genres: ['horror', 'sci-fi'],
    rating: 10.0,
    votes: 4,
    runtime: 88,
    providers: ['mubi'],
    synopsis: 'A late-night broadcast that only four people have ever admitted to seeing.',
    noTrailer: true,
  },
  {
    id: 'oppenheimer',
    title: 'Oppenheimer',
    releaseYear: 2023,
    mediaType: 'movie',
    genres: ['drama', 'thriller'],
    rating: 8.3,
    votes: 900_000,
    runtime: 180,
    providers: ['peacock'],
    synopsis: 'The man who built it spends the rest of the film being asked whether he regrets it.',
    poster: 2,
  },
  {
    id: 'parasite',
    title: 'Parasite',
    releaseYear: 2019,
    mediaType: 'movie',
    genres: ['thriller', 'drama'],
    rating: 8.5,
    votes: 900_000,
    runtime: 132,
    providers: ['max', 'mubi'],
    synopsis: 'One family talks its way into another family’s house and finds the basement.',
    poster: 6,
  },
  {
    id: 'pulp-fiction',
    title: 'Pulp Fiction',
    releaseYear: 1994,
    mediaType: 'movie',
    genres: ['thriller', 'drama'],
    rating: 8.9,
    votes: 2_200_000,
    runtime: 154,
    providers: ['netflix'],
    synopsis: 'Several bad days in Los Angeles, told out of order and quoted ever since.',
    poster: 1,
  },
  {
    id: 'spotlight',
    title: 'Spotlight',
    releaseYear: 2015,
    mediaType: 'movie',
    genres: ['drama', 'thriller'],
    rating: 8.1,
    votes: 500_000,
    runtime: 129,
    providers: ['prime-video'],
    synopsis: 'A newspaper team pulls a thread and finds the whole institution attached to it.',
    poster: 2,
  },
  {
    id: 'superbad',
    title: 'Superbad',
    releaseYear: 2007,
    mediaType: 'movie',
    genres: ['comedy'],
    rating: 7.6,
    votes: 620_000,
    runtime: 113,
    providers: ['netflix', 'hulu'],
    synopsis: 'Two friends attempt one last party before graduation, with forged identification.',
    poster: 3,
  },
  {
    id: 'the-dark-knight',
    title: 'The Dark Knight',
    releaseYear: 2008,
    mediaType: 'movie',
    genres: ['action', 'thriller'],
    rating: 9.0,
    votes: 2_900_000,
    runtime: 152,
    providers: ['max', 'netflix'],
    synopsis: 'A city decides how much order it is willing to trade for safety.',
    poster: 5,
  },
  {
    id: 'the-witch',
    title: 'The Witch',
    releaseYear: 2015,
    mediaType: 'movie',
    genres: ['horror', 'drama'],
    rating: 7.0,
    votes: 300_000,
    runtime: 92,
    // No providers and no poster: the worst-case card, exercising filter 3 and
    // FR-016 together. The card must still be fully readable.
    providers: [],
    synopsis: 'A family banished to the edge of the woods discovers the woods were the point.',
    noTrailer: true,
  },
  {
    id: 'whiplash',
    title: 'Whiplash',
    releaseYear: 2014,
    mediaType: 'movie',
    genres: ['drama'],
    rating: 8.5,
    votes: 1_000_000,
    runtime: 106,
    providers: ['max', 'prime-video'],
    synopsis: 'A drummer and a conductor disagree about where encouragement ends.',
    poster: 1,
  },

  // --------------------------------------------------------------- series --
  {
    id: 'black-mirror',
    title: 'Black Mirror',
    releaseYear: 2011,
    mediaType: 'tv',
    genres: ['sci-fi', 'thriller', 'drama'],
    rating: 8.7,
    votes: 650_000,
    runtime: 60,
    providers: ['netflix'],
    synopsis: 'Standalone stories about the feature nobody asked for and everybody enabled.',
    poster: 5,
  },
  {
    id: 'breaking-bad',
    title: 'Breaking Bad',
    releaseYear: 2008,
    mediaType: 'tv',
    genres: ['drama', 'thriller'],
    rating: 9.5,
    votes: 2_000_000,
    runtime: 47,
    providers: ['netflix'],
    synopsis:
      'A chemistry teacher receives a diagnosis and makes a series of extremely confident decisions.',
    poster: 2,
  },
  {
    id: 'chernobyl',
    title: 'Chernobyl',
    releaseYear: 2019,
    mediaType: 'tv',
    genres: ['drama', 'thriller'],
    rating: 9.4,
    votes: 900_000,
    runtime: 65,
    providers: ['max'],
    synopsis: 'The cost of a lie is measured in roentgen, and then in people.',
    poster: 6,
  },
  {
    id: 'dark',
    title: 'Dark',
    releaseYear: 2017,
    mediaType: 'tv',
    genres: ['sci-fi', 'thriller'],
    rating: 8.7,
    votes: 450_000,
    runtime: 55,
    providers: ['netflix'],
    synopsis:
      'A missing child in a small German town, and four families discovering they are the same family.',
    poster: 5,
  },
  {
    id: 'fleabag',
    title: 'Fleabag',
    releaseYear: 2016,
    mediaType: 'tv',
    genres: ['comedy', 'drama'],
    rating: 8.7,
    votes: 250_000,
    runtime: 27,
    providers: ['prime-video'],
    synopsis: 'A woman narrates her own catastrophe directly to you, which is the whole problem.',
    poster: 3,
  },
  {
    id: 'mad-men',
    title: 'Mad Men',
    releaseYear: 2007,
    mediaType: 'tv',
    genres: ['drama'],
    rating: 8.7,
    votes: 300_000,
    runtime: 47,
    providers: ['netflix', 'prime-video'],
    synopsis: 'Advertising executives sell happiness they have never personally located.',
    poster: 1,
  },
  {
    id: 'only-murders',
    title: 'Only Murders in the Building',
    releaseYear: 2021,
    mediaType: 'tv',
    genres: ['comedy', 'thriller'],
    rating: 8.1,
    votes: 150_000,
    runtime: 34,
    providers: ['hulu', 'disney-plus'],
    synopsis: 'Three neighbours who love true crime start living in one.',
    poster: 4,
  },
  {
    id: 'stranger-things',
    title: 'Stranger Things',
    releaseYear: 2016,
    mediaType: 'tv',
    genres: ['sci-fi', 'horror', 'thriller'],
    rating: 8.7,
    votes: 1_400_000,
    runtime: 51,
    providers: ['netflix'],
    synopsis: 'A boy disappears and the town’s science fair project turns out to be load-bearing.',
    poster: 5,
  },
  {
    id: 'succession',
    title: 'Succession',
    releaseYear: 2018,
    mediaType: 'tv',
    genres: ['drama', 'comedy'],
    rating: 8.9,
    votes: 300_000,
    runtime: 60,
    providers: ['max'],
    synopsis: 'Four siblings compete for a throne their father has no intention of vacating.',
    poster: 2,
  },
  {
    id: 'ted-lasso',
    title: 'Ted Lasso',
    releaseYear: 2020,
    mediaType: 'tv',
    genres: ['comedy', 'drama'],
    rating: 8.8,
    votes: 350_000,
    runtime: 30,
    providers: ['apple-tv-plus'],
    synopsis: 'An American football coach is hired to lose gracefully and declines to.',
    poster: 6,
  },
  {
    id: 'the-bear',
    title: 'The Bear',
    releaseYear: 2022,
    mediaType: 'tv',
    genres: ['drama', 'comedy'],
    rating: 8.6,
    votes: 250_000,
    runtime: 30,
    providers: ['hulu', 'disney-plus'],
    synopsis: 'A fine-dining chef inherits a sandwich shop and everyone yells, lovingly.',
    poster: 3,
  },
  {
    id: 'the-last-of-us',
    title: 'The Last of Us',
    releaseYear: 2023,
    mediaType: 'tv',
    genres: ['drama', 'horror'],
    rating: 8.7,
    votes: 600_000,
    runtime: 56,
    providers: ['max'],
    synopsis: 'A smuggler is paid to move one immune girl across a country that ended.',
    poster: 4,
  },
  {
    id: 'the-queens-gambit',
    title: "The Queen's Gambit",
    releaseYear: 2020,
    mediaType: 'tv',
    genres: ['drama'],
    rating: 8.5,
    votes: 600_000,
    runtime: 60,
    providers: ['netflix'],
    synopsis: 'An orphan discovers chess, and chess discovers a problem it cannot solve.',
    poster: 1,
  },
  {
    id: 'the-sopranos',
    title: 'The Sopranos',
    releaseYear: 1999,
    mediaType: 'tv',
    genres: ['drama', 'thriller'],
    rating: 9.2,
    votes: 500_000,
    runtime: 55,
    providers: ['max'],
    synopsis: 'A mob boss starts therapy and spends seven seasons avoiding the subject.',
    poster: 2,
  },
  {
    id: 'the-wire',
    title: 'The Wire',
    releaseYear: 2002,
    mediaType: 'tv',
    genres: ['drama', 'thriller'],
    rating: 9.3,
    votes: 400_000,
    runtime: 59,
    providers: ['max'],
    synopsis: 'Baltimore, one institution at a time, each convinced it is the only one trying.',
    poster: 6,
  },
  {
    id: 'sherlock',
    title: 'Sherlock',
    releaseYear: 2010,
    mediaType: 'tv',
    genres: ['thriller', 'drama'],
    rating: 9.1,
    votes: 1_000_000,
    runtime: 88,
    providers: ['netflix', 'prime-video'],
    synopsis: 'The world’s most famous detective is relocated to a London with smartphones.',
    poster: 5,
  },

  // ---------------------------------------------------------------- anime --
  {
    id: 'attack-on-titan',
    title: 'Attack on Titan',
    releaseYear: 2013,
    mediaType: 'anime',
    genres: ['animation', 'action', 'drama'],
    rating: 9.0,
    votes: 500_000,
    runtime: 24,
    providers: ['crunchyroll', 'hulu'],
    synopsis: 'Humanity lives behind walls until the walls stop being the biggest problem.',
    poster: 4,
  },
  {
    id: 'cowboy-bebop',
    title: 'Cowboy Bebop',
    releaseYear: 1998,
    mediaType: 'anime',
    genres: ['animation', 'action', 'sci-fi'],
    rating: 8.9,
    votes: 350_000,
    runtime: 24,
    providers: ['crunchyroll', 'netflix'],
    synopsis: 'Bounty hunters drift through the solar system, each avoiding one specific person.',
    poster: 5,
  },
  {
    id: 'death-note',
    title: 'Death Note',
    releaseYear: 2006,
    mediaType: 'anime',
    genres: ['animation', 'thriller'],
    rating: 8.9,
    votes: 600_000,
    runtime: 23,
    providers: ['crunchyroll', 'netflix'],
    synopsis: 'A student finds a notebook that kills, and a detective finds the student.',
    poster: 6,
  },
  {
    id: 'frieren',
    title: 'Frieren: Beyond Journey’s End',
    releaseYear: 2023,
    mediaType: 'anime',
    genres: ['animation', 'drama'],
    rating: 9.0,
    votes: 100_000,
    runtime: 24,
    providers: ['crunchyroll'],
    synopsis: 'An elf who outlived her party finally gets around to grieving them.',
    poster: 1,
  },
  {
    id: 'fullmetal-alchemist-brotherhood',
    title: 'Fullmetal Alchemist: Brotherhood',
    releaseYear: 2009,
    mediaType: 'anime',
    genres: ['animation', 'action', 'drama'],
    rating: 9.1,
    votes: 200_000,
    runtime: 24,
    providers: ['crunchyroll', 'hulu'],
    synopsis:
      'Two brothers pay a terrible price for a lesson in equivalent exchange, then keep the receipt.',
    poster: 2,
  },
  {
    id: 'hunter-x-hunter',
    title: 'Hunter x Hunter',
    releaseYear: 2011,
    mediaType: 'anime',
    genres: ['animation', 'action'],
    rating: 9.0,
    votes: 250_000,
    runtime: 23,
    providers: ['crunchyroll', 'netflix'],
    synopsis: 'A boy sets out to find his father and keeps meeting people who make that harder.',
    poster: 3,
  },
  {
    id: 'jujutsu-kaisen',
    title: 'Jujutsu Kaisen',
    releaseYear: 2020,
    mediaType: 'anime',
    genres: ['animation', 'action', 'horror'],
    rating: 8.5,
    votes: 200_000,
    runtime: 24,
    providers: ['crunchyroll'],
    synopsis: 'A student swallows a cursed object and is enrolled somewhere worse than expelled.',
    poster: 4,
  },
  {
    id: 'mob-psycho-100',
    title: 'Mob Psycho 100',
    releaseYear: 2016,
    mediaType: 'anime',
    genres: ['animation', 'comedy', 'action'],
    rating: 8.6,
    votes: 180_000,
    runtime: 24,
    providers: ['crunchyroll'],
    synopsis: 'The most powerful psychic alive mostly wants to be less awkward at school.',
    noTrailer: true,
  },
  {
    id: 'spirited-away',
    title: 'Spirited Away',
    releaseYear: 2001,
    mediaType: 'anime',
    genres: ['animation', 'drama'],
    rating: 8.6,
    votes: 830_000,
    runtime: 125,
    providers: ['max', 'netflix'],
    synopsis: 'A girl loses her name in a bathhouse for spirits and has to earn it back.',
    poster: 6,
  },
  {
    id: 'steins-gate',
    title: 'Steins;Gate',
    releaseYear: 2011,
    mediaType: 'anime',
    genres: ['animation', 'sci-fi', 'thriller'],
    rating: 8.8,
    votes: 300_000,
    runtime: 24,
    providers: ['crunchyroll'],
    synopsis: 'A self-described mad scientist builds a microwave that texts the past.',
    poster: 5,
  },
  {
    id: 'vinland-saga',
    title: 'Vinland Saga',
    releaseYear: 2019,
    mediaType: 'anime',
    genres: ['animation', 'action', 'drama'],
    rating: 8.8,
    votes: 200_000,
    runtime: 24,
    // No providers and no poster, mirroring `the-witch`: the degraded card.
    providers: [],
    synopsis: 'A Viking boy wants revenge, gets it, and then has to live in the aftermath.',
    noTrailer: true,
  },
  {
    id: 'your-name',
    title: 'Your Name',
    releaseYear: 2016,
    mediaType: 'anime',
    genres: ['animation', 'romance', 'drama'],
    rating: 8.4,
    votes: 300_000,
    runtime: 106,
    providers: ['crunchyroll', 'prime-video'],
    synopsis:
      'Two teenagers keep waking up in each other’s lives, which is romantic until it is not.',
    poster: 3,
  },
];

/**
 * Expands a seed into a `MediaTitle`.
 *
 * Provider ids with no entry in `PROVIDER_SEARCH_URLS` are dropped rather than
 * given a placeholder URL — a link to nowhere is worse than one fewer badge
 * (data-model.md: unknown ids are ignored, not fatal).
 */
function toMediaTitle(seed: CatalogSeed): MediaTitle {
  const availability: StreamingAvailability[] = seed.providers
    .map((providerId) => {
      const search = PROVIDER_SEARCH_URLS[providerId];
      if (!search) return null;
      return {
        providerId,
        deepLinkUrl: search(encodeURIComponent(seed.title)),
      };
    })
    .filter((entry): entry is StreamingAvailability => entry !== null);

  return {
    id: seed.id,
    title: seed.title,
    releaseYear: seed.releaseYear,
    mediaType: seed.mediaType,
    genres: [...seed.genres],
    synopsis: seed.synopsis,
    rating: seed.rating,
    voteCount: seed.votes,
    runtimeMinutes: seed.runtime,
    trailerUrl: seed.noTrailer ? undefined : trailerSearchUrl(seed.title),
    posterUrl: seed.poster === undefined ? undefined : posterUrl(seed.poster),
    availability,
  };
}

/** The Milestone 1 catalog, in seed order. Ranking re-sorts it; order is irrelevant. */
export const MEDIA_CATALOG: readonly MediaTitle[] = CATALOG_SEEDS.map(toMediaTitle);
