import { Injectable } from '@angular/core';
import { DimensionChoice, QuizState } from '../models/quiz';

/** LocalStorage key for the guest's single persisted quiz document. */
export const QUIZ_STATE_STORAGE_KEY = 'playnext:quiz-state';

/** The only schema version this build understands. */
export const QUIZ_STATE_SCHEMA_VERSION = 1;

function isDimensionChoice(value: unknown): value is DimensionChoice<string> {
  if (typeof value !== 'object' || value === null) return false;
  const choice = value as Record<string, unknown>;
  return (
    Array.isArray(choice['values']) &&
    choice['values'].every((entry) => typeof entry === 'string') &&
    typeof choice['any'] === 'boolean'
  );
}

/**
 * Shape check against the frozen persistence contract
 * (`specs/001-onboarding-quiz/contracts/preference-storage.md`). A document
 * that fails this check is treated as "no saved state".
 */
export function isValidQuizState(value: unknown): value is QuizState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;

  if (state['schemaVersion'] !== QUIZ_STATE_SCHEMA_VERSION) return false;
  if (state['status'] !== 'in-progress' && state['status'] !== 'completed') return false;

  const step = state['step'];
  if (step !== 1 && step !== 2 && step !== 3) return false;

  const mediaType = state['mediaType'];
  const genre = state['genre'];
  const provider = state['provider'];
  if (!isDimensionChoice(mediaType) || !isDimensionChoice(genre) || !isDimensionChoice(provider)) {
    return false;
  }
  if (mediaType.values.some((value) => value !== 'movie' && value !== 'tv' && value !== 'anime')) {
    return false;
  }

  // The "Any / No preference" chip is exclusive (FR-005).
  for (const choice of [mediaType, genre, provider]) {
    if (choice.any && choice.values.length > 0) return false;
  }

  if (typeof state['includeUnownedProviders'] !== 'boolean') return false;
  if (typeof state['updatedAt'] !== 'string') return false;
  if (state['status'] === 'completed' && typeof state['completedAt'] !== 'string') return false;

  return true;
}

/**
 * Reads and writes the guest's quiz document in browser LocalStorage.
 *
 * Behaviour is fixed by the persistence contract: unknown schema versions and
 * unparseable JSON reset to a first visit, `updatedAt` is refreshed on every
 * write, and write failures are non-fatal (the session keeps working from
 * memory rather than crashing).
 */
@Injectable({ providedIn: 'root' })
export class PreferenceStore {
  /** Used when LocalStorage is unavailable (blocked or private browsing). */
  private memoryFallback: string | null = null;

  read(): QuizState | null {
    const raw = this.readRaw();
    if (raw === null) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValidQuizState(parsed)) return parsed;
    } catch {
      // Unparseable — fall through to the reset below.
    }

    // Unknown schema version, unparseable JSON, or a malformed document:
    // start fresh, and let the next write overwrite it.
    this.clear();
    return null;
  }

  write(state: QuizState): void {
    const document: QuizState = { ...state, updatedAt: new Date().toISOString() };
    const serialized = JSON.stringify(document);

    try {
      this.storage()?.setItem(QUIZ_STATE_STORAGE_KEY, serialized);
      this.memoryFallback = serialized;
    } catch {
      // Non-fatal: keep the latest state in memory so the session continues.
      this.memoryFallback = serialized;
    }
  }

  clear(): void {
    this.memoryFallback = null;
    try {
      this.storage()?.removeItem(QUIZ_STATE_STORAGE_KEY);
    } catch {
      // Nothing to do — the in-memory copy is already cleared.
    }
  }

  private readRaw(): string | null {
    try {
      const stored = this.storage()?.getItem(QUIZ_STATE_STORAGE_KEY);
      if (stored !== null && stored !== undefined) return stored;
    } catch {
      // Fall back to memory below.
    }
    return this.memoryFallback;
  }

  /** Returns LocalStorage, or null when the browser refuses to provide it. */
  private storage(): Storage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }
}
