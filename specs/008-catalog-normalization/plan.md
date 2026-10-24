# Implementation Plan: Normalized Catalog & Per-Service Pools

**Branch**: `008-catalog-normalization` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-catalog-normalization/spec.md`

## Summary

Replace the per-region JSON catalog snapshot with versioned, queryable
PostgreSQL records for titles, genres, services, availability, and refresh runs,
and use them to build deep per-service candidate pools. The existing snapshot
stays as the rollback path and migration source. Readers resolve one active
catalog version per region, so a refresh builds invisible rows and promotes a
complete mixed version in a single transaction — successful slices fresh, failed
slices carried from the last known good. The catalog request keeps its response
shape and gains optional service, genre, media-type, and title-id filters; the
server narrows the candidate set and the client keeps ranking and the final
filter exactly as they are. A refresh discovers each quiz service's catalog
directly (`with_watch_providers` + `watch_region`), enriches each unique title
once for complete availability, pages to 300 titles per service/genre/media
type, and writes the rollback snapshot from the general slice on the way. A
scheduled workflow drives a protected refresh endpoint; every run records its
scope, counts, and failures. Data older than six months is purged, while titles
referenced by ratings, history, or watchlist entries remain readable through a
retired-title archive and a durable title-identity table.

The technical approach and rejected alternatives are in
[research.md](research.md) (D1–D13); the schema and contracts follow in
[data-model.md](data-model.md), [contracts/catalog-api.md](contracts/catalog-api.md),
and [contracts/catalog-refresh.md](contracts/catalog-refresh.md).

## Technical Context

**Language/Version**: C# 13 / .NET 10 (`net10.0`); TypeScript 6.0 on Angular 22.2

**Primary Dependencies**: ASP.NET Core minimal APIs, EF Core 10.0.12 with
Npgsql 10.0.3, ASP.NET Core Identity + JWT Bearer (existing), System.Text.Json,
the TMDB v3 API (bearer token, server-side only), xUnit 2.9.2 for .NET tests,
Vitest 5 + Angular TestBed for the frontend, GitHub Actions for CI and the
scheduled refresh. No new runtime dependency is introduced.

**Storage**: PostgreSQL 17 (Neon in production, a PG17 service container in CI).
New versioned tables (`CatalogVersions`, `CatalogTitles`,
`CatalogTitleGenres`, `CatalogAvailability`), vocabulary tables
(`CatalogGenres`, `CatalogServices`, `CatalogServiceProviders`), operations
tables (`CatalogRefreshRuns`, `CatalogTitleIdentities`,
`CatalogRetiredTitles`), plus the existing `CatalogSnapshots` rollback document.
`IMemoryCache` remains the L1 read cache, now keyed by catalog version.

**Testing**: `dotnet test` for Domain/Application/API integration
(`WebApplicationFactory` with a stub TMDB handler); `npx ng test --watch=false`
for the Angular suite (the project's working command — `npx vitest run` is not
configured); gated live TMDB tests for provider depth and aliases; a Vitest
parity harness over 100+ quiz combinations.

**Target Platform**: Linux web app on Azure App Service F1 (single origin),
serving the Angular PWA and the .NET API; PostgreSQL on Neon.

**Project Type**: Web application — .NET backend (Clean Architecture:
Domain → Application → Infrastructure/Api) and Angular frontend.

**Performance Goals**: first deck card within 300 ms of opening on a warm cache
over 4G (SC-008); a targeted pool response bounded at 1,000 titles and roughly
60–250 KB Brotli-compressed; a warm normalized read served from `IMemoryCache`
in single-digit milliseconds; a full refresh of every active service and region
within 60 minutes (SC-010) with zero visitor-visible errors; admin status
endpoint under 1 second.

**Constraints**: Brazil is the only active region; 11 quiz services, 9 quiz
genres, 3 presentation media types; provider pacing at 30 requests/second; the
existing 24-hour staleness bound; the provider's six-month retention limit; no
provider credential in the client bundle, any response, or any log (FR-017);
no ranking, filter, quiz, or screen-shape changes (FR-025); the catalog
response shape is frozen (FR-004); rollback is a configuration change under
five minutes with no deployment (SC-005); no new Azure resource and no new
runtime dependency.

**Scale/Scope**: 10,000–20,000 unique titles per version (spec assumption),
~25,000–50,000 genre rows and ~15,000–30,000 availability rows, at most two
versions alive per region (active + previous for one day), one scheduled
refresh per day, ~6,300 discovery calls and one enrichment call per unique
title in the worst case, and general pools around today's ~1,000-title size.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Result |
|---|---|---|
| I. Mobile-First | The change must not add weight or a larger first payload on a 390/360 px phone; the deck and every screen keep their existing layout and 44 px targets. | **PASS** — no UI change; targeted pools replace the whole-catalog payload, the response is capped at 1,000 titles, and compression is unchanged. |
| II. Decision Speed & Simplicity | The first card must stay inside the 300 ms budget; no new dead ends; the simplest design that satisfies the requirements. | **PASS** — the deck requests only its slice plus rated ids; the cap and version-keyed cache protect the first card; every failure path keeps the existing cached/empty states. The refresh complexity is server-side and off the request path; it is the minimum needed for a complete mixed version (D1, D4). |
| III. Guest-First | A guest must complete the whole quiz → deck → watchlist flow with no account. | **PASS** — the catalog read is anonymous, and no user record is read or written by this feature. |
| IV. API-First | The Angular client talks only to our API; provider credentials stay server-side; CI credentials stay in scoped secrets and are never logged. | **PASS** — TMDB access stays in `TmdbClient`; the admin token is an Azure app setting and a scoped GitHub secret; no new client-side third-party call. |
| V. Test-First | Critical paths are tested before implementation: parity, migration, refresh failure, retention, rollback, and the feedback-loop invariants. | **PASS** — the test strategy in D12 covers every success criterion; the existing deck/rating/watchlist tests are unchanged except for the source interface. |
| VI. Deterministic Recommendations | No ML, embeddings, or collaborative filtering; ranking stays reproducible and explainable. | **PASS** — no scoring change; pool selection is deterministic (fixed slice/query order, `Popularity DESC, TitleId` cap order), and `rankTitles` is untouched. |
| VII. Clean Architecture & Domain Integrity | Domain stays framework-free; external integrations sit in outer layers behind interfaces; catalog/recommendation rules live in Domain. | **PASS** — slice planning, pool-query validation, and retention rules are Domain types; TMDB and EF stay in Infrastructure behind Application ports. |
| Engineering standards | .NET 10, EF Core migrations, PostgreSQL, one pattern per concern, structured logging, low-cost footprint, migrations before code deploy. | **PASS** — one EF migration, no new dependency or resource, structured run logging without payloads or secrets, migration applied by the existing deploy workflow. |

**Post-design re-check (Phase 1):** all gates still pass. The design adds
tables, a hosted migration runner, two admin endpoints, and a scheduled
workflow, but no principle is violated. `Complexity Tracking` is therefore
empty.

## Project Structure

### Documentation (this feature)

```text
specs/008-catalog-normalization/
├── plan.md                          # This file
├── research.md                      # Phase 0: D1–D13
├── data-model.md                    # Phase 1: schema, relationships, queries
├── quickstart.md                    # Phase 1: runnable validation scenarios
├── contracts/
│   ├── catalog-api.md               # Read contract: filters, ids, errors, rollback
│   └── catalog-refresh.md           # Admin refresh/status + migration runner contract
├── checklists/
│   ├── requirements.md              # Spec-quality checklist (16/16)
│   └── data-migration.md            # Reviewer-owned migration review (40 items)
└── tasks.md                         # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── PlayNext.Domain/                         # Framework-free rules
│   │   ├── CatalogTitle.cs                      # existing wire/domain title
│   │   ├── CatalogClassification.cs             # existing movie/tv/anime rule
│   │   ├── CatalogVocabulary.cs                 # existing genres/services; alias-aware
│   │   ├── CatalogSlice.cs                      # NEW: slice + discovery-stream plan
│   │   ├── CatalogPoolQuery.cs                  # NEW: filter/id normalization + validation
│   │   └── CatalogRetention.cs                  # NEW: cutoff, expiry, archive decision
│   ├── PlayNext.Application/
│   │   ├── Contracts/CatalogContracts.cs        # extend: request, run status, counts
│   │   ├── Interfaces/
│   │   │   ├── ICatalogProvider.cs              # extend: discovery + observation ports
│   │   │   ├── ICatalogPoolReader.cs            # NEW
│   │   │   ├── ICatalogVersionStore.cs          # NEW
│   │   │   ├── ICatalogRefreshRunStore.cs       # NEW
│   │   │   └── ICatalogRetentionStore.cs        # NEW
│   │   └── UseCases/
│   │       ├── CatalogUseCases.cs               # existing snapshot path (kept)
│   │       ├── CatalogQueryService.cs           # NEW: source switch + read orchestration
│   │       ├── RefreshCatalogUseCase.cs         # NEW: plan → discover → enrich → promote
│   │       ├── MigrateCatalogUseCase.cs         # NEW: snapshot → normalized version
│   │       └── CatalogRetentionUseCase.cs       # NEW: purge + archive
│   ├── PlayNext.Infrastructure/
│   │   ├── Catalog/
│   │   │   ├── TmdbClient.cs                    # extend: paged discovery, retries
│   │   │   ├── TmdbOptions.cs                   # extend: depth target, paging, retries
│   │   │   ├── CatalogOptions.cs                # NEW: source switch, admin token, limits
│   │   │   ├── CatalogRefresher.cs              # extend: choose mode from Catalog:Source
│   │   │   ├── CatalogPoolReader.cs             # NEW: pinned-version EF queries
│   │   │   ├── CatalogPoolCache.cs              # NEW: version-keyed IMemoryCache
│   │   │   ├── CatalogVersionStore.cs           # NEW: build/promote/load versions
│   │   │   ├── CatalogRefreshRunStore.cs        # NEW: run records + status
│   │   │   ├── CatalogRetentionStore.cs         # NEW: purge + retired archive
│   │   │   └── CatalogMigrationRunner.cs        # NEW: opt-in hosted one-shot
│   │   └── Persistence/
│   │       ├── AppDbContext.cs                  # extend: new DbSets + constraints
│   │       ├── AccountStateRepository.cs        # extend: title-identity upsert
│   │       ├── CatalogVersion.cs                # NEW (+ title/genre/availability rows)
│   │       ├── CatalogVocabularyRows.cs         # NEW (+ provider mapping)
│   │       ├── CatalogRefreshRun.cs             # NEW
│   │       ├── CatalogTitleIdentity.cs          # NEW
│   │       ├── CatalogRetiredTitle.cs           # NEW
│   │       └── Migrations/                      # NEW: one normalized-catalog migration
│   └── PlayNext.Api/
│       ├── Endpoints/CatalogEndpoints.cs        # extend: filters, ids, admin routes
│       └── Program.cs                           # DI, Kestrel limit, hosted migration runner
└── tests/
    ├── PlayNext.Domain.Tests/                   # NEW: slice, query, retention tests
    ├── PlayNext.Application.Tests/              # NEW: refresh, migration, purge use cases
    └── PlayNext.Api.IntegrationTests/
        ├── CatalogApiFactory.cs                 # extend: stub filters/depth, cleanup
        ├── NormalizedCatalogTests.cs            # NEW
        ├── CatalogRefreshTests.cs               # NEW
        ├── CatalogMigrationTests.cs             # NEW
        ├── CatalogRetentionTests.cs             # NEW
        └── CatalogAdminTests.cs                 # NEW

frontend/
├── src/app/core/
│   ├── models/catalog-query.ts                  # NEW: CatalogQuery shape
│   └── services/
│       ├── catalog.service.ts                   # extend: query-keyed fallback + ids method
│       └── http-catalog-source.ts               # extend: optional params
├── src/app/features/
│   ├── deck/deck.ts                             # targeted pool + rated-id merge
│   ├── deck/match-found/match-found.ts          # ids request
│   ├── watchlist/watchlist.ts                   # ids request
│   ├── watchlist/detail/detail.ts               # ids request
│   └── watchlist/history/history.ts             # ids request
└── src/app/features/deck/deck-logic/parity/     # NEW: 100+ combination parity harness

.github/workflows/
├── deploy.yml                                   # unchanged (already applies migrations)
└── catalog-refresh.yml                          # NEW: scheduled admin refresh + polling
```

**Structure Decision**: The repository is the existing two-part web app
(`backend/` .NET Clean Architecture + `frontend/` Angular). New domain rules go
at the Domain root, next to the catalog types they extend; new ports and use
cases follow the existing manual-DI, one-class-per-concern layout; persistence
entities sit with the existing EF entities; and the read endpoint stays the one
catalog route, with admin routes added in the same endpoint file. No project is
added or renamed.

## Complexity Tracking

> No constitution violations. The versioned-catalog copy and the admin refresh
> endpoint are deliberate design decisions justified in
> [research.md](research.md) D1, D4, and D10 — each is the simplest structure
> that satisfies a hard requirement (FR-014, FR-018) under App Service F1's
> scale-to-zero. No entry belongs in this table.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
