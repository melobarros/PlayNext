# Data Model: Guest Accounts & Migration

**Feature**: 004 | **Date**: 2026-09-27

004 adds the first server-persisted entities and two new device-local
documents. The guest entities it migrates (`QuizState` from 001,
`InteractionDocument` from 002) are unchanged — their contracts stay the
source of their shapes and validation.

The server-side vocabulary is the constitution's ubiquitous language: the
six-state rating vocabulary is one enum in the Domain layer, one enum in the
API contract, and one string union in the client — the same six values, no
translation layer.

---

## Server-persisted (PostgreSQL via EF Core)

### User (identity, aggregate root)

The registered identity. Columns come from ASP.NET Core Identity (the
framework's own `IdentityUser<Guid>`); the domain never depends on the
framework, so Domain code sees a `UserId` (Guid) and the API maps it.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `Guid` | PK |
| `email` | `string` | normalized unique index; validated at registration (FR-008) |
| `passwordHash` | `string` | **PBKDF2** via Identity defaults (FR-010, constitution) |
| `accessFailedCount` / `lockoutEnd` | Identity columns | FR-011: 5 failures → lockout for 15 min, Identity built-in (research D10) |
| `createdAt` | `DateTimeOffset` | |
| `region` | `string` | copied from the device's `DEFAULT_REGION` at registration; a place-holder until Milestone 2 makes regions real |

A Google-linked account is the same row: the email anchor is what links
(FR-009, research D5). No separate "provider" table at this scale.

### UserSession (refresh token record)

| Field | Type | Notes |
|-------|------|-------|
| `id` | `Guid` | PK |
| `userId` | `Guid` | FK → User |
| `tokenHash` | `string` | SHA-256 of the refresh token; **the raw token is never stored** (research D6) |
| `createdAt` | `DateTimeOffset` | |
| `expiresAt` | `DateTimeOffset` | slides to now+30 days on each refresh — FR-015 is "30 days **without activity**", so activity extends it |
| `revokedAt` | `DateTimeOffset?` | set on sign-out and password change (FR-013/FR-014 invalidate all sessions) |

Access tokens are stateless JWTs (15 min) and are not rows.

### UserPreference (aggregate root)

One row per user — the account copy of the quiz's completed `QuizState`
(001). The account stores the *completed* form; an in-progress quiz stays
device-only (the deck and quiz only care about completed preferences, and
migrating half-answered questions adds nothing).

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `Guid` | PK (one row per user) |
| `mediaType` | JSON: `{values: string[], any: boolean}` | from `QuizState.mediaType` |
| `genre` | JSON: `{values: string[], any: boolean}` | from `QuizState.genre` |
| `provider` | JSON: `{values: string[], any: boolean}` | from `QuizState.provider` |
| `includeUnownedProviders` | `bool` | from `QuizState.includeUnownedProviders` |
| `completedAt` | `DateTimeOffset` | from `QuizState.completedAt` |
| `updatedAt` | `DateTimeOffset` | from `QuizState.updatedAt` — the newest-wins comparator |

The three `DimensionChoice`s are stored as JSON columns (PostgreSQL
`jsonb`), because the 001 contract freezes them as a document shape and no
query ever filters on their members.

### UserInteraction (aggregate root)

One row per `(userId, titleId)` — the account copy of one rating.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `Guid` | composite PK with `titleId`; **index (UserId, TitleId)** per the constitution's performance standard |
| `titleId` | `string` | the catalog id — the mock catalog's id today, TMDB's id in Milestone 2 |
| `state` | `InteractionState` enum | one of exactly `loved | liked | disliked | wantToWatch | notInterested | watchingNow` — the ubiquitous language |
| `updatedAt` | `DateTimeOffset` | device-written; the newest-wins comparator |

One rating per title by construction (the composite key), exactly as the
device map guarantees it — so "zero duplicate entries" is structural on the
server too.

### UserWatchHistoryEntry

Append-only, like its device counterpart. Part of the User aggregate's data
but its own table because it grows independently.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `Guid` | PK |
| `userId` | `Guid` | FK → User |
| `titleId` | `string` | |
| `chosenAt` | `DateTimeOffset` | device-written |

Idempotency for retried migrations (research D4): a unique index on
`(userId, titleId, chosenAt)` makes re-uploading the same pair a no-op
instead of a duplicate.

---

## The merge rule (Domain service, the critical path)

`MergeService` is pure (Principle VII): in-memory inputs, in-memory output,
no framework, no I/O. Input: the account's current state + an incoming
document; output: the canonical merged state.

```
for each (titleId, incoming) in incoming.interactions:
    existing = account.interactions[titleId]
    if existing is null            → keep incoming            (union)
    else if incoming.updatedAt > existing.updatedAt → keep incoming   (newest wins)
    else                           → keep existing            (account wins ties, D4)

history = account.history ∪ { incoming.history pairs not already present by
          (titleId, chosenAt) }                              (append-only, idempotent)

preferences = the whole preference document with the newer updatedAt
              (account wins ties)
```

Every property the spec's US3/SC-005 scenarios assert falls out of this:
distinct titles on both sides are all kept; conflicting titles resolve to the
newer action; nothing else is lost.

---

## Device-local (LocalStorage)

Two new versioned keys, following the 001/002 pattern (versioned, fail-safe
on read, readers never mutate). Full contract in
[`contracts/device-storage.md`](./contracts/device-storage.md).

### `playnext:session` — who is signed in (no tokens, ever)

```ts
interface SessionDocument {
  schemaVersion: 1;
  userId: string;      // server GUID
  email: string;       // display only
  signedInAt: string;  // ISO 8601
}
```

It is a marker: boot checks it to attempt a silent refresh (research D6),
and sign-out deletes it. The credentials themselves live in an httpOnly
cookie + memory, deliberately absent from LocalStorage.

### `playnext:sync-pending` — offline writes waiting to reach the account

```ts
type PendingOperation =
  | { kind: 'rate';     titleId: string; state: InteractionState; updatedAt: string }
  | { kind: 'remove';   titleId: string; updatedAt: string }
  | { kind: 'history';  titleId: string; chosenAt: string }
  | { kind: 'preferences'; preferences: PreferenceDocument; updatedAt: string };

interface PendingDocument {
  schemaVersion: 1;
  operations: PendingOperation[];  // FIFO; cleared only after a confirmed sync
}
```

Removal is queued as an operation, not as a snapshot diff, so replay stays
idempotent under newest-wins: the server's re-apply of a remove for a title
already removed is a no-op, and a concurrent device's newer re-rate survives
because it carries a newer `updatedAt` (FR-017's newest-wins hold).

---

## State transitions

### The device's relationship to data

```
        guest mode                          signed in
┌──────────────────────────┐     sign-in    ┌─────────────────────────────┐
│ LocalStorage = the store │ ─────────────► │ LocalStorage = the cache    │
│ writes stay local        │   (merge)      │ writes: local + push/queue  │
└──────────────────────────┘ ◄───────────── └─────────────────────────────┘
                              sign-out            server = source of truth
                              (clear device)

registration = sign-in + create account, same merge on the new empty account
(US1 scenario 4: a guest with no data registers → merge over an empty account
→ a fresh empty account).
```

### A write while signed in

```
write (rate / re-rate / remove / history / quiz retake)
  → store applies to LocalStorage immediately          (FR-017: never blocked)
  → sync sink pushes the changed items to POST /api/me/sync
      ├─ success   → response state replaces the cache; queue untouched
      └─ failure   → operation appended to playnext:sync-pending
                      → replayed on reconnect / boot / next success
                      → success clears the queue, failure leaves it (FR-007)
```

### A session

```
no session → sign-in/register/Google → tokens + canonical state pulled
          → silent refresh on boot (cookie) slides the 30-day window
          → 401 + failed refresh → cached data stays, Profile asks to sign in
          → sign-out / password change → all UserSessions revoked
```

---

## Validation rules

Server-side (a malformed payload is a `400`, never a silent drop — the 002
contract's "an unknown state invalidates the document" rule, serverified):

- `state` MUST be one of the six vocabulary values, else the request is
  rejected outright. Silently skipping an entry would change which titles
  are excluded — the exact defect the 002/003 contracts refuse to allow.
- `updatedAt`/`chosenAt` MUST be parseable timestamps.
- `titleId` MUST be a non-empty string (any string: the server does not
  know the catalog, and a rating for a title the server has never heard of
  is legitimate — the client owns the "unavailable title" rendering).
- Email MUST be well-formed and not already registered (FR-008); the
  duplicate response carries the "sign in instead" message.
- Unknown `schemaVersion` on either new device document → treated as "no
  document" and rebuilt, exactly like 001/002.

## Scale

- One user's server data: ≤ 1 preference row + ≤ catalog-size interaction
  rows + unbounded history rows — tens of KB at the 500-entry bound 003
  analyzed. Merge is one pass per collection.
- The `(userId, titleId)` interaction index makes per-title upserts O(log n)
  — the constitution's named index, implemented for exactly this feature.
- No pagination anywhere: 48 catalog titles bound the interactive case;
  history grows slowly (one row per Watch Now).
