import { Injectable } from '@angular/core';
import {
  createDeckSession,
  DECK_SESSION_SCHEMA_VERSION,
  DECK_SESSION_STORAGE_KEY,
  DeckSession,
} from '../models/deck-session';

/** ISO-8601 enough for our purposes: a string a `Date` can actually parse. */
function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * Shape check for the loop document. Deliberately does **not** verify the
 * ids against the catalog: the store has no catalog and should not want one.
 * An id the catalog no longer knows is harmless — ranking never produces it,
 * so it simply never matches anything (data-model.md validation rule 4).
 */
export function isValidDeckSession(value: unknown): value is DeckSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Record<string, unknown>;

  if (session['schemaVersion'] !== DECK_SESSION_SCHEMA_VERSION) return false;
  if (!isIsoString(session['startedAt'])) return false;

  const shown = session['shownTitleIds'];
  return Array.isArray(shown) && shown.every((id) => typeof id === 'string');
}

/**
 * Reads and writes the running loop.
 *
 * Follows `PreferenceStore`'s read/write shape, but note the one place it
 * deliberately differs from `InteractionStore`: **`write` does not refresh a
 * timestamp.** `InteractionDocument.updatedAt` records when the document last
 * changed, because 004 merges two of them. Here `startedAt` *identifies* the
 * loop, so refreshing it on every advance would make each card look like the
 * start of a new loop. The session is stored exactly as handed over.
 *
 * `clear()` is private, unlike its two siblings. Starting a new loop overwrites
 * rather than erases, so nothing in this slice needs to erase a session — and
 * an unused public method would be dead code (constitution, engineering
 * standards).
 */
@Injectable({ providedIn: 'root' })
export class DeckSessionStore {
  /** Used when LocalStorage is unavailable (blocked or private browsing). */
  private memoryFallback: string | null = null;

  /**
   * The saved loop, or a fresh one. Never `null`, and never a shared
   * reference — each call parses a fresh copy.
   *
   * A corrupt or unrecognised session is discarded rather than repaired: the
   * worst case is that the visitor sees a card they already saw, which is a far
   * better outcome than refusing to show the deck at all.
   */
  read(): DeckSession {
    const raw = this.readRaw();

    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isValidDeckSession(parsed)) return parsed;
      } catch {
        // Unparseable — fall through to the reset below.
      }

      this.clear();
    }

    return createDeckSession();
  }

  /** Stores the loop exactly as given — see the note on `startedAt` above. */
  write(session: DeckSession): void {
    const serialized = JSON.stringify(session);

    try {
      this.storage()?.setItem(DECK_SESSION_STORAGE_KEY, serialized);
    } catch {
      // Non-fatal: the loop continues from memory for this session.
    }
    this.memoryFallback = serialized;
  }

  private clear(): void {
    this.memoryFallback = null;
    try {
      this.storage()?.removeItem(DECK_SESSION_STORAGE_KEY);
    } catch {
      // Nothing to do — the in-memory copy is already cleared.
    }
  }

  private readRaw(): string | null {
    try {
      const stored = this.storage()?.getItem(DECK_SESSION_STORAGE_KEY);
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
