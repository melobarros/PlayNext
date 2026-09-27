/**
 * The visitor's recorded decisions about titles (002), and the frozen storage
 * contract behind them
 * (`specs/002-recommendation-deck/contracts/interaction-storage.md`).
 *
 * The six states are the constitution's ubiquitous language: the same
 * vocabulary crosses the deck (002), the watchlist (003), and the API
 * (Milestone 2). Renaming one is a contract change.
 */

/** The rating vocabulary. A swipe is a neutral skip and records none of these. */
export type InteractionState =
  'loved' | 'liked' | 'disliked' | 'wantToWatch' | 'notInterested' | 'watchingNow';

/** Every valid state, for validation and iteration. */
export const INTERACTION_STATES: readonly InteractionState[] = [
  'loved',
  'liked',
  'disliked',
  'wantToWatch',
  'notInterested',
  'watchingNow',
];

/**
 * The visitor-facing wording for each state, kept next to the state it
 * describes — the same arrangement as `MEDIA_TYPE_LABELS` in `quiz.ts`.
 *
 * These are the action-bar labels (FR-007) and the Match Found wording. They
 * live here so the button text and the value it records cannot drift apart:
 * one table, one place to rename.
 */
export const INTERACTION_STATE_LABELS: Record<InteractionState, string> = {
  loved: 'Loved It',
  liked: 'Liked It',
  disliked: 'Disliked',
  wantToWatch: 'Want to Watch',
  notInterested: 'Not Interested',
  watchingNow: 'Watch Now',
};

/**
 * The five actions a card offers (FR-007), in the order they are shown.
 *
 * `watchingNow` is deliberately absent: it is not a rating. Ratings judge a
 * title and move on; Watch Now stops the loop and opens Match Found, which is a
 * different kind of action and is rendered apart from these.
 */
export const RATING_ACTIONS: readonly { state: InteractionState; label: string }[] = (
  ['loved', 'liked', 'disliked', 'wantToWatch', 'notInterested'] as const
).map((state) => ({ state, label: INTERACTION_STATE_LABELS[state] }));

/**
 * **Only `disliked` and `notInterested` exclude a title** from suggestions
 * (FR-009).
 *
 * Every other state — including `loved` and `wantToWatch` — leaves the title
 * eligible to be suggested again. That is what lets spec 003's "un-dislike"
 * work with no extra bookkeeping: change the state, and the title is eligible
 * on the next ranking.
 */
export const EXCLUDING_STATES: readonly InteractionState[] = ['disliked', 'notInterested'];

/** Whether a state removes its title from future suggestions. */
export function isExcluding(state: InteractionState): boolean {
  return EXCLUDING_STATES.includes(state);
}

/**
 * One rating. Re-rating replaces it — one entry per title, by construction.
 *
 * Note what is **absent**: `titleId`. The title is the key in
 * `InteractionDocument.interactions`, and the stored entry holds only the
 * state and its timestamp. Carrying the id inside the value as well would
 * create two places for it to live and therefore a way for them to disagree —
 * exactly the class of bug the keyed-map shape exists to prevent. Callers that
 * need the id iterate `Object.entries(...)`.
 *
 * `WatchHistoryEntry` below *does* carry a `titleId`, because it is an array
 * element and has no key to inherit one from.
 */
export interface Interaction {
  state: InteractionState;
  /** ISO-8601. Replaced on every re-rating. */
  updatedAt: string;
}

/**
 * A Watch Now decision. **Append-only**: re-rating the title later does not
 * remove the entry, and the same title may legitimately appear more than once
 * — a visitor can decide to watch something twice.
 *
 * Streaming links are deliberately not stored here: spec 003 requires them to
 * be refreshed from current availability when an entry is reopened, so the
 * entry holds the decision and the catalog holds the links.
 */
export interface WatchHistoryEntry {
  titleId: string;
  /** ISO-8601, set when Watch Now is tapped. */
  chosenAt: string;
}

/**
 * The persisted document at `playnext:interactions`.
 *
 * The exclusion set is **derived** from `interactions` at read time and MUST
 * NOT be stored as a separate list: a stored list would need a second write on
 * every rating, re-rating and removal, and would drift (research.md D2).
 */
export interface InteractionDocument {
  schemaVersion: 1;
  /** Keyed by `titleId` — one rating per title, structurally guaranteed. */
  interactions: Record<string, Interaction>;
  /** Append-only log of Watch Now decisions. */
  history: WatchHistoryEntry[];
  /** ISO-8601; refreshed on every write. Used for last-write-wins in 004. */
  updatedAt: string;
}

/** The only schema version this build understands. */
export const INTERACTION_SCHEMA_VERSION = 1;

/** LocalStorage key for the guest's ratings and watching history. */
export const INTERACTION_STORAGE_KEY = 'playnext:interactions';

/** A visitor who has rated nothing yet. */
export function emptyInteractionDocument(now: Date | string = new Date()): InteractionDocument {
  return {
    schemaVersion: INTERACTION_SCHEMA_VERSION,
    interactions: {},
    history: [],
    updatedAt: typeof now === 'string' ? now : now.toISOString(),
  };
}
