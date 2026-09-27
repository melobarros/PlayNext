import { TestBed } from '@angular/core/testing';
import { createDeckSession, DECK_SESSION_STORAGE_KEY } from '../models/deck-session';
import { DeckSessionStore } from './deck-session-store';

/**
 * Contract tests for the ephemeral loop document.
 *
 * This document is throwaway — "start a new loop" discards it and 004 never
 * migrates it — so the rules under test are narrower than the interaction
 * document's. What matters is that a corrupt session fails safe (an empty loop
 * is a fine outcome) and that nothing here can ever endanger the visitor's
 * ratings, which live in a separate key (research.md D3).
 */
describe('DeckSessionStore', () => {
  let store: DeckSessionStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(DeckSessionStore);
  });

  afterEach(() => localStorage.clear());

  it('starts an empty loop for a first-time visitor', () => {
    const session = store.read();

    expect(session.schemaVersion).toBe(1);
    expect(session.shownTitleIds).toEqual([]);
    expect(Number.isNaN(Date.parse(session.startedAt))).toBe(false);
  });

  it('round-trips a loop through storage (FR-010)', () => {
    store.write({ ...createDeckSession('2026-09-26T10:00:00.000Z'), shownTitleIds: ['arrival'] });

    expect(store.read().shownTitleIds).toEqual(['arrival']);
  });

  it('preserves an id the catalog does not know (it simply never matches)', () => {
    // The store has no catalog to check against, and it should not want one:
    // an unrecognised id is harmless because ranking never produces it.
    store.write({
      ...createDeckSession('2026-09-26T10:00:00.000Z'),
      shownTitleIds: ['a-title-we-retired-last-year'],
    });

    expect(store.read().shownTitleIds).toEqual(['a-title-we-retired-last-year']);
  });

  it('keeps startedAt as given, so advancing is not mistaken for a new loop', () => {
    store.write({ ...createDeckSession('2026-09-26T10:00:00.000Z'), shownTitleIds: ['arrival'] });

    expect(store.read().startedAt).toBe('2026-09-26T10:00:00.000Z');
  });

  it('resets shownTitleIds and startedAt when a new loop begins', () => {
    store.write({
      ...createDeckSession('2020-01-01T00:00:00.000Z'),
      shownTitleIds: ['arrival', 'inception'],
    });

    store.write(createDeckSession());

    const session = store.read();
    expect(session.shownTitleIds).toEqual([]);
    expect(session.startedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  describe('fail-safe reads', () => {
    it('treats an unknown schemaVersion as absent and clears it', () => {
      localStorage.setItem(
        DECK_SESSION_STORAGE_KEY,
        JSON.stringify({ ...createDeckSession('2026-09-26T10:00:00.000Z'), schemaVersion: 3 }),
      );

      expect(store.read().shownTitleIds).toEqual([]);
      expect(localStorage.getItem(DECK_SESSION_STORAGE_KEY)).toBeNull();
    });

    it('treats unparseable JSON as absent and clears it', () => {
      localStorage.setItem(DECK_SESSION_STORAGE_KEY, '{ not json');

      expect(store.read().shownTitleIds).toEqual([]);
      expect(localStorage.getItem(DECK_SESSION_STORAGE_KEY)).toBeNull();
    });

    it('rejects a shownTitleIds that is not an array of strings', () => {
      localStorage.setItem(
        DECK_SESSION_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          startedAt: '2026-09-26T10:00:00.000Z',
          shownTitleIds: [{ id: 'arrival' }],
        }),
      );

      expect(store.read().shownTitleIds).toEqual([]);
    });

    it('rejects a startedAt that is not an ISO-8601 string', () => {
      localStorage.setItem(
        DECK_SESSION_STORAGE_KEY,
        JSON.stringify({ schemaVersion: 1, startedAt: 'yesterday', shownTitleIds: [] }),
      );

      expect(store.read().startedAt).not.toBe('yesterday');
    });

    it('hands out a copy, so editing it cannot corrupt the stored loop', () => {
      store.write({ ...createDeckSession('2026-09-26T10:00:00.000Z'), shownTitleIds: ['arrival'] });

      store.read().shownTitleIds.push('inception');

      expect(store.read().shownTitleIds).toEqual(['arrival']);
    });
  });

  describe('LocalStorage unavailable (contract: failure semantics)', () => {
    it('keeps working when LocalStorage refuses to write, without throwing', () => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error('QuotaExceededError');
      };

      try {
        expect(() => store.write(createDeckSession('2026-09-26T10:00:00.000Z'))).not.toThrow();
        // A lost session is survivable: the loop restarts at the top of the
        // ranking rather than the deck failing to render.
        expect(store.read().shownTitleIds).toEqual([]);
      } finally {
        Storage.prototype.setItem = original;
      }
    });
  });
});
