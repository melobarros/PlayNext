import { Interaction, InteractionDocument, WatchHistoryEntry } from './interaction';
import { Preference } from './quiz';

/**
 * The wire shapes for account state and the guest payload
 * (`specs/004-guest-auth-migration/contracts/api.md`).
 *
 * These are **transport** types, which is why they live here and not in
 * `interaction.ts` or `quiz.ts`. Those two files hold frozen device contracts,
 * and the server's shapes differ from both on purpose:
 *
 * - The device's quiz document is versioned and carries `status` and `step`;
 *   the account stores the *completed* preferences and has no use for the
 *   bookkeeping of getting there. Sending the stored document verbatim would
 *   ship device state into an account record.
 * - The device's interaction document carries its own `schemaVersion` and
 *   `updatedAt`; the account is a bare map.
 *
 * Narrowing here rather than at the server keeps the device contracts frozen,
 * which is what the 001/002 policy requires.
 */

/** The completed quiz as the API spells it: 001's `Preference` plus the comparator. */
export type PreferenceDocument = Preference & { updatedAt: string };

/**
 * The canonical state of an account, as `GET /me/state` and every auth
 * response return it.
 *
 * `preferences` is `null` for an account that never completed the quiz —
 * distinct from an empty one, because there is nothing to store until the
 * quiz is finished (data-model.md).
 */
export interface AccountState {
  interactions: Record<string, Interaction>;
  history: WatchHistoryEntry[];
  preferences: PreferenceDocument | null;
}

/**
 * The device's document as the merge's incoming side.
 *
 * Every field is optional: the same shape is the body of `POST /me/sync`,
 * where an omitted collection means "untouched" rather than "empty". The auth
 * endpoints send the full document, but a partial one is not a different type.
 */
export interface GuestStatePayload {
  interactions?: Record<string, Interaction>;
  history?: WatchHistoryEntry[];
  preferences?: PreferenceDocument | null;
}

/**
 * Narrows a stored interaction document to the wire payload, or `null` when
 * the device has nothing worth migrating.
 *
 * Returning `null` rather than an empty object is what lets the service omit
 * `guest` entirely (US1 scenario 4): a body that says "here is nothing" invites
 * the reader to believe the device was consulted and found empty, which is a
 * different claim from "this visitor never rated anything".
 */
export function toGuestState(
  interactions: InteractionDocument,
  preferences: PreferenceDocument | null,
): GuestStatePayload | null {
  const hasRatings = Object.keys(interactions.interactions).length > 0;
  const hasHistory = interactions.history.length > 0;
  const hasPreferences = preferences !== null;

  if (!hasRatings && !hasHistory && !hasPreferences) return null;

  const payload: GuestStatePayload = {};

  if (hasRatings) payload.interactions = interactions.interactions;
  if (hasHistory) payload.history = interactions.history;
  if (hasPreferences) payload.preferences = preferences;

  return payload;
}

/**
 * The stored quiz document as the wire's preference document, or `null`.
 *
 * **Only a completed quiz migrates.** An in-progress one stays on the device:
 * the deck and the ranking only ever read completed preferences, so uploading
 * half-answered questions would put rows in an account that nothing can use
 * (data-model.md).
 *
 * `updatedAt` falls back to `completedAt` for a document written before that
 * field was current — the comparator needs *a* timestamp, and the moment the
 * quiz finished is the honest one.
 */
export function toPreferenceDocument(state: {
  status: string;
  mediaType: Preference['mediaType'];
  genre: Preference['genre'];
  provider: Preference['provider'];
  includeUnownedProviders: boolean;
  completedAt?: string;
  updatedAt: string;
}): PreferenceDocument | null {
  if (state.status !== 'completed' || state.completedAt === undefined) return null;

  return {
    mediaType: state.mediaType,
    genre: state.genre,
    provider: state.provider,
    includeUnownedProviders: state.includeUnownedProviders,
    completedAt: state.completedAt,
    updatedAt: state.updatedAt,
  };
}
