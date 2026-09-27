/**
 * The running recommendation loop (002).
 *
 * Deliberately separate from `playnext:interactions`: this document is
 * throwaway. "Start a new loop" discards it, spec 003 never reads it, and spec
 * 004 has no reason to migrate it. Mixing it into the durable document would
 * make starting a new loop a partial write against the visitor's ratings — the
 * one thing that must never be lost (research.md D3).
 */

/** LocalStorage key for the ephemeral loop. **Not** part of any migration. */
export const DECK_SESSION_STORAGE_KEY = 'playnext:deck-session';

/** The only schema version this build understands. */
export const DECK_SESSION_SCHEMA_VERSION = 1;

export interface DeckSession {
  schemaVersion: 1;
  /** ISO-8601; identifies the loop. */
  startedAt: string;
  /**
   * Titles the visitor has **advanced past** in this loop (FR-010).
   *
   * Note what is *absent*: the current card is not a field. It is derived —
   * `rankTitles(...)` minus this list, taking the first result. Because
   * ranking is deterministic (FR-011), recomputing after a refresh yields the
   * same card the visitor was looking at, with no cursor to persist and no
   * risk of a stored cursor disagreeing with the ranked list (research.md D5).
   */
  shownTitleIds: string[];
}

/** A fresh loop: nothing shown yet. */
export function createDeckSession(now: Date | string = new Date()): DeckSession {
  return {
    schemaVersion: DECK_SESSION_SCHEMA_VERSION,
    startedAt: typeof now === 'string' ? now : now.toISOString(),
    shownTitleIds: [],
  };
}
