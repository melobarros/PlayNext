# Tasks: Guest Accounts & Migration

**Input**: Design documents from `/specs/004-guest-auth-migration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (api.md, device-storage.md), quickstart.md

**Tests**: Required — the constitution names guest→account migration a critical path (Principle V: Red-Green-Refactor). Test tasks come first in every phase and MUST fail before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Web app + API per plan.md: `backend/src/PlayNext.{Domain,Application,Infrastructure,Api}/`, `backend/tests/`, `frontend/src/app/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: First backend in the project — solution, packages, database, host config, frontend bootstrap.

**Prerequisite (user, one-time)**: `winget install PostgreSQL.PostgreSQL` — Docker is not available on this machine (research D2); commands are in `specs/004-guest-auth-migration/quickstart.md`.

- [x] T001 Scaffold the backend solution `backend/PlayNext.sln` with projects `backend/src/PlayNext.Domain`, `backend/src/PlayNext.Application`, `backend/src/PlayNext.Infrastructure`, `backend/src/PlayNext.Api` and test projects `backend/tests/PlayNext.Domain.Tests`, `backend/tests/PlayNext.Application.Tests`, `backend/tests/PlayNext.Api.IntegrationTests`; references point inward only (Api → Infrastructure → Application → Domain, per plan.md structure); add `backend/.editorconfig` (constitution: formatting enforced at the solution root)
- [x] T002 [P] Add the justified NuGet packages (plan.md Technical Context) to `backend/src/` and `backend/tests/` csproj files: ASP.NET Core Identity, Microsoft.AspNetCore.Authentication.Google, Microsoft.AspNetCore.Authentication.JwtBearer, Npgsql.EntityFrameworkCore.PostgreSQL, xUnit
- [x] T003 [P] Create the local PostgreSQL database `playnext` and set `ConnectionStrings:Postgres` and `Jwt:SigningKey` (64+ random hex chars) in PlayNext.Api user-secrets, per the commands in `specs/004-guest-auth-migration/quickstart.md`
- [x] T004 [P] Configure the API host in `backend/src/PlayNext.Api/Program.cs`: Identity with PBKDF2 defaults and lockout (5 fails / 15 min — FR-011, research D10), JwtBearer 15-minute HMAC-SHA256 tokens, Google auth handler, refresh-cookie policy (httpOnly, SameSite=Strict locally / None;Secure in prod, research D6), strict CORS allow-list (http://localhost:4200 with credentials, no wildcard), structured request logging that never logs payloads (constitution security standards)
- [x] T005 [P] Bootstrap the frontend integration points: Google Identity Services script tag in `frontend/src/index.html` and the API base URL in `frontend/src/environments/environment.ts` (no secrets — client ID only, research D5)
- [x] T006 Create the EF Core DbContext in `backend/src/PlayNext.Infrastructure/Persistence/AppDbContext.cs` with the five entities from data-model.md (User via Identity, UserSession, UserPreference, UserInteraction, UserWatchHistoryEntry), the `(UserId, TitleId)` index on interactions and the unique `(userId, titleId, chosenAt)` index on history; generate the `InitialCreate` migration (constitution: schema ships as migrations)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The domain core every story builds on — entities, the merge rule (the named critical path), application contracts, infrastructure implementations. **No user story work may begin until this phase is complete.**

**⚠️ CRITICAL**: The merge tests (T007) are written red FIRST — constitution V.

- [x] T007 [P] Write red tests for the merge rule in `backend/tests/PlayNext.Domain.Tests/MergeServiceTests.cs`, covering the critical-path table in quickstart.md: titles unique to either side are kept; a shared title resolves to the newer action; equal timestamps resolve in favor of the account (research D4 determinism); history unions idempotently — the same `(titleId, chosenAt)` pair twice yields one entry; preferences take the newer `updatedAt` whole
- [x] T008 [P] Write red tests for payload validation in `backend/tests/PlayNext.Application.Tests/ValidationTests.cs`: an unknown `state` is rejected (never silently dropped — data-model.md validation rules), non-parseable timestamps rejected, malformed email rejected
- [x] T009 [P] Implement the domain entities in `backend/src/PlayNext.Domain/`: `InteractionState` enum (the six-state vocabulary — the ubiquitous language), `UserInteraction`, `UserPreference`, `WatchHistoryEntry`, and the `GuestState`/`AccountState` document shapes per data-model.md; no framework references (constitution VII)
- [x] T010 Implement `backend/src/PlayNext.Domain/MergeService.cs` — pure, in-memory, union + newest-wins per record with account-wins ties — to turn T007 green
- [x] T011 Implement the application DTOs and validators in `backend/src/PlayNext.Application/` (GuestState, AccountState, register/login/change-password requests) to turn T008 green
- [x] T012 [P] Define the application interfaces in `backend/src/PlayNext.Application/Interfaces/`: `IAccountStateRepository`, `ISessionStore`, `ITokenService`, `IGoogleTokenVerifier` — the seams the use cases code against (constitution VII: persistence behind interfaces)
- [x] T013 Implement the EF Core repositories in `backend/src/PlayNext.Infrastructure/Persistence/` behind the T012 interfaces (one repository pattern, used by every read/write path)
- [x] T014 Implement session + token services in `backend/src/PlayNext.Infrastructure/Security/`: refresh tokens stored as SHA-256 hashes in `UserSession` with 30-day sliding expiry, HMAC-SHA256 access JWTs with 15-minute expiry, revocation on logout and password change (FR-013/FR-014/FR-015, research D6)
- [x] T015 [P] Implement `backend/src/PlayNext.Infrastructure/Security/GoogleTokenVerifier.cs`: ID-token validation against Google JWKS (signature, issuer, audience = configured client ID, expiry) — no real credentials needed to build or unit-test (research D5)
- [x] T016 [P] Write red tests for the auth use cases in `backend/tests/PlayNext.Application.Tests/AuthUseCaseTests.cs` (fakes for all interfaces): register with a guest payload merges losslessly; register with no payload creates an empty account (US1 scenario 4); duplicate email → friendly rejection; wrong password → generic error; the 5th consecutive failure locks the account (FR-011)

**Checkpoint**: Foundation ready — `dotnet test` runs, T007/T008/T016 are red, T010/T011 make their pairs green. User story implementation can now begin.

---

## Phase 3: User Story 1 - Guest creates an account and keeps everything (Priority: P1) 🎯 MVP

**Goal**: A guest registers with email/password or Google and every saved preference, rating, and history entry moves into the account losslessly; they are signed in without redoing anything. Profile becomes the third nav destination; the dismissible nudge appears on Match Found.

**Independent Test**: As a guest, complete the quiz, rate three titles, Watch Now one; register from the Profile → watchlist, history, and quiz preferences are intact while signed in, on this device and on a second device after signing in there (spec US1).

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T017 [P] [US1] Write red gated integration tests in `backend/tests/PlayNext.Api.IntegrationTests/AuthTests.cs` (run when the Postgres connection string is set): register with a seeded guest document → response state equals the device state exactly (SC-001); register with no guest data → empty account; duplicate email → 409 offering sign-in (FR-008)
- [x] T018 [P] [US1] Write red frontend tests in `frontend/src/app/core/services/auth.service.spec.ts`: register/login/google call the contract endpoints with the guest document attached; the session marker is written to `playnext:session`; **no token ever appears in LocalStorage** (research D6)
- [x] T022 [P] [US1] Write red tests in `frontend/src/app/features/profile/profile.spec.ts`: Sign up / Sign in modes, email + password fields with the password hidden while typed (FR-010), the Google button on both modes, generic friendly error messages, touch targets ≥44px at 360px (FR-018), and the Profile link present in the shell nav
- [x] T023 [P] [US1] Write red tests in `frontend/src/app/features/match-found/match-found.spec.ts`: the nudge renders after a Watch Now lock-in, is dismissible, stays dismissed for the session (sessionStorage, research D11), and never blocks Start New Loop (US1 scenario 5, FR-001)

### Implementation for User Story 1

- [x] T019 [US1] Implement the auth use cases in `backend/src/PlayNext.Application/UseCases/` (Register, Login, GoogleSignIn — all funnel the optional guest payload through `MergeService` over the empty/new account) to turn T016 green
- [x] T020 [US1] Implement the auth endpoints in `backend/src/PlayNext.Api/Endpoints/AuthEndpoints.cs` per contracts/api.md: POST /auth/register, /auth/login, /auth/google, /auth/refresh, /auth/logout — the session envelope (access token in body, refresh token as httpOnly cookie, canonical state) to turn T017 green
- [x] T021 [US1] Implement `frontend/src/app/core/models/session.ts` and `frontend/src/app/core/services/auth.service.ts` (register/login/google calls, silent refresh, session marker read/write, tokens in memory only) to turn T018 green
- [x] T024 [US1] Implement the Profile feature in `frontend/src/app/features/profile/` (profile.ts, profile.html), add its route in `frontend/src/app/app.routes.ts`, and add Profile as the third nav destination in `frontend/src/app/features/shell/` to turn T022 green
- [x] T025 [US1] Implement the dismissible nudge in `frontend/src/app/features/match-found/` (match-found.ts, match-found.html) to turn T023 green
- [x] T026 [US1] Wire the Profile forms to AuthService end-to-end: capture the guest documents (`playnext:interactions` + `playnext:quiz-state` per contracts), attach them to the auth call, and write the returned canonical state back to LocalStorage as the device cache (research D3/D7, US1 scenarios 1–3)

**Checkpoint**: User Story 1 fully functional — a guest registers and loses nothing; the second-device sign-in pulls the account state.

---

## Phase 4: User Story 2 - Registered user's data follows them across sessions and devices (Priority: P2)

**Goal**: Signed-in changes (ratings, re-ratings, removals, quiz retakes, Watch Now) reach the account; the account state is pullable from anywhere; offline signed-in use queues changes and replays them (FR-017, SC-010).

**Independent Test**: Sign in on device A, rate a title; open device B, sign in → the rating is there. Retake the quiz on B → A shows it after reload (spec US2).

### Tests for User Story 2 ⚠️

- [ ] T027 [P] [US2] Write red tests in `frontend/src/app/core/services/sync.service.spec.ts`: a signed-in write pushes to the API; a network failure appends to `playnext:sync-pending` and the local write still applies; replay on reconnect clears the queue only on a confirmed 200; a 400 is surfaced, not retried forever (contracts/device-storage.md failure semantics)
- [ ] T028 [P] [US2] Write red tests in `frontend/src/app/core/services/interaction-store.spec.ts` and the quiz store spec: while signed in, `record`/`recordWatch`/`remove` and quiz writes notify the sync sink with the changed items; while a guest, no sink notification fires (research D9)
- [x] T031 [P] [US2] Write red application tests in `backend/tests/PlayNext.Application.Tests/SyncUseCaseTests.cs`: a partial sync body upserts only the given items (omitted = untouched); conflicts resolve newest-wins; an unknown `state` is a 400; history pairs are idempotent

### Implementation for User Story 2

- [ ] T029 [US2] Implement `frontend/src/app/core/models/sync.ts` and `frontend/src/app/core/services/sync.service.ts` (the pending queue per contracts/device-storage.md, replay, cache write-back from the canonical response) to turn T027 green
- [ ] T030 [US2] Wire the sync sink into `frontend/src/app/core/services/interaction-store.ts` and the quiz store: an optional observer notified with changed items after every successful local write, subscribed by SyncService while a session is active (research D9) to turn T028 green
- [x] T032 [US2] Implement the state endpoints in `backend/src/PlayNext.Api/Endpoints/StateEndpoints.cs` + use cases: GET /me/state and POST /me/sync — the single write endpoint for live pushes, offline replay, and migrations (contracts/api.md) — to turn T031 green
- [ ] T033 [US2] Implement boot restore in `frontend/src/app/`: on start, if `playnext:session` exists, silent refresh via cookie; on success pull GET /me/state into the LocalStorage cache; on online failure drop to signed-out guest mode with cached data intact and the Profile inviting sign-in; on offline failure enter signed-in offline mode (offline notice + queue, FR-017, research D12); tests in a boot spec

**Checkpoint**: User Stories 1 AND 2 both work — signed-in data is portable and offline-tolerant.

---

## Phase 5: User Story 3 - Guest data merges with an existing account on sign-in (Priority: P3)

**Goal**: Signing in to an existing account merges the device's guest data under the same union + newest-wins rule; nothing is clobbered, and deck exclusions from both sides hold.

**Independent Test**: On a fresh device, rate title X Disliked as a guest, then sign in to an account that had X as Loved → X is Disliked everywhere, the account's other titles are untouched, the guest's other titles were added (spec US3).

### Tests for User Story 3 ⚠️

- [ ] T034 [P] [US3] Write red tests in `frontend/src/app/core/services/auth.service.spec.ts` (sign-in merge) and `frontend/src/app/features/deck/deck.spec.ts`: login and Google sign-in carry the guest document and write the merged canonical state back to the cache; after a merge, Disliked/Not Interested titles from **either** side stay excluded from the deck (US3 scenario 4)

### Implementation for User Story 3

- [ ] T035 [US3] Implement sign-in and Google guest-document capture + canonical write-back in `frontend/src/app/core/services/auth.service.ts` (reusing T026's plumbing — one code path, not two) to turn T034 green
- [ ] T036 [US3] Extend the gated integration suite in `backend/tests/PlayNext.Api.IntegrationTests/MigrationTests.cs` for US3 scenarios 1–3 end-to-end: sign-in with a conflicting title resolves newest-wins; unique titles on both sides survive; newer preferences win (the merge itself is T007's domain tests — this exercises it through the endpoint). **Assert newest-wins by re-reading the account in a later session, never off the merging call's own response** — the merge is computed in memory, so that response is identical whether or not the write reached PostgreSQL. The conflicting-rating and newer-quiz cases now exist in `AuthTests.cs`; keep this file for scenarios 1–3 proper. Also cover the removals delete path (FR-006) once T032 lands: a removal newer than the stored rating must leave no row behind, and the title must not reappear in a later read

**Checkpoint**: All user stories now independently functional — both migration paths (register and sign-in) are lossless.

---

## Phase 6: User Story 4 - The user manages their account (Priority: P4)

**Goal**: Sign-out returns the device to a clean guest state; password change applies everywhere and kills old sessions; session expiry and lockout surfaces behave per the spec.

**Independent Test**: Sign in, change the password, sign out → clean guest mode with no account data visible (SC-007); sign in with the new password → everything returns (spec US4).

### Tests for User Story 4 ⚠️

- [ ] T037 [P] [US4] Write red application tests in `backend/tests/PlayNext.Application.Tests/ChangePasswordTests.cs`: success revokes **all** sessions; wrong current password → friendly 401; the new password validates on subsequent logins (FR-014)
- [ ] T039 [P] [US4] Write red tests in `frontend/src/app/features/profile/profile.spec.ts` (sign-out + change-password): sign-out warns when the pending queue is non-empty (spec edge case), then clears `playnext:interactions`, `playnext:quiz-state`, `playnext:session`, `playnext:sync-pending` (SC-007); the change-password form confirms the current password first; lockout responses show the retry time (FR-011)

### Implementation for User Story 4

- [ ] T038 [US4] Implement the change-password use case + POST /auth/change-password in `backend/src/PlayNext.Application/UseCases/` and `backend/src/PlayNext.Api/Endpoints/AuthEndpoints.cs` to turn T037 green
- [ ] T040 [US4] Implement the sign-out flow and change-password form in `frontend/src/app/features/profile/` to turn T039 green
- [ ] T041 [US4] Implement the 401 chain in `frontend/src/app/core/`: 401 → one silent refresh → one retry → on failure drop to signed-out guest mode with cached data intact and the lockout/retry-time message surfaced (FR-011, FR-015, research D12); tests in the auth service spec

**Checkpoint**: The full account loop closes — register, migrate, sign out, sign in, change password.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates, documentation, sweeps, and the manual verification that needs a real browser or credentials.

- [ ] T042 Run the quality gates: `dotnet build` and `dotnet test` in `backend/` (integration suite gated on Postgres), `npx ng test --watch=false` in `frontend/` (all 446 existing tests plus the new suites green — NOTE: the working invocation is `npx ng test --watch=false`, never `npx vitest run`), `npm run build` in `frontend/`; record bundle figures
- [ ] T043 [P] Update `README.md` (feature table row for 004) and `frontend/README.md` (new core services, the two new storage keys, run-with-backend instructions pointing at quickstart.md)
- [ ] T044 [P] Sweep for dead code, commented-out blocks, and TODO/FIXME without a tracked issue in `backend/src/` and `frontend/src/` (constitution code-quality gate)
- [ ] T045 Gated — needs Google Cloud credentials (user creates them at verification time, quickstart.md step 3): manually verify Google sign-in end-to-end (US1 scenario 2), the popup-cancel path (FR-012), and email-linking to an existing account (FR-009)
- [ ] T046 Gated — needs a real browser/phone: run the manual walkthrough, quickstart.md steps 1–2 and 4–12, including 360px touch (FR-018, SC-009), signed-in offline replay (FR-017, SC-010), and lockout (FR-011); record results honestly in the quickstart.md verification table

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — **BLOCKS all user stories**
- **User Stories (Phases 3–6)**: All depend on the Foundational phase; they proceed in priority order (P1 → P2 → P3 → P4) — US2's sink (T030) touches the same store files US1's auth writes to, so P1 before P2 avoids edit collisions
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational — no dependencies on other stories
- **US2 (P2)**: Builds on US1's auth service (session detection for the sink); independently testable once the endpoints exist
- **US3 (P3)**: Reuses US1's guest-document plumbing (T026) — one code path, per the "same behavior not implemented two ways" rule
- **US4 (P4)**: Independent of US2/US3; touches Profile files after US1

### Within Each User Story

- Tests MUST be written and FAIL before implementation (constitution V)
- Domain before application, application before endpoints
- Core implementation before integration

### Parallel Opportunities

- Setup: T002–T005 are independent files — parallel
- Foundational: T007/T008/T016 (all red tests) parallel; T012/T013/T014/T015 split by file — T012 before T013/T014
- US1: T017/T018/T022/T023 (all red tests) parallel; T019/T020/T021/T024/T025 implement their pairs
- US2: T027/T028/T031 parallel (red); T029/T030/T032/T033 implement their pairs
- US4: T037/T039 parallel (red); T038/T040/T041 implement their pairs
- Polish: T043/T044 parallel

### Parallel Example: User Story 1

```text
# Launch all red tests for US1 together:
Task: "gated integration tests in backend/tests/PlayNext.Api.IntegrationTests/AuthTests.cs"
Task: "frontend auth service tests in frontend/src/app/core/services/auth.service.spec.ts"
Task: "Profile screen tests in frontend/src/app/features/profile/profile.spec.ts"
Task: "Match Found nudge tests in frontend/src/app/features/match-found/match-found.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test US1 independently — register a guest, verify zero data loss
5. The MVP is: email/password + Google accounts with lossless migration

### Incremental Delivery

1. Setup + Foundational → the backend exists, merge is unit-tested green
2. US1 → guests can convert to accounts losslessly (the headline promise)
3. US2 → signed-in data is portable and offline-tolerant
4. US3 → the second migration path (sign-in merge) is lossless
5. US4 → the account loop closes (sign-out, password change, expiry, lockout)
6. Polish → quality gates green, quickstart verified, recorded honestly

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Verify tests fail before implementing — an initial green is not evidence
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
- Frontend test invocation is `npx ng test --watch=false` (Vitest runs through the Angular builder; bare `npx vitest run` fails in this repo)
- Never kill all `node.exe` processes — target specific PIDs when a dev server hangs
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
