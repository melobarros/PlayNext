import {
  emptyInteractionDocument,
  INTERACTION_STATE_LABELS,
  InteractionDocument,
  InteractionState,
  WATCHLIST_SURFACES,
  WATCHLIST_TABS,
  WatchlistSurface,
} from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { groupBySurface, historyEntries, watchlistEntries } from './entries';

/**
 * Tests for the watchlist's derived view.
 *
 * Everything here is a pure function over `(document, catalog)`, which is the
 * point: grouping, ordering and lookup have no DOM and no Angular, so they can
 * be proven — including at a scale the UI cannot reach — before any component
 * exists.
 *
 * **What "500+ entries" does and does not prove here.** The catalog holds 48
 * titles, so 500 ratings cannot be produced by clicking; the document is built
 * directly, which is honest (it is the state the requirement names) but skips
 * nothing the visitor could do. What this file establishes is that the
 * *grouping* stays correct at that size. Whether 500 rows scroll smoothly is a
 * rendering question with no answer in jsdom, and it is recorded as a manual
 * browser check rather than claimed here (research.md D7).
 */

function title(id: string, overrides: Partial<MediaTitle> = {}): MediaTitle {
  return {
    id,
    title: `Title ${id}`,
    releaseYear: 2024,
    mediaType: 'movie',
    genres: [],
    synopsis: '',
    rating: 8,
    voteCount: 100,
    availability: [],
    ...overrides,
  };
}

function documentWith(
  ratings: readonly { titleId: string; state: InteractionState; updatedAt: string }[],
  history: readonly { titleId: string; chosenAt: string }[] = [],
): InteractionDocument {
  return {
    ...emptyInteractionDocument('2026-09-26T00:00:00.000Z'),
    interactions: Object.fromEntries(
      ratings.map((rating) => [
        rating.titleId,
        { state: rating.state, updatedAt: rating.updatedAt },
      ]),
    ),
    history: [...history],
  };
}

describe('watchlist entries', () => {
  describe('deriving an entry', () => {
    it('carries the state, its label, when it changed, and the title', () => {
      const document = documentWith([
        { titleId: 'arrival', state: 'loved', updatedAt: '2026-09-26T10:00:00.000Z' },
      ]);

      const [entry] = watchlistEntries(document, [title('arrival', { releaseYear: 2016 })]);

      expect(entry.titleId).toBe('arrival');
      expect(entry.state).toBe('loved');
      expect(entry.stateLabel).toBe(INTERACTION_STATE_LABELS['loved']);
      expect(entry.updatedAt).toBe('2026-09-26T10:00:00.000Z');
      expect(entry.title?.releaseYear).toBe(2016);
    });

    it('lists a rated title the catalog no longer knows, as unavailable', () => {
      // Milestone 2 makes this reachable: the catalog becomes a TMDB response
      // whose contents change between visits. The entry must not throw and must
      // not silently vanish — an entry the visitor can see is always one they
      // can remove (data-model.md).
      const document = documentWith([
        { titleId: 'delisted', state: 'wantToWatch', updatedAt: '2026-09-26T10:00:00.000Z' },
      ]);

      const entries = watchlistEntries(document, [title('arrival')]);

      expect(entries).toHaveLength(1);
      expect(entries[0].title).toBeNull();
      expect(entries[0].state).toBe('wantToWatch');
    });

    it('resolves each entry against its own id, not the first match', () => {
      const document = documentWith([
        { titleId: 'a', state: 'loved', updatedAt: '2026-09-26T10:00:00.000Z' },
        { titleId: 'b', state: 'liked', updatedAt: '2026-09-26T11:00:00.000Z' },
      ]);

      const entries = watchlistEntries(document, [title('a'), title('b')]);
      const byId = Object.fromEntries(entries.map((entry) => [entry.titleId, entry.title?.id]));

      expect(byId).toEqual({ a: 'a', b: 'b' });
    });

    it('is empty for a visitor who has rated nothing', () => {
      // `read()` never returns null, so an empty watchlist is a property of the
      // data rather than a null check in every tab.
      expect(watchlistEntries(emptyInteractionDocument(), [])).toEqual([]);
    });
  });

  describe('ordering', () => {
    it('lists the most recently rated first', () => {
      const document = documentWith([
        { titleId: 'old', state: 'loved', updatedAt: '2026-09-20T10:00:00.000Z' },
        { titleId: 'newest', state: 'liked', updatedAt: '2026-09-26T10:00:00.000Z' },
        { titleId: 'middle', state: 'disliked', updatedAt: '2026-09-24T10:00:00.000Z' },
      ]);

      expect(watchlistEntries(document, []).map((entry) => entry.titleId)).toEqual([
        'newest',
        'middle',
        'old',
      ]);
    });

    it('breaks ties by id, so the order never depends on map insertion', () => {
      // Two ratings can land in the same millisecond. Without a tie-break the
      // order would follow `Object.entries`, which is a property of how the
      // document was written, not of anything the visitor did.
      const at = '2026-09-26T10:00:00.000Z';
      const forwards = documentWith([
        { titleId: 'alpha', state: 'loved', updatedAt: at },
        { titleId: 'beta', state: 'liked', updatedAt: at },
      ]);
      const backwards = documentWith([
        { titleId: 'beta', state: 'liked', updatedAt: at },
        { titleId: 'alpha', state: 'loved', updatedAt: at },
      ]);

      expect(watchlistEntries(forwards, []).map((entry) => entry.titleId)).toEqual([
        'alpha',
        'beta',
      ]);
      expect(watchlistEntries(backwards, []).map((entry) => entry.titleId)).toEqual([
        'alpha',
        'beta',
      ]);
    });
  });

  describe('grouping by surface', () => {
    it('puts every entry on exactly one surface', () => {
      const document = documentWith([
        { titleId: 'a', state: 'wantToWatch', updatedAt: '2026-09-26T10:00:00.000Z' },
        { titleId: 'b', state: 'loved', updatedAt: '2026-09-26T10:00:00.000Z' },
        { titleId: 'c', state: 'liked', updatedAt: '2026-09-26T10:00:00.000Z' },
        { titleId: 'd', state: 'disliked', updatedAt: '2026-09-26T10:00:00.000Z' },
        { titleId: 'e', state: 'notInterested', updatedAt: '2026-09-26T10:00:00.000Z' },
        { titleId: 'f', state: 'watchingNow', updatedAt: '2026-09-26T10:00:00.000Z' },
      ]);

      const grouped = groupBySurface(watchlistEntries(document, []));
      const ids = (surface: WatchlistSurface) => grouped[surface].map((entry) => entry.titleId);

      // Equal timestamps, so each bucket keeps the id tie-break's order. The
      // positives share one tab and the rejections the other; `wantToWatch` has
      // been in the first bucket since its own tab was removed (2026-09-30).
      expect(ids('loved')).toEqual(['a', 'b', 'c']);
      expect(ids('disliked')).toEqual(['d', 'e']);
      expect(ids('history')).toEqual(['f']);
    });

    it('keeps each entry’s own state inside a merged tab', () => {
      // FR-001 merges two states per tab. The tab says which *bucket* an entry
      // is in; only the entry says which of the two it is, which is why the row
      // renders `stateLabel` rather than the tab's label.
      const document = documentWith([
        { titleId: 'loved-one', state: 'loved', updatedAt: '2026-09-26T12:00:00.000Z' },
        { titleId: 'liked-one', state: 'liked', updatedAt: '2026-09-26T11:00:00.000Z' },
      ]);

      const grouped = groupBySurface(watchlistEntries(document, []));

      expect(grouped.loved.map((entry) => entry.state)).toEqual(['loved', 'liked']);
      expect(grouped.loved.map((entry) => entry.stateLabel)).toEqual(['Loved It', 'Liked It']);
    });

    it('has a bucket for every surface, empty ones included', () => {
      // The tabs render from these keys; a missing bucket would be a crash
      // rather than an empty state.
      const grouped = groupBySurface([]);

      expect(Object.keys(grouped).sort()).toEqual(
        WATCHLIST_SURFACES.map((surface) => surface.id).sort(),
      );
      for (const surface of WATCHLIST_SURFACES) {
        expect(grouped[surface.id]).toEqual([]);
      }
    });

    it('loses no entry, and invents none', () => {
      const document = documentWith(
        (['loved', 'liked', 'disliked', 'notInterested', 'wantToWatch', 'watchingNow'] as const).map(
          (state, index) => ({
            titleId: `t${index}`,
            state,
            updatedAt: '2026-09-26T10:00:00.000Z',
          }),
        ),
      );

      const entries = watchlistEntries(document, []);
      const grouped = groupBySurface(entries);
      const regrouped = WATCHLIST_SURFACES.flatMap((surface) => grouped[surface.id]);

      expect(regrouped).toHaveLength(entries.length);
      expect(new Set(regrouped.map((entry) => entry.titleId)).size).toBe(entries.length);
    });

    it('derives each tab’s badge count from the list it renders', () => {
      // data-model.md: badges are derived, not counted separately, so a badge
      // cannot disagree with the list beneath it. There is deliberately no
      // `countFor()` to test — the count *is* the bucket's length, and this
      // pins the property that makes that true.
      const counts = (document: InteractionDocument) => {
        const grouped = groupBySurface(watchlistEntries(document, []));
        return Object.fromEntries(WATCHLIST_TABS.map((tab) => [tab.id, grouped[tab.id].length]));
      };

      expect(
        counts(
          documentWith([
            { titleId: 'a', state: 'wantToWatch', updatedAt: '2026-09-26T10:00:00.000Z' },
            { titleId: 'b', state: 'liked', updatedAt: '2026-09-26T10:00:00.000Z' },
          ]),
        ),
      ).toEqual({ loved: 2, disliked: 0 });

      // One new rating moves exactly one tab by exactly one — the property a
      // separately-maintained counter is most likely to break.
      expect(
        counts(
          documentWith([
            { titleId: 'a', state: 'wantToWatch', updatedAt: '2026-09-26T10:00:00.000Z' },
            { titleId: 'b', state: 'liked', updatedAt: '2026-09-26T10:00:00.000Z' },
            { titleId: 'c', state: 'loved', updatedAt: '2026-09-26T11:00:00.000Z' },
          ]),
        ),
      ).toEqual({ loved: 3, disliked: 0 });
    });

    it('keeps the ordering within each surface', () => {
      const document = documentWith([
        { titleId: 'older', state: 'loved', updatedAt: '2026-09-20T10:00:00.000Z' },
        { titleId: 'newer', state: 'liked', updatedAt: '2026-09-26T10:00:00.000Z' },
      ]);

      const grouped = groupBySurface(watchlistEntries(document, []));

      expect(grouped.loved.map((entry) => entry.titleId)).toEqual(['newer', 'older']);
    });
  });

  describe('history (003 FR-008)', () => {
    it('lists a watched title with when it was chosen', () => {
      const document = documentWith(
        [],
        [{ titleId: 'arrival', chosenAt: '2026-09-26T21:00:00.000Z' }],
      );

      const [entry] = historyEntries(document, [title('arrival')]);

      expect(entry.titleId).toBe('arrival');
      expect(entry.chosenAt).toBe('2026-09-26T21:00:00.000Z');
      expect(entry.title?.id).toBe('arrival');
    });

    it('shows the newest decision first', () => {
      const document = documentWith(
        [],
        [
          { titleId: 'first', chosenAt: '2026-09-20T10:00:00.000Z' },
          { titleId: 'third', chosenAt: '2026-09-26T10:00:00.000Z' },
          { titleId: 'second', chosenAt: '2026-09-24T10:00:00.000Z' },
        ],
      );

      expect(historyEntries(document, []).map((entry) => entry.titleId)).toEqual([
        'third',
        'second',
        'first',
      ]);
    });

    it('keeps both entries when the same title is watched twice', () => {
      // History is a log, not a set — a visitor can decide to watch something
      // twice, and both decisions happened.
      const document = documentWith(
        [],
        [
          { titleId: 'arrival', chosenAt: '2026-09-20T10:00:00.000Z' },
          { titleId: 'arrival', chosenAt: '2026-09-26T10:00:00.000Z' },
        ],
      );

      const entries = historyEntries(document, [title('arrival')]);

      expect(entries).toHaveLength(2);
      expect(new Set(entries.map((entry) => entry.key)).size).toBe(2);
    });

    it('gives every entry a stable key, even for repeats at the same instant', () => {
      // `@for` needs unique keys, and a title watched twice in the same
      // millisecond is a real (if unlikely) state. The key is derived from the
      // entry's position in the append-only log, which never shifts for an
      // existing entry — so it is unique *and* survives re-sorting.
      const chosenAt = '2026-09-26T10:00:00.000Z';
      const document = documentWith(
        [],
        [
          { titleId: 'arrival', chosenAt },
          { titleId: 'arrival', chosenAt },
        ],
      );

      const entries = historyEntries(document, []);
      const keys = entries.map((entry) => entry.key);

      expect(new Set(keys).size).toBe(keys.length);
    });

    it('lists a watched title the catalog no longer knows', () => {
      const document = documentWith([], [{ titleId: 'delisted', chosenAt: '2026-09-26T10:00:00Z' }]);

      expect(historyEntries(document, [])[0].title).toBeNull();
    });

    it('is empty when nothing has been watched', () => {
      expect(historyEntries(emptyInteractionDocument(), [])).toEqual([]);
    });
  });

  describe('at scale (FR-011, SC-005)', () => {
    const SIZE = 500;

    function bigDocument(): InteractionDocument {
      const states: InteractionState[] = [
        'loved',
        'liked',
        'disliked',
        'notInterested',
        'wantToWatch',
        'watchingNow',
      ];

      return documentWith(
        Array.from({ length: SIZE }, (_, index) => ({
          titleId: `t${index}`,
          state: states[index % states.length],
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        })),
      );
    }

    it('groups every entry correctly', () => {
      const grouped = groupBySurface(watchlistEntries(bigDocument(), []));

      const total = WATCHLIST_SURFACES.reduce(
        (sum, surface) => sum + grouped[surface.id].length,
        0,
      );

      expect(total).toBe(SIZE);
      // 500 = 6 x 83 + 2, so the first two states in the cycle appear 84 times
      // and the rest 83. The merged tabs sum their states rather than sharing a
      // count, which is what makes 251 and 166 different numbers.
      expect(grouped.loved).toHaveLength(251); // loved 84 + liked 84 + wantToWatch 83
      expect(grouped.disliked).toHaveLength(166); // disliked 83 + notInterested 83
      expect(grouped.history).toHaveLength(83);
    });

    it('keeps every surface in newest-first order', () => {
      const grouped = groupBySurface(watchlistEntries(bigDocument(), []));

      for (const surface of WATCHLIST_SURFACES) {
        const stamps = grouped[surface.id].map((entry) => entry.updatedAt);
        expect([...stamps].sort().reverse()).toEqual(stamps);
      }
    });
  });

  describe('purity', () => {
    it('does not mutate the document it was given', () => {
      const document = documentWith([
        { titleId: 'arrival', state: 'loved', updatedAt: '2026-09-26T10:00:00.000Z' },
      ]);
      const before = JSON.stringify(document);

      watchlistEntries(document, [title('arrival')]);
      historyEntries(document, [title('arrival')]);

      expect(JSON.stringify(document)).toBe(before);
    });

    it('does not mutate the catalog it was given', () => {
      // The document's reads are copies, and the catalog's are detached
      // (`CatalogService.loadTitles`). Sorting a caller's array in place would
      // break that promise from the other side.
      const catalog = [title('a'), title('b'), title('c')];
      const order = catalog.map((entry) => entry.id);

      watchlistEntries(
        documentWith([
          { titleId: 'c', state: 'loved', updatedAt: '2026-09-26T10:00:00.000Z' },
          { titleId: 'a', state: 'liked', updatedAt: '2026-09-26T09:00:00.000Z' },
        ]),
        catalog,
      );

      expect(catalog.map((entry) => entry.id)).toEqual(order);
    });
  });
});
