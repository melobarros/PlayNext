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

/** Where a recorded rating can be found again (003 FR-003). */
export type WatchlistSurface = 'wantToWatch' | 'loved' | 'disliked' | 'history';

interface WatchlistSurfaceDefinition {
  id: WatchlistSurface;
  /** The visitor-facing name of the tab or screen. */
  label: string;
  /** Every state this surface lists. */
  states: readonly InteractionState[];
  /**
   * `tab` renders in the watchlist's tab strip; `log` is the watching-history
   * screen, which is a separate destination rather than a fourth tab.
   */
  kind: 'tab' | 'log';
}

/**
 * **Which surface each state appears on.** The one table the tabs, the re-rate
 * control and the empty-state logic all read, so they cannot disagree
 * (research.md D3).
 *
 * Two rows reconcile a vocabulary of six states with a product that offers
 * three tabs. `liked` sits with `loved`, which is how the PRD already described
 * the Loved tab. `notInterested` sits with `disliked`, which the clarification
 * of 2026-09-26 settled: leaving it out made a rating the visitor could record
 * and then never find again — a dead end, which the constitution's Principle II
 * forbids. Each entry still carries its own label, so a merged tab is never
 * ambiguous about which of the two it is.
 *
 * `watchingNow` appears in no tab by design (003 FR-004): it is set only by the
 * deck's Watch Now action. Its surface is the history, which is why the history
 * is part of this table rather than a fourth state bucket invented elsewhere.
 *
 * **The invariant this table must never break**: every state in
 * `INTERACTION_STATES` appears here exactly once. A state with no surface is
 * stored and then invisible, and `interaction.spec.ts` fails if one is added
 * without a home.
 */
export const WATCHLIST_SURFACES: readonly WatchlistSurfaceDefinition[] = [
  { id: 'wantToWatch', label: 'Want to Watch', states: ['wantToWatch'], kind: 'tab' },
  { id: 'loved', label: 'Loved', states: ['loved', 'liked'], kind: 'tab' },
  { id: 'disliked', label: 'Disliked', states: ['disliked', 'notInterested'], kind: 'tab' },
  { id: 'history', label: 'History', states: ['watchingNow'], kind: 'log' },
];

/** The three surfaces the watchlist renders as tabs, in tab-strip order. */
export const WATCHLIST_TABS: readonly WatchlistSurfaceDefinition[] = WATCHLIST_SURFACES.filter(
  (surface) => surface.kind === 'tab',
);

/** The surface a state is listed on. Total by construction — see the table. */
export function surfaceFor(state: InteractionState): WatchlistSurface {
  const surface = WATCHLIST_SURFACES.find((candidate) => candidate.states.includes(state));

  // Unreachable while the invariant above holds; throwing beats returning a
  // plausible default that would hide a state from the visitor.
  if (surface === undefined) throw new Error(`No watchlist surface for state "${state}"`);

  return surface.id;
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
