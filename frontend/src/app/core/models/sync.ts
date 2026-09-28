import { GuestStatePayload, PreferenceDocument, RemovalPayload } from './account-state';
import {
  Interaction,
  INTERACTION_STATES,
  InteractionState,
  WatchHistoryEntry,
} from './interaction';

/**
 * The offline write queue (`specs/004-guest-auth-migration/contracts/device-storage.md`)
 * and the fold that turns it into a sync body.
 *
 * Queued operations are **whole decisions, not deltas**. That is the property
 * the whole offline story rests on: every operation is self-contained and
 * carries its own timestamp, so replaying one is idempotent under the server's
 * newest-wins rule — an operation that lost a race simply loses again, and a
 * retried replay changes nothing. Deltas would need an ordering protocol the
 * constitution's YAGNI principle does not pay for (research D7).
 *
 * A guest's writes never come near this file. There is no account to reach, so
 * nothing is queued and `SyncService` is never asked.
 */

/** LocalStorage key for the operations awaiting the account. */
export const SYNC_PENDING_STORAGE_KEY = 'playnext:sync-pending';

/** The only queue schema version this build understands. */
export const SYNC_SCHEMA_VERSION = 1;

/** A rating, recorded on the device at `updatedAt`. */
export interface RateOperation {
  kind: 'rate';
  titleId: string;
  state: InteractionState;
  updatedAt: string;
}

/**
 * An unrating (FR-006).
 *
 * The timestamp is the whole point of the operation existing separately. A
 * rating is expressed by a title's presence and a removal by its absence, so
 * without a time to compare, a removal replayed from a stale queue could only
 * ever win or always lose — and neither is right when a second device re-rated
 * the title in the meantime.
 */
export interface RemoveOperation {
  kind: 'remove';
  titleId: string;
  updatedAt: string;
}

/** A Watch Now decision (FR-008). */
export interface HistoryOperation {
  kind: 'history';
  titleId: string;
  chosenAt: string;
}

/** A completed quiz, replaced whole (research D4). */
export interface PreferencesOperation {
  kind: 'preferences';
  preferences: PreferenceDocument;
}

export type SyncOperation =
  RateOperation | RemoveOperation | HistoryOperation | PreferencesOperation;

export interface SyncPendingDocument {
  schemaVersion: number;
  operations: SyncOperation[];
}

export function emptyPendingDocument(): SyncPendingDocument {
  return { schemaVersion: SYNC_SCHEMA_VERSION, operations: [] };
}

function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isOperation(value: unknown): value is SyncOperation {
  if (typeof value !== 'object' || value === null) return false;
  const operation = value as Record<string, unknown>;

  switch (operation['kind']) {
    case 'rate':
      return (
        typeof operation['titleId'] === 'string' &&
        typeof operation['state'] === 'string' &&
        (INTERACTION_STATES as readonly string[]).includes(operation['state']) &&
        isIsoString(operation['updatedAt'])
      );

    case 'remove':
      return typeof operation['titleId'] === 'string' && isIsoString(operation['updatedAt']);

    case 'history':
      return typeof operation['titleId'] === 'string' && isIsoString(operation['chosenAt']);

    case 'preferences':
      return typeof operation['preferences'] === 'object' && operation['preferences'] !== null;

    default:
      return false;
  }
}

/**
 * Shape check for the stored queue. An unknown version, unparseable JSON or an
 * unrecognized operation discards the **whole** queue rather than the one entry,
 * matching the 001/002 fail-safe rule: replaying a partially-understood queue
 * would apply some of a visitor's changes and silently drop the rest, and the
 * device's own copy of those changes is still intact either way.
 */
export function isValidPendingDocument(value: unknown): value is SyncPendingDocument {
  if (typeof value !== 'object' || value === null) return false;
  const document = value as Record<string, unknown>;

  if (document['schemaVersion'] !== SYNC_SCHEMA_VERSION) return false;
  if (!Array.isArray(document['operations'])) return false;

  return document['operations'].every(isOperation);
}

/**
 * Folds the queue, in order, into one body for `POST /me/sync`.
 *
 * The fold is what lets the queue's operations stay dumb. Two operations on one
 * title are not a conflict to resolve here so much as a sequence to follow: the
 * later one is what this device last believed, so it is what goes on the wire.
 * The result never names a title in both `interactions` and `removals` — the
 * server refuses that with a 400, precisely because a body carrying both has
 * already thrown away the ordering that would settle it.
 *
 * The server still applies newest-wins against the *account*, which may have
 * moved on since. Folding only answers "what did this device decide, in the
 * end?", and it must not try to answer more: a device cannot know what another
 * one did while it was offline.
 */
export function toSyncBody(operations: readonly SyncOperation[]): GuestStatePayload {
  const claims = new Map<string, RateOperation | RemoveOperation>();
  const history: WatchHistoryEntry[] = [];
  const seenHistory = new Set<string>();
  let preferences: PreferenceDocument | null = null;

  for (const operation of operations) {
    switch (operation.kind) {
      case 'rate':
      case 'remove': {
        const previous = claims.get(operation.titleId);

        // `>=` rather than `>`: on a tie the later operation in the queue wins,
        // because it is the one that actually happened second on this device.
        // The server's tie rule goes the other way — the account wins — and it
        // is answering a different question, about two devices rather than one.
        if (previous === undefined || operation.updatedAt >= previous.updatedAt) {
          claims.set(operation.titleId, operation);
        }

        break;
      }

      case 'history': {
        const key = `${operation.titleId}\u0000${operation.chosenAt}`;

        if (!seenHistory.has(key)) {
          seenHistory.add(key);
          history.push({ titleId: operation.titleId, chosenAt: operation.chosenAt });
        }

        break;
      }

      case 'preferences': {
        // The quiz is replaced whole, never field-merged (research D4), so the
        // newest document is the only one worth sending.
        if (preferences === null || operation.preferences.updatedAt >= preferences.updatedAt) {
          preferences = operation.preferences;
        }

        break;
      }
    }
  }

  const interactions: Record<string, Interaction> = {};
  const removals: RemovalPayload[] = [];

  for (const [titleId, claim] of claims) {
    if (claim.kind === 'rate') {
      interactions[titleId] = { state: claim.state, updatedAt: claim.updatedAt };
    } else {
      removals.push({ titleId, updatedAt: claim.updatedAt });
    }
  }

  // Absent rather than empty, for the same reason `toGuestState` returns null:
  // an empty collection is a claim about the account, and a queue that happens
  // to hold only ratings has said nothing about history.
  const body: GuestStatePayload = {};

  if (Object.keys(interactions).length > 0) body.interactions = interactions;
  if (removals.length > 0) body.removals = removals;
  if (history.length > 0) body.history = history;
  if (preferences !== null) body.preferences = preferences;

  return body;
}
