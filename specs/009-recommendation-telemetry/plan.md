# Implementation Plan: Recommendation Telemetry & Offline Evaluation

**Branch**: `009-recommendation-telemetry` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-recommendation-telemetry/spec.md`

## Summary

Record every recommendation card the deck displays and every action on it, and
add an offline harness that replays a frozen fixture to compare rankers.

The deck already computes the ranking in the browser, so the client is where an
impression is observable. The client creates a random per-tab session id, a
client event id per event, and a small filter digest; it queues events in
memory and posts them in batches to a new public `POST
/api/recommendations/events` endpoint. The API stores them in two append-only
PostgreSQL tables (impressions and actions) whose unique client event ids make
retries idempotent. A hosted service purges impressions (and, by cascade,
actions) older than 90 days at startup and daily.

The harness is TypeScript beside the ranker: it replays a committed synthetic
fixture in temporal order, evaluates the incumbent, a popularity baseline, and
any candidate with the same six measures, and runs in the existing frontend
suite, which CI already runs on every push.

The specification's "rotating guest id" assumption was corrected during
planning: the app has no guest identifier today, so this feature introduces a
random per-tab session id instead (research D2).

## Technical Context

**Language/Version**: C# 14 / .NET 10 (backend); TypeScript 6 / Angular 22
(frontend); SQL / PostgreSQL 17 (database).

**Primary Dependencies**: ASP.NET Core Minimal APIs, EF Core 10 with Npgsql,
ASP.NET Core Identity + JWT (existing); Angular signals, `HttpClient`,
Tailwind (existing). No new NuGet or npm package is added. `fetch` with
`keepalive` supplies the page-hide flush; `crypto.randomUUID` supplies event
ids; FNV-1a is implemented in a few lines rather than adding a hash library.

**Storage**: PostgreSQL, two new tables via an EF Core migration:
`RecommendationImpressions` and `RecommendationActions`
([data-model.md](data-model.md)). No browser storage for the queue; the session
id uses `sessionStorage` with an in-memory fallback.

**Testing**: xUnit (`dotnet test`) for Domain, Application, and API integration
tests; Vitest through `@angular/build:unit-test` (`npx ng test --watch=false`)
for the telemetry service, filter digest, ranker fields, and the harness. The
integration tests use the existing local-Postgres `CatalogApiFactory` pattern.

**Target Platform**: mobile browsers (360px first), served by the existing
Linux Azure App Service F1 that hosts the API and the built frontend on one
origin.

**Project Type**: web application — Angular PWA frontend plus .NET Clean
Architecture backend, in one repository.

**Performance Goals**: recording an event adds ≤10ms at p95 to a card
interaction (SC-002) and never blocks a render or a swipe (FR-006). A flush of
20 events is one small POST; the intake answers in well under a second on the
existing tier. The standard fixture completes in under 60 seconds (SC-006).

**Constraints**: no PII or free text in the record (FR-020); no third-party
analytics (FR-021); in-memory queue only, bounded retries (FR-007); idempotent
submission (FR-008); whole-batch validation (FR-009); 90-day retention driven
by the server's receipt time (FR-018); ranking stays deterministic and its
ordering unchanged (Constitution VI).

**Scale/Scope**: thousands of events per day, not millions; two new tables, one
public endpoint, one hosted service, one client service, one harness with four
synthetic personas. No visitor-facing screen is added.

## Constitution Check

*GATE: evaluated before Phase 0 and re-checked after Phase 1 design.*

| Principle | Gate | Result |
|---|---|---|
| I. Mobile-First Experience | No new screen, layout, or tap; the deck at 360px is untouched; recording is invisible. | **PASS** |
| II. Decision Speed & Simplicity | Fire-and-forget recording adds no step and cannot delay a card; the design is two tables, one endpoint, one service, one harness. No analytics vendor, no queue library, no event bus. | **PASS** |
| III. Guest-First Access | The intake is anonymous-first; a guest completes the whole flow with no account. Sign-in is optional and only new events carry the account id. | **PASS** |
| IV. API-First Architecture | Events travel browser → PlayNext API → PostgreSQL. No third-party script, no credential in the client, no provider call. The API remains the only write path. | **PASS** |
| V. Test-First for Critical Paths | The feature touches the recommendation path, so tests precede implementation for intake validation, idempotency, retention boundaries, queue failure behavior, and the six measures. The existing Filter Enforcement and Feedback Loop tests must stay green; the ranker's ordering is not changed. | **PASS** |
| VI. Deterministic Recommendations | `rankTitles` keeps the same comparator and inputs; only `score` and `reasonCode` are exposed. The harness has no clock, network, or randomness and uses title-id tie-breakers. No ML. | **PASS** |
| VII. Clean Architecture & Domain Integrity | Entities and the retention rule are in Domain with no framework reference; contracts, interfaces, and use cases in Application; EF, the limiter, and the hosted service in Infrastructure; the endpoint only translates. The harness stays beside the ranker because ranking is client-side today (research D9). | **PASS** |

No violations. Complexity Tracking is empty.

**Post-design re-check (after Phase 1)**: the same table holds. The contract
adds no third-party dependency, no new origin, and no credential; the data model
has no PII column; the harness is deterministic by construction.

## Project Structure

### Documentation (this feature)

```text
specs/009-recommendation-telemetry/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 decisions D1–D16
├── data-model.md        # Tables, validation, retention, client and harness models
├── quickstart.md        # Runnable validation scenarios
├── contracts/
│   ├── recommendation-events.md
│   └── evaluation-harness.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Generated by /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── PlayNext.Domain/
│   │   ├── RecommendationImpression.cs          # NEW entity
│   │   ├── RecommendationAction.cs              # NEW entity
│   │   ├── RecommendationActionKinds.cs         # NEW closed vocabulary
│   │   ├── RecommendationReasonCodes.cs         # NEW closed vocabulary (added during T036)
│   │   └── RecommendationRetention.cs           # NEW 90-day rule
│   ├── PlayNext.Application/
│   │   ├── Contracts/RecommendationEventsContracts.cs        # NEW request/response DTOs
│   │   ├── Interfaces/IRecommendationEventStore.cs           # NEW
│   │   ├── Interfaces/IRecommendationIntakeLimiter.cs        # NEW
│   │   ├── Interfaces/IRecommendationRetentionStore.cs       # NEW
│   │   ├── UseCases/RecordRecommendationEventsUseCase.cs     # NEW validate → limit → store
│   │   ├── UseCases/RecommendationIntakeLimiter.cs           # NEW in-memory windows
│   │   ├── UseCases/PurgeRecommendationEventsUseCase.cs      # NEW
│   │   └── Validation/RecommendationEventValidator.cs        # NEW
│   ├── PlayNext.Infrastructure/
│   │   ├── Persistence/AppDbContext.cs                       # MODIFIED: DbSets + mapping
│   │   ├── Persistence/RecommendationEventStore.cs           # NEW EF implementation
│   │   ├── Persistence/RecommendationRetentionStore.cs       # NEW batched purge
│   │   ├── Persistence/Migrations/                           # NEW migration
│   │   └── Telemetry/
│   │       └── RecommendationRetentionService.cs             # NEW startup + 24h purge
│   └── PlayNext.Api/
│       ├── Endpoints/RecommendationEndpoints.cs              # NEW public endpoint
│       └── Program.cs                                        # MODIFIED: DI + mapping
├── tests/
│   ├── PlayNext.Domain.Tests/RecommendationRetentionTests.cs   # NEW 90-day boundary + vocabularies
│   ├── PlayNext.Application.Tests/RecommendationEventValidatorTests.cs  # NEW
│   ├── PlayNext.Application.Tests/RecordRecommendationEventsUseCaseTests.cs   # NEW
│   ├── PlayNext.Application.Tests/RecommendationIntakeLimiterTests.cs          # NEW
│   ├── PlayNext.Application.Tests/PurgeRecommendationEventsUseCaseTests.cs     # NEW
│   └── PlayNext.Api.IntegrationTests/RecommendationEventTests.cs        # NEW
│       PlayNext.Api.IntegrationTests/RecommendationRetentionTests.cs   # NEW

frontend/
├── src/app/
│   ├── core/
│   │   ├── models/telemetry.ts                  # NEW event and kind types
│   │   ├── services/catalog.service.ts          # MODIFIED: retain fetchedAt as catalog version
│   │   ├── services/http-catalog-source.ts      # MODIFIED: surface fetchedAt through the seam
│   │   ├── telemetry/
│   │   │   ├── filter-digest.ts                 # NEW FNV-1a over normalized filters
│   │   │   ├── telemetry-session.ts             # NEW per-tab anonymous id
│   │   │   ├── telemetry-transport.ts           # NEW fetch transport, test seam
│   │   │   ├── recommendation-telemetry.ts      # NEW queue, flush, counters
│   │   │   └── *.spec.ts                        # NEW one spec beside each unit
│   └── features/deck/
│       ├── deck-logic/recommend.ts              # MODIFIED: engine version, score, reasonCode, eligibleTitles
│       ├── deck-logic/recommend.spec.ts         # MODIFIED: ranking unchanged + new fields
│       ├── deck-logic/evaluation/               # NEW harness: types, metrics, replay, rankers,
│       │                                        #      report, harness.spec.ts, and the specs for
│       │                                        #      metrics and replay
│       ├── deck-logic/evaluation/fixtures/      # NEW frozen fixture personas-v1 + its invariant spec
│       ├── deck.ts                              # MODIFIED: impression effect + action hooks
│       └── deck.spec.ts                         # MODIFIED: exactly-once and failure tests
```

**Structure Decision**: the existing web-application layout is kept. The
feature adds one vertical slice through Domain → Application → Infrastructure →
API, and on the client one service under `core/` plus one harness folder beside
the ranker. No new project, no new package, and no new deployment target.

## Phase 0 — Research

All unknowns are resolved in [research.md](research.md):

| # | Decision |
|---|---|
| D1 | Browser → own API → PostgreSQL; no third-party analytics |
| D2 | Random per-tab anonymous session id in sessionStorage |
| D3 | Public batch endpoint with optional bearer authentication |
| D4 | Two tables, client event ids, server receipt time, no account/catalog FKs |
| D5 | `catalogVersion` is the catalog payload's `fetchedAt` |
| D6 | `recommend-v1`, `score`, and `reasonCode` come from the ranker |
| D7 | FNV-1a filter digest over normalized filters |
| D8 | In-memory bounded queue, bounded retries, keepalive page-hide flush |
| D9 | TypeScript harness beside the ranker |
| D10 | Temporal replay uses only the session's past |
| D11 | Six metric definitions |
| D12 | Synthetic persona fixture, committed |
| D13 | CI runs the harness with the existing frontend suite |
| D14 | 90-day purge, startup + daily, batched |
| D15 | Privacy boundaries |
| D16 | Client and server time semantics |

## Phase 1 — Design

| Artifact | Contents |
|---|---|
| [data-model.md](data-model.md) | The two tables, indexes, validation table, idempotency, retention lifecycle, privacy audit, client queue model, harness model |
| [contracts/recommendation-events.md](contracts/recommendation-events.md) | Endpoint, request/response, errors, limits, idempotency, privacy |
| [contracts/evaluation-harness.md](contracts/evaluation-harness.md) | Fixture shape, ranker interface, replay, measures, report, determinism |
| [quickstart.md](quickstart.md) | Eight runnable validation scenarios |

## Post-Design Constitution Re-Check

| Gate | Result |
|---|---|
| I. Mobile-First | **PASS** — no UI surface changes; nothing added to the layout or tap count. |
| II. Decision Speed | **PASS** — recording is a synchronous push into an in-memory array; the network is never on the swipe path. |
| III. Guest-First | **PASS** — anonymous by default; account association is additive and never retroactive. |
| IV. API-First | **PASS** — one first-party endpoint; no vendor; no credential reaches the client. |
| V. Test-First | **PASS** — the task list orders tests before implementation for the intake, retention, queue, and metrics. |
| VI. Deterministic | **PASS** — the ranker's comparator is unchanged; the harness is pure and tie-broken. |
| VII. Clean Architecture | **PASS** — Domain has no framework reference; Infrastructure holds EF, the limiter, and the timer; the API translates. |

## Complexity Tracking

No violations, no added projects, no added packages, no new patterns. Nothing
to justify.
