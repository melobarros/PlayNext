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

- [x] T027 [P] [US2] Write red tests in `frontend/src/app/core/services/sync.service.spec.ts`: a signed-in write pushes to the API; a network failure appends to `playnext:sync-pending` and the local write still applies; replay on reconnect clears the queue only on a confirmed 200; a 400 is surfaced, not retried forever (contracts/device-storage.md failure semantics). **The guest case in T028's wording is asserted where it is observable — no request and no queue — not as "the sink was not notified": the stores stay auth-free and it is `SyncService.push` that declines (research D9's "SyncService subscribes while a session is active"), so a spy on the sink would pin the wrong layer.**
- [x] T028 [P] [US2] Write red tests in `frontend/src/app/core/services/interaction-store.spec.ts` and the quiz store spec: while signed in, `record`/`recordWatch`/`remove` and quiz writes notify the sync sink with the changed items; while a guest, no sink notification fires (research D9)
- [x] T031 [P] [US2] Write red application tests in `backend/tests/PlayNext.Application.Tests/SyncUseCaseTests.cs`: a partial sync body upserts only the given items (omitted = untouched); conflicts resolve newest-wins; an unknown `state` is a 400; history pairs are idempotent

### Implementation for User Story 2

- [x] T029 [US2] Implement `frontend/src/app/core/models/sync.ts` and `frontend/src/app/core/services/sync.service.ts` (the pending queue per contracts/device-storage.md, replay, cache write-back from the canonical response) to turn T027 green. **A `400` is `refused` and queued; status 0 and every other code are `deferred` and queued. The failure is classified, not merely caught** — a permanently-rejected operation on the queue is retried on every future sync forever.
- [x] T030 [US2] Wire the sync sink into `frontend/src/app/core/services/interaction-store.ts` and the quiz store: an optional observer notified with changed items after every successful local write, subscribed by SyncService while a session is active (research D9) to turn T028 green. **The account's own write-back path must stay silent or the sync loops**: `InteractionStore.replace`/`clear` and the new `PreferenceStore.replace` (used by `AccountCache`) announce nothing, because the cache write is reached *from* a push's success handler. `PreferenceStore.write` announces only a **completed** quiz — the account has no use for a half-answered one. The unit tests pin each method's quietness but cannot see which one `AccountCache` calls, so `sync.service.spec.ts` asserts the loop itself: caching a response must leave no second `POST /me/sync` open (`http.verify()`).
- [x] T032 [US2] Implement the state endpoints in `backend/src/PlayNext.Api/Endpoints/StateEndpoints.cs` + use cases: GET /me/state and POST /me/sync — the single write endpoint for live pushes, offline replay, and migrations (contracts/api.md) — to turn T031 green
- [x] T033 [US2] Implement boot restore in `frontend/src/app/`: on start, if `playnext:session` exists, silent refresh via cookie; on success pull GET /me/state into the LocalStorage cache; on online failure drop to signed-out guest mode with cached data intact and the Profile inviting sign-in; on offline failure enter signed-in offline mode (offline notice + queue, FR-017, research D12); tests in a boot spec. **`AuthService.refresh()` returns `RefreshOutcome` (`refreshed | refused | unreachable`) rather than a boolean** — "the server said no" and "the server was never reached" are different answers and boot must act differently on each; a boolean cannot carry the difference, and inferring it from `Connectivity` would repeat the mistake that service's own doc warns about ("a failed request proves that one request failed"). Only `401`/`403` are a refusal; a `5xx` is unreachable. Expiry calls `AuthService.expire()`, which drops the marker and leaves the cache — D12's "cached data intact", and the opposite of sign-out (SC-007, T037–T040). `Entry` awaits the restore before routing, so a new device's first render is the account's state rather than a detour through a quiz already taken.

**Checkpoint**: User Stories 1 AND 2 both work — signed-in data is portable and offline-tolerant.

---

## Phase 5: User Story 3 - Guest data merges with an existing account on sign-in (Priority: P3)

**Goal**: Signing in to an existing account merges the device's guest data under the same union + newest-wins rule; nothing is clobbered, and deck exclusions from both sides hold.

**Independent Test**: On a fresh device, rate title X Disliked as a guest, then sign in to an account that had X as Loved → X is Disliked everywhere, the account's other titles are untouched, the guest's other titles were added (spec US3).

### Tests for User Story 3 ⚠️

- [x] T034 [P] [US3] Write red tests in `frontend/src/app/core/services/auth.service.spec.ts` (sign-in merge) and `frontend/src/app/features/deck/deck.spec.ts`: login and Google sign-in carry the guest document and write the merged canonical state back to the cache; after a merge, Disliked/Not Interested titles from **either** side stay excluded from the deck (US3 scenario 4). The auth-service half landed with T026 (`the guest document it sends`, 5 tests; `the device cache it writes back`, 7). The deck half is one test in a new `a merge that arrived from the account (004 US3 scenario 4)` block, and it drives the **real** `AuthService` rather than the `AccountCache` seam — the claim spans the whole path a merge travels (guest document up → merged document down → the card that renders), so substituting any one link would leave the interesting part untested. It needed `provideHttpClient()`/`provideHttpClientTesting()`, so `configure()` gained an optional extra-providers parameter and this test resets and rebuilds the module; the other 40-odd deck tests keep the TestBed they had. The fixture makes each side's exclusion separately load-bearing: the account's older `disliked` of Alpha is proven by reaching **Bravo** at all (Alpha leads the catalog — scores tied, id breaks them), and the guest's `notInterested` of Golf is proven by one Skip emptying the deck (Golf was next in line). Falsified against `EXCLUDING_STATES` losing `notInterested` (caught) and `AccountCache.write` no longer replacing the interactions (caught).

### Implementation for User Story 3

- [x] T035 [US3] Implement sign-in and Google guest-document capture + canonical write-back in `frontend/src/app/core/services/auth.service.ts` (reusing T026's plumbing — one code path, not two) to turn T034 green. No new work: T026's `enter(path, credentials)` is already the single path all three ways in share — `register`, `signIn` and `signInWithGoogle` each pass a path segment and their own credentials, and each ends in the same `guestDocument()` → `accept()` pair. That was the point of building it that way (contracts/api.md: "the same behavior is not implemented three ways"), so US3 is the earlier task's plumbing being *used*, not extended.
- [x] T036 [US3] Extend the gated integration suite in `backend/tests/PlayNext.Api.IntegrationTests/MigrationTests.cs` for US3 scenarios 1–3 end-to-end: sign-in with a conflicting title resolves newest-wins; unique titles on both sides survive; newer preferences win (the merge itself is T007's domain tests — this exercises it through the endpoint). **Assert newest-wins by re-reading the account in a later session, never off the merging call's own response** — the merge is computed in memory, so that response is identical whether or not the write reached PostgreSQL. The conflicting-rating and newer-quiz cases now exist in `AuthTests.cs`; keep this file for scenarios 1–3 proper. Also cover the removals delete path (FR-006) once T032 lands: a removal newer than the stored rating must leave no row behind, and the title must not reappear in a later read.

    Four tests, every assertion read from a later session (login with no guest document, then `GET /me/state` — the endpoint with no merge in it). Scenario 1 is the exact set, not "contains both", and covers both migration paths at once since register and sign-in share `CompleteAsync`. Scenario 2 and scenario 3 each get the direction the existing suite was missing: the state that must **lose**. This was not a theoretical gap — mutating `MergeService` to always take the incoming rating failed *one* test, the new one, with AuthTests and StateTests green; the same mutation on `MergePreferences` likewise. A merge that always preferred whatever arrived answered every case that existed before. The quiz case asserts two dimensions, because "preferences are replaced whole, never field-merged" is only visible when a field-merge would produce a document neither side ever answered.

    **Removals are not here, and that is the contract rather than an omission.** api.md is explicit that "`removals` is meaningful only on `POST /me/sync`. The auth paths' `guest` payload never carries it" — a stored device document expresses a removal as the title's *absence*, and absence has no timestamp to compare. So FR-006's delete path is `StateTests.A_removal_newer_than_the_stored_rating_deletes_it_and_leaves_the_rest_alone`, which already has the two properties T036 names: the row is gone, read back through `GET /me/state` rather than off the sync response, and the sibling rating is still there so "empty account" cannot pass for "removal worked".

    One thing the suite does *not* need, confirmed by mutation rather than assumed: a union cannot be lost the way an update can. Flipping `LoadInteractionsAsync(forWrite: true)` to `false` makes every applied rating a no-op on an untracked row — the merge result stays correct, so the response stays correct, and only the database is stale. That mutation is caught by `AuthTests.A_newer_rating_from_a_second_device_replaces_the_stored_one` and *not* by the union test, because a union inserts and an insert still happens. The `forWrite` doc in `AccountStateRepository` already warns that this failure is silent; this is the test that makes it audible.

**Checkpoint**: All user stories now independently functional — both migration paths (register and sign-in) are lossless.

---

## Phase 6: User Story 4 - The user manages their account (Priority: P4)

**Goal**: Sign-out returns the device to a clean guest state; password change applies everywhere and kills old sessions; session expiry and lockout surfaces behave per the spec.

**Independent Test**: Sign in, change the password, sign out → clean guest mode with no account data visible (SC-007); sign in with the new password → everything returns (spec US4).

### Tests for User Story 4 ⚠️

- [x] T037 [P] [US4] Write red application tests in `backend/tests/PlayNext.Application.Tests/ChangePasswordTests.cs`: success revokes **all** sessions; wrong current password → friendly 401; the new password validates on subsequent logins (FR-014). **The third claim cannot be settled here and moved to T038's integration tests** — against a fake `IAccountStore`, "the new password validates on the next sign-in" is a test asserting that a stub returns what it was told to return, and whether a password really changed is a fact about a stored hash. The seven tests here cover the first two claims plus the negative halves a fake *can* express: nothing is revoked before a failure (`A_wrong_current_password_changes_nothing_at_all`, `A_rejected_new_password_ends_no_sessions`), and a missing field is an ordinary refusal rather than a 500. The file shares `AuthHarness.cs` rather than declaring its own fakes — `InMemoryAccountStateRepository`'s own doc sets the rule ("one copy, shared by both suites, so they cannot drift"), and a second `FakeAccountStore` would be the second answer to "what does the store contract mean". `FakeAccountStore` gained a `Changes` list, `CurrentPasswordMatches` and `WeakNewPassword` to carry these; a rejected new password throws `WeakPasswordException`, which is how Identity reports it. That exception had to **move from `PlayNext.Infrastructure.Security` to `PlayNext.Application.Interfaces`** — it is thrown by the implementation but caught by the use case, and a contract type only one implementation can see is one the Application layer (and its test project) cannot honour without reaching outward past its own boundary (constitution VII).
- [x] T039 [P] [US4] Write red tests in `frontend/src/app/features/profile/profile.spec.ts` (sign-out + change-password): sign-out warns when the pending queue is non-empty (spec edge case), then clears `playnext:interactions`, `playnext:quiz-state`, `playnext:session`, `playnext:sync-pending` (SC-007); the change-password form confirms the current password first; lockout responses show the retry time (FR-011). Twelve tests in a new `a visitor who is signed in (US4)` block; 545 existing pass unchanged. **The lockout clause is already satisfied and gets no new test**: the change-password endpoint cannot produce a lockout — Identity's lockout lives on `CheckPasswordSignInAsync`, not on `ChangePasswordAsync`, and the use case maps only Succeeded/InvalidCredentials/PasswordRejected — so a test feeding `code: 'locked'` into that form would be asserting a state the API never sends. The screen's one `explain()` handles the retry time, and `'says how long a locked-out visitor has to wait (FR-011)'` already pins it. `ACCOUNT_DEVICE_KEYS` is spelled as four literals rather than imported constants: the key *names* are the frozen contract (`contracts/device-storage.md`), and a test reading them from a constant would follow that constant to a name no earlier build's data lives under. The sign-out setup drives a real sign-in rather than seeding `playnext:session`, because the access token lives in memory and in no storage key — a seeded marker leaves every authenticated request in the block going out without one. **Two assertions were rewritten after writing them.** `'leaves none of the account on the device'` first seeded the queue with `'{}'`, which `SyncService` discards at construction as unparseable — the key would have been gone before sign-out could be blamed, so it now seeds a real empty document. `'ends the session the server has already ended'` first asserted `playnext:interactions` was merely non-null, which every sign-in satisfies since the register response writes the cache; it now flushes a state carrying a rating and asserts the rating survives, which is the thing that distinguishes "kept the cache" from "wiped it".

### Implementation for User Story 4

- [x] T038 [US4] Implement the change-password use case + POST /auth/change-password in `backend/src/PlayNext.Application/UseCases/` and `backend/src/PlayNext.Api/Endpoints/AuthEndpoints.cs` to turn T037 green. `ChangePasswordStatus`/`ChangePasswordResult` are their own types rather than a reuse of `AuthStatus`/`AuthResult`, because the two answer different questions: every `AuthStatus` is about a session (one is issued or it is not) and a password change issues nothing — sharing the enum would make `Succeeded` mean "signed in" in one place and "changed" in another, and the endpoint's status-to-code mapping would have to guess which. **Order matters and is the design**: nothing is revoked until the change has succeeded (a mistyped current password must not sign a visitor out of every device they own), and the change is committed before the revocation, so a failure in the second step leaves the credential rotated rather than the sessions alive. The account comes from the token's `sub` claim and never from the body — `ChangePasswordAsync` takes `userId` as its own parameter for exactly that reason, since a body naming its own account would let any signed-in visitor change anyone's password. `?? string.Empty` on both fields, because Identity throws on null and a malformed body deserves an ordinary refusal rather than a 500. The handler was also the second caller of "who is this request from", so that became `backend/src/PlayNext.Api/Endpoints/CurrentUser.cs` and `StateEndpoints.cs` was refactored onto it. **The five integration tests here close T037's moved claim**, and they observe revocation through `POST /auth/refresh` — an access token cannot answer the question, being a 15-minute credential no revocation reaches, so the cookie that outlives it is what "signed in" means. `A_wrong_current_password_changes_nothing` and `A_rejected_new_password_changes_nothing` assert the session *survived* as well as the refusal, which is the half that costs a visitor something. Falsified by deleting the `RevokeAllForUserAsync` call: exactly `Changing_the_password_ends_every_session_including_the_one_that_asked` failed, 42 others green. Falsified again by deleting `RequireAuthorization()` from the route: **the suite stayed green**, because the handler's own null-subject check answers 401 too — the test asserts the outcome, not which of the two guards produced it, and its comment now says so. `POST /auth/refresh` had no coverage anywhere before this; it has incidental coverage now, but no test of its own and none of rotation or expiry.
- [x] T040 [US4] Implement the sign-out flow and change-password form in `frontend/src/app/features/profile/` to turn T039 green. 557/557 frontend green. **The signed-in half replaces the guest half rather than joining it** — a visitor holding a session has nothing to do with a sign-up form, and leaving one up invites a second account for an address already in use. **Sign-out is the one flow that spans two services and the Profile is the only place that can end it**: `AuthService.signOut()` now wipes `playnext:interactions` and `playnext:quiz-state` before `forget()`, but it cannot touch `playnext:sync-pending` — that is `SyncService`'s document and nothing else may write it (`contracts/device-storage.md`), and `SyncService` injects `AuthService`, so reaching back would be a cycle. The flow calls `sync.clearQueue()` and the SC-007 test asserts all four keys gone, which is the guard against a later edit forgetting one. **This is what makes `expire()` and `signOut()` different**, and the difference is written out rather than shared: expiry keeps the cache because the visitor did not ask to leave; signing out removes it because they did. The warning latch (`confirmingSignOut`) is a latch rather than a re-try: replaying again would warn again about the same unreachable server, and a visitor with no signal could never sign out at all. **`AuthService.changePassword` attaches the bearer token itself** rather than waiting for T041's interceptor — it is the only auth-service call that needs one (`refresh` and `logout` use the cookie), and the profile spec provides a bare `HttpClient`; the two must not both attach it when the interceptor lands. A success ends the local session, because the server revoked this one too: the access token would keep working for its remaining minutes and then stop, dropping the visitor at the next silent refresh with nothing on screen to explain it. Falsified four ways, each failing exactly one test: splitting `signOut`'s wipe out (SC-007); dropping the `!confirmingSignOut()` latch (`signs out anyway when the visitor presses again` — no logout request is ever made); making `changePassword` wipe the cache as well; and removing its `forget()` entirely.
- [x] T041 [US4] Implement the 401 chain in `frontend/src/app/core/`: 401 → one silent refresh → one retry → on failure drop to signed-out guest mode with cached data intact and the lockout/retry-time message surfaced (FR-011, FR-015, research D12); tests in the auth service spec. 567/567 frontend green. `session.interceptor.ts` is registered in `app.config.ts`, which is where the whole feature's most consequential defect was hiding — **`appConfig` had no `provideHttpClient()` at all**, and `AuthService`, `SessionBoot` and `SyncService` all inject `HttpClient`. The original reading of that ("the app would fail at bootstrap") was **wrong, and probing it was what corrected it**: Angular provides `HttpInterceptorHandler` and `HttpClient` at the root regardless, so injection succeeds with an **empty interceptor chain** and the app boots happily. What was actually lost is silent — no `Authorization` on `/me/state` or `/me/sync`, no 401 chain, and an expired session that looks like a server that stopped answering. That is why an earlier draft of `app.config.spec.ts` asserting `TestBed.inject(HttpClient)` does not throw was **deleted rather than kept**: it cannot fail, because the root handler answers whether or not `appConfig` provides anything, and it passed with `provideHttpClient` removed outright. The surviving test drives a request and expects the refresh, which is the only observable difference a client with the interceptor has. **The interceptor has two jobs and they need two different lists.** *Attaching the token* excludes `/auth/register|login|google|refresh|logout` — each authenticates by cookie or by its own body, and a bearer token offered to an endpoint that never asked is how a stale credential reaches a log. *The 401 chain* stops at the whole `/api/auth/` namespace, because these are the endpoints where a 401 is an **answer**: `/auth/login` counting a wrong password against FR-011's five attempts, and `/auth/change-password` — which carries a token and so looks exactly like an expiry — reporting a wrong current password. A single "skip `/api/auth/`" rule would have broken change-password's bearer header; a single "retry authorized requests" rule would have spent two of five attempts per wrong guess and made the lockout message a lie. `AuthService.changePassword` no longer builds its own header (T040's note flagged the double-attach as the thing to watch; the interceptor now owns it) and the profile spec provides the interceptor, since the token on that request is attached by it and nothing else. **Only a `refused` refresh calls `expire()`** — `unreachable` proves the connection failed and nothing about the session, so treating it as expiry would sign a visitor out for walking into a lift. Falsified seven ways: never attaching the token (3 tests — the two bearer assertions here and T039's profile test, which confirms the interceptor is now genuinely that test's mechanism); never chaining (4 chain tests plus the config guard); chaining everything (39 failures, mostly `http.verify()` in unrelated specs, because a chained `/auth/login` 401 fires a refresh no spec flushes — the exclusion is load-bearing well beyond the lockout); expiring on any non-refreshed outcome (1); retrying with the old token (1); attaching the token to the cookie endpoints (1, on the refresh's absent header); and dropping `provideHttpClient` entirely (1). The two negative tests — "does not chain…" — pass under the *never-chain* mutation too, which is the known asymmetry of negative assertions; the positive tests are what cover that side.

**Checkpoint**: The full account loop closes — register, migrate, sign out, sign in, change password.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates, documentation, sweeps, and the manual verification that needs a real browser or credentials.

- [x] T042 Run the quality gates: `dotnet build` and `dotnet test` in `backend/` (integration suite gated on Postgres), `npx ng test --watch=false` in `frontend/` (all 446 existing tests plus the new suites green — NOTE: the working invocation is `npx ng test --watch=false`, never `npx vitest run`), `npm run build` in `frontend/`; record bundle figures. **Green on 2026-09-27.** Backend **147/147** — 28 domain + 76 application + 43 integration, 0 failed, 0 skipped, so the gated integration suite really ran against Postgres rather than being silently skipped (`Ignorado: 0` is the line to read; `Aprovado!` is Portuguese for passed and the CLI prints in Portuguese on this machine). Frontend **567/567** across 36 files. Production build succeeds: **initial total 295.60 kB raw / 80.73 kB estimated transfer** (main 114.00 kB / 29.23 kB, styles 19.39 kB / 3.98 kB), plus lazy chunks per route — `profile` 11.39 kB and `deck` 14.60 kB the largest. The task text's "446 existing tests" was stale and is corrected here: 001–003 ended at 446, and 004 added 121 (the count moved several times as suites were rewritten, so the figure above is the one that was measured, not the one that was planned).
- [x] T043 [P] Update `README.md` (feature table row for 004) and `frontend/README.md` (new core services, the two new storage keys, run-with-backend instructions pointing at quickstart.md). **Both files were stale in ways 004 caused, not just incomplete.** The root README said "there is no backend — everything above is the Angular client on LocalStorage", listed `backend/` as "not yet created (arrives in Milestone 2)", and named .NET 8 — but `git log -- backend/` shows all three of its commits are 004's, and the projects target `net9.0`. Its gaps paragraph went from three to four and named T047, because a reader deciding whether to trust the feature table should not have to find that in `tasks.md`. (That paragraph is back to three gaps and no longer names T047: T047 was closed after this note was written and the README was updated again — see T047.) The frontend README's storage table gained `playnext:session` and `playnext:sync-pending` (both marked frozen, both naming their single writer) plus the sessionStorage nudge key, and a new **"How auth reaches code that predates it"** section explains the seam — `WriteSink` outward, `AccountCache` inward — since that is the design decision a reader of this feature most needs and the one least visible from any single file. The proxy claim was verified rather than assumed: `proxy.conf.json` exists, is wired in `angular.json`, and targets `http://localhost:5003`, which is the API's own `http` profile in `launchSettings.json`.
- [x] T044 [P] Sweep for dead code, commented-out blocks, and TODO/FIXME without a tracked issue in `backend/src/` and `frontend/src/` (constitution code-quality gate). **Clean, and the sweep is worth describing because the first pass looked like it had found things.** No `TODO`/`FIXME`/`HACK`/`XXX` in either source tree, and every "commented-out code" regex hit was a prose comment that happened to begin with a keyword (`// returning a session would contradict…`). The export sweep flagged seven symbols as unimported — `SYNC_SCHEMA_VERSION`, `RemoveOperation`, `HistoryOperation`, `PreferencesOperation`, `SyncPendingDocument`, `SyncOutcome` — and every one is a **false positive**: each is referenced inside its own file, and they are exported as the module's named surface in a codebase that exports its model types as a matter of course. `RateOperation` and `SYNC_PENDING_STORAGE_KEY` are the same kind of declaration and *are* imported by `sync.service.spec.ts`, which is what shows the flagged seven differ by nothing but their callers. Nothing was deleted: removing an `export` that the contract names would be churn, and `SyncPendingDocument` is the shape `contracts/device-storage.md` specifies. `dotnet build` reports **0 warnings**, so there is no compiler-visible dead member either; the backend file sweep's hits were all `obj/` artifacts, EF migration designers, and files whose *name* matches no type (`Contracts/AuthContracts.cs`, `StateContracts.cs`).
- [ ] T045 Gated — needs Google Cloud credentials (user creates them at verification time, quickstart.md step 3): manually verify Google sign-in end-to-end (US1 scenario 2), the popup-cancel path (FR-012), and email-linking to an existing account (FR-009)
- [ ] T046 Gated — needs a real browser/phone: run the manual walkthrough, quickstart.md steps 1–2 and 4–12, including 360px touch (FR-018, SC-009), signed-in offline replay (FR-017, SC-010), and lockout (FR-011); record results honestly in the quickstart.md verification table
- [x] T047 [US2] **Nothing triggers `SyncService.replay()` except the sign-out flow, so a queued change is stranded — and sign-out then discards it.** Found while wiring T041, not in scope there. The path: a signed-in visitor offline rates a title → `push` defers → `playnext:sync-pending` holds it. They come back online and keep using the app. `push` sends only the operations it is *given*, never the queue, so the stranded operation is not retried — and the only other caller is `Profile.signOut`, whose warning ends in `leave()` → `clearQueue()`. So the change the queue exists to protect is the change most likely to be thrown away (FR-017, SC-010; `contracts/device-storage.md` "the queue is cleared only after the server confirms the sync" is satisfied, but nothing ever tries to confirm it). T029 built `replay()` and T027 tested it; the trigger was assumed rather than specified, which is why no task contains it. **Fixed at boot, in `SessionBoot.reconcile()`, and the fix turned out to cover a second defect of the same shape.** `restore()`'s existing `pull()` became `reconcile()`: the state fetch now swallows its own failure with `catchError(() => of(null))` — **not `EMPTY`**, which completes without emitting and would swallow the boot result along with the error — and then `switchMap(() => this.sync.replay())`. Pull first, drain second, so the account's *merged* answer is the last thing written to the cache; reversed, the older state fetch lands on top of the sync and undoes it on screen, and the rating reaches the account while disappearing from the device that made it. Boot is one of the two triggers, not the only one. The other is the connection returning, and the first draft of this note called that YAGNI — wrongly, and the correction is worth keeping: **FR-017 says changes made offline "MUST apply automatically when the connection returns", and SC-010 says 100% of them are applied "after the connection returns"**. T027's own text in this file said "replay on reconnect", and research D7 names three moments ("on reconnect, app boot, or the next successful write"). So the trigger was specified all along and simply never made it into a task. Boot alone would have satisfied the letter of SC-010 — the change does apply *after* the connection returns — while missing FR-017's moment, which matters most for the case the queue was built for: an installed app that stays open for days.
  **The reconnect trigger needed an edge, which neither `Connectivity` nor an effect could give.** `isOnline` is a *level* — true for every second the app runs — so a subscriber acting on it would act always; and watching the signal through `toObservable`/`effect` loses a drop and a return that land in one change-detection pass, because signals coalesce. `Connectivity` now exposes `cameOnline: Observable<void>`, fired from the same `online` listener it already had — the event *is* the transition, so it is handed on where it already arrives rather than adding a second listener on the same browser event. `SyncService` subscribes in its constructor, beside the sink subscription, and guards the drain with `isSignedIn()`: a queue deliberately outlives the session (an expired one keeps it for the next sign-in to merge), so draining unconditionally would fire a credential-less write whenever a signed-out visitor's connection twitched.
  **The second defect: `SessionBoot` now injects `SyncService`, and that injection is what makes the sink live.** `WriteSink`'s only observer is registered in `SyncService`'s constructor, and `grep -rn SyncService src --glob '!*.spec.ts'` showed the only other injection was `Profile` — so a signed-in visitor who rated a title from the deck had the sink run its loop zero times: no request, no queued operation, nothing to retry, and no error either, because an observer-less sink is a `Set` that stays empty. Half of T047's premise ("`push` defers") was therefore not even happening for anyone who had not opened Profile in that page load. Boot is the right owner: it is the one thing guaranteed to run before the first tap.
  Thirteen tests cover it — six in `session-boot.spec.ts` (five for the drain: sends what was queued, asks for nothing when the queue is empty, keeps the queue when the drain cannot be sent, still drains when the pull failed, does *not* drain when the session is over; plus the sink being live from boot), three in `connectivity.spec.ts` (the return is announced, the drop is not, and every return is announced rather than only the first — three flaky minutes on a train are three chances to send) and three in `sync.service.spec.ts` (a reconnect sends what is queued, a drop sends nothing, and a reconnect with no session sends nothing). Seven mutations were run: no boot drain at all (3 fail, sink test passes — the two are independent), drain before pull, `EMPTY` for `of(null)`, draining on the expired path, the session guard removed, the reconnect subscription made a no-op (exactly 1 failure), and `offline` announcing a return too (which fails both "says nothing when it drops" claims). The sink test was isolated separately, by removing the injection *and* the drain: it fails, and it did not fail in the no-drain mutation, so it is pinned to the construction rather than to the drain. Frontend **579/579** (up 12 on T042's 567), production build green at 295.60 kB / 80.74 kB. Also worth recording: `afterEach` in both new specs now clears storage *before* `http.verify()`, because a throwing `verify()` skipped the clear and left a marker or a queue on the device for the next spec file — one real failure became a dozen unrelated ones, which is the worst possible moment to make a suite hard to read.

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
