import { Interaction } from '../../../../core/models/interaction';
import { MediaTitle } from '../../../../core/models/media-title';
import { Preference } from '../../../../core/models/quiz';
import { TelemetryActionKind } from '../../../../core/models/telemetry';
import { replaySession } from './replay';
import { FixtureEvent, FixtureSession, Ranker, RankerInput } from './types';

/**
 * The temporal replay (T039).
 *
 * The replay's job is to hand each ranker the state a real deck would have
 * handed it, so the assertions here are about *inputs*, not about scores: a
 * recording ranker captures what it was given at every decision, which is the
 * only way to see the state the replay built without exporting its internals.
 */

const BASE = '2026-10-01T10:00:00.000Z';

/** A timestamp `seconds` after the session opened, so the log reads in order. */
function at(seconds: number): string {
  return new Date(Date.parse(BASE) + seconds * 1000).toISOString();
}

function title(id: string, genres: string[] = ['action']): MediaTitle {
  return {
    id,
    title: id,
    releaseYear: 2020,
    mediaType: 'movie',
    genres,
    synopsis: '',
    rating: 7,
    voteCount: 1000,
    availability: [{ providerId: 'netflix', deepLinkUrl: 'https://example.invalid/watch' }],
  };
}

/** Twelve eligible titles, so a top ten is a truncation and not the whole pool. */
const CATALOG: readonly MediaTitle[] = Array.from({ length: 12 }, (_, index) => title(`t${index}`));

const PREFERENCE: Preference = {
  mediaType: { values: [], any: true },
  genre: { values: ['action'], any: false },
  provider: { values: ['netflix'], any: false },
  includeUnownedProviders: false,
  completedAt: BASE,
};

function shown(titleId: string, seconds: number): FixtureEvent {
  return { type: 'impression', titleId, shownAt: at(seconds) };
}

function did(titleId: string, kind: TelemetryActionKind, seconds: number): FixtureEvent {
  return { type: 'action', titleId, kind, occurredAt: at(seconds) };
}

function session(
  events: FixtureEvent[],
  initialInteractions: Record<string, Interaction> = {},
): FixtureSession {
  return { sessionId: 'session-1', preference: PREFERENCE, initialInteractions, events };
}

/** A ranker that records what it was asked and offers the catalog's first ten. */
class RecordingRanker implements Ranker {
  readonly name = 'recorder';
  readonly engineVersion = 'recorder-v1';
  readonly inputs: RankerInput[] = [];

  rank(input: RankerInput): readonly MediaTitle[] {
    // Copied, not referenced: the replay owns its working state and is free to
    // keep mutating it, and a test that held a live reference would pass while
    // every decision saw the session's final state.
    this.inputs.push({
      ...input,
      interactions: { ...input.interactions },
      shownTitleIds: [...input.shownTitleIds],
    });

    return input.catalog.slice(0, 10);
  }
}

describe('the state at each impression', () => {
  it('is exactly the prior actions’ effects', () => {
    const recorder = new RecordingRanker();

    replaySession(
      session([
        shown('t0', 0),
        did('t0', 'liked', 1),
        shown('t1', 2),
        did('t1', 'skip', 3),
        shown('t2', 4),
        did('t2', 'disliked', 5),
        shown('t3', 6),
      ]),
      CATALOG,
      recorder,
    );

    expect(recorder.inputs).toHaveLength(4);

    expect(recorder.inputs[0].interactions).toEqual({});
    expect(recorder.inputs[0].shownTitleIds).toEqual([]);

    // The timestamp is the action's own `occurredAt`, not the replay's clock.
    expect(recorder.inputs[1].interactions).toEqual({
      t0: { state: 'liked', updatedAt: at(1) },
    });
    expect(recorder.inputs[1].shownTitleIds).toEqual(['t0']);

    // A skip writes no interaction and still leaves the deck.
    expect(recorder.inputs[2].shownTitleIds).toEqual(['t0', 't1']);

    expect(recorder.inputs[3].interactions).toEqual({
      t0: { state: 'liked', updatedAt: at(1) },
      t2: { state: 'disliked', updatedAt: at(5) },
    });
    expect(recorder.inputs[3].shownTitleIds).toEqual(['t0', 't1', 't2']);
  });

  it('arrives with the ratings the visitor already had', () => {
    const recorder = new RecordingRanker();
    const earlier: Interaction = { state: 'wantToWatch', updatedAt: at(-600) };

    replaySession(session([shown('t0', 0)], { t5: earlier }), CATALOG, recorder);

    expect(recorder.inputs[0].interactions).toEqual({ t5: earlier });
  });
});

describe('undo', () => {
  it('restores the state the visitor had before the action it answers', () => {
    // The visitor arrived with t2 saved (synced from another device, say). The
    // session rated it, then undid that rating — and what the next card is
    // ranked against has to be the saved state again, not an empty one.
    const earlier: Interaction = { state: 'wantToWatch', updatedAt: at(-600) };
    const recorder = new RecordingRanker();

    replaySession(
      session(
        [
          shown('t2', 0),
          did('t2', 'liked', 1),
          shown('t3', 2),
          did('t2', 'undo', 3),
          shown('t2', 4),
        ],
        { t2: earlier },
      ),
      CATALOG,
      recorder,
    );

    expect(recorder.inputs[1].interactions['t2']).toEqual({
      state: 'liked',
      updatedAt: at(1),
    });

    // Undone: the like is gone, the earlier save is back, and the title is no
    // longer a title that left the deck.
    expect(recorder.inputs[2].interactions['t2']).toEqual(earlier);
    expect(recorder.inputs[2].shownTitleIds).toEqual([]);
  });

  it('removes a rating that had nothing before it', () => {
    const recorder = new RecordingRanker();

    replaySession(
      session([
        shown('t0', 0),
        did('t0', 'disliked', 1),
        shown('t1', 2),
        did('t0', 'undo', 3),
        shown('t1', 4),
      ]),
      CATALOG,
      recorder,
    );

    expect(recorder.inputs[1].interactions).toEqual({
      t0: { state: 'disliked', updatedAt: at(1) },
    });
    expect(recorder.inputs[1].shownTitleIds).toEqual(['t0']);

    expect(recorder.inputs[2].interactions).toEqual({});
    expect(recorder.inputs[2].shownTitleIds).toEqual([]);
  });
});

describe('watch_now', () => {
  it('ends the session and does not add the title to the walk', () => {
    const decisions = replaySession(
      session([
        shown('t0', 0),
        did('t0', 'liked', 1),
        shown('t1', 2),
        did('t1', 'watch_now', 3),
        shown('t2', 4),
        did('t2', 'liked', 5),
      ]),
      CATALOG,
      new RecordingRanker(),
    );

    expect(decisions.map((decision) => decision.titleId)).toEqual(['t0', 't1']);

    // It is a label — the visitor chose it — but the walk stopped there.
    expect(decisions[1].labels).toEqual(new Set(['t1']));
  });
});

describe('labels', () => {
  it('are later likes and watch-nows only', () => {
    const decisions = replaySession(
      session([
        shown('t0', 0),
        did('t0', 'skip', 1),
        shown('t1', 2),
        did('t1', 'liked', 3),
        shown('t2', 4),
        did('t2', 'disliked', 5),
        shown('t3', 6),
      ]),
      CATALOG,
      new RecordingRanker(),
    );

    // A skip and a dislike say what not to show; only a like says what to show.
    expect(decisions[0].labels).toEqual(new Set(['t1']));

    // The like that answers this very card is a label — the visitor was shown
    // t1 and wanted it; the dislike two events later is not.
    expect(decisions[1].labels).toEqual(new Set(['t1']));

    // Only a dislike followed, which is not something to have retrieved.
    expect(decisions[2].labels.size).toBe(0);

    // "Later" is later, not later-or-earlier: t3 came after the like.
    expect(decisions[3].labels.size).toBe(0);
  });

  it('exclude ratings the visitor brought with them', () => {
    // A rated title is filtered out of the pool, so it could never be
    // retrieved; counting it as a miss would grade every ranker on a card
    // nobody could have been shown.
    const decisions = replaySession(
      session([shown('t0', 0)], {
        t5: { state: 'liked', updatedAt: at(-600) },
      }),
      CATALOG,
      new RecordingRanker(),
    );

    expect(decisions[0].labels.size).toBe(0);
  });
});

describe('determinism', () => {
  it('produces deep-equal decisions from two replays of the same session', () => {
    const events: FixtureEvent[] = [
      shown('t0', 0),
      did('t0', 'liked', 1),
      shown('t1', 2),
      did('t1', 'skip', 3),
      shown('t2', 4),
      did('t2', 'undo', 5),
      shown('t2', 6),
      did('t2', 'watch_now', 7),
    ];

    const first = replaySession(session(events), CATALOG, new RecordingRanker());
    const second = replaySession(session(events), CATALOG, new RecordingRanker());

    expect(first).toEqual(second);
  });
});
