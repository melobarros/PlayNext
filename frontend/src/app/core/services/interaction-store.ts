import { inject, Injectable } from '@angular/core';
import {
  emptyInteractionDocument,
  INTERACTION_SCHEMA_VERSION,
  INTERACTION_STATES,
  INTERACTION_STORAGE_KEY,
  Interaction,
  InteractionDocument,
  InteractionState,
  WatchHistoryEntry,
} from '../models/interaction';
import { WriteSink } from './write-sink';

/** ISO-8601 enough for our purposes: a string a `Date` can actually parse. */
function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** One stored rating. The title id is the key, not a field (see `interaction.ts`). */
function isInteraction(value: unknown): value is Interaction {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  const state = entry['state'];

  return (
    typeof state === 'string' &&
    (INTERACTION_STATES as readonly string[]).includes(state) &&
    isIsoString(entry['updatedAt'])
  );
}

function isHistoryEntry(value: unknown): value is WatchHistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;

  return typeof entry['titleId'] === 'string' && isIsoString(entry['chosenAt']);
}

/**
 * Shape check against the frozen persistence contract
 * (`specs/002-recommendation-deck/contracts/interaction-storage.md`).
 *
 * An unknown `state` invalidates the whole document rather than just that
 * entry: silently dropping it would change which titles are excluded, and a
 * wrong exclusion set is worse than starting over.
 */
export function isValidInteractionDocument(value: unknown): value is InteractionDocument {
  if (typeof value !== 'object' || value === null) return false;
  const document = value as Record<string, unknown>;

  if (document['schemaVersion'] !== INTERACTION_SCHEMA_VERSION) return false;
  if (!isIsoString(document['updatedAt'])) return false;

  const interactions = document['interactions'];
  if (typeof interactions !== 'object' || interactions === null || Array.isArray(interactions)) {
    return false;
  }
  if (!Object.values(interactions).every(isInteraction)) return false;

  const history = document['history'];
  if (!Array.isArray(history) || !history.every(isHistoryEntry)) return false;

  return true;
}

/**
 * Reads and writes the guest's ratings and watching history.
 *
 * Shaped after spec 001's `PreferenceStore`, with one deliberate difference:
 * `read()` returns an **empty document** rather than `null` when nothing is
 * saved. For quiz state, "no state" is a distinct condition that gates the
 * entry redirect; for interactions, "nothing rated yet" and "an empty record"
 * are the same thing, and returning a usable value spares every caller a
 * null check before it can rank anything.
 *
 * The exclusion set is never stored. Callers derive it from `interactions` at
 * read time, so re-rating a title changes its eligibility immediately and
 * there is no second list to keep in sync (research.md D2).
 */
@Injectable({ providedIn: 'root' })
export class InteractionStore {
  private readonly sink = inject(WriteSink);

  /** Used when LocalStorage is unavailable (blocked or private browsing). */
  private memoryFallback: string | null = null;

  /**
   * The saved document, or an empty one. Never `null`; never a shared
   * reference — each call parses a fresh copy, so a caller that edits what it
   * was handed cannot corrupt what is stored.
   */
  read(): InteractionDocument {
    const raw = this.readRaw();

    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isValidInteractionDocument(parsed)) return parsed;
      } catch {
        // Unparseable — fall through to the reset below.
      }

      // Unknown schema version or a malformed document: start fresh and let
      // the next write overwrite it (contract: readers treat it as absent).
      this.clear();
    }

    return emptyInteractionDocument();
  }

  /**
   * Records a rating, replacing any previous one for that title (003 FR-006).
   *
   * The timestamp is taken once, and the same value goes to the document and
   * to the sink. Two calls to `new Date()` would put a slightly earlier time on
   * the stored rating than on the change being pushed, and the server settles
   * conflicts by exactly that field — so a device could lose a race it should
   * have won by a few milliseconds of clock drift inside one method.
   */
  record(titleId: string, state: InteractionState): void {
    const updatedAt = new Date().toISOString();
    const document = this.read();

    document.interactions[titleId] = { state, updatedAt };
    this.write(document);

    this.sink.notify({ kind: 'rate', titleId, state, updatedAt });
  }

  /**
   * Records a Watch Now decision (FR-008).
   *
   * Both writes happen together on purpose. The `watchingNow` interaction and
   * its history entry are two halves of one decision, and splitting them into
   * two calls would let a caller land one without the other — leaving a title
   * that says it was watched with no entry in the log, or the reverse.
   */
  recordWatch(titleId: string): void {
    const now = new Date().toISOString();
    const document = this.read();

    document.interactions[titleId] = { state: 'watchingNow', updatedAt: now };
    document.history.push({ titleId, chosenAt: now });

    this.write(document);

    // Announced as the same two halves, for the same reason they are written
    // together: the account needs both the `watchingNow` rating the watchlist
    // reads and the log entry history is made of, and one without the other is
    // a decision only half recorded.
    this.sink.notify({ kind: 'rate', titleId, state: 'watchingNow', updatedAt: now });
    this.sink.notify({ kind: 'history', titleId, chosenAt: now });
  }

  /**
   * Removes a rating, returning the title to unrated (003 FR-005).
   *
   * **`history` is deliberately untouched.** The watching log records what
   * happened, not what the visitor currently thinks, so a title they watched
   * and later unrated keeps its entry (003 FR-008). Removal is the absence of a
   * rating, not the erasure of a decision that was made — and that is why this
   * is not implemented as "clear this title".
   *
   * Removing a title that was never rated is a no-op rather than an error: the
   * caller is stating a desired end state, and that state already holds.
   *
   * Absence is the whole mechanism. There is no tombstone value, because the
   * six-state vocabulary is the constitution's ubiquitous language and adding a
   * seventh to say "no rating" would be a contract change to express something
   * an absent key already expresses (research.md D2).
   */
  remove(titleId: string): void {
    const document = this.read();
    delete document.interactions[titleId];
    this.write(document);

    // A time is manufactured here because the device has none to offer: on the
    // device a removal *is* the absence this line just created, and absence
    // carries no clock. The server needs one to weigh the removal against the
    // account's rating (api.md) — without it, a removal replayed from a stale
    // queue could only ever win or always lose, and neither is right when a
    // second device re-rated the title in between.
    //
    // Announced even when nothing was removed. That looks like a no-op and is
    // one *locally*, but the claim being made — "unrated as of now" — is about
    // the account, which may be holding a rating this device has never seen.
    this.sink.notify({ kind: 'remove', titleId, updatedAt: new Date().toISOString() });
  }

  /**
   * Replaces the whole document with the account's canonical copy (research D7).
   *
   * The one write here that does not start from `read()`. Every other method is
   * a read-modify-write of the device's own document, because the device is the
   * only author — but once a session exists the server has merged both sides,
   * so its copy is the answer and copying it in is a replacement of the local
   * document rather than an edit to it.
   *
   * `schemaVersion` and `updatedAt` stay the store's own: they describe this
   * device's document, not the account's.
   */
  replace(interactions: Record<string, Interaction>, history: WatchHistoryEntry[]): void {
    this.write({ ...emptyInteractionDocument(), interactions, history });
  }

  clear(): void {
    this.memoryFallback = null;
    try {
      this.storage()?.removeItem(INTERACTION_STORAGE_KEY);
    } catch {
      // Nothing to do — the in-memory copy is already cleared.
    }
  }

  private write(document: InteractionDocument): void {
    const serialized = JSON.stringify({
      ...document,
      updatedAt: new Date().toISOString(),
    });

    try {
      this.storage()?.setItem(INTERACTION_STORAGE_KEY, serialized);
    } catch {
      // Non-fatal: the document stays in memory so the session continues.
    }
    this.memoryFallback = serialized;
  }

  private readRaw(): string | null {
    try {
      const stored = this.storage()?.getItem(INTERACTION_STORAGE_KEY);
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
