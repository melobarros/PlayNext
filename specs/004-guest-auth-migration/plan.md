# Implementation Plan: Guest Accounts & Migration

**Branch**: `004-guest-auth-migration` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-guest-auth-migration/spec.md`

## Summary

004 makes accounts real: email/password and Google sign-in, lossless
guest-to-account migration on registration or sign-in (union + newest-wins),
cross-device persistence for registered users, offline-tolerant signed-in use
with a pending-changes queue, and account management (sign-out, password
change, session expiry, lockout).

This is the **first backend feature**. Specs 001–003 shipped the Milestone 1
Angular prototype with mock data and LocalStorage; the constitution (Principles
III and IV) always intended accounts to live on a .NET API with PostgreSQL, so
this slice bootstraps that backend — but only as far as 004 needs it. The
catalog stays mock; TMDB/JustWatch remain Milestone 2.

The centerpiece is the **merge rule**, which the spec fixes precisely
(Assumptions): union plus newest-wins, resolved per record by its own
timestamp. Per Principle IV the API owns business rules, so the merge lives
server-side in the Domain layer and is the named critical path for
test-first (Principle V).

## Technical Context

**Language/Version**: C# / .NET 9 (SDK 9.0.300 verified on this machine);
frontend stays Angular 22.2 / TypeScript ~6.0.

**Primary Dependencies** (all standard for the constitution's own stack, each
justified — the spec cannot name implementation details, so they are justified
here):

| Dependency | Why | Justification |
|------------|-----|---------------|
| ASP.NET Core Identity | Accounts, PBKDF2 password hashing, built-in lockout (5 fails / 15 min = FR-011) | Named by the constitution's security standards; the lockout is built in, so FR-011 is configuration, not custom code (research D10) |
| `Microsoft.AspNetCore.Authentication.Google` | Server-side Google ID-token validation (JWKS) | Constitution III names Google OAuth via Identity; no client secret ever reaches the browser (research D5) |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | Access-token validation | Constitution: JWTs, short expiry |
| `Npgsql.EntityFrameworkCore.PostgreSQL` + EF Core 9 | PostgreSQL via EF Core migrations | Constitution's stack |
| xUnit | Backend tests (Principle V red-green) | Standard .NET test framework |

Frontend adds **no npm dependency**. The Google button uses Google's Identity
Services script (loaded from Google's CDN in index.html); it is the OAuth
client Google ships for the popup flow and cannot be meaningfully reproduced
by hand (research D5).

**Storage**: PostgreSQL via EF Core migrations. Local dev: PostgreSQL installed
natively (`winget install PostgreSQL.PostgreSQL`) because **Docker is not
available on this machine**; Neon free tier is the documented cloud
alternative; CI gets Postgres as a GitHub Actions service container. The
frontend's LocalStorage keys from 001–003 remain the guest store and become the
signed-in device cache; two new versioned keys arrive with 004 (research D7/D8,
[contracts/device-storage.md](./contracts/device-storage.md)).

**Testing**: xUnit for Domain + Application; a small gated integration suite
for API + EF against Postgres; frontend keeps Vitest via `ng test` (446 tests
must stay green) and gains auth/sync tests. The migration merge is the new
named critical path — red-green from task 1.

**Target Platform**: PWA (360px, touch-first) on any modern mobile browser;
backend hosted later on Azure Container Apps/App Service per the constitution,
with the frontend on Static Web Apps. Local dev on Windows for now.

**Project Type**: web-app (Angular PWA) + web-service (.NET REST API).

**Performance Goals**: auth and sync calls are document-sized (≤ a few hundred
entries, ~tens of KB); merge is one pass per collection, linear in entries
(same bound 003 analyzed for 500+). SC-002 (register + migrated data in <60 s)
and SC-008 (sign-in <30 s) are dominated by network, not compute. Card render
budget (<300 ms) is untouched — 004 does not change the deck's render path.

**Constraints**: 360px touch-first (FR-018); guest mode fully offline-capable
and never gated (FR-001, FR-016); newest-wins merge identical everywhere
(FR-004/FR-005); secrets never in client code; JWTs short-lived; strict CORS;
PBKDF2 (all research D2–D12).

**Scale/Scope**: single-developer MVP scale — one account per visitor,
48-title mock catalog, bounded 500+ entry documents. One new nav destination
(Profile), two new screens (Profile with sign-up/sign-in, plus the
dismissible nudge on Match Found), no catalog work.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Requirement | How 004 complies | Gate |
|-----------|-------------|------------------|------|
| I. Mobile-First | 360px, 44px targets, dark, fewest taps | FR-018; Profile is the third nav destination, auth is one screen with a mode switch; the nudge never blocks the loop (FR-001) | ✅ |
| II. Decision Speed | Never a dead end; no friction in the loop | Guest mode untouched; nudge dismissible; offline degrades with notices, never walls (FR-016/FR-017) | ✅ |
| III. Guest-First | Optional accounts, lossless migration on register/sign-in | US1/US3 are the feature; the merge rule is the critical path | ✅ |
| IV. API-First | Angular ↔ .NET only; state owned server-side; secrets server-side | Backend bootstrapped; merge + persistence server-side; Google secret only in App Settings/user-secrets (D5) | ✅ |
| V. Test-First | Red-green on critical paths incl. migration | Merge service tests first (tasks phase 1); lockout/merge/queue all unit-tested; migration e2e in quickstart | ✅ |
| VI. Deterministic | Same inputs → same outputs | Merge tie-break is explicit (account wins on equal timestamps, D4); no randomness anywhere in 004 | ✅ |
| VII. Clean Architecture | Domain free of frameworks; one pattern per concern | Four projects (Domain/Application/Infrastructure/Api); merge lives in Domain; the one new pattern — the offline pending queue — is proposed in the spec itself (FR-017, Edge Cases), as VII requires | ✅ |
| Security standards | PBKDF2, JWT short expiry, CORS strict, CSRF, no secrets in logs | Identity defaults (PBKDF2); 15-min access token + 30-day sliding refresh, hashed at rest (D6); CORS allow-list with credentials; refresh cookie protected by SameSite + custom-header requirement; structured logging with no payloads (D12) | ✅ |
| Workflow | PR review, quality gates | Backend build/test + frontend build added to the gate list | ✅ |

**No violations.** Complexity Tracking is intentionally empty.

**Post-design re-check (after Phase 1)**: still passing. The design artifacts
introduced no new gates: the merge lives in Domain (VII), the pending queue is
the one new pattern and is proposed in the spec (VII), Google credentials stay
server-side (IV), the token split honors both short-JWT and 30-day-inactivity
(V, security), and tie-breaks keep the merge deterministic (VI).

## Project Structure

### Documentation (this feature)

```text
specs/004-guest-auth-migration/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/                                # NEW — bootstrapped by this feature
├── PlayNext.sln
├── src/
│   ├── PlayNext.Domain/                # entities, InteractionState, merge rules
│   ├── PlayNext.Application/           # use cases, DTOs, interfaces
│   ├── PlayNext.Infrastructure/        # EF Core, Identity, Google, JWT
│   └── PlayNext.Api/                   # endpoints, CORS, DI
└── tests/
    ├── PlayNext.Domain.Tests/          # merge service (red-green, constitution V)
    ├── PlayNext.Application.Tests/
    └── PlayNext.Api.IntegrationTests/  # gated on a real Postgres (D2)

frontend/src/app/                       # existing, extended
├── core/
│   ├── models/
│   │   ├── session.ts                  # NEW — signed-in session shape
│   │   └── sync.ts                     # NEW — pending-operation queue types
│   └── services/
│       ├── auth.service.ts             # NEW — register/login/google/refresh/logout
│       ├── sync.service.ts             # NEW — push, pull, replay, merge fan-in
│       └── (existing stores gain a write sink, D9)
├── features/
│   ├── profile/                        # NEW — Profile screen, sign-up/sign-in
│   ├── match-found/                    # extended — dismissible nudge (US1 scenario 5)
│   └── shell/                          # extended — third nav destination
```

**Structure Decision**: backend follows the constitution's four-project Clean
Architecture layout (Web API → Application → Domain, Infrastructure at the
edge). Frontend keeps the established `core/` + `features/` layout; auth and
sync logic live in `core/services` because three features (deck, watchlist,
profile) touch them, matching how `catalog.service` and `interaction-store`
already live. No new frontend folder conventions — the `features/` rule from
002/003 applies unchanged.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — the check above passed with no violations.
