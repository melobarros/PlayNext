# Contract: Interaction Storage (guest ratings & watching history)

**Owner**: feature 002 (recommendation deck) | **Consumers**: 003 (ratings &
watchlist), 004 (account migration) | **Date**: 2026-09-26

This is the interface between the deck, which records ratings, and every later
feature that reads or edits them. It is a LocalStorage contract, not a network
API — the shape is frozen for Milestone 1 so 003 can build the watchlist on it
and 004 can migrate it without rework.

It is the sibling of spec 001's
[preference-storage contract](../../001-onboarding-quiz/contracts/preference-storage.md)
and follows the same rules: versioned, fail-safe on read, readers never mutate.

## Storage key

| Field | Value |
|-------|-------|
| Key | `playnext:interactions` |
| Scope | browser origin, per device/profile (LocalStorage semantics) |
| Encoding | UTF-8 JSON, pretty-printed |
| Size bound | ~30 bytes per rated title; ~20 KB at 500 titles |

## Document schema

```jsonc
{
  "schemaVersion": 1,
  "interactions": {
    "the-matrix": { "state": "loved",       "updatedAt": "2026-09-26T14:30:00Z" },
    "se7en":      { "state": "disliked",    "updatedAt": "2026-09-26T14:31:00Z" },
    "arrival":    { "state": "wantToWatch", "updatedAt": "2026-09-26T14:32:00Z" }
  },
  "history": [
    { "titleId": "the-matrix", "chosenAt": "2026-09-26T14:33:00Z" }
  ],
  "updatedAt": "2026-09-26T14:33:00Z"
}
```

Field rules (normative, from [spec.md](../spec.md), spec 003, and
[data-model.md](../data-model.md)):

- `schemaVersion` MUST equal `1`. Readers MUST treat any other value (or
  unparseable JSON) as "no saved state" and start fresh, overwriting on the
  next write. Same policy as spec 001.
- `interactions` is an **object keyed by `titleId`** — one rating per title,
  by construction. Re-rating replaces the value; it never appends. This is
  what makes spec 003's "zero duplicate entries" (FR-006) structurally
  guaranteed rather than merely tested.
- `state` MUST be one of exactly:
  `"loved" | "liked" | "disliked" | "wantToWatch" | "notInterested" | "watchingNow"`.
  An unknown state invalidates the document — silently ignoring it would
  change which titles are excluded, which is worse than starting over.
- **Only `disliked` and `notInterested` exclude a title from suggestions.**
  The exclusion set is *derived* from this map at read time and MUST NOT be
  stored separately. A stored list would have to be kept in sync on every
  re-rating and on removal, and spec 003 requires the exclusion rule to
  reflect the current rating state at all times.
- `history` is an **append-only array**. Re-rating or removing an interaction
  MUST NOT remove history entries (spec 003: the history is a log). The same
  `titleId` MAY appear more than once.
- `updatedAt` changes on every write; 004 uses it for last-write-wins in the
  account merge, exactly as with `playnext:quiz-state`.

## Ownership rules

- **Writers**: feature 002 records interactions and history entries. Feature
  003 re-rates, removes interactions, and appends history when reopened —
  both features write this document through the same store service.
- **Readers**: 003 reads interactions to build the watchlist tabs and history
  to build the watching history; 004 reads the whole document for migration.
- **Readers MUST NOT mutate** the document they were handed; the store
  returns copies.
- **Versioning**: a `schemaVersion` bump is a breaking change requiring a
  migration path agreed in the spec that introduces it. Milestone 1 policy:
  unknown versions reset (no accounts to protect; migration arrives with 004).

## Not part of this contract

`playnext:deck-session` (the running loop's `shownTitleIds` and `startedAt`) is
**deck-private and ephemeral**. It is deliberately *not* migrated by 004 and
not read by 003 — "start a new loop" throws it away. Only the two documents
above hold durable guest data.

## Failure semantics

- LocalStorage unavailable (blocked, private-mode quirk): the app degrades to
  in-memory state for the session. Ratings still work and the loop still
  behaves correctly; the cross-session exclusion guarantee (FR-009) becomes
  best-effort. No crash, no error dialog.
- Write failures are non-fatal: the last successful document remains and the
  in-memory state stays authoritative for the session.

## Consumer examples

- **Deck ranking (002)**: read → `interactions` where `state` is `disliked` or
  `notInterested` → those `titleId`s are excluded from the candidate set.
- **Watchlist tabs (003)**: group `interactions` by state — `wantToWatch` →
  its tab, `loved` + `liked` → the Loved tab, `disliked` → its tab;
  `notInterested` is recorded and excludes, but is not listed.
- **Un-dislike (003)**: replace `interactions[id].state` with any other value
  → the title is immediately eligible again on the next ranking, with no
  second write and no batch job.
- **Account migration (004)**: read `interactions` + `history` + spec 001's
  `playnext:quiz-state`, merge into the account under newest-wins using each
  record's own timestamp.
