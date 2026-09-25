import { TestBed } from '@angular/core/testing';
import { QuizState } from '../models/quiz';
import { createInitialQuizState } from '../../features/quiz/quiz-logic/quiz-rules';
import { PreferenceStore, QUIZ_STATE_STORAGE_KEY } from './preference-store';

describe('PreferenceStore', () => {
  let store: PreferenceStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(PreferenceStore);
  });

  afterEach(() => localStorage.clear());

  it('has no saved state for a first-time visitor', () => {
    expect(store.read()).toBeNull();
  });

  it('round-trips a document through storage (FR-010)', () => {
    const state = createInitialQuizState('2026-09-25T10:00:00.000Z');
    state.mediaType = { values: ['movie'], any: false };
    state.step = 2;

    store.write(state);
    const restored = store.read();

    expect(restored).not.toBeNull();
    expect(restored!.schemaVersion).toBe(1);
    expect(restored!.step).toBe(2);
    expect(restored!.mediaType.values).toEqual(['movie']);
    expect(restored!.status).toBe('in-progress');
  });

  it('refreshes updatedAt on every write (contract: newest-wins input)', () => {
    const state = createInitialQuizState('2026-09-25T10:00:00.000Z');
    store.write(state);

    expect(store.read()!.updatedAt).not.toBe('2026-09-25T10:00:00.000Z');
  });

  it('persists a completed document with its completedAt', () => {
    const state: QuizState = {
      ...createInitialQuizState('2026-09-25T10:00:00.000Z'),
      status: 'completed',
      completedAt: '2026-09-25T10:05:00.000Z',
    };

    store.write(state);

    expect(store.read()!.status).toBe('completed');
    expect(store.read()!.completedAt).toBe('2026-09-25T10:05:00.000Z');
  });

  it('treats unparseable JSON as a first visit and clears it', () => {
    localStorage.setItem(QUIZ_STATE_STORAGE_KEY, '{ not json');

    expect(store.read()).toBeNull();
    expect(localStorage.getItem(QUIZ_STATE_STORAGE_KEY)).toBeNull();
  });

  it('treats an unknown schemaVersion as a first visit', () => {
    localStorage.setItem(
      QUIZ_STATE_STORAGE_KEY,
      JSON.stringify({ ...createInitialQuizState('2026-09-25T10:00:00.000Z'), schemaVersion: 99 }),
    );

    expect(store.read()).toBeNull();
  });

  it('rejects a document whose Any chip is not exclusive', () => {
    localStorage.setItem(
      QUIZ_STATE_STORAGE_KEY,
      JSON.stringify({
        ...createInitialQuizState('2026-09-25T10:00:00.000Z'),
        mediaType: { values: ['movie'], any: true },
      }),
    );

    expect(store.read()).toBeNull();
  });

  it('rejects a completed document with no completedAt', () => {
    localStorage.setItem(
      QUIZ_STATE_STORAGE_KEY,
      JSON.stringify({
        ...createInitialQuizState('2026-09-25T10:00:00.000Z'),
        status: 'completed',
      }),
    );

    expect(store.read()).toBeNull();
  });

  it('rejects an unknown media type value', () => {
    localStorage.setItem(
      QUIZ_STATE_STORAGE_KEY,
      JSON.stringify({
        ...createInitialQuizState('2026-09-25T10:00:00.000Z'),
        mediaType: { values: ['podcast'], any: false },
      }),
    );

    expect(store.read()).toBeNull();
  });

  it('clears the saved document on request', () => {
    store.write(createInitialQuizState('2026-09-25T10:00:00.000Z'));
    store.clear();

    expect(store.read()).toBeNull();
  });

  it('keeps working when LocalStorage refuses to store (FR-010 best effort)', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    try {
      const state = createInitialQuizState('2026-09-25T10:00:00.000Z');
      expect(() => store.write(state)).not.toThrow();
      // The session continues from memory rather than losing the answers.
      expect(store.read()!.updatedAt).toBeDefined();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
