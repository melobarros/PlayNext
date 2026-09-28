# Implementation Plan: Real Catalog (TMDB)

**Branch**: `005-tmdb-catalog` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-tmdb-catalog/spec.md`

## Summary

005 retires the bundled sample catalog and makes the deck deal real titles:
the backend obtains a TMDB credential out of band, composes a bounded
region-scoped title pool from TMDB's popularity ranking, enriches each title
with true per-region watch-provider availability and trailer links, caches the
resulting snapshot server-side (memory + Postgres), and serves it through one
anonymous endpoint. The Angular client swaps its `CatalogSource` seam from the
bundled array to that endpoint — ranking, filtering, and every screen stay
exactly as they are (FR-011, SC-007). Region becomes a real input, derived
from the device locale (FR-005). Badges name every real service, the quiz's
twelve ids preserved and everything else added to the mapping vocabulary
(FR-010). When TMDB cannot be reached, the API serves the last good snapshot
and the client keeps its existing cached-copy fallback and notice (FR-012/013);
when nothing was ever retrieved, the existing empty state appears (FR-014).

This is the feature the 002 catalog seam was built for: `CatalogSource.load`
becomes the REST request, and no component changes shape.

## Technical Context

**Language/Version**: C# / .NET 9 (SDK 9.0.300); frontend stays Angular 22.2 /
TypeScript ~6.0.

**Primary Dependencies**: no new packages on either side.

| Dependency | Why | Justification |
|------------|-----|---------------|
| `HttpClient` (built-in) | TMDB calls through a typed client | Constitution VII: external integrations live in Infrastructure behind interfaces |
| `IMemoryCache` (built-in) | L1 server cache | Named by the constitution's Performance & Reliability standards |
| EF Core + Npgsql (already in) | L2 snapshot persistence (one new table) | Already the stack; the migration ships in this PR per the constitution |
| Angular `HttpClient` (already in) | The catalog request | The 002 seam was designed for exactly this swap |

Frontend adds **no npm dependency** (004 precedent).

**Storage**: one new Postgres table — `CatalogSnapshots` (region → last good
snapshot, jsonb) — shipped as an EF Core migration. This is the L2 behind
`IMemoryCache`; see research D10/D11 for why a persistent layer exists at all
(scale-to-zero hosting + FR-012/013 across restarts). The catalog is otherwise
a cache, not a domain store.

**Testing**: xUnit Domain tests for the mapping and classification rules
(anime, genres, monetization, templates); Application tests for the snapshot
policy (staleness, never-overwrite, single-flight); a gated integration suite
extending the existing `AuthApiFactory` with a stubbed TMDB HTTP handler;
frontend keeps Vitest via `ng test` — the 579 green tests are re-anchored to a
test fixture catalog instead of the retired sample, and gain specs for the HTTP
source and region derivation. Constitution V: the mapping + classification
rules and the cache policy are the named critical paths, red-green.

**Target Platform**: PWA (360px, touch-first) on modern mobile browsers;
backend later on Azure Container Apps / App Service (scale-to-zero) per the
constitution — which is exactly why the snapshot survives restarts.

**Project Type**: web-app (Angular PWA) + web-service (.NET REST API).

**Performance Goals**: SC-002 — first card < 300 ms on a warm cache over 4G.
Served from memory, the payload is ~400 KB raw / ~100 KB gzipped for a
~600-title pool; if the 4G measurement comes up short, the pool quota is the
tuning lever (research D3). Cold-cache visitors are never made to wait: the
API answers immediately and refreshes in the background (D10/D11). SC-003 — a
50-card session causes exactly one client request and zero upstream requests;
a region refresh is one bounded background batch (D4).

**Constraints**: FR-019/SC-003 (bounded upstream calls per session, one client
fetch); FR-012/013 (never discard good data); FR-014 (never a spinner or error
screen); FR-002/SC-006 (credential never in bundle, responses, or logs — the
existing structured logging never logs payloads, and the TMDB key travels only
in a request header from the backend); FR-008 (`include_adult=false` on every
upstream query); FR-018 (TMDB attribution visible).

**Scale/Scope**: single-developer MVP scale — ~600 titles per region snapshot,
refreshed at most once per staleness window (24 h), ~620 upstream calls per
refresh at a throttled ~30 rps. Default regions are BR and US; other regions
work with whatever TMDB returns for them.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Requirement | How 005 complies | Gate |
|-----------|-------------|------------------|------|
| I. Mobile-First | 360px, 44px targets, dark, fewest taps | No new screens; deck/watchlist unchanged (FR-009/FR-011); attribution is one footer line | ✅ |
| II. Decision Speed | Never a dead end; degrade, never stall | FR-012/013/014/017 with the existing empty state and cached-copy notice; a badge tap is always one tap from watching (FR-007) | ✅ |
| III. Guest-First | Guest browsing end-to-end, no account | `/api/catalog` is anonymous — a guest quiz → deck works with no session at all | ✅ |
| IV. API-First | Angular ↔ .NET only; secrets server-side; TMDB cached server-side | All TMDB traffic in the backend; `Tmdb:ApiKey` in user-secrets / App Settings (Key Vault on Azure); poster artwork is the spec'd exception to "no direct provider contact" (FR-001 carve-out, clarified) | ✅ |
| V. Test-First | Red-green on critical paths | Mapping/classification rules and the snapshot cache policy are the named critical paths; contract tests against contracts/catalog.md | ✅ |
| VI. Deterministic | Same inputs → same outputs, no ML | Ranking untouched on the client (FR-011); pool composition is a deterministic function of TMDB's popularity ordering within one snapshot | ✅ |
| VII. Clean Architecture | Domain free of frameworks; one pattern per concern | `CatalogTitle`/`AvailabilityEntry` + mapping/classification in Domain (pure); use cases + ports in Application; `TmdbClient`, snapshot persistence, cache in Infrastructure; endpoint in Api. The one new pattern — the snapshot cache — is the spec's own Key Entity ("Catalog snapshot"), proposed in the spec as VII requires | ✅ |
| Security standards | No secrets in client code; no secrets in logs; strict CORS; parameterized SQL | Key only in backend config; TMDB key goes out only in a header; structured logging never carries payloads; catalog endpoint uses no SQL by hand — EF Core | ✅ |
| Workflow | PR review; migrations in PR; quality gates | Snapshot migration ships in this PR; backend build/tests + frontend build stay the gates | ✅ |

**No violations.**

**Post-design re-check (after Phase 1)**: still passing. The design kept
ranking and every screen on the client (I, II, VI), the endpoint anonymous
(III), all provider traffic server-side with the one spec'd artwork carve-out
(IV), the critical paths named for red-green (V), and the snapshot cache
implemented as a Domain-modeled entity behind Application ports with
Infrastructure owning HTTP, memory cache, and persistence (VII). The L2
snapshot table extends the constitution's `IMemoryCache` wording — justified
in Complexity Tracking below, not a violation.

## Project Structure

### Documentation (this feature)

```text
specs/005-tmdb-catalog/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/src/
├── PlayNext.Domain/
│   ├── CatalogTitle.cs                # NEW — snapshot title entity (read model)
│   ├── StreamingAvailability.cs       # NEW — one badge: provider id + deep link
│   └── CatalogVocabulary.cs           # NEW — genre/provider mapping + anime rule (pure)
├── PlayNext.Application/
│   ├── Contracts/CatalogContracts.cs  # NEW — DTOs (response, region request)
│   ├── Interfaces/
│   │   ├── ICatalogProvider.cs        # NEW — TMDB port (pool + per-title enrichment)
│   │   └── ICatalogSnapshotStore.cs   # NEW — L1/L2 snapshot port
│   └── UseCases/CatalogUseCases.cs    # NEW — snapshot policy (fresh/stale/never-overwrite)
├── PlayNext.Infrastructure/
│   ├── Catalog/TmdbClient.cs          # NEW — typed HttpClient, throttled refresh batch
│   ├── Catalog/CatalogSnapshotStore.cs# NEW — IMemoryCache L1 + EF L2
│   ├── Catalog/TmdbOptions.cs         # NEW — ApiKey/BaseUrl/Staleness/Quotas config
│   └── Persistence/…                  # + CatalogSnapshot entity, migration
└── PlayNext.Api/
    ├── Endpoints/CatalogEndpoints.cs  # NEW — GET /api/catalog?region=
    └── Program.cs                     # extended — config section, DI, endpoint map

frontend/src/app/
├── core/
│   ├── models/media-title.ts          # unchanged — the wire shape is already this
│   ├── models/media-catalog.data.ts   # DELETED — bundled sample retired
│   ├── models/quiz-options.data.ts    # unchanged — quiz lists stay client-side
│   └── services/
│       ├── catalog.service.ts         # almost unchanged — new source behind the token
│       ├── http-catalog-source.ts     # NEW — the REST CatalogSource (the 002 seam)
│       └── region.ts                  # NEW — locale → ISO region (FR-005)
└── features/deck/                     # deck passes the derived region; no UI change
```

**Structure Decision**: backend follows the constitution's four-project layout;
the catalog read model lives in Domain (pure classification/mapping rules —
the critical path), HTTP/cache/persistence in Infrastructure, one endpoint in
Api. Frontend keeps the established `core/` + `features/` layout: the swap is
a new `CatalogSource` implementation behind the existing token, exactly as the
002 seam comment promised ("`load` becomes the REST request, and no component
changes"). The sample data module and its poster SVGs are deleted, not kept as
an offline seed (spec Assumptions).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Addition beyond the named stack | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Postgres `CatalogSnapshots` table (L2 behind `IMemoryCache`) | The constitution's own infra note hosts the API on Azure Container Apps with scale-to-zero: a memory-only cache dies with every scale-in, and FR-012/013 promise the last good catalog survives the provider being unreachable — across restarts and deploys, not just within one process lifetime | A purely in-memory cache would serve the empty state (FR-014) to the first visitor after every deploy or scale-up even when TMDB is healthy but slow, and would lose the outage story exactly when the outage happens |
