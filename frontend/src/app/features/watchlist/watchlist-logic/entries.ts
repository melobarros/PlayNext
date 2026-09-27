import {
  INTERACTION_STATE_LABELS,
  InteractionDocument,
  InteractionState,
  surfaceFor,
  WATCHLIST_SURFACES,
  WatchlistSurface,
} from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';

/**
 * The watchlist's derived view (003).
 *
 * **No Angular here, and no component.** Grouping, ordering and catalog lookup
 * are pure functions over `(document, catalog)`, which is what lets them be
 * proven at a scale the UI cannot reach and re-proven in Milestone 2 when the
 * catalog stops being a local array. The components read these results; they do
 * not re-derive them, so a tab's badge and the list beneath it cannot disagree
 * (data-model.md).
 *
 * Nothing in this file writes. The document's single writer is
 * `InteractionStore`, and a second writer — even a well-meaning one — is how
 * two components start disagreeing about what is stored.
 */

/** One rated title, as a watchlist row needs it. */
export interface WatchlistEntry {
  titleId: string;
  state: InteractionState;
  /** The visitor-facing name of *this entry's* state, not of its tab. */
  stateLabel: string;
  /** ISO-8601; when the rating was last changed. */
  updatedAt: string;
  /**
   * The catalog's copy, or `null` when the catalog does not know this id.
   *
   * **`null` is a normal state, not an error.** Milestone 2 makes the catalog a
   * TMDB response whose contents change between visits, so a rated title can
   * legitimately disappear. The entry is still listed — an entry the visitor
   * can see is always one they can remove, and hiding it would strand the
   * rating with no way back (Principle II: never a dead end).
   */
  title: MediaTitle | null;
}

/** One Watch Now decision, as the history screen needs it. */
export interface HistoryEntryView {
  /**
   * Unique and stable, for `@for` to match rows by.
   *
   * Derived from the entry's position in the append-only log rather than from
   * its contents: the same title may be watched twice, and two decisions could
   * in principle share a millisecond, but no two entries share a position.
   */
  key: string;
  titleId: string;
  /** ISO-8601; when Watch Now was tapped. */
  chosenAt: string;
  /** As in `WatchlistEntry` — `null` when the catalog no longer knows the id. */
  title: MediaTitle | null;
}

/**
 * Code-unit order, deliberately **not** `localeCompare`.
 *
 * `localeCompare` is locale-sensitive: the same two ids can order differently
 * on two machines, or in two browsers, which would make ordering here
 * non-deterministic — the one property the constitution forbids outright
 * (Principle VI). Code-unit order is the same everywhere.
 */
function byCodepoint(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Built once per call: a 500-entry list would otherwise scan the catalog 500 times. */
function titleLookup(catalog: readonly MediaTitle[]): Map<string, MediaTitle> {
  return new Map(catalog.map((title) => [title.id, title]));
}

/**
 * Every rating, newest first.
 *
 * Ordering is by `updatedAt` descending with the title id as a tie-break, so
 * the same document always produces the same list. The tie-break is not
 * decoration: two ratings can land in the same millisecond, and without it the
 * order would follow `Object.entries`, which is a property of how the document
 * was serialized rather than of anything the visitor did.
 *
 * Timestamps are parsed once, up front, rather than inside the comparator —
 * `sort` runs thousands of comparisons on a long list, and re-parsing in the
 * hot path would be the same work repeated. Parsing also means the comparison
 * is chronological rather than lexicographic, so a hand-edited document
 * carrying a UTC offset still orders correctly. (The store's validator accepts
 * any `Date`-parseable string, even though `record()` only ever writes
 * `toISOString()` output.)
 */
export function watchlistEntries(
  document: InteractionDocument,
  catalog: readonly MediaTitle[],
): WatchlistEntry[] {
  const titles = titleLookup(catalog);

  const scored = Object.entries(document.interactions).map(([titleId, interaction]) => ({
    titleId,
    interaction,
    time: Date.parse(interaction.updatedAt),
  }));

  scored.sort((a, b) => b.time - a.time || byCodepoint(a.titleId, b.titleId));

  return scored.map(({ titleId, interaction }) => ({
    titleId,
    state: interaction.state,
    stateLabel: INTERACTION_STATE_LABELS[interaction.state],
    updatedAt: interaction.updatedAt,
    title: titles.get(titleId) ?? null,
  }));
}

/**
 * The entries for each surface, in the order `watchlistEntries` produced.
 *
 * Every surface gets a bucket whether or not it has entries, so a tab renders
 * an empty state rather than crashing on a missing key.
 *
 * One bucket per surface is also what makes the tab badges honest: a badge is
 * its bucket's length, computed from the same grouping the list renders, so
 * there is no second count that could drift.
 */
export function groupBySurface(
  entries: readonly WatchlistEntry[],
): Record<WatchlistSurface, WatchlistEntry[]> {
  // The one cast in this file. Building the buckets from `WATCHLIST_SURFACES`
  // rather than from a hand-written literal keeps this in step with the table:
  // a new surface appears here by existing there, not by someone remembering.
  const grouped = {} as Record<WatchlistSurface, WatchlistEntry[]>;

  for (const surface of WATCHLIST_SURFACES) grouped[surface.id] = [];
  for (const entry of entries) grouped[surfaceFor(entry.state)].push(entry);

  return grouped;
}

/**
 * The watching history, newest first (003 FR-008).
 *
 * The same title may appear more than once and both decisions are kept: the
 * history records what happened, not what the visitor currently thinks, which
 * is why removing a rating leaves it alone.
 *
 * Streaming links are deliberately not carried here. 003 requires them to be
 * refreshed from current availability when an entry is reopened, so the log
 * holds the decision and the catalog holds the links.
 */
export function historyEntries(
  document: InteractionDocument,
  catalog: readonly MediaTitle[],
): HistoryEntryView[] {
  const titles = titleLookup(catalog);

  const scored = document.history.map((entry, index) => ({
    entry,
    index,
    time: Date.parse(entry.chosenAt),
  }));

  // Equal timestamps keep log order rather than reversing: the later index is
  // the later decision, and preserving that is the honest reading.
  scored.sort((a, b) => b.time - a.time || a.index - b.index);

  return scored.map(({ entry, index }) => ({
    key: `${index}:${entry.titleId}`,
    titleId: entry.titleId,
    chosenAt: entry.chosenAt,
    title: titles.get(entry.titleId) ?? null,
  }));
}
