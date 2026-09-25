# Contract: Preference Storage (guest device-local persistence)

**Owner**: feature 001 (onboarding quiz) | **Consumers**: 002 (deck), 003
(watchlist), 004 (account migration) | **Date**: 2026-09-25

This is the interface between the quiz and every later feature that reads
guest preferences. It is a LocalStorage contract, not a network API — the
shape is frozen for Milestone 1 so that 002–004 can depend on it without
rework.

## Storage key

| Field | Value |
|-------|-------|
| Key | `playnext:quiz-state` |
| Scope | browser origin, per device/profile (LocalStorage semantics) |
| Encoding | UTF-8 JSON, pretty-printed |
| Size bound | < 1 KB |

## Document schema

```jsonc
{
  "schemaVersion": 1,
  "status": "in-progress",            // "in-progress" | "completed"
  "step": 2,                          // 1..3, present while in-progress
  "mediaType": { "values": ["movie"], "any": false },
  "genre":     { "values": [],        "any": true },
  "provider":  { "values": ["nfx"],   "any": false },
  "includeUnownedProviders": false,
  "completedAt": null,                // ISO 8601, set when completed
  "updatedAt": "2026-09-25T14:30:00Z" // ISO 8601, every write
}
```

Field rules (normative, from [spec.md](../spec.md) and
[data-model.md](../data-model.md)):

- `schemaVersion` MUST equal `1`. Readers MUST treat any other value (or
  unparseable JSON) as "no saved state" and start fresh, overwriting the
  document on the next write.
- A dimension is complete iff `values.length > 0 || any === true`.
- `any === true` MUST imply `values` is empty (the chip is exclusive).
- `mediaType.values` contains only `"movie" | "tv" | "anime"`.
- `status: "completed"` MUST have a non-null `completedAt`.
- `updatedAt` changes on every write; readers use it for
  last-write-wins in the 004 account merge.

## Ownership rules

- **Writers**: feature 001 only (quiz progression, retake, completion).
- **Readers**: 002 reads the completed `Preference` view
  (`mediaType`, `genre`, `provider`, `includeUnownedProviders`) to build
  suggestions; 003/004 read the whole document for migration. Readers
  MUST NOT mutate the document.
- **Versioning**: `schemaVersion` bump = breaking change requiring a
  migration path agreed in the spec that introduces it. Milestone 1
  policy: unknown versions reset (no users to protect; migration feature
  is 004).

## Failure semantics

- LocalStorage unavailable (blocked/private mode quirk): the app degrades
  to in-memory state for the session; quiz works, persistence guarantee
  (FR-010) is best-effort with no crash.
- Write failures are non-fatal: last successful state remains; the app
  shows nothing (silent retry on next transition).

## Consumer examples

- Deck boot: read doc → `status === 'completed'` → load `Preference`;
  else route to quiz.
- Migration (004): read doc, merge into account under newest-wins using
  `updatedAt` and per-title timestamps from the ratings contract.
