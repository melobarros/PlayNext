# Contract: Watchlist Reads & Mutations

**Feature**: 003 | **Date**: 2026-09-26

What the watchlist is allowed to do to `playnext:interactions`, and what it
promises the deck in return.

**This contract adds no stored field and no storage key.** The document is
owned by 002 and is frozen there:
[`../../002-recommendation-deck/contracts/interaction-storage.md`](../../002-recommendation-deck/contracts/interaction-storage.md).
Read that first; this document only says how 003 reads and writes it. A document
written by the watchlist must be indistinguishable from one written by the deck.

---

## Scope

| | |
|---|---|
| **Storage key** | `playnext:interactions` — unchanged |
| **Schema version** | `1` — unchanged |
| **Writer** | `InteractionStore` — the only writer, as in 002 |
| **Owned by** | 002 (shape), 003 (two added operations) |

---

## Operations 003 performs

| Operation | Calls | Effect on storage |
|-----------|-------|-------------------|
| List a tab | `read()` | none |
| Re-rate | `record(titleId, state)` | replaces `interactions[titleId]` |
| Remove | `remove(titleId)` | deletes `interactions[titleId]` |
| Open history | `read().history` | none |

Nothing else. In particular the watchlist never writes `history`, never writes
a document wholesale, and never sets `watchingNow` (FR-004 — that state is the
deck's Watch Now action alone).

---

## Guarantees 003 must preserve

These are the invariants the deck depends on. A change to any of them is a
cross-feature contract change, not a watchlist bug fix.

1. **One entry per title.** `interactions` is keyed by `titleId`; re-rating
   assigns rather than appends. The watchlist cannot create a duplicate because
   the shape will not hold one (FR-006, SC-004).
2. **`history` is append-only.** No watchlist operation removes from it —
   including Remove. A title watched and later unrated keeps its history entry
   (FR-008).
3. **The exclusion set stays derived.** Neither the watchlist nor the store
   persists a list of excluded titles; both derive it from `interactions` at
   read time (002 research D2). This is what makes re-rating take effect on the
   next ranking with no invalidation step (FR-007, SC-002).
4. **Every write refreshes `updatedAt`.** Including removal. 004's
   last-write-wins merge depends on this being monotonic.
5. **A malformed document resets rather than repairs.** Inherited unchanged from
   002; the watchlist does not get to be more forgiving than the deck, since
   both read the same bytes.

---

## Guarantees the watchlist relies on from the deck

1. **Every state is recorded, not just the tab-visible ones.** The watchlist can
   only show what the deck wrote; a deck that skipped recording `notInterested`
   would make the Disliked tab quietly incomplete.
2. **`recordWatch` writes both halves atomically.** The `watchingNow` interaction
   and the history entry are one decision, and the store writes them together so
   the history can never show a choice the ratings map knows nothing about.

---

## Read semantics

`read()` returns an `InteractionDocument`; it never returns `null`. A visitor
who has rated nothing gets an empty document, so the watchlist's empty states
are a property of the data rather than a null check in every tab (002's store
documentation).

Reads are **copies**. Each call parses fresh, so a component that sorts or
filters what it was handed cannot corrupt what is stored — which matters more
here than in the deck, because the watchlist sorts and groups on every render.

---

## Failure semantics

| Condition | Behaviour |
|-----------|-----------|
| LocalStorage unavailable (private browsing, blocked) | store falls back to memory; the watchlist works for the session and does not throw |
| Document unparseable, or an unknown `schemaVersion` | cleared, treated as a first visit — empty tabs, not an error screen |
| An entry has an unknown `state` | the whole document resets (002's rule, kept) |
| A rated `titleId` is absent from the catalog | the entry renders as unavailable and remains removable; the rating is never silently dropped (data-model.md) |

---

## Out of scope

- **Server-side persistence.** Milestone 3 moves this document behind the API;
  until then it is device-local and clearing browser data loses it (FR-009 is
  satisfied per-device, which is what the spec's Assumptions say).
- **Merging two documents.** 004 owns guest→account migration.
- **The history's streaming links.** Not stored here at all — resolved from the
  catalog at render (research D10).
