# Contract: Account & Sync REST API

**Owner**: feature 004 | **Consumers**: Angular frontend (only — constitution
IV) | **Date**: 2026-09-27

The first network contract in the project. It is deliberately small: one
shape for auth (three ways in, one way out), one shape for state (the merged
document), and **one write endpoint** whose semantics are the merge rule —
so the client has exactly one way to push changes, whether live, replaying an
offline queue, or migrating a guest document.

Base URL: `/api` under the API's origin. All bodies are UTF-8 JSON.

## The guest state payload (shared by every endpoint that carries one)

The device document, as the merge's incoming side. Appears as `guest` in the
auth endpoints and as the body of `POST /me/sync` (where **omitted fields
mean "untouched"** — the sync body may be partial):

```jsonc
{
  "interactions": {
    "arrival":   { "state": "loved",       "updatedAt": "2026-09-27T10:00:00Z" }
  },
  "removals": [
    { "titleId": "hereditary", "updatedAt": "2026-09-27T10:02:00Z" }
  ],
  "history": [
    { "titleId": "arrival", "chosenAt": "2026-09-27T10:05:00Z" }
  ],
  "preferences": {
    "mediaType": { "values": ["movie"], "any": false },
    "genre":     { "values": ["sci-fi"], "any": false },
    "provider":  { "values": ["netflix"], "any": false },
    "includeUnownedProviders": false,
    "completedAt": "2026-09-27T09:00:00Z",
    "updatedAt":   "2026-09-27T09:00:00Z"
  }
}
```

Rules (from the 001/002 frozen contracts and the merge rule in
[`../data-model.md`](../data-model.md)):

- `state` MUST be one of the six vocabulary values, else `400`.
- Timestamps MUST be parseable ISO-8601, else `400`.
- `interactions` keys are `titleId`s; one rating per title.
- A sync body containing no collections at all is valid and means "pull
  only" — it returns the account state unchanged.
- A title MUST NOT appear in both `interactions` and `removals`, else `400`:
  the two are competing claims about one title and a body that makes both is
  asking the server to guess which the visitor meant.

### Why `removals` is a collection of its own

FR-006 names removals among the changes made while signed in that must reach
the account, and research D2 rules out the obvious alternative: a rating is
removed by *absence*, and there is no seventh "unrated" state to send instead.
Absence cannot carry a timestamp, and without one a removal cannot take part in
newest-wins — so `removals` carries `updatedAt` explicitly and is compared
against the account's rating exactly as two ratings are. A removal older than
the account's rating loses to it, which is what lets a concurrent device's
newer re-rate survive a replayed removal.

`removals` is meaningful only on `POST /me/sync`. The auth paths' `guest`
payload never carries it, and that is a real boundary rather than an
oversight: a device's stored document expresses a removal as the title's
absence, and absence has no timestamp to compare. So a rating removed while
signed out, on a device that then signs in to an account still holding that
rating, keeps the account's rating. The union rule decides it, the account's
action was deliberate, and inventing a timestamp for an absence would be
guessing at when the visitor changed their mind.

## Auth

| Endpoint | Body | Response |
|----------|------|----------|
| `POST /auth/register` | `{ email, password, guest? }` | `200` session + canonical state |
| `POST /auth/login` | `{ email, password, guest? }` | `200` session + canonical state |
| `POST /auth/google` | `{ credential, guest? }` | `200` session + canonical state |
| `POST /auth/refresh` | — (cookie + `X-Requested-With: playnext`) | `200` new access token; rotates the refresh token |
| `POST /auth/logout` | — (cookie + header) | `204`; revokes the session |
| `POST /auth/change-password` | `{ currentPassword, newPassword }` (Bearer) | `204`; revokes **all** sessions, current included |

The session response is the same envelope for all three ways in:

```jsonc
{
  "userId": "<server GUID — the device's session marker records it>",
  "email": "<the marker's display field>",
  "accessToken": "<15-minute JWT — client keeps in memory only>",
  "state": { /* the canonical merged account state, same shape as GET /me/state */ }
}
```

`userId` and `email` are here because
[`device-storage.md`](./device-storage.md)'s `playnext:session` records who is
signed in. Returning them beats the alternative — making the client decode its
own access token to recover two values the server already has — and it keeps
the marker independent of a credential that expires in fifteen minutes. The
email is not redundant with the request body: on the Google path the address is
chosen inside Google's own sheet, so the client never sees it.

The refresh token arrives as an **httpOnly cookie** (SameSite=Strict locally;
`None; Secure` in production), never in the body, never readable by script.

Semantics the spec pins and the API must not paper over:

- **Register** with an already-registered email → `409` with
  `{ code: "email-taken", message: "…sign in instead" }` (FR-008). The
  message MUST offer sign-in.
- **Google** with a verified email matching an existing account → signs into
  that account (FR-009). No duplicate account is ever created.
- **Wrong credentials** → `401` with a friendly, generic message — never
  reveals whether the email exists (FR-011). The 5th consecutive failure
  locks the account for 15 minutes; while locked, `401` carries
  `{ code: "locked", retryAfterSeconds }` so the client can say when to try
  again.
- **Offline** is not an API concern — the client detects it via
  `navigator.onLine`/Connectivity and shows the notice; the API is simply
  unreachable (FR-016).
- A **failed or interrupted** migration is invisible to the API: nothing is
  written unless the whole merge succeeds (single transaction), so the guest
  document on the device is still the only copy of that data (FR-007).

## State

| Endpoint | Auth | Response |
|----------|------|----------|
| `GET /me/state` | Bearer | `200` `{ interactions, history, preferences }` — the canonical account state, same shape as the sync body |
| `POST /me/sync` | Bearer | `200` the canonical merged state after applying the body's partial document |

`POST /me/sync` is the **only write endpoint** for account data. The client
uses it for: a live signed-in change (body = the changed items), a guest
migration (body = the full guest document, carried as `guest` on the auth
call instead), and an offline replay (body = the queued operations, one sync
call). One endpoint, one merge rule, one code path — the same behavior is
not implemented three ways.

The merge applies in a single transaction: new titles from the body are
added, conflicts resolve newest-wins (account wins exact ties), history
unions idempotently, preferences take the newer `updatedAt`. The response is
the whole merged state, which the client writes back to LocalStorage as its
cache (research D3/D7).

## Auth transport rules (constitution IV + security standards)

- **CORS**: explicit origin allow-list — `http://localhost:4200` in dev, the
  frontend's Azure Static Web Apps origin in production — with
  `AllowCredentials`. No wildcard, ever.
- **CSRF**: the cookie-authenticated endpoints (`refresh`, `logout`) require
  the custom header `X-Requested-With: playnext`, which cross-origin callers
  cannot set; SameSite backs it up. Bearer-authenticated endpoints are not
  CSRF-relevant.
- **Tokens**: access JWT is HMAC-SHA256-signed, 15-minute expiry, in memory
  only. Refresh token is 256-bit random, stored server-side only as its
  SHA-256 hash, 30-day sliding inactivity expiry (FR-015), revoked on
  sign-out and password change.
- **401 handling** (client-side contract): on `401` the client attempts one
  silent `refresh`, retries once; if that fails it drops to guest mode with
  cached data intact and the Profile area invites sign-in — data is never
  discarded by an expired session.

## Failure semantics

- `400` — malformed body: the client shows a friendly error; **the local
  write already succeeded**, and the operation goes to `playnext:sync-pending`
  only if it was a network failure — a `400` is not retried blindly, it is
  surfaced (a queue that replays invalid payloads forever is a dead end).
- `409` — email taken (register only), handled above.
- `401` / `423` — see auth semantics above.
- `5xx` — the client keeps its cache, the change sits in the pending queue,
  and the app keeps working offline-aware (FR-017). Server errors are logged
  structured, with **no request payloads, tokens, or personal data**
  (constitution security standards).
