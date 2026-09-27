# Data Model: Ratings & Watchlist

**Feature**: 003 | **Date**: 2026-09-26

**This feature adds no persisted entity.** Every fact the watchlist shows is
already stored by 002 in `playnext:interactions`, or already in the catalog. So
this document is mostly about the *derived* shapes — what the watchlist computes
— and the two operations added to the store that owns the stored one. See
[`contracts/watchlist-storage.md`](./contracts/watchlist-storage.md) for the
storage contract 003 must preserve, and
[`../002-recommendation-deck/data-model.md`](../002-recommendation-deck/data-model.md)
for the entities themselves.

---

## Persisted (owned by 002, unchanged)

`playnext:interactions`, version 1:

```ts
interface InteractionDocument {
  schemaVersion: 1;
  interactions: Record<string, Interaction>;   // keyed by titleId
  history: WatchHistoryEntry[];                // append-only
  updatedAt: string;                           // ISO-8601
}
```

003 reads this and writes to it. It does not change its shape, its version, or
its meaning (research D2).

---

## Reused as-is

| Entity | Owner | 003's use |
|--------|-------|-----------|
| `InteractionDocument` | 002 | the whole rating and history store |
| `Interaction` | 002 | `{state, updatedAt}`; the title id is the map key |
| `WatchHistoryEntry` | 002 | `{titleId, chosenAt}`; links resolve at render |
| `MediaTitle` | 002 | poster, title, year, availability for each entry |
| `InteractionState` | 002 | the six-state vocabulary, unchanged |
| `INTERACTION_STATE_LABELS` | 002 | the label shown on every entry |
| `RATING_ACTIONS` | 002 | the five options the re-rate control offers |

---

## New — derived, never stored

### WatchlistEntry

One row in a tab. Computed per render from `(interactions, catalog)`.

| Field | Type | Source |
|-------|------|--------|
| `titleId` | `string` | the key in `interactions` |
| `state` | `InteractionState` | `Interaction.state` |
| `stateLabel` | `string` | `INTERACTION_STATE_LABELS[state]` |
| `updatedAt` | `string` | `Interaction.updatedAt` |
| `title` | `MediaTitle \| null` | catalog lookup by `titleId` |

**`title` is nullable on purpose.** A rating can outlive the title's presence in
the catalog — reachable in Milestone 2, when the catalog becomes a TMDB response
whose contents change between visits. A null title renders an "unavailable" row;
it does not throw and it does not silently vanish. **An entry the visitor can see
is always an entry they can remove** — that is the property that keeps a
delisted title from becoming a rating that can never be cleared.

### Tab membership

The mapping from state to surface (research D3). One table, three consumers.

| Surface | States |
|---------|--------|
| Want to Watch | `wantToWatch` |
| Loved | `loved`, `liked` |
| Disliked | `disliked`, `notInterested` |
| History | `watchingNow` |

Every state in `INTERACTION_STATES` appears exactly once, and a test asserts
that: a state added to the vocabulary without a surface would otherwise be
stored and then invisible, which is the defect the 2026-09-26 clarification
fixed for `notInterested`.

### Tab counts

Each tab's badge count is the size of its entry list, computed from the same
grouping the list renders. Derived rather than counted separately, so a badge
cannot disagree with the list beneath it.

---

## New — operations on `InteractionStore`

Two, and no more.

### `remove(titleId: string): void`

Deletes the key from `interactions` (FR-005). Returns the title to unrated, so
it becomes eligible for the deck again (003 FR-007).

- Does **not** touch `history`. The watching log records what happened
  (FR-008); a title watched and later unrated keeps its history entry.
- Removing a title that was never rated is a no-op, not an error.
- The document is written back with a refreshed `updatedAt`, like every other
  write, so 004's last-write-wins has a coherent timestamp.

### `rerate(titleId: string, state: InteractionState)` — not needed

Re-rating is `record(titleId, state)`, which already replaces by assignment.
Adding a second name for the same operation would be the duplicate-pattern
violation the engineering standards forbid. Recorded here so its absence reads
as a decision rather than an oversight.

---

## State transitions

```
        (unrated)
            │
      rate from deck ──────────────┐
            │                       │
            ▼                       │
      ┌───────────┐   re-rate       │
      │  rated    │◄────────────────┘
      │ (any of 6)│
      └─────┬─────┘
            │ remove
            ▼
        (unrated)
```

Two rules the diagram does not show:

- **`watchingNow` is entered only from the deck's Watch Now.** The watchlist can
  re-rate *away* from it (to any of the five) but never *to* it (FR-004).
- **`history` is append-only and outside this diagram entirely.** No rating
  transition adds to it or removes from it; only Watch Now appends.

---

## Validation rules

Inherited wholesale from the frozen contract — 003 adds none, because it adds no
stored field. Restated because they are what the watchlist's reads depend on:

- An unknown `schemaVersion` invalidates the whole document; it is cleared and
  treated as a first visit.
- An unknown `state` on any entry invalidates the whole document. Not that
  entry — the whole document, because dropping one entry silently changes which
  titles the deck excludes, and a wrong exclusion set is worse than starting
  over.
- A malformed `history` array or a non-ISO `updatedAt` invalidates the document.
- Readers never mutate: `read()` parses a fresh copy each call.

---

## Scale

FR-011 / SC-005 name 500+ entries. Three facts about that number:

1. **It is unreachable through the UI.** The catalog holds 48 titles and a
   visitor has one rating per title, so 500 entries cannot be produced by
   clicking. The criterion is verified against a synthesized document
   (research D7).
2. **The logic side is bounded and cheap.** Grouping is one pass over the
   entries; the catalog lookup is a `Map` built once per render. Both are
   linear in entries with a small constant.
3. **The render side is not verifiable here.** jsdom has no layout engine, so
   "smooth" at 500 rows is a browser check. Recorded as a manual step in
   [`quickstart.md`](./quickstart.md), not claimed as passing.

The stored document at 500 entries is on the order of tens of kilobytes of
JSON — well inside LocalStorage's typical 5MB budget, and the reason no
eviction or pagination strategy is proposed. If Milestone 2's real catalog makes
that assumption false, this is the decision to revisit.
