# Quickstart & Validation Guide: Guest Accounts & Migration

**Feature**: 004 | **Date**: 2026-09-27

Runnable validation scenarios proving accounts and migration work end-to-end,
mapped to the spec's acceptance scenarios and success criteria. Implementation
details live in `tasks.md` (created by `/speckit-tasks`); this guide stays a
run/verify reference.

## Prerequisites

- Node.js `^22 || ^24 || ^26` + npm, and .NET SDK 9 (verified on this
  machine: `dotnet --version` → 9.0.300)
- **PostgreSQL** — the backend's only database. Docker is not available
  here, so the documented local path is a native install:

  ```powershell
  winget install PostgreSQL.PostgreSQL
  ```

  (note the generated `postgres` superuser password; the connection string
  goes into user-secrets below). Prefer a cloud instance instead? The
  constitution names Neon/Supabase free tiers — a Neon connection string
  works identically.
- Google sign-in e2e needs a Google Cloud OAuth **client ID + secret** (Web
  application, authorized origin `http://localhost:4200`). Everything else
  — including the Google button rendering and its cancel path — works
  without it; without credentials the button's completion path can't be
  walked.
- Latest Chrome or Firefox + DevTools device emulation at 360px for touch
  checks. A phone on the same network is the better instrument (003's
  quickstart documents the `--host 0.0.0.0` recipe).

## Setup & run

```powershell
# backend
cd backend
dotnet user-secrets init --project src/PlayNext.Api
dotnet user-secrets set "ConnectionStrings:Postgres" "Host=localhost;Database=playnext;Username=postgres;Password=<your-postgres-password>" --project src/PlayNext.Api
dotnet user-secrets set "Jwt:SigningKey" "<long random string, e.g. 64 hex chars>" --project src/PlayNext.Api
# Google, only if you have credentials:
dotnet user-secrets set "Google:ClientId" "<id>" --project src/PlayNext.Api
dotnet user-secrets set "Google:ClientSecret" "<secret>" --project src/PlayNext.Api
dotnet ef database update --project src/PlayNext.Infrastructure --startup-project src/PlayNext.Api
dotnet run --project src/PlayNext.Api            # → https://localhost:7xxx

# frontend (second terminal)
cd frontend
npm install
npm start                                        # → http://localhost:4200
```

`npm start` is wired to call the API at its dev origin (CORS allows
`http://localhost:4200` — see
[`contracts/api.md`](./contracts/api.md)).

**Secrets never leave user-secrets / App Settings**: the frontend holds no
keys, and the backend's appsettings carry no secrets (constitution IV).

## Test commands

```powershell
cd backend
dotnet test                                   # Domain + Application suites — always runnable
dotnet test tests/PlayNext.Api.IntegrationTests   # gated: needs the Postgres connection string

cd frontend
npx ng test --watch=false                     # 446 existing tests + the new auth/sync suites
npm run build                                 # quality gate
```

Critical-path tests (constitution V — red-green, written before
implementation):

| Test | Covers |
|------|--------|
| Merge keeps titles unique to either side | FR-004, US3 scenario 1 |
| Merge resolves a shared title with the newer action | FR-004, US3 scenario 2, SC-005 |
| Merge resolves equal timestamps in favor of the account | research D4 determinism |
| Merge unions history idempotently (same pair twice → once) | FR-007, SC-004 |
| Preferences take the newer `updatedAt` whole | US3 scenario 3 |
| Register/login carry a guest document into the account losslessly | FR-003, US1 scenarios 1–2, SC-001 |
| 5 wrong passwords lock the account for 15 minutes, message says when | FR-011 |
| Duplicate email registration is rejected and offers sign-in | FR-008, edge case |
| Offline writes queue, replay applies, conflict resolves newest-wins | FR-017, SC-010 |
| Sign-out clears the device and the account returns on sign-in | FR-013, SC-007, US4 |

## Manual validation walkthrough (acceptance scenarios)

Two browser profiles (Chrome + Firefox, or a second device) play "device A"
and "device B".

1. **Guest → register, lossless (US1 scenarios 1–4)**: as a guest, complete
   the quiz, rate three titles, Watch Now one. Profile → Sign up → register
   with email/password. Watchlist, history, and quiz preferences are intact;
   you are signed in with no further step. Repeat with an empty guest
   (private window): a fresh empty account.
2. **The nudge (US1 scenario 5)**: as a guest, Watch Now a title → the Match
   Found view shows the account nudge; Start New Loop is not blocked;
   dismissing it keeps it gone after reloads, until the session ends.
3. **Google (US1 scenario 2, FR-002/FR-009)**: from the Profile, complete
   Google sign-in (needs credentials configured). Cancel the popup instead →
   back to the previous state, nothing changed, a friendly note, and
   email/password still available. With an existing password account on the
   same email, Google sign-in lands in that account, not a new one.
4. **Cross-device (US2, FR-005/FR-006, SC-003)**: device A signs in, rates a
   title. Device B signs in → the rating is there. Device B retakes the quiz
   → device A shows the new preferences after a reload.
5. **Merge on sign-in (US3)**: on device B as a guest, rate title X
   Disliked, then sign in to an account that had X as Loved → X is Disliked
   everywhere; the account's other titles are untouched; the guest's other
   titles were added; Disliked/Not Interested from both sides stay excluded
   from the deck.
6. **Account management (US4)**: change password (current + new) → sign out
   → the app is a clean guest: no account data visible in any tab
   (SC-007) → sign in with the new password → everything returns. Also: the
   old refresh session is dead after password change — no silent session
   survives.
7. **Failure tolerance (FR-007, SC-004)**: start a migration, then
   DevTools → Network → Offline mid-flow (or throttle to drop the request).
   Guest data stays intact, guest mode keeps working, and a later attempt
   completes the migration.
8. **Lockout (FR-011)**: five wrong passwords → the sign-in shows when you
   can try again, and the correct password is also refused for 15 minutes.
9. **Signed-in offline (FR-017, SC-010)**: signed in, go offline (Network →
   Offline): rate a title, retake the quiz — both apply locally with the
   offline notice. Reconnect → the changes reach the account automatically.
   If another device changed the same title meanwhile, the newer one wins
   everywhere.
10. **Session expiry (FR-015)**: sign in, then stop touching the app for
    the configured window (shortened in dev config to minutes — see
    `appsettings.Development.json`) → the next open asks you to sign in
    again; your data is untouched.
11. **360px touch (FR-018, SC-009)**: at 360px with touch emulation, run
    the full flow — register, migrate, sign out, sign in, change password —
    with no horizontal scrolling and every control ≥44px.
12. **Guest regression (FR-001/FR-016)**: never sign in: the quiz, deck,
    watchlist, and history behave exactly as in 003, including offline.

## Verification status

Recorded honestly, because a walkthrough nobody ran is not evidence.

| Step | Requirement | Status |
|------|-------------|--------|
| 1–12 | US1–US4 behaviours above | **NOT RUN** — this guide ships with the plan, before implementation. |
| — | Automated suite (merge, lockout, queue, stores) | **NOT RUN** — tests are written red-green during `/speckit-implement`. |

## Expected outcomes

- **SC-001, SC-004, SC-005, SC-007, SC-010** are enforced by the critical-path
  tests (merge and queue suites) plus walkthrough steps 1/5/6/7/9.
- **SC-002 / SC-008** (60 s register / 30 s sign-in) are wall-clock
  observations of steps 1 and 4 — no automation claims them.
- **SC-003** is step 4, cross-device.
- **SC-006** (90% first-attempt registration success) is an operational
  metric over real traffic; not verifiable in a single walkthrough.
- **SC-009** is step 11, touch-only at 360px.

## What this slice does not include

- **Forgot-password / account deletion / subscription management** — out of
  scope per the spec's Assumptions.
- **Catalog, TMDB, JustWatch on the backend** — Milestone 2; 004's API knows
  titles only as opaque ids.
- **Email verification** — accounts activate immediately (spec Assumptions).
- **Any change to how 001–003 render or store guest data** — their contracts
  are consumed, not modified.
