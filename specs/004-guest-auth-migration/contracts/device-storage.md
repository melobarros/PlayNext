# Contract: Device Storage (session marker & sync queue)

**Owner**: feature 004 | **Consumers**: frontend auth/sync services |
**Date**: 2026-09-27

The sibling of 001's
[`preference-storage`](../../001-onboarding-quiz/contracts/preference-storage.md)
and 002's
[`interaction-storage`](../../002-recommendation-deck/contracts/interaction-storage.md),
and it follows the same rules: LocalStorage keys, versioned documents,
fail-safe on read, readers never mutate. 004 does **not** change those two
keys' contracts — it adds two keys beside them.

The 001/002 keys change *role* when a session is active: from **the store**
to **the cache of the account state** (research D7). Their shapes do not
change, which is what keeps every 001–003 read path untouched.

## Keys

| Key | Purpose | Lifecycle |
|-----|---------|-----------|
| `playnext:session` | who is signed in (marker only) | written on sign-in/register; deleted on sign-out and on unrecoverable session expiry |
| `playnext:sync-pending` | offline writes awaiting the account | appended on push failure; cleared after a confirmed sync; deleted on sign-out (after the spec's warning if non-empty) |

Neither key ever holds a token. The access token lives in memory; the refresh
token lives in an httpOnly cookie. LocalStorage holding credentials would be
an XSS giveaway, and the constitution's security standards are the bar.

## `playnext:session`

```jsonc
{
  "schemaVersion": 1,
  "userId": "0e7d2c41-9f3a-4b8e-a1c6-5d0f9e2b3a11",
  "email": "visitor@example.com",
  "signedInAt": "2026-09-27T10:00:00Z"
}
```

Field rules:

- `schemaVersion` MUST equal `1`; unknown version or unparseable JSON → no
  session, treated as signed out (fail-safe, like 001/002).
- `email` is display-only convenience; the server's copy is authoritative.
- Boot semantics: presence of this document triggers a silent `refresh`
  attempt. Failure to refresh while online means the session expired
  (FR-015) — the document is deleted and the Profile area invites sign-in.
  Failure to refresh **because offline** means signed-in offline mode
  (FR-017): cached data + offline notice + pending queue; the next
  successful refresh restores the live session.

## `playnext:sync-pending`

```jsonc
{
  "schemaVersion": 1,
  "operations": [
    { "kind": "rate",    "titleId": "arrival", "state": "loved",  "updatedAt": "2026-09-27T11:00:00Z" },
    { "kind": "remove",  "titleId": "hereditary",                  "updatedAt": "2026-09-27T11:01:00Z" },
    { "kind": "history", "titleId": "arrival", "chosenAt": "2026-09-27T11:02:00Z" },
    { "kind": "preferences", "preferences": { "updatedAt": "2026-09-27T11:03:00Z" } }
  ]
}
```

Field rules:

- `schemaVersion` MUST equal `1`; unknown version or unparseable JSON → empty
  queue (fail-safe).
- `operations` is FIFO, but replay does not depend on order: every operation
  is self-contained, so the server's newest-wins rule makes each one
  idempotent. A replayed `remove` of an already-removed title is a no-op; a
  replayed `rate` older than the account's current value loses to it —
  exactly FR-017's rule.
- Operations are **never deduplicated on the device** (two `rate`s on the
  same title are two re-rates; the newest wins on the server, as it should).
- The queue is cleared only after the server confirms the sync (`200` with
  the merged state). A `400` is not retried (see [`api.md`](./api.md)
  failure semantics); a network failure leaves the queue intact for the next
  attempt (FR-007 / SC-004).
- Sign-out with a non-empty queue warns first (spec edge case), then deletes
  the key with the rest of the account's device data (SC-007).

## Not part of this contract

- `playnext:deck-session` remains deck-private and ephemeral, exactly as 002
  ruled — 004 neither reads nor migrates it.
- The nudge's dismissal is in `sessionStorage`, not LocalStorage, because the
  spec scopes it to "the rest of the session" (research D11). It is not a
  durable document and has no version.
- Access/refresh tokens: deliberately absent from all storage keys (above).

## Ownership rules

- **Writers**: `AuthService` (session marker) and `SyncService` (queue).
  Nothing else writes either key.
- **Readers**: app boot (session marker → silent refresh), `SyncService`
  (queue → replay). Readers MUST NOT mutate; services return copies.
- **Versioning**: a `schemaVersion` bump is a breaking change requiring a
  migration path agreed in the spec that introduces it, per the 001/002
  policy.

## Failure semantics

- LocalStorage unavailable (blocked, private-mode quirk): signed-in state
  degrades to memory for the session — tokens and sync still work, the
  queue is in-memory, and a reload loses the pending operations. The app
  does not crash; the visitor keeps using it (the same degrade-forever
  stance 001/002 take).
- Write failures are non-fatal: the in-memory state stays authoritative for
  the session.
