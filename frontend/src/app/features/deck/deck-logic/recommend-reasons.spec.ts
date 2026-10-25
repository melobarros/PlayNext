import { Interaction, isRejection } from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import { personasFixture } from './evaluation/fixtures/personas';
import { replaySession } from './evaluation/replay';
import { RankerInput } from './evaluation/types';
import {
  POSITIVE_STATES,
  RankedTitle,
  isAvailableOnSelectedService,
  matchedGenres,
} from './recommend-shared';
import { rankTitlesV2 } from './recommend-v2';

/**
 * The reasons, held to the statement the card makes (US3, SC-004,
 * `specs/010-deterministic-engine-v2/contracts/ranking-engine.md` § Reasons).
 *
 * A reason is a claim about the score: the branch that fired must have
 * contributed **positively** to this card, and a card with no reason must have
 * had nothing positive to say. The checks below recompute each contribution
 * from the same five inputs the engine saw — deliberately not by importing the
 * engine's own helpers for the scored terms — so the test can disagree with the
 * engine rather than agree with it by construction.
 */

const RATED_AT = '2026-09-26T10:00:00.000Z';

const VOCABULARY = ['genre-picked', 'genre-affinity', 'era-affinity', 'service', 'none'] as const;

const ERA_EVIDENCE = 3;
const ERA_SPAN = 20;

function title(id: string, overrides: Partial<MediaTitle> = {}): MediaTitle {
  return {
    id,
    title: id,
    releaseYear: 2020,
    mediaType: 'movie',
    genres: [],
    synopsis: '',
    rating: 8,
    voteCount: 1000,
    availability: [],
    ...overrides,
  };
}

function preference(overrides: Partial<Preference> = {}): Preference {
  return {
    mediaType: { values: [], any: true },
    genre: { values: [], any: true },
    provider: { values: [], any: true },
    includeUnownedProviders: false,
    completedAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  };
}

function rated(state: Interaction['state']): Interaction {
  return { state, updatedAt: RATED_AT };
}

const noInteractions: Record<string, Interaction> = {};

interface ReferenceProfile {
  readonly genreWeights: ReadonlyMap<string, number>;
  readonly positiveCount: number;
  readonly eraCentre: number | null;
}

/** The profile as the contract defines it, computed independently of the engine. */
function referenceProfile(
  catalog: readonly MediaTitle[],
  interactions: Readonly<Record<string, Interaction>>,
): ReferenceProfile {
  const genreWeights = new Map<string, number>();
  let positiveCount = 0;
  let yearTotal = 0;

  for (const entry of catalog) {
    const state = interactions[entry.id]?.state;
    if (state === undefined) continue;

    const positive = POSITIVE_STATES.includes(state);
    if (!positive && !isRejection(state)) continue;

    const weight = positive ? 1 : -1;
    for (const genre of new Set(entry.genres)) {
      genreWeights.set(genre, (genreWeights.get(genre) ?? 0) + weight);
    }

    if (!positive) continue;
    positiveCount += 1;
    yearTotal += entry.releaseYear;
  }

  return {
    genreWeights,
    positiveCount,
    eraCentre: positiveCount > 0 ? yearTotal / positiveCount : null,
  };
}

function referenceAffinity(entry: MediaTitle, profile: ReferenceProfile): number {
  const distinct = new Set(entry.genres);
  if (distinct.size === 0) return 0;

  let total = 0;
  for (const genre of distinct) total += profile.genreWeights.get(genre) ?? 0;

  return total / distinct.size;
}

function referenceEraFit(entry: MediaTitle, profile: ReferenceProfile): number {
  if (profile.eraCentre === null || profile.positiveCount < ERA_EVIDENCE) return 0;

  const gap = entry.releaseYear - profile.eraCentre;

  return Math.max(0, 1 - Math.max(gap, -gap) / ERA_SPAN);
}

/** The four contributions the reason vocabulary may name. */
function contributionsOf(
  card: MediaTitle,
  input: RankerInput,
): { picked: boolean; affinity: boolean; era: boolean; service: boolean } {
  const profile = referenceProfile(input.catalog, input.interactions);

  return {
    picked: !input.preference.genre.any && matchedGenres(card, input.preference) > 0,
    affinity: referenceAffinity(card, profile) > 0,
    era: referenceEraFit(card, profile) > 0,
    service: isAvailableOnSelectedService(card, input.preference),
  };
}

describe('rankTitlesV2 — reasons are statements about the score (SC-004)', () => {
  it('backs every reason on the fixture with a positive contribution', () => {
    // A recording ranker so each card can be checked against the exact input
    // the engine ranked — the replay's own decisions keep ids, not inputs.
    const calls: { input: RankerInput; ranked: RankedTitle[] }[] = [];

    const recorder = {
      name: 'recording-v2',
      engineVersion: 'recommend-v2',
      rank(input: RankerInput) {
        const ranked = rankTitlesV2(
          input.catalog,
          input.preference,
          input.interactions,
          input.shownTitleIds,
        );
        calls.push({ input, ranked });
        return ranked;
      },
    };

    for (const session of personasFixture.sessions) {
      replaySession(session, personasFixture.catalog, recorder);
    }

    expect(calls.length).toBeGreaterThan(0);

    for (const { input, ranked } of calls) {
      for (const card of ranked) {
        const contributions = contributionsOf(card, input);
        const code: string = card.reasonCode;

        expect(VOCABULARY).toContain(code);

        if (code === 'genre-picked') {
          expect(contributions.picked).toBe(true);
          expect(card.reason).not.toBeNull();
        } else if (code === 'genre-affinity') {
          expect(contributions.affinity).toBe(true);
          expect(card.reason).not.toBeNull();
        } else if (code === 'era-affinity') {
          expect(contributions.era).toBe(true);
          expect(card.reason).not.toBeNull();
        } else if (code === 'service') {
          expect(contributions.service).toBe(true);
          expect(card.reason).not.toBeNull();
        } else {
          // `none` never speaks, and it is exactly the card with nothing
          // positive to name.
          expect(code).toBe('none');
          expect(card.reason).toBeNull();
          expect(
            contributions.picked ||
              contributions.affinity ||
              contributions.era ||
              contributions.service,
          ).toBe(false);
        }
      }
    }
  });

  it('names the decade of the card’s own year', () => {
    const catalog = [
      title('anchor-1', { genres: ['comedy'], releaseYear: 1995 }),
      title('anchor-2', { genres: ['comedy'], releaseYear: 1995 }),
      title('anchor-3', { genres: ['comedy'], releaseYear: 1995 }),
      title('era-hit', { genres: ['drama'], releaseYear: 2004 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'anchor-1': rated('loved'), 'anchor-2': rated('loved'), 'anchor-3': rated('loved') },
      [],
    );

    const card = result.find((entry) => entry.id === 'era-hit');

    expect(card?.reasonCode).toBe('era-affinity');
    expect(card?.reason).toBe('Because you loved 2000s titles');
  });

  it('needs three positive ratings before the era can speak', () => {
    // Two positives are not evidence: the same card at the same distance stays
    // silent rather than asserting a taste two ratings cannot support.
    const catalog = [
      title('anchor-1', { genres: ['comedy'], releaseYear: 1995 }),
      title('anchor-2', { genres: ['comedy'], releaseYear: 1995 }),
      title('era-hit', { genres: ['drama'], releaseYear: 1996 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'anchor-1': rated('loved'), 'anchor-2': rated('loved') },
      [],
    );

    const card = result.find((entry) => entry.id === 'era-hit');

    expect(card?.reasonCode).toBe('none');
    expect(card?.reason).toBeNull();
  });

  it('stays silent when the card is outside the era span', () => {
    const catalog = [
      title('anchor-1', { genres: ['comedy'], releaseYear: 1995 }),
      title('anchor-2', { genres: ['comedy'], releaseYear: 1995 }),
      title('anchor-3', { genres: ['comedy'], releaseYear: 1995 }),
      title('era-miss', { genres: ['drama'], releaseYear: 1960 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'anchor-1': rated('loved'), 'anchor-2': rated('loved'), 'anchor-3': rated('loved') },
      [],
    );

    const card = result.find((entry) => entry.id === 'era-miss');

    expect(card?.reasonCode).toBe('none');
    expect(card?.reason).toBeNull();
  });

  it('says service only when the availability term was actually awarded', () => {
    const catalog = [
      title('on-netflix', { availability: [{ providerId: 'netflix', deepLinkUrl: 'https://example.test/n' }] }),
      title('on-hulu', { availability: [{ providerId: 'hulu', deepLinkUrl: 'https://example.test/h' }] }),
    ];

    const selected = rankTitlesV2(
      catalog,
      preference({
        provider: { values: ['netflix'], any: false },
        includeUnownedProviders: true,
      }),
      noInteractions,
      [],
    );

    expect(selected.find((entry) => entry.id === 'on-netflix')?.reasonCode).toBe('service');
    expect(selected.find((entry) => entry.id === 'on-hulu')?.reasonCode).toBe('none');

    // Under `Any` nothing was selected, so availability is not a positive term
    // and must not be spoken aloud.
    const anyProvider = rankTitlesV2(catalog, preference(), noInteractions, []);

    for (const card of anyProvider) expect(card.reasonCode).toBe('none');
  });

  it('never lets runtime speak, even when it is the only positive term', () => {
    // Three runtime anchors put the runtime centre at 100 minutes and make the
    // card a perfect runtime fit; its year is far from the anchors' and its
    // genre was never rated, so runtime is all it has — and runtime has no
    // sentence.
    const catalog = [
      title('anchor-1', { genres: ['comedy'], releaseYear: 1995, runtimeMinutes: 90 }),
      title('anchor-2', { genres: ['comedy'], releaseYear: 1995, runtimeMinutes: 100 }),
      title('anchor-3', { genres: ['comedy'], releaseYear: 1995, runtimeMinutes: 110 }),
      title('runtime-card', { genres: ['drama'], releaseYear: 1940, runtimeMinutes: 100 }),
    ];

    const result = rankTitlesV2(
      catalog,
      preference(),
      { 'anchor-1': rated('loved'), 'anchor-2': rated('loved'), 'anchor-3': rated('loved') },
      [],
    );

    const card = result.find((entry) => entry.id === 'runtime-card');

    expect(card?.reasonCode).toBe('none');
    expect(card?.reason).toBeNull();
  });

  it('keeps the vocabulary closed on the wire values this feature adds', () => {
    // The type is the vocabulary; this pins the wire values, so a new code has
    // to change this list and the backend's at the same time.
    expect([...VOCABULARY]).toEqual([
      'genre-picked',
      'genre-affinity',
      'era-affinity',
      'service',
      'none',
    ]);
  });
});
