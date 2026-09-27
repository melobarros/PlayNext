import { TestBed } from '@angular/core/testing';
import { emptyInteractionDocument, INTERACTION_STORAGE_KEY } from '../models/interaction';
import { InteractionStore } from './interaction-store';

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

      expect(new InteractionStore().read().interactions['arrival'].state).toBe('loved');
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
