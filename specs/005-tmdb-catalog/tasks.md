# Tasks: Real Catalog (TMDB)

**Input**: Design documents from `/specs/005-tmdb-catalog/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/catalog.md](./contracts/catalog.md)

**Tests**: Included — the constitution (Principle V) names the mapping/classification rules and the snapshot cache policy as this feature's critical paths, red-green. Backend tests run with `dotnet test` (the integration suite is gated on a reachable Postgres, same as 004); frontend tests run with `cd frontend && npx ng test --watch=false` (**not** `npx vitest run`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths in every description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Config surface and the one schema change, before any story starts

- [x] T001 [P] Create `TmdbOptions` config record — `ApiKey`, `BaseUrl` (default `https://api.themoviedb.org/3`), `ImageBaseUrl` (default `https://image.tmdb.org/t/p`), `Staleness` (default 24 h), pool quotas (30 movie / 30 TV per genre, 60 anime), refresh throttle (30 rps) — in `backend/src/PlayNext.Infrastructure/Catalog/TmdbOptions.cs`
- [x] T002 [P] Create `CatalogSnapshot` entity (`Region` string PK, `FetchedAt` DateTimeOffset, `PayloadJson` string mapped to jsonb), add `DbSet<CatalogSnapshot>` to `backend/src/PlayNext.Infrastructure/Persistence/AppDbContext.cs`, and generate the EF migration (`dotnet ef migrations add CatalogSnapshots`) in `backend/src/PlayNext.Infrastructure/Persistence/Migrations/`
- [x] T003 Wire the `Tmdb` section into `backend/src/PlayNext.Api/Program.cs`: bind options with `builder.Services.Configure<TmdbOptions>(...)` and **fail fast at startup when `Tmdb:ApiKey` is missing**, mirroring the existing `Jwt:SigningKey` guard (spec Assumptions: the feature must say so rather than fail obscurely)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure domain rules every story builds on — the constitution's named critical path, so tests come first and must fail before implementation

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 [P] Create Domain entities `CatalogTitle` and `StreamingAvailability` in `backend/src/PlayNext.Domain/CatalogTitle.cs` and `backend/src/PlayNext.Domain/StreamingAvailability.cs` — fields exactly per `data-model.md`: id format `tmdb:{movie|tv}:{providerId}` (underlying type, never the anime-classified one); `mediaType` ∈ movie|tv|anime; `genres` may be empty; `rating` 0–10 one decimal; `voteCount` ≥ 0; `runtimeMinutes`/`trailerUrl`/`posterUrl` optional; `availability` may be empty
- [x] T005 [P] Write red tests for the vocabulary rules in `backend/tests/PlayNext.Domain.Tests/CatalogVocabularyTests.cs` — genre seed map (action=28, comedy=35, drama=18, horror=27, romance=10749, sci-fi=878, thriller=53, animation=16, documentary=99); provider seed map (netflix=8, prime-video=119, disney-plus=337, max=384+1899, apple-tv-plus=350, paramount-plus=531, crunchyroll=283, mubi=11, globoplay=307, star-plus=619, hulu=15, peacock=386); unmapped providers become `tmdb:{id}` and are never dropped; monetization filter keeps flatrate|free|ads and excludes rent|buy; search-template application URL-encodes the title; unmapped TMDB genres kept as extra tags
- [x] T006 Implement the vocabulary rules in `backend/src/PlayNext.Domain/CatalogVocabulary.cs` (mapping tables, monetization filter, template application per research D5–D8) until T005 passes
- [x] T007 [P] Write red tests for the anime classification in `backend/tests/PlayNext.Domain.Tests/CatalogClassificationTests.cs` — FR-016: `anime` iff genre 16 present **and** `original_language == "ja"`; the classification overrides movie/tv in `mediaType`; the title id keeps the underlying type; Japanese live-action and non-Japanese animation are never anime
- [x] T008 Implement the classification in `backend/src/PlayNext.Domain/CatalogClassification.cs` until T007 passes
- [x] T009 [P] Define the Application ports `ICatalogProvider` (compose region pool + enrich titles) and `ICatalogSnapshotStore` (load/save snapshot by region) in `backend/src/PlayNext.Application/Interfaces/ICatalogProvider.cs` and `ICatalogSnapshotStore.cs`
- [x] T010 [P] Define the catalog DTOs in `backend/src/PlayNext.Application/Contracts/CatalogContracts.cs` — `CatalogResponse { region, fetchedAt, titles[] }`, `TitleDto`, `AvailabilityDto` matching [contracts/catalog.md](./contracts/catalog.md) (camelCase, error codes `invalid-region`, `catalog-not-ready`)

**Checkpoint**: vocabulary + classification rules green; ports and DTOs in place — user story implementation can begin

---

## Phase 3: User Story 1 - The deck offers real, watchable titles (Priority: P1) 🎯 MVP

**Goal**: Quiz → deck deals real TMDB titles (synopsis, year, rating, poster from the provider's image CDN), availability included so the existing provider filter keeps working (Filter Enforcement is a constitution-V invariant — an availability-less deck would show an empty deck for every visitor who selected services), bundled sample retired, attribution visible. Ranking and screens untouched.

**Independent Test**: Complete the quiz with any combination of answers and confirm the deck offers titles that are not among the bundled samples, each with synopsis, release year, rating, and a poster; existing filters and ranking behave exactly as before; TMDB attribution visible (spec US1 + FR-018).

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T011 [US1] Create `CatalogApiFactory` in `backend/tests/PlayNext.Api.IntegrationTests/CatalogApiFactory.cs` — `WebApplicationFactory<Program>` with a **stubbed TMDB HTTP handler** (DelegatingHandler returning canned discover/watch-providers/videos JSON; no live key needed) and the `Tmdb:BaseUrl` overridden to the stub host (research D18); reuse the existing Postgres gate pattern from `AuthApiFactory`
- [x] T012 [P] [US1] Write red contract tests for `GET /api/catalog` in `backend/tests/PlayNext.Api.IntegrationTests/CatalogTests.cs` — 200 body matches [contracts/catalog.md](./contracts/catalog.md) (id format `tmdb:{movie|tv}:{id}`, mediaType values, posterUrl `https://image.tmdb.org/t/p/w500/…`, availability entries with final deepLinkUrl); malformed region → 400 `invalid-region`; no snapshot ever → 503 `catalog-not-ready`; endpoint requires no auth (anonymous guest)
- [x] T013 [P] [US1] Write red specs for the HTTP catalog source in `frontend/src/app/core/services/http-catalog-source.spec.ts` — requests `/api/catalog` with the region param, maps the payload to `MediaTitle[]`, and propagates a 503/network error (so `CatalogService`'s fallback engages, as today)

### Implementation for User Story 1

- [x] T014 [US1] Implement `TmdbClient` in `backend/src/PlayNext.Infrastructure/Catalog/TmdbClient.cs` per research D3/D4/D12/D15 — pool composition: per quiz genre, `discover/movie` + `discover/tv` (sort_by popularity.desc, `include_adult=false`, `language=en-US`, pages until quota filled) plus the 60-title anime quota (`with_genres=16&with_original_language=ja`), deduplicated; per-title enrichment: one call per title with `append_to_response=watch/providers,videos`, availability from `results[region]` (monetization filter flatrate|free|ads), trailer from the first YouTube video of type Trailer, poster URL `w500`; throttle ~30 rps and back off on 429 (`Retry-After`); map into Domain titles (T004 vocabulary + classification)
- [x] T015 [US1] Implement the snapshot store skeleton and use case in `backend/src/PlayNext.Infrastructure/Catalog/CatalogSnapshotStore.cs` and `backend/src/PlayNext.Application/UseCases/CatalogUseCases.cs` — `IMemoryCache` L1 keyed by region; on miss: single-flight background refresh per region (SemaphoreSlim), atomic swap of the snapshot only when the whole batch succeeds, 503-when-none signal; on hit: serve (staleness handling arrives in US3)
- [x] T016 [US1] Implement `GET /api/catalog?region=` in `backend/src/PlayNext.Api/Endpoints/CatalogEndpoints.cs` — anonymous, region validated `^[A-Z]{2}$` → 400 `invalid-region`, otherwise the snapshot policy result (200 / 503 `catalog-not-ready`); register the typed `HttpClient` "tmdb" and the new services in `backend/src/PlayNext.Api/Program.cs`; map the endpoint via `app.MapCatalogEndpoints()`
- [x] T017 [US1] Implement `httpCatalogSource` in `frontend/src/app/core/services/http-catalog-source.ts` (Angular `HttpClient` → `/api/catalog?region=`) and swap the `CATALOG_SOURCE` factory to it in `frontend/src/app/core/services/catalog.service.ts`; delete `localCatalogSource`, `titlesFor`, and `servesRegion` from that file — `loadTitles`'s cachedCopyOf fallback and `usingCachedTitles` notice are unchanged
- [x] T018 [US1] Delete the bundled sample: `frontend/src/app/core/models/media-catalog.data.ts` and `frontend/public/posters/*.svg` (the CSS placeholder in `shared/poster` stays)
- [x] T019 [US1] Re-anchor frontend specs to a test-only fixture catalog (new `frontend/src/app/core/models/media-catalog.fixture.ts`): update `deck.spec.ts`, `catalog.service.spec.ts`, `watchlist/*.spec.ts`, `shared/poster/poster.spec.ts` and any other spec importing the retired sample — suites must stay green (SC-007: scenarios pass, fixtures are theirs to choose)
- [x] T020 [US1] Add the TMDB attribution footer line (FR-018, research D13) to `frontend/src/app/features/deck/deck.html` + `deck.ts` — "This product uses the TMDB API but is not endorsed or certified by TMDB", linked to TMDB; verify at 360px

**Checkpoint**: real deck end-to-end on a stubbed TMDB; sample retired; all suites green

---

## Phase 4: User Story 2 - "Where to watch" is true for my region (Priority: P2)

**Goal**: The region becomes a real input end-to-end: the client derives it from the device locale and sends it; badges reflect availability in *that* region; the badge link opens that service searching for the title.

**Independent Test**: Same title, BR vs US locale → different badges; a title carried by no service in the region shows none; tapping a badge opens that service's search for the title (spec US2, FR-005/006/007).

### Tests for User Story 2 ⚠️

- [x] T021 [P] [US2] Write red specs for region derivation in `frontend/src/app/core/region.spec.ts` — "pt-BR" → BR, "en-US" → US, language-only ("pt") → `DEFAULT_REGION` (BR), unmappable/garbage → `DEFAULT_REGION` (research D14)
- [x] T022 [P] [US2] Write red integration tests for region-scoped truth in `backend/tests/PlayNext.Api.IntegrationTests/CatalogRegionTests.cs` — stub TMDB returning provider A for BR and provider B for US on the same title; assert the BR snapshot lists A and not B, the US snapshot the reverse; a title with no availability in a region renders with an empty `availability` (never hidden, never an error)

### Implementation for User Story 2

- [x] T023 [US2] Implement region derivation in `frontend/src/app/core/region.ts` — `navigator.language` → ISO 3166-1 alpha-2 per research D14; pure function for testability
- [x] T024 [US2] Make the deck pass the derived region where it passed `DEFAULT_REGION`: update `frontend/src/app/features/deck/deck.ts` (and any other `loadTitles` call sites) to use `deriveRegion(navigator.language)` — no other UI change (FR-011)
- [x] T025 [US2] Add gated provider-id verification tests in `backend/tests/PlayNext.Api.IntegrationTests/CatalogProviderIdsGatedTests.cs` — gated on `Tmdb:ApiKey` being present (same gate pattern as Postgres): fetch `/watch/providers/movie` + `/watch/providers/tv` live and assert the D7 seed ids still name the right services (paramount-plus=531, star-plus=619, crunchyroll=283, globoplay=307 and the aliases); skip cleanly when the key is absent

**Checkpoint**: region is a real input; badge truth verified per region

---

## Phase 5: User Story 3 - The catalog survives the provider being unavailable (Priority: P3)

**Goal**: TMDB slow/rate-limited/down is never the visitor's problem: stale snapshots keep serving with the existing notice; failed refreshes never damage good data; the never-fetched case shows the existing empty state with its way out — never a spinner or error screen.

**Independent Test**: With the upstream unreachable, the deck still renders titles from the last successful fetch with the cached notice; with no successful fetch ever, the existing empty state; one failed fetch has not replaced previously good data (spec US3, FR-012/013/014, SC-005).

### Tests for User Story 3 ⚠️

- [x] T026 [P] [US3] Write red policy tests in `backend/tests/PlayNext.Application.Tests/CatalogSnapshotPolicyTests.cs` — a stale snapshot (age > `Staleness`) is served while a background refresh is triggered (FR-004/FR-012); a failed refresh leaves the existing snapshot untouched in L1 **and** L2 (FR-013); the snapshot is swapped only when the whole batch succeeds; concurrent requests share one refresh (single-flight); no snapshot ever + refresh kicked → the not-ready signal (FR-014)
- [x] T027 [P] [US3] Write red outage integration tests in `backend/tests/PlayNext.Api.IntegrationTests/CatalogOutageTests.cs` — stub TMDB goes down: a request after a previous success returns the **stale snapshot with 200** (FR-012); never-succeeded + down returns 503 `catalog-not-ready`; stub recovers → the next refresh serves fresh titles; SC-005: no path ever returns an error body the client would render as a screen
- [x] T028 [P] [US3] Write red client-side fallback specs in `frontend/src/app/core/services/http-catalog-source.spec.ts` (extend) — a 503/network error from the source flows into `CatalogService`'s cachedCopyOf fallback and sets `usingCachedTitles` (the deck's existing "showing cached titles" notice); with no cached copy, the result is the empty array the existing empty state renders (FR-014)

### Implementation for User Story 3

- [x] T029 [US3] Implement L2 snapshot persistence in `backend/src/PlayNext.Infrastructure/Catalog/CatalogSnapshotStore.cs` — on miss: load the `CatalogSnapshots` row into L1; on successful refresh: save the payload (jsonb) and `FetchedAt`; a failed batch writes **nothing** (data-model state machine)
- [x] T030 [US3] Harden the policy in `backend/src/PlayNext.Application/UseCases/CatalogUseCases.cs` — staleness check (`age > Staleness` → serve stale + background refresh, research D10); refresh failure leaves L1+L2 untouched and logs a structured warning with region/status only (never a payload or key — constitution security standard); 429 honors `Retry-After` and aborts the batch (D16)
- [x] T031 [US3] Sync [quickstart.md](./quickstart.md) scenarios 6–7 with the final 503/stale behavior and the outage-drill command (`Tmdb:BaseUrl` override) — no code, this is the validation guide matching the shipped semantics

**Checkpoint**: outage story complete; all three stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Measurements, gated validations, and the end-to-end walkthrough

- [x] T032 [P] Run the full backend suite (`dotnet test` — 147 green today plus the new tests; gated integration against local Postgres), the full frontend suite (`cd frontend && npx ng test --watch=false` — 579 green today, re-anchored), and the production frontend build; fix anything red; update the quickstart verification table rows for the automated suites and build — **DONE 2026-09-28: backend 271 (Domain 102, Application 87, Integration 82, 0 skipped), frontend 618 across 40 files, build clean.** Two things the run itself caught, both fixed: the `Max` → `HBO Max` rename had a **fifth** assertion site (`ways-to-watch.spec.ts`) and a **second data list** (`FALLBACK_PROVIDERS`, which the region-load failure path renders — so the same service was called two things depending on whether the network worked), and two more assertions were `toContain('Max')`, which passes against both the right label and the wrong one. The fallback-list drift now has a test (`Fallback_providers_agree_with_the_offered_ones`)
- [x] T033 [P] SC-001 measurement (gated on the real `Tmdb:ApiKey`): with the live catalog, measure distinct-title counts for "one genre + own services" combinations per quickstart; if a combination falls below 20, raise the pool quotas in config (the documented tuning lever, research D3) and re-measure; record results in quickstart — **DONE 2026-09-28, and it took both levers.** Quotas raised 30 → 60 (research D3): the pool went 540 → 916 titles, and the criterion is now met for **every selection of three or more services** (thinnest genre: horror 23). The single-service case is **not reachable by tuning** — Netflix-only horror went 2 → 8 across a quadrupling of the pool, because what caps it is what that one service carries in the region — so **SC-001 was reworded to state the guarantee the catalog controls** ("for any selection of three or more services") rather than the number being dropped. Full table in quickstart; the lever still unused (per-service retrieval; 44% of the pool carries no badge) is recorded there with the reason it is a spec of its own
- [ ] T034 [P] SC-002 measurement (gated, manual): DevTools network throttling (4G), warm cache — first card renders < 300 ms from deck open; record in quickstart; if short, the quota is the first lever, gzip/HTTP caching second — **SERVER HALF DONE 2026-09-28, re-measured after the quota raise**: response compression was **not configured at all** and now is (Brotli + Gzip, both raised from the default `Fastest` to `Optimal` because at `Fastest` brotli produced 180 KB — *larger* than gzip, and brotli is what browsers are offered first). At the shipped quotas: 635,380 raw / 192,281 gzip / 186,480 brotli. The browser reading is still outstanding, and the 64% payload growth makes it the one criterion the T033 quota raise could still threaten — so it is now the first item in "Still outstanding" rather than a formality
- [x] T035 [P] SC-004 spot check (gated, manual): 10 titles checked by hand against the services' own pages — 10/10 badges name a service that still carries the title in the visitor's region; record in quickstart — **LINK HALF DONE 2026-09-28**: one live deep link per service in the BR pool (10 services) was resolved. **Two real fixes**: Pluto's `/search/details` 404s → `/search` (200); Paramount+'s `/search/?q=` 302s to `/{region}/search/` and **drops the query**, fixed by giving the template a `{region}` placeholder (research D8). **Two honest compromises**, both recorded as degraded with the probes behind them: Disney+ serves no search page to an anonymous client at all, and Max exposes none either (`play.hbomax.com/search?q=` 302s to `www.hbomax.com/?q=`, which is where the template now points — one redirect fewer, query intact). Dropping those two was considered and rejected. The "still carries the title" half still needs a human with accounts; that is why this stays open
- [x] T036 [P] SC-006 credential scan: search the built client bundle, a sample of server logs, and the API response for the configured key string — zero occurrences; scriptable, needs no live key (use a sentinel search against the bundle and logs)
- [ ] T037 Run quickstart scenarios 1–10 end-to-end with the real key (gated, manual — the 005 equivalent of 004's T046 walkthrough) and fill the quickstart verification table — **PARTIAL 2026-09-28**: the verification table is filled with everything that could be measured without a browser (suites, build, credential scan, provider drift, SC-001/002/004). Scenarios 1–5 and T034's browser half remain
- [x] T038 [P] Retire Star+ without dead-ending the visitors who selected it: remove `star-plus` from `STREAMING_PROVIDERS` and the server vocabulary, add `RETIRED_PROVIDERS` + `RETIRED_PROVIDER_SUCCESSORS` and consult the successor in the deck's own matching predicate (`frontend/src/app/core/models/quiz-options.data.ts`, `frontend/src/app/core/services/quiz-options.service.ts`, `frontend/src/app/features/deck/deck-logic/recommend.ts`), with specs for both the alias and the naming (`quiz-options.service.spec.ts`, `recommend.spec.ts`) — research D20. This is the constitution-II dead end the provider-drift finding created: without it, every visitor holding a stored `star-plus` matches **nothing, in every genre**
- [x] T039 [P] Enforce the provider's retention ceiling: `TmdbOptions.MaxCacheAge` (180 days, provably < 6 months) plus serve-and-purge in `backend/src/PlayNext.Infrastructure/Catalog/CatalogSnapshotStore.cs` on read (the region asked for) and on save (every other expired region) — research D19. §1.C of TMDB's API Terms of Use forbids caching their data longer than six months, and §1.D requires purging it on termination; nothing enforced either, and `Staleness` only decided when to *refresh*. Enforced in the store so no caller can serve expired data by omission
- [x] T040 [P] Stop `dotnet test` writing into the developer's own database: `backend/tests/PlayNext.Api.IntegrationTests/AuthTests.cs` now rewrites `ConnectionStrings:Postgres` to a `_test`-suffixed database, creating and migrating it lazily. The suites shared one database with the running API, so a test run left stub snapshots behind and the live deck served eight fake titles until the region was cleared — a diagnosis that cost real time in T033. **Verified after a run by querying both:** `playnext` held the real 916-title BR snapshot untouched, `playnext_test` the suite's 8-title stub, and the integration suite reported 0 skipped — which is itself the proof that the lazy create-and-migrate succeeded, since a database that could not be prepared would have skipped those tests instead of failing them

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately (T001/T002 parallel; T003 after either)
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories. Within it: T004 before T005/T006/T007/T008; T005+T007 (tests) parallel; T009/T010 parallel after T004
- **User Stories (Phase 3–5)**: all depend on Foundational
  - US2 and US3 both build on US1's pipeline (same subsystem — the backend batch and the client source), so they run **sequentially after US1**; US2 and US3 themselves touch disjoint files and may run in parallel after US1
- **Polish (Phase 6)**: depends on the stories it measures; T033–T036 need the real credential (gated), T032 needs nothing external

### User Story Dependencies

- **User Story 1 (P1)**: after Foundational — no story dependencies. Ship it and the deck is real
- **User Story 2 (P2)**: after US1 — the region input and badge truth ride on the pipeline; independently testable (T022)
- **User Story 3 (P3)**: after US1 — the outage story hardens the store US1 built; independently testable (T026/T027)

### Within Each User Story

- Tests (T0xx) MUST be written and FAIL before implementation
- Domain/infrastructure before endpoint; endpoint before client swap
- Story complete before moving to the next priority

### Parallel Opportunities

- T001 ∥ T002 (different files); T005 ∥ T007 (test files); T009 ∥ T010 (interfaces vs DTOs)
- US1: T012 ∥ T013 (backend vs frontend tests); T018 ∥ T020 while T017/T019 land
- US2: T021 ∥ T022
- US3: T026 ∥ T027 ∥ T028
- Polish: T032 ∥ T036 (no credential needed) while T033–T035 wait on the key

### Parallel Example: User Story 1

```text
Launch the test tasks together:
  Task: "T012 [P] [US1] Write red contract tests for GET /api/catalog in backend/tests/PlayNext.Api.IntegrationTests/CatalogTests.cs"
  Task: "T013 [P] [US1] Write red specs for the HTTP catalog source in frontend/src/app/core/services/http-catalog-source.spec.ts"

Then the pipeline, front to back:
  T014 TmdbClient → T015 store/use case → T016 endpoint → T017 client swap → T019 re-anchor → T020 attribution
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (options, snapshot table + migration, fail-fast config)
2. Complete Phase 2: Foundational (rules red-green, ports, DTOs)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: stubbed-TMDB integration tests green; frontend suite green; deck shows real titles end-to-end
5. This is the demo milestone — the sample is gone, the deck is real

### Incremental Delivery

1. Setup + Foundational → rules proven (T005–T008 green)
2. US1 → deck deals real titles (MVP)
3. US2 → region is a real input, badges true per region
4. US3 → outage story: stale-serving, never-overwrite, empty state
5. Polish → measured against SC-001–SC-006; gated rows recorded in quickstart

### Notes

- Commit/push only when the user asks; all changes merge via PR with review (constitution)
- Frontend tests: `cd frontend && npx ng test --watch=false` — `npx vitest run` is **not** the runner
- Backend integration tests are gated on a reachable Postgres (existing `[GatedFact]` pattern); the new TMDB-gated tests gate on `Tmdb:ApiKey`
- Do not kill `node.exe` processes wholesale — target specific PIDs
- The TMDB credential is obtained out of band; T011–T031 all run against stubs and need no key — only T025/T033/T034/T035/T037 are gated on it
