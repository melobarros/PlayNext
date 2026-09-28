import { TestBed } from '@angular/core/testing';
import { emptyInteractionDocument, INTERACTION_STORAGE_KEY } from '../models/interaction';
import { SyncOperation } from '../models/sync';
import { InteractionStore } from './interaction-store';
import { WriteSink } from './write-sink';

/**
 * Contract tests for the guest's interaction document
 * (`specs/002-recommendation-deck/contracts/interaction-storage.md`).
 *
 * Spec 003 builds the watchlist on this document and 004 migrates it, so the
 * fail-safe read rules matter more than the happy path: a document that is
 * partially trusted would silently change which titles are excluded.
 */
describe('InteractionStore', () => {
  let store: InteractionStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(InteractionStore);
  });

  afterEach(() => localStorage.clear());

  /**
   * A brand-new store, deliberately not the one DI hands out.
   *
   * The point of it is a store with no memory fallback and no history, so that
   * whatever it reads it must have read from LocalStorage. Wrapped in an
   * injection context because the store injects the write sink (research D9),
   * which is the one thing about it that Angular has to supply.
   */
  function freshStore(): InteractionStore {
    return TestBed.runInInjectionContext(() => new InteractionStore());
  }

  describe('a first visit', () => {
    it('starts empty rather than absent', () => {
      const document = store.read();

      expect(document.schemaVersion).toBe(1);
      expect(document.interactions).toEqual({});
      expect(document.history).toEqual([]);
    });
  });

  describe('fail-safe reads (data-model.md validation rules)', () => {
    it('treats an unknown schemaVersion as absent and clears it', () => {
      localStorage.setItem(
        INTERACTION_STORAGE_KEY,
        JSON.stringify({
          ...emptyInteractionDocument('2026-09-26T14:30:00.000Z'),
          schemaVersion: 2,
        }),
      );

      expect(store.read().interactions).toEqual({});
      expect(localStorage.getItem(INTERACTION_STORAGE_KEY)).toBeNull();
    });

    it('treats unparseable JSON as absent and clears it', () => {
      localStorage.setItem(INTERACTION_STORAGE_KEY, '{ not json');

      expect(store.read().interactions).toEqual({});
      expect(localStorage.getItem(INTERACTION_STORAGE_KEY)).toBeNull();
    });

    it('rejects a document containing an unknown state', () => {
      // Silently ignoring the bad entry would change which titles are excluded,
      // which is worse than starting over.
      localStorage.setItem(
        INTERACTION_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          interactions: { arrival: { state: 'adored', updatedAt: '2026-09-26T14:30:00.000Z' } },
          history: [],
          updatedAt: '2026-09-26T14:30:00.000Z',
        }),
      );

      expect(store.read().interactions).toEqual({});
    });

    it('rejects a document whose history is not an array', () => {
      localStorage.setItem(
        INTERACTION_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          interactions: {},
          history: { arrival: '2026-09-26T14:30:00.000Z' },
          updatedAt: '2026-09-26T14:30:00.000Z',
        }),
      );

      expect(store.read().history).toEqual([]);
    });

    it('rejects a document whose updatedAt is not an ISO-8601 string', () => {
      localStorage.setItem(
        INTERACTION_STORAGE_KEY,
        JSON.stringify({ schemaVersion: 1, interactions: {}, history: [], updatedAt: 'whenever' }),
      );

      expect(store.read().updatedAt).not.toBe('whenever');
    });
  });

  describe('recording a rating', () => {
    it('round-trips a rating through storage (FR-007)', () => {
      store.record('arrival', 'loved');

      expect(store.read().interactions['arrival'].state).toBe('loved');
    });

    it('replaces an entry on re-rating rather than appending (003 FR-006)', () => {
      store.record('arrival', 'loved');
      store.record('arrival', 'disliked');

      const document = store.read();
      expect(Object.keys(document.interactions)).toEqual(['arrival']);
      expect(document.interactions['arrival'].state).toBe('disliked');
    });

    it('keeps one entry per title across many titles', () => {
      store.record('arrival', 'loved');
      store.record('inception', 'liked');
      store.record('parasite', 'wantToWatch');

      expect(Object.keys(store.read().interactions).sort()).toEqual([
        'arrival',
        'inception',
        'parasite',
      ]);
    });
  });

  describe('recording Watch Now (FR-008)', () => {
    it('writes a watchingNow interaction and exactly one history entry', () => {
      store.recordWatch('arrival');

      const document = store.read();
      expect(document.interactions['arrival'].state).toBe('watchingNow');
      expect(document.history).toEqual([{ titleId: 'arrival', chosenAt: expect.any(String) }]);
    });

    it('keeps history when the title is later re-rated (append-only log)', () => {
      store.recordWatch('arrival');
      store.record('arrival', 'liked');

      const document = store.read();
      expect(document.history).toHaveLength(1);
      expect(document.interactions['arrival'].state).toBe('liked');
    });

    it('lets the same title be watched twice — history is a log, not a set', () => {
      store.recordWatch('arrival');
      store.recordWatch('arrival');

      expect(store.read().history).toHaveLength(2);
    });
  });

  describe('removing a rating (003 FR-005)', () => {
    it('deletes the entry, returning the title to unrated', () => {
      store.record('arrival', 'loved');
      store.record('inception', 'liked');

      store.remove('arrival');

      // Absent means unrated, which is what makes the deck treat it as
      // eligible again (003 FR-007) with no extra bookkeeping.
      expect(store.read().interactions['arrival']).toBeUndefined();
      expect(Object.keys(store.read().interactions)).toEqual(['inception']);
    });

    it('does not touch the watching history (003 FR-008)', () => {
      // The history is a log of what happened, not of what the visitor
      // currently thinks. This is the guarantee most at risk from a removal
      // implemented as "clear this title".
      store.recordWatch('arrival');
      store.record('inception', 'liked');

      store.remove('arrival');

      const document = store.read();
      expect(document.history).toEqual([{ titleId: 'arrival', chosenAt: expect.any(String) }]);
      expect(document.interactions['arrival']).toBeUndefined();
      expect(document.interactions['inception'].state).toBe('liked');
    });

    it('is a no-op for a title that was never rated, not an error', () => {
      store.record('inception', 'liked');

      expect(() => store.remove('never-rated')).not.toThrow();

      expect(Object.keys(store.read().interactions)).toEqual(['inception']);
    });

    it('refreshes updatedAt like every other write', () => {
      store.record('arrival', 'loved');
      localStorage.setItem(
        INTERACTION_STORAGE_KEY,
        JSON.stringify({ ...store.read(), updatedAt: '2020-01-01T00:00:00.000Z' }),
      );

      store.remove('arrival');

      expect(store.read().updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('writes a document the validator still accepts', () => {
      // Read back through a *fresh* store, so the shape is re-validated rather
      // than served from a memory fallback. A removal that produced a document
      // 002 would reject would silently wipe every other rating.
      store.record('arrival', 'loved');
      store.record('inception', 'liked');

      store.remove('arrival');

      const reread = freshStore().read();
      expect(reread.interactions['inception'].state).toBe('liked');
      expect(Object.keys(reread.interactions)).toEqual(['inception']);
    });

    it('leaves nothing behind for a re-rating to disagree with', () => {
      store.record('arrival', 'disliked');
      store.remove('arrival');
      store.record('arrival', 'loved');

      const document = store.read();
      expect(Object.keys(document.interactions)).toEqual(['arrival']);
      expect(document.interactions['arrival'].state).toBe('loved');
    });
  });

  describe('write semantics', () => {
    it('refreshes updatedAt on every write (004 last-write-wins input)', () => {
      localStorage.setItem(
        INTERACTION_STORAGE_KEY,
        JSON.stringify(emptyInteractionDocument('2020-01-01T00:00:00.000Z')),
      );

      store.record('arrival', 'loved');
      store.record('inception', 'liked');

      expect(store.read().updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('persists across store instances, not just in memory', () => {
      store.record('arrival', 'loved');

      expect(freshStore().read().interactions['arrival'].state).toBe('loved');
    });
  });

  describe('readers never mutate (contract: ownership rules)', () => {
    it('hands out a copy, so editing it cannot corrupt the stored document', () => {
      store.record('arrival', 'loved');

      const borrowed = store.read();
      borrowed.interactions['arrival'].state = 'disliked';
      borrowed.interactions['inception'] = {
        state: 'loved',
        updatedAt: '2026-09-26T14:30:00.000Z',
      };
      borrowed.history.push({ titleId: 'ghost', chosenAt: '2026-09-26T14:30:00.000Z' });

      const reread = store.read();
      expect(reread.interactions['arrival'].state).toBe('loved');
      expect(reread.interactions['inception']).toBeUndefined();
      expect(reread.history).toEqual([]);
    });

    it('does not mutate a snapshot a caller is still holding', () => {
      store.record('arrival', 'loved');
      const held = store.read();

      store.record('inception', 'liked');

      expect(held.interactions['inception']).toBeUndefined();
      expect(Object.keys(held.interactions)).toEqual(['arrival']);
    });
  });

  describe('the write sink (research D9)', () => {
    let sink: WriteSink;
    let seen: SyncOperation[];
    let stop: () => void;

    beforeEach(() => {
      sink = TestBed.inject(WriteSink);
      seen = [];
      stop = sink.observe((operation) => seen.push(operation));
    });

    afterEach(() => stop());

    it('announces a rating with the timestamp it actually stored', () => {
      store.record('arrival', 'loved');

      // The timestamp is the load-bearing field: the server settles a conflict
      // by comparing it against the account's, so an operation carrying a
      // different one would lose a race this device's write should have won.
      const stored = store.read().interactions['arrival'];

      expect(seen).toEqual([
        { kind: 'rate', titleId: 'arrival', state: 'loved', updatedAt: stored.updatedAt },
      ]);
    });

    it('announces a Watch Now decision as both of its halves (FR-008)', () => {
      store.recordWatch('arrival');

      // The interaction and the log entry are one decision recorded twice.
      // Sending only the interaction leaves the account's watching log short an
      // entry the device has; sending only the history leaves it without the
      // `watchingNow` rating the watchlist reads.
      const stored = store.read();

      expect(seen).toEqual([
        {
          kind: 'rate',
          titleId: 'arrival',
          state: 'watchingNow',
          updatedAt: stored.interactions['arrival'].updatedAt,
        },
        {
          kind: 'history',
          titleId: 'arrival',
          chosenAt: stored.history[0].chosenAt,
        },
      ]);
    });

    it('announces a removal as a removal, carrying a time of its own', () => {
      store.record('arrival', 'loved');
      seen.length = 0;

      store.remove('arrival');

      // On the device a removal is an *absence*, and an absence has no time to
      // compare. It has to be given one here, or the server cannot weigh it
      // against the account's rating and the removal either always wins or
      // always loses (api.md).
      expect(seen).toEqual([{ kind: 'remove', titleId: 'arrival', updatedAt: expect.any(String) }]);
    });

    it('says nothing when it is the account writing its own state back', () => {
      // `replace` is the server's copy arriving, not a decision by the visitor.
      // Announcing it would push the account's own state straight back at it —
      // and since the push's success handler is what calls `replace`, one sync
      // would trigger the next, forever.
      store.replace({ arrival: { state: 'loved', updatedAt: '2026-09-27T10:00:00.000Z' } }, []);

      expect(seen).toEqual([]);
    });

    it('says nothing when the document is cleared on sign-out', () => {
      store.record('arrival', 'loved');
      seen.length = 0;

      store.clear();

      // Sign-out discards the device's copy of the account's data (SC-007). It
      // is not a change to the account, and announcing it would resurrect a
      // rating the visitor has just walked away from.
      expect(seen).toEqual([]);
    });

    it('stops announcing once the observer is removed', () => {
      stop();
      store.record('arrival', 'loved');

      expect(seen).toEqual([]);
    });
  });

  describe('LocalStorage unavailable (contract: failure semantics)', () => {
    it('keeps working when LocalStorage refuses to write, without throwing', () => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error('QuotaExceededError');
      };

      try {
        expect(() => store.record('arrival', 'loved')).not.toThrow();
        // The session continues from memory rather than losing the rating.
        expect(store.read().interactions['arrival'].state).toBe('loved');
      } finally {
        Storage.prototype.setItem = original;
      }
    });

    it('reads as empty when LocalStorage throws on access', () => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = () => {
        throw new Error('SecurityError');
      };

      try {
        expect(() => store.read()).not.toThrow();
        expect(store.read().interactions).toEqual({});
      } finally {
        Storage.prototype.getItem = original;
      }
    });
  });
});
