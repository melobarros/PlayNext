# Research: Guest Accounts & Migration

**Feature**: 004 | **Date**: 2026-09-27

Every open decision from the Technical Context, resolved. Each entry follows
the house format: Decision, Rationale, Alternatives considered.

---

## D1. Backend scope: a skeleton, not a port

**Decision**: Bootstrap the .NET solution with exactly what 004 needs — auth,
accounts, and persistence of preferences/interactions/history with the merge
rule. Do **not** move the catalog, quiz options, or recommendation scoring
server-side in this slice.

**Rationale**: The spec consumes the device-local contracts of 001–003
unchanged (Assumptions); the catalog replacement is Milestone 2's job and
mixing it in would double the review surface of an already large slice. YAGNI
(Principle II): nothing 004 needs requires the catalog on the server.

**Alternatives considered**: Full API-first port of everything in one slice —
rejected: violates vertical-slice discipline, and the constitution's own
milestone framing keeps the mock catalog for now.

## D2. PostgreSQL locally without Docker

**Decision**: Native PostgreSQL via `winget install PostgreSQL.PostgreSQL`
(EDB installer) as the documented local path, with the Neon free tier as the
cloud alternative for anyone who prefers it. EF Core migrations own the
schema either way. Integration tests are a small suite **gated on a reachable
Postgres** (connection string from user-secrets); CI provides Postgres as a
GitHub Actions service container so the gate runs there even on a machine
without a local install.

**Rationale**: Docker is not installed on this machine (verified), and
Docker Desktop on Windows 10 Home requires WSL2 — a heavyweight prerequisite
to impose for one feature. The constitution's Infrastructure section already
names the free-tier Postgres options, so this is a constitution-aligned
choice. The gated suite keeps `dotnet test` green without a database while
still exercising the real provider where available.

**Alternatives considered**: Docker Compose (rejected: unavailable locally);
EF InMemory/SQLite for tests (rejected: hides provider differences, and the
constitution demands Postgres exclusivity); unit tests that hit the network
(rejected: flaky, slow, and not unit tests).

## D3. The merge lives server-side

**Decision**: The union + newest-wins merge is a **Domain-layer service** in
the backend. The client sends its guest document (or pending changes) to the
API; the API merges and returns the canonical state; the client writes that
back to LocalStorage as its cache.

**Rationale**: Principle IV — "the REST API is the single source of truth for
business rules; the client renders state, it does not own it." A client-side
merge would have to be reimplemented identically in JS and C# ("the same
behavior MUST NOT be implemented two different ways"), and every future
consumer of the API would re-derive it. In the Domain layer it is pure,
deterministic, and unit-testable with no database or HTTP stack (Principle
VII, and it becomes the named critical path for Principle V).

**Alternatives considered**: Client merges before sending (rejected: two
implementations, drift risk); merge in a stored procedure (rejected: not
testable in isolation, domain logic trapped in infrastructure).

## D4. Merge semantics, precisely

**Decision**: For each collection:

- **Interactions**: keyed by `titleId`. A title on one side only is kept. A
  title on both sides is resolved by comparing the two `updatedAt` values —
  the newer record wins. **Equal timestamps: the account wins** (a
  deterministic tie-break, Principle VI — no coin flips).
- **History**: append-only union. An entry already present as the exact pair
  `(titleId, chosenAt)` is not duplicated; a new pair is appended. This makes
  migration retries idempotent (FR-007, SC-004) without deleting anything.
- **Preferences**: the quiz state document is atomic — newest `updatedAt`
  wins whole, with the same account-wins tie-break. No field-level merge:
  the quiz is a single coherent choice set, and merging two documents
  field-by-field could produce a combination no visitor ever chose.

All timestamps are device-written ISO-8601 (frozen in the 001/002 contracts).
Device clocks can disagree, so "newest" is best-effort — the spec's own
scenarios assume exactly this (US3 scenario 2: "newer timestamp"), so the
plan accepts it rather than inventing a server-clock rewrite.

**Rationale**: Matches the spec's Assumptions verbatim ("union plus
newest-wins… the newer action, which supersedes the older one") while adding
the two decisions the spec left open: the tie-break and history idempotency.

**Alternatives considered**: Last-write-wins at document granularity
(rejected: one stale device would clobber everything); field-level preference
merge (rejected above); server-assigned timestamps (rejected: would require
the client to renumber records and breaks the frozen 002 contract).

## D5. Google sign-in: Identity Services popup, server-validated

**Decision**: The frontend loads Google Identity Services (GIS) from Google's
CDN and renders the official button in popup mode (`uix_mode=popup` — the
spec's "popup is blocked" edge case already assumes this). On success the
browser holds a Google **ID token**; the frontend POSTs it to
`/api/auth/google`; the backend validates signature, issuer, audience, and
expiry against Google's JWKS, then links the account **by the verified
email**. The Google **client secret lives only in backend configuration**
(user-secrets locally, App Settings/Key Vault in Azure — constitution IV).

**Rationale**: The constitution forbids provider credentials in client code.
The GIS flow is the standard way to honor that: the *client ID* is public by
design (it is an audience identifier, not a credential), while the secret
never leaves the server. This is the recommended Google pattern for web apps,
and the popup flow preserves the in-app UX the spec describes.

**Alternatives considered**: Server-side redirect OAuth (rejected: full-page
redirects out of a PWA and back, worse on mobile, and the spec's edge cases
describe a popup); shipping a secret in frontend config (rejected outright —
constitution IV); a hand-rolled Google button instead of GIS (rejected: GIS
handles the popup, cancellation, and credential selection; rebuilding it adds
risk for zero benefit, and it is Google's own supported client).

## D6. Sessions: short JWT + 30-day sliding refresh, hashed at rest

**Decision**: Access JWTs, HMAC-SHA256-signed, **15-minute** expiry, held in
**memory only** (never LocalStorage). A refresh token (random 256-bit, stored
as a **SHA-256 hash** in a `UserSession` table) rides an **httpOnly
SameSite=Strict cookie**; each refresh slides its expiry to 30 days of
*inactivity* — which is exactly FR-015 ("after 30 days without activity the
user MUST sign in again"). Refresh on every app boot and on 401. Sign-out and
password change revoke all of the user's sessions (FR-013/FR-014).

CSRF surface: the only cookie-authenticated endpoints are `refresh` and
`logout`. Both additionally require a custom header (`X-Requested-With:
playnext`), which cross-origin attackers cannot set — plus SameSite=Strict.
In production the cookie becomes `SameSite=None; Secure` (frontend and API
are different Azure origins); the custom header then does the CSRF work, and
CORS stays an explicit origin allow-list with credentials (constitution:
strict CORS, frontend domain only).

**Rationale**: The constitution demands short-lived JWTs *and* FR-015 demands
30-day sessions; the two-tier pattern is the standard reconciliation, and
hashing refreshes at rest means a database leak does not leak sessions. In
memory-only access tokens keep the highest-value credential out of the
XSS-reachable storage the ratings data already lives in.

**Alternatives considered**: Tokens in LocalStorage (rejected: the classic
XSS-exposed pattern, and the constitution's security bar invites the stricter
choice); refresh tokens in plaintext DB rows (rejected: hashing is one line);
no refresh tier with a 30-day access token (rejected: violates "short
expiration times" directly).

## D7. Signed-in offline: LocalStorage stays the read path; a queue holds writes

**Decision**: After sign-in the device's `playnext:interactions` and
`playnext:quiz-state` become the **cache of the account state** — the deck,
quiz, watchlist, and history keep reading them exactly as today, so 001–003
rendering code is untouched. When signed in, every write additionally goes to
the API; if the request fails (offline), the change is appended to a new
versioned key `playnext:sync-pending` and **applied locally immediately**
(FR-017: keep using the app). On reconnect, app boot, or the next successful
write, the queue replays as one partial sync (POST `/api/me/sync` with only
the queued items), the server applies newest-wins, the response's canonical
state replaces the cache, and the queue clears. A failed replay leaves the
queue intact for the next attempt (FR-007/SC-004 recoverability).

**Rationale**: This is the minimal design that satisfies FR-017 and SC-010
without re-architecting 001–003. The stores keep one read path (one pattern
per concern); sync becomes a write-side concern bolted on as a sink (D9).
Queuing whole operations (not deltas) keeps replay idempotent under the
server's newest-wins rule.

**Alternatives considered**: Server-first reads with a local read-through
cache (rejected: rewrites every 001–003 read path for no functional gain at
48 titles); per-request retry with no queue (rejected: offline writes would
be lost, violating SC-010); a two-way sync protocol with version vectors
(rejected: newest-wins makes them unnecessary — YAGNI).

## D8. Sign-out clears the device copy; the account is untouched

**Decision**: Sign-out revokes the sessions server-side, then deletes
`playnext:interactions`, `playnext:quiz-state`, `playnext:session`, and
`playnext:sync-pending` from the device — after warning if the queue is
non-empty (the spec's edge case). The account's data remains on the server
and returns on the next sign-in (FR-013, SC-007, US4 scenario 3).

**Rationale**: The spec is explicit: "none of the account's data remaining on
the device" (SC-007). Because the account is the source of truth (D3), the
deleted cache costs nothing — it is rebuilt by `GET /api/me/state` on the
next sign-in.

**Alternatives considered**: Keeping the cache as the new guest state
(rejected: violates SC-007 and leaks one user's taste data into the next
guest session — bad on shared devices); server-side sign-out only
(rejected: same leak).

## D9. The stores grow a sink, not a second write path

**Decision**: `InteractionStore` (and 001's quiz store) gain an optional
**write sink**: an observer notified with the changed items after every
successful local write. `SyncService` subscribes while a session is active
and pushes. The stores remain the single local write path; components do not
learn about sync.

**Rationale**: 003's research D4 deliberately kept the store non-reactive;
adding a sink preserves that character while giving 004 one seam. Wiring sync
into the deck/detail/quiz components directly would be the "implemented two
different ways" anti-pattern the engineering standards forbid.

**Alternatives considered**: `storage` events on `window` (rejected: same-tab
writes don't fire them, and they carry no operation context); a second
server-backed store selected by session state (rejected: two read paths, two
source-of-truth stories, and offline mode breaks by construction).

## D10. Lockout is Identity's built-in, configured

**Decision**: ASP.NET Core Identity's lockout: `MaxFailedAccessAttempts = 5`,
`DefaultLockoutTimeSpan = 15 minutes`, count reset on success. The 401
response carries the lockout-remaining time so the client can say when the
visitor can try again (FR-011).

**Rationale**: The spec's numbers match Identity's defaults shape exactly;
building a custom attempt counter would be the duplicate-implementation the
standards forbid, and Identity's lockout is well-tested.

**Alternatives considered**: Custom attempt table + timer (rejected:
reimplementing a framework feature); IP-based throttling (rejected: out of
scope — the spec's unit is the account).

## D11. Profile becomes the third nav destination; the nudge lives on Match Found

**Decision**: The shell's nav gains **Profile** (after Deck and Watchlist).
The Profile screen hosts one auth surface with a **Sign up / Sign in** mode
switch (email+password and the Google button on both modes). The Match Found
view gains a dismissible nudge whose dismissal is stored in `sessionStorage`
(spec: "rest of the session") and never blocks Start New Loop (US1 scenario
5, FR-001).

**Rationale**: The spec names the Profile area as "always-available"; a nav
destination is the fewest-tap placement on a phone (Principle I). One screen
with modes keeps the surface count down; the spec requires no confirm-password
field and none is added (YAGNI). `sessionStorage` matches "the rest of the
session" exactly — reloads keep it, new sessions reset it.

**Alternatives considered**: Profile behind a gear icon on a header
(rejected: 001–003 have no header, and a hidden profile violates
"always-available"); an interstitial between quiz and deck (rejected: gates
the loop — Principle II); in-memory dismissal (rejected: a reload would
re-nudge, contradicting the edge case).

## D12. Session expiry, errors, and observability

**Decision**: Every API response: `401` (token invalid/expired) triggers a
silent refresh then a retry once; if refresh fails, the client drops to
signed-out guest mode *with cached data intact* and the Profile area shows
"sign in again" — data untouched (spec edge case). `409 Conflict`-style
flows are unnecessary: newest-wins means there is nothing to conflict. Errors
are friendly and generic (never reveal whether an email exists — FR-008/
FR-011). Backend logging is structured and logs **no payloads**: no
passwords, no tokens, no rating contents; request ids, status codes, and
latency only (constitution security standards).

**Rationale**: The spec's "session expired" edge case asks for exactly the
re-auth prompt; the rest follows the constitution's security line and the
product's "never a dead end" rule — an expired session must never strand the
visitor or their cached data.

**Alternatives considered**: Interceptor-level global 401 handling that
silently re-authenticates (rejected: hides expiry from the user); logging
request bodies for debugging (rejected: violates the no-personal-data rule).

---

## Unresolved

None — every Technical Context unknown has a decision above. Items deferred
by the spec itself (password recovery, account deletion, subscription
management) remain out of scope and are not re-litigated here.
