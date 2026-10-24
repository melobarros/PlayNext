import { Interaction } from '../../../../../core/models/interaction';
import { MediaTitle } from '../../../../../core/models/media-title';
import { MediaType, Preference } from '../../../../../core/models/quiz';
import { TelemetryActionKind } from '../../../../../core/models/telemetry';
import { EvaluationFixture, FixtureEvent, FixtureSession } from '../types';

/**
 * `personas-v1` — the frozen fixture the harness reports against
 * (`specs/009-recommendation-telemetry/contracts/evaluation-harness.md`).
 *
 * Synthetic and committed. Nothing here came from a visitor, so the file can be
 * reviewed, diffed, and run by a fresh clone with no capture step — and a
 * report from today can be compared with one from months ago because the input
 * cannot have moved.
 *
 * **The catalog is generated from fixed arrays, not captured.** Nine quiz
 * genres, six titles each, every title carrying a second genre. That second
 * genre is what makes the fixture measurable: a persona selecting four genres
 * has titles matching one of them and titles matching two, so a ranker that
 * reads genre has something to be right about and one that ignores it has
 * something to be wrong about. Ratings and vote counts cycle through a fixed
 * table so the order is authored rather than accidental.
 *
 * **The walks are anchored in the pool, not in the catalog.** Each persona's
 * sessions only show titles its own preference admits — a fixture that showed
 * an ineligible card would be recording a deck that could not exist.
 *
 * Every persona selects `mediaType: any` and either `provider: any` or
 * "include other platforms": with 54 titles, a narrower preference would leave
 * fewer eligible titles than a twenty-card walk needs, and a report that mostly
 * measured an emptying pool would say nothing about ranking. The availability
 * and media-type filters are exercised exhaustively by `recommend.spec.ts`.
 */

const SESSION_BASE = '2026-10-01T09:00:00.000Z';

/** The quiz's own ids, verbatim — a fixture that invented its own would not rank. */
const GENRE_IDS = [
  'action',
  'comedy',
  'drama',
  'horror',
  'romance',
  'sci-fi',
  'thriller',
  'animation',
  'documentary',
] as const;

const PROVIDER_IDS = [
  'netflix',
  'prime-video',
  'disney-plus',
  'max',
  'apple-tv-plus',
  'paramount-plus',
  'crunchyroll',
  'mubi',
  'globoplay',
  'hulu',
  'peacock',
] as const;

/** Six per genre, in season order. */
const TITLES_PER_GENRE = 6;

const NAMES: Record<(typeof GENRE_IDS)[number], readonly string[]> = {
  action: ['Last Stand', 'Iron Run', 'Hard Exit', 'Silent Raid', 'Black Tide', 'Final Bell'],
  comedy: ['Office Hours', 'The Wrong Twin', 'Dinner at Nine', 'Small Talk', 'Plus One', 'Late Checkout'],
  drama: ['The Long Winter', 'Paper Houses', 'Quiet Rooms', 'A Second Spring', 'Low Country', 'The Visitor'],
  horror: ['Cellar Door', 'Night Bell', 'The Hollow', 'Static', 'Red Room', 'Last Light'],
  romance: ['Two Bridges', 'Postcards', 'The Slow Season', 'Almost, Always', 'Harbour Lights', 'One Summer'],
  'sci-fi': ['Orbital', 'Signal Loss', 'The Long Orbit', 'Deep Field', 'Quiet Machines', 'Far Relay'],
  thriller: ['Blind Corner', 'The Courier', 'Nine Hours', 'Dead Reckoning', 'Cold Open', 'Hairline'],
  animation: ['Skybound', 'The Paper Boat', 'Little Giant', 'Cloud Factory', 'Moon Garden', 'Tiny Kingdom'],
  documentary: ['Deep Water', 'Field Notes', 'The Salt Road', 'Wild Harbour', 'Archive One', 'Night Shift'],
};

/**
 * Ratings and vote counts cycle against the genre index as well as the title
 * index, so the same title is not always the well-reviewed one and the
 * confidence weighting has something to weigh.
 */
const RATINGS = [6.4, 7.2, 8.1, 7.8, 6.9, 8.6];
const VOTES = [1_240, 18_400, 640, 42_100, 3_300, 880];

/** A title's second genre: the neighbouring one, then the one after it. */
function genresFor(genreIndex: number, position: number): string[] {
  const offset = position <= TITLES_PER_GENRE / 2 ? 1 : 2;
  const secondary = GENRE_IDS[(genreIndex + offset) % GENRE_IDS.length];

  return [GENRE_IDS[genreIndex], secondary];
}

/** Availability is rotated across the quiz's services so every one is reachable. */
function availabilityFor(seedIndex: number): MediaTitle['availability'] {
  return [0, 3, 6, 9].map((offset) => {
    const providerId = PROVIDER_IDS[(seedIndex + offset) % PROVIDER_IDS.length];

    return {
      providerId,
      deepLinkUrl: `https://example.invalid/${providerId}/${seedIndex}`,
    };
  });
}

function mediaTypeFor(genre: string, position: number): MediaType {
  if (genre === 'animation' && (position === 3 || position === 6)) return 'anime';

  return position <= TITLES_PER_GENRE / 2 ? 'movie' : 'tv';
}

function buildCatalog(): MediaTitle[] {
  const catalog: MediaTitle[] = [];

  GENRE_IDS.forEach((genre, genreIndex) => {
    for (let position = 1; position <= TITLES_PER_GENRE; position++) {
      const seedIndex = genreIndex * TITLES_PER_GENRE + position - 1;
      const valueIndex = (genreIndex + position - 1) % RATINGS.length;

      catalog.push({
        id: `${genre}-${position}`,
        title: NAMES[genre][position - 1],
        releaseYear: 2005 + ((genreIndex * 3 + position) % 20),
        mediaType: mediaTypeFor(genre, position),
        genres: genresFor(genreIndex, position),
        synopsis: `A synthetic ${genre} title from the ${'personas-v1'} fixture.`,
        rating: RATINGS[valueIndex],
        voteCount: VOTES[valueIndex],
        availability: availabilityFor(seedIndex),
      });
    }
  });

  return catalog;
}

function preference(genres: string[], providers: string[], unowned: boolean): Preference {
  return {
    mediaType: { values: [], any: true },
    genre: { values: genres, any: false },
    provider: providers.length === 0 ? { values: [], any: true } : { values: providers, any: false },
    includeUnownedProviders: unowned,
    completedAt: '2026-09-15T12:00:00.000Z',
  };
}

/**
 * A session's events, with the clock advanced for us.
 *
 * The fixture is data, and hand-writing nineteen ISO timestamps per persona
 * would bury the one thing worth reading — the order of cards and answers.
 * `.card` is "shown, then answered"; `.shown` is a card the visitor left
 * alone; `.acted` is an answer with no new card, which is what an undo is.
 */
class Walk {
  private readonly events: FixtureEvent[] = [];
  private seconds = 0;

  card(titleId: string, kind: TelemetryActionKind): this {
    return this.shown(titleId).acted(titleId, kind);
  }

  shown(titleId: string): this {
    this.events.push({ type: 'impression', titleId, shownAt: this.tick() });

    return this;
  }

  acted(titleId: string, kind: TelemetryActionKind): this {
    this.events.push({ type: 'action', titleId, kind, occurredAt: this.tick() });

    return this;
  }

  done(): FixtureEvent[] {
    return this.events;
  }

  private tick(): string {
    this.seconds += 20;

    return new Date(Date.parse(SESSION_BASE) + this.seconds * 1000).toISOString();
  }
}

function session(
  sessionId: string,
  preferenceForSession: Preference,
  walk: Walk,
  initialInteractions: Record<string, Interaction> = {},
): FixtureSession {
  return {
    sessionId,
    preference: preferenceForSession,
    initialInteractions,
    events: walk.done(),
  };
}

/**
 * Horror, with some science fiction and thriller: four genres, of which a
 * horror title that is also science fiction carries two — the titles this
 * visitor says yes to.
 *
 * The early cards are the one-match titles (thriller without a selected
 * second genre), skipped or refused; the strong matches are shown late and
 * liked, which is what makes them labels for every impression before them.
 */
const horror = session(
  'persona-horror',
  preference(['horror', 'thriller', 'drama', 'sci-fi'], [], true),
  new Walk()
    .shown('horror-1')
    .card('horror-2', 'skip')
    .card('horror-3', 'disliked')
    .card('thriller-1', 'skip')
    .shown('thriller-2')
    .card('thriller-3', 'skip')
    .card('drama-4', 'skip')
    .card('drama-5', 'disliked')
    // The dislike is taken back on the spot, so the title returns to the deck.
    .acted('drama-5', 'undo')
    .shown('drama-5')
    .card('drama-6', 'skip')
    .card('sci-fi-4', 'skip')
    .shown('sci-fi-5')
    .card('horror-4', 'liked')
    .card('drama-1', 'liked')
    .card('sci-fi-1', 'liked')
    .shown('drama-2')
    .card('drama-3', 'disliked')
    .card('horror-5', 'liked')
    .shown('horror-6')
    .card('sci-fi-2', 'watch_now'),
  {
    // Saved in an earlier session and never touched here: input state, never a
    // label, and a title the pool must not offer.
    'romance-2': { state: 'wantToWatch', updatedAt: '2026-09-20T20:00:00.000Z' },
  },
);

/** Prestige drama, with romance, documentary and thriller. */
const prestigeDrama = session(
  'persona-prestige-drama',
  preference(['drama', 'romance', 'documentary', 'thriller'], ['max', 'apple-tv-plus', 'mubi'], true),
  new Walk()
    .shown('drama-1')
    .card('drama-2', 'skip')
    .card('drama-3', 'disliked')
    .card('thriller-1', 'skip')
    .shown('thriller-2')
    .card('thriller-3', 'skip')
    .card('romance-1', 'skip')
    .card('romance-2', 'disliked')
    .acted('romance-2', 'undo')
    .shown('romance-2')
    .card('romance-3', 'skip')
    .card('documentary-1', 'skip')
    .shown('documentary-2')
    .card('drama-4', 'liked')
    .card('romance-4', 'liked')
    .shown('thriller-4')
    .card('documentary-3', 'skip')
    .card('thriller-5', 'liked')
    .shown('drama-5')
    .card('romance-5', 'liked')
    .card('documentary-4', 'watch_now'),
);

/** Family animation: animation, comedy, romance and drama. */
const familyAnimation = session(
  'persona-family-animation',
  preference(['animation', 'comedy', 'romance', 'drama'], ['disney-plus', 'netflix', 'prime-video'], true),
  new Walk()
    .shown('animation-1')
    .card('animation-2', 'skip')
    .card('animation-3', 'disliked')
    .card('comedy-1', 'liked')
    .shown('animation-4')
    .card('animation-5', 'skip')
    .card('animation-6', 'skip')
    .card('romance-1', 'skip')
    .acted('romance-1', 'undo')
    .shown('romance-1')
    .card('romance-2', 'disliked')
    .card('romance-3', 'skip')
    .shown('romance-4')
    .card('comedy-2', 'liked')
    .card('romance-5', 'skip')
    .shown('comedy-3')
    .card('drama-4', 'liked')
    .card('comedy-4', 'liked')
    .shown('drama-5')
    .card('drama-6', 'liked')
    .card('comedy-5', 'watch_now'),
);

/**
 * Science fiction, and the session with **nothing relevant in it**.
 *
 * No like and no Watch Now, on purpose: the report must show coverage and
 * diversity surviving a visitor who wanted nothing, and the four ranking
 * measures must not be diluted by twenty decisions that could never be scored.
 */
const scienceFiction = session(
  'persona-science-fiction',
  preference(['sci-fi', 'action', 'thriller', 'drama'], [], true),
  new Walk()
    .shown('sci-fi-4')
    .card('sci-fi-5', 'skip')
    .card('sci-fi-6', 'disliked')
    .card('thriller-1', 'skip')
    .shown('thriller-2')
    .card('thriller-3', 'skip')
    .card('drama-1', 'skip')
    .card('drama-2', 'disliked')
    .acted('drama-2', 'undo')
    .shown('drama-2')
    .card('drama-3', 'skip')
    .card('action-1', 'skip')
    .shown('action-2')
    .card('action-3', 'disliked')
    .card('romance-1', 'skip')
    .shown('comedy-1')
    .card('comedy-2', 'skip')
    .card('documentary-1', 'skip')
    .shown('documentary-2')
    .card('documentary-3', 'skip')
    .shown('romance-2'),
);

/** The committed fixture: four personas over one frozen catalog. */
export const personasFixture: EvaluationFixture = {
  fixtureId: 'personas-v1',
  catalogVersion: '2026-09-30T00:00:00.000Z',
  region: 'BR',
  catalog: buildCatalog(),
  sessions: [horror, prestigeDrama, familyAnimation, scienceFiction],
};
