# Tasks: Normalized Catalog & Per-Service Pools

**Input**: Design documents from `/specs/008-catalog-normalization/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included because the project constitution (Principle V, Test-First)
and plan D12 require tests for parity, migration, refresh failure, retention,
and rollback before implementation. Tests in each story are written first and
must fail before the implementation tasks in that story.

**Organization**: Tasks are grouped by user story. Stories are delivered in
priority order (US1 → US2 → US3); each builds on the previous story's files, so
they are sequential rather than parallel, but each story has its own
independently testable outcome.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `backend/src/PlayNext.{Domain,Application,Infrastructure,Api}/`, tests in `backend/tests/`
- **Frontend**: `frontend/src/app/`
- **CI**: `.github/workflows/`
- Column-level detail lives in [data-model.md](data-model.md) by section; tasks quote the constraints that must not be left to implementation-time discretion.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration surface and a verified green baseline.

**Independent test**: The API starts with defaults, `Catalog:*` and the new
`Tmdb:*` settings bind, no secret has a default value, and both existing test
suites pass before any feature code lands.

- [x] T001 [P] Create `backend/src/PlayNext.Infrastructure/Catalog/CatalogOptions.cs` with `Source` (default `Snapshot`), `AdminToken` (default empty), `MaxPoolTitles` (default `1000`), `MaxIdsPerRequest` (default `1000`), `RefreshTimeoutMinutes` (default `55`), and nested `Migration.Enabled` (default `false`), matching the settings table in `specs/008-catalog-normalization/contracts/catalog-refresh.md`
- [x] T002 [P] Extend `backend/src/PlayNext.Infrastructure/Catalog/TmdbOptions.cs` with `ServiceTitlesPerGenre` (default `300`), `MaxDiscoverPages` (default `25`), and `MaxRetries` (default `2`)
- [x] T003 Bind `CatalogOptions` and the extended `TmdbOptions` in `backend/src/PlayNext.Api/Program.cs`; add the non-secret defaults to `backend/src/PlayNext.Api/appsettings.json` without adding `Catalog:AdminToken`
- [x] T004 Run the baseline suites and record them green: `dotnet test` from `backend/` and `npx ng test --watch=false` from `frontend/`

**Checkpoint**: Configuration compiles and the pre-existing suites are green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The versioned schema, vocabulary, storage ports, and test stub that
every story uses. The full schema is created in **one** EF migration (plan D1,
engineering standards), even though US3 exercises some tables later.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

**Independent test**: The migration applies to an empty database and to a
database with existing `Interactions`/`WatchHistory` rows; identities are
backfilled before the foreign keys are added; the vocabulary seeder is
idempotent; the stub can serve filtered per-service responses and injected
failures.

- [x] T005 [P] Create `CatalogVersion`, `CatalogTitle`, `CatalogTitleGenre`, and `CatalogAvailability` entities in `backend/src/PlayNext.Infrastructure/Persistence/CatalogVersion.cs` with the keys and lengths from data-model §4–§7: `CatalogVersions.State varchar(16)` (`Building|Active|Superseded`), `Source varchar(16)` (`Refresh|Migration`); `CatalogTitles` PK `(VersionId, TitleId)`, `Name varchar(512)`, `MediaType varchar(8)` (`movie|tv|anime`), `InGeneralPool boolean`, `PoolPosition int`, `LastObservedAt timestamptz`; `CatalogAvailability` PK `(VersionId, TitleId, ServiceId, Region)`, `ServiceId varchar(64)`, `Region varchar(2)`, `Monetization varchar(16)` (`flatrate|free|ads|unknown`), `Position int`; composite FKs to `CatalogTitles` cascade
- [x] T006 [P] Create `CatalogGenre`, `CatalogService`, and `CatalogServiceProvider` entities in `backend/src/PlayNext.Infrastructure/Persistence/CatalogVocabularyRows.cs`: `CatalogGenres.Id varchar(64)` PK, `TmdbId int NULL` unique, `IsSelectable boolean`, `Position int`; `CatalogServices.Id varchar(64)` PK, `SearchTemplate text NULL`, `IsQuizService boolean`, `Position int`; `CatalogServiceProviders.TmdbProviderId int` PK, `ServiceId varchar(64)` FK with index `(ServiceId)` (data-model §1–§3)
- [x] T007 [P] Create `CatalogRefreshRun`, `CatalogTitleIdentity`, and `CatalogRetiredTitle` entities in `backend/src/PlayNext.Infrastructure/Persistence/CatalogRefreshRun.cs`, `CatalogTitleIdentity.cs`, and `CatalogRetiredTitle.cs`: `Kind varchar(16)` (`Refresh|Migration`), `Mode varchar(16) NULL` (`Configured|Normalized|Snapshot`), `Status varchar(24)` (`Running|Succeeded|PartiallyFailed|Failed|Abandoned`), `CountsJson jsonb`, `FailuresJson jsonb`; identity `TitleId varchar(64)` PK with `FirstSeenAt`; retired title PK/FK to identity, `PayloadJson jsonb`, `LastObservedAt`, `RetiredAt` (data-model §8–§10)
- [x] T008 Register the new DbSets and configure keys, indexes, and FKs in `backend/src/PlayNext.Infrastructure/Persistence/AppDbContext.cs`: partial unique indexes `(Region) WHERE State='Active'` and `(Region) WHERE State='Building'`; `CatalogTitles` indexes `(VersionId, InGeneralPool, PoolPosition)`, `(VersionId, MediaType, TitleId)`, `(VersionId, Popularity DESC, TitleId)`, `(VersionId, LastObservedAt)`; `CatalogTitleGenres` PK `(VersionId, TitleId, GenreId)` plus `(VersionId, GenreId, TitleId)`; `CatalogAvailability` index `(VersionId, Region, ServiceId, TitleId)` and `(VersionId, LastObservedAt)`; `TitleId` FKs from `Interactions` and `WatchHistory` with `ON DELETE RESTRICT` plus `TitleId` indexes on both
- [x] T009 Create the single EF migration `NormalizedCatalog` under `backend/src/PlayNext.Infrastructure/Persistence/Migrations/`: create all tables and indexes, backfill `CatalogTitleIdentities` from the distinct `Interactions.TitleId` and `WatchHistory.TitleId` values, then add the two foreign keys with `ON DELETE RESTRICT`; no user row may be rewritten or deleted
- [x] T010 [P] Extend `backend/src/PlayNext.Application/Contracts/CatalogContracts.cs` with the read query/mode records, run status payload, per-slice count records, failure records, and retired-title lookup result matching `contracts/catalog-api.md` and `contracts/catalog-refresh.md`
- [x] T011 [P] Define `backend/src/PlayNext.Application/Interfaces/ICatalogVersionStore.cs` (begin build, write version, promote, resolve active, delete superseded) and `ICatalogRefreshRunStore.cs` (start, complete, latest status for region) with no EF or provider types in their signatures
- [x] T012 Implement `backend/src/PlayNext.Infrastructure/Catalog/CatalogVersionStore.cs`: create a `Building` version, write rows in stable array order, promote `Building → Active` and previous `Active → Superseded` in one transaction, resolve the active version id once, and delete superseded versions
- [x] T013 Implement `backend/src/PlayNext.Infrastructure/Catalog/CatalogRefreshRunStore.cs`: create a `Running` row, complete it terminally with counts/failures, and return the latest run per region; serialize only sanitized summaries (status code, attempts, disposition)
- [x] T014 [P] Create `backend/src/PlayNext.Infrastructure/Catalog/CatalogVocabularySeeder.cs` as an idempotent startup upsert (not `HasData`) from `CatalogVocabulary`: nine selectable genres in quiz order, the 11 quiz services, provider aliases (Netflix `8` + `1796`, Prime `119` + `2100`), the known non-quiz services, and each service's `SearchTemplate`
- [x] T015 Extend `backend/tests/PlayNext.Api.IntegrationTests/CatalogApiFactory.cs` so the stub honors `with_watch_providers`, `watch_region`, `with_watch_monetization_types`, `with_original_language`, `with_genres`, provider names and ids (including aliases), region `link`, deep paging, and injectable per-slice failures/status codes
- [x] T016 Wire the options, stores, vocabulary seeder, and startup seeding order in `backend/src/PlayNext.Api/Program.cs`; seeding runs before the app serves requests and is safe to run on every start

**Checkpoint**: Schema, vocabulary, stores, and stub are ready; user-story work can begin.

---

## Phase 3: User Story 1 - The storage change is invisible (Priority: P1) 🎯 MVP

**Goal**: The catalog is stored as versioned rows and served from them, with
migration from the existing snapshot, unchanged deck behavior for a fixed
version, preserved user records, and a configuration-only rollback.

**Independent Test**: Freeze one catalog version, migrate it, and compare the
no-filter response and the ranked deck before and after — same ids, same order.
Confirm ratings/history/watchlist still resolve, then flip `Catalog:Source`
back and confirm the snapshot serves the deck.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST and confirm they FAIL before T020–T027.**

- [x] T017 [P] [US1] Create the parity harness `frontend/src/app/features/deck/deck-logic/parity/catalog-parity.spec.ts`: read `snapshot.json` and `normalized.json` fixtures, build the 9 genres × 11 services × 3 media types matrix plus all-any, run `rankTitles` over each response, assert identical eligible ids and order, and skip with a clear message when fixtures are absent; add `frontend/src/app/features/deck/deck-logic/parity/fixtures/` to `.gitignore`
- [x] T018 [P] [US1] Create `backend/tests/PlayNext.Api.IntegrationTests/NormalizedCatalogTests.cs`: seed a fixed snapshot, run the migration, and assert the normalized no-filter response is field-identical to the snapshot response (title ids, order, genres, availability, links); assert `Catalog:Source=Snapshot` serves the snapshot again after a restart with no deployment and no error
- [x] T019 [P] [US1] Create `backend/tests/PlayNext.Api.IntegrationTests/CatalogMigrationTests.cs`: rerunning with the same snapshot timestamp creates no duplicates; a newer snapshot discards the stale `Building` version; malformed, missing, or over-age snapshots yield a `Failed` migration run and leave the region and user rows untouched; counts equal the snapshot's arrays; a rating for a never-seen title id still saves and creates an identity row

### Implementation for User Story 1

- [x] T020 [US1] Implement `backend/src/PlayNext.Infrastructure/Catalog/CatalogPoolReader.cs` for the general pool: resolve the active version once, then run three queries pinned to that version id — titles where `InGeneralPool` ordered by `PoolPosition, TitleId`, genres by the returned ids, availability by the returned ids — and map to the existing wire title
- [x] T021 [US1] Implement `backend/src/PlayNext.Infrastructure/Catalog/CatalogPoolCache.cs` as a version-keyed `IMemoryCache` with a 10-minute TTL and a cancellation token per entry, with an eviction call used on promotion (data-model "Query semantics", research D8)
- [x] T022 [US1] Implement `backend/src/PlayNext.Application/UseCases/CatalogQueryService.cs`: select the source per request from `Catalog:Source` (`Snapshot` default, `Normalized`), keep the legacy snapshot path unchanged, serve normalized reads through the reader and cache, and return `503 catalog-not-ready` plus a background refresh trigger when the region has no active version
- [x] T023 [US1] Implement `backend/src/PlayNext.Application/UseCases/MigrateCatalogUseCase.cs`: map snapshot JSON to rows verbatim — ids unchanged, array order preserved, `Monetization="unknown"`, `InGeneralPool=true`, `PoolPosition=i`, `Popularity=0`, `LastObservedAt=fetchedAt` — and make the same-timestamp rerun upsert the same `Building` version while a newer snapshot discards the stale one
- [x] T024 [US1] Implement `backend/src/PlayNext.Infrastructure/Catalog/CatalogMigrationRunner.cs` as an opt-in hosted one-shot gated by `Catalog:Migration:Enabled`; attempt every readable, in-retention region, record a `Kind=Migration` run, and never delete the snapshot or touch user rows
- [x] T025 [US1] Update `backend/src/PlayNext.Api/Endpoints/CatalogEndpoints.cs` so `GET /catalog` calls `CatalogQueryService`; keep the 005 response shape, `fetchedAt`, and existing error bodies unchanged
- [x] T026 [US1] Extend `AccountStateRepository.MergeIntoAccountAsync` in `backend/src/PlayNext.Infrastructure/Persistence/AccountStateRepository.cs` to upsert every merged title id into `CatalogTitleIdentities` (`INSERT … ON CONFLICT DO NOTHING`) inside the existing transaction before `SaveChangesAsync`
- [x] T027 [US1] Wire `CatalogPoolReader`, `CatalogPoolCache`, `CatalogQueryService`, `MigrateCatalogUseCase`, and `CatalogMigrationRunner` in `backend/src/PlayNext.Api/Program.cs`; ensure `Catalog:Source` is read per request, not cached at startup

**Checkpoint**: US1 is independently testable and deployable with `Catalog:Source=Snapshot`; migration and parity are proven before any enrichment.

---

## Phase 4: User Story 2 - A service's depth comes from that service (Priority: P2)

**Goal**: The refresh discovers each quiz service's own catalog, enriches each
unique title once, and stores deep per-service pools; the catalog request gains
service/genre/media-type filters and an id batch; the deck and watchlist use
them without changing ranking or screen shape.

**Independent Test**: Run a full normalized refresh against the deep stub, then
request Netflix + horror in BR and count at least 300 distinct titles (or the
stub's reported depth); confirm a title on two selected services appears once
with both, and that the watchlist resolves ids outside the general pool in one
request.

### Tests for User Story 2 ⚠️

> **NOTE: Write these tests FIRST and confirm they FAIL before T035–T045.**

- [x] T028 [P] [US2] Create `backend/tests/PlayNext.Domain.Tests/CatalogSliceTests.cs`: general slice plus one slice per quiz service, nine genres × two presentation media types plus per-genre anime and any-genre anime streams, dedupe rules, fixed query order, 300-title target, and the 25-page discovery cap
- [x] T029 [P] [US2] Create `backend/tests/PlayNext.Domain.Tests/CatalogPoolQueryTests.cs`: OR within a dimension and AND across dimensions, empty/duplicate values ignored, service/genre/media-type/title-id regexes from `contracts/catalog-api.md`, and the `MaxIdsPerRequest` bound
- [x] T030 [P] [US2] Extend `backend/tests/PlayNext.Api.IntegrationTests/NormalizedCatalogTests.cs`: targeted requests return only matching titles with the unchanged shape; two-service requests contain no duplicate title id and carry both badges; an empty combination is `200` with `titles: []`; each syntax error returns its contract code; the pool is capped at 1,000 ordered by `Popularity DESC, TitleId`; `ids` resolves active then archive, omits unknown ids, honors filter intersection, and rejects more than 1,000 ids with `too-many-ids`
- [x] T031 [P] [US2] Create `backend/tests/PlayNext.Api.IntegrationTests/CatalogRefreshTests.cs` (success path): a full normalized refresh over deep stub data builds the general pool and every service slice; Netflix + horror and Max + horror reach 300 or the stub's reported depth; every title's availability is complete after one enrichment pass; no duplicate title or availability rows exist
- [x] T032 [P] [US2] Create `frontend/src/app/core/services/catalog.service.spec.ts` and `http-catalog-source.spec.ts`: query-keyed cache and fallback, `loadTitlesById` does not change `usingCachedTitles`, and filters serialize as comma-separated optional params
- [x] T033 [P] [US2] Update the deck spec (existing `frontend/src/app/features/deck/deck.spec.ts`) to assert the targeted query built from the preference (service/genre/media type omitted when "any" or "other platforms" is on) and that merging the supplementary rated ids preserves `historyAffinity` while filter 4 still removes rated titles
- [x] T034 [P] [US2] Update the watchlist, history, detail, and match-found specs under `frontend/src/app/features/watchlist/` and `frontend/src/app/features/deck/match-found/` to assert one `ids` catalog request per view and tolerance for missing titles

### Implementation for User Story 2

- [x] T035 [P] [US2] Create `backend/src/PlayNext.Domain/CatalogSlice.cs` with the full plan from research D2: general slice, one slice per quiz service, nine genres × movie/tv at the configured target, per-genre anime (`with_genres=16,<genre>` + `with_original_language=ja`), any-genre anime streams, fixed slice/query order, and dedupe ownership
- [x] T036 [P] [US2] Create `backend/src/PlayNext.Domain/CatalogPoolQuery.cs` to normalize and validate the optional `services`, `genres`, `mediaTypes`, and `ids` inputs with the contract regexes and bounds; unknown but well-formed vocabulary values remain valid and produce an empty result
- [x] T037 [US2] Extend `backend/src/PlayNext.Infrastructure/Catalog/TmdbClient.cs`: paged `discover` with `with_watch_providers`, `watch_region`, `with_watch_monetization_types=flatrate|free|ads`, `with_original_language` for anime, 30 requests/second pacing, `MaxRetries`, explicit 429 handling, and `append_to_response=watch/providers,videos` enrichment
- [x] T038 [US2] Implement `backend/src/PlayNext.Application/UseCases/RefreshCatalogUseCase.cs` for the success path: execute every planned slice, merge observations into one row per title, run one enrichment pass per unique title, canonicalize service aliases, upsert unknown services with the TMDB region `link` fallback, apply `flatrate → free → ads` precedence, and compose a complete version (all-or-nothing in this story)
- [x] T039 [US2] Extend `backend/src/PlayNext.Infrastructure/Catalog/CatalogPoolReader.cs` with targeted pools — `EXISTS` predicates for genre and service, `MediaType IN`, all dimensions ANDed, ordered `Popularity DESC, TitleId`, limited by `MaxPoolTitles` — and the `ids` mode (active version first, then `CatalogRetiredTitles`, unknown ids omitted)
- [x] T040 [US2] Extend `backend/src/PlayNext.Api/Endpoints/CatalogEndpoints.cs` to parse the optional parameters and return the contract error codes `invalid-service`, `invalid-genre`, `invalid-media-type`, `invalid-title-id`, `too-many-ids`; a request with no optional parameters keeps the general pool path
- [x] T041 [P] [US2] Create `frontend/src/app/core/models/catalog-query.ts` with the optional `services`, `genres`, `mediaTypes`, and `ids` shape shared by the service and screens
- [x] T042 [US2] Extend `frontend/src/app/core/services/catalog.service.ts` (`CatalogSource.load(query)`, query-keyed cache/fallback, `loadTitlesById(region, ids)`) and `frontend/src/app/core/services/http-catalog-source.ts` (optional comma-separated params)
- [x] T043 [US2] Update `frontend/src/app/features/deck/deck.ts` to load the targeted pool from the preference and merge the supplementary rated-id response before `rankTitles`; no ranking or filter code changes
- [x] T044 [US2] Update `frontend/src/app/features/watchlist/watchlist.ts`, `watchlist/detail/detail.ts`, `watchlist/history/history.ts`, and `deck/match-found/match-found.ts` to resolve titles with one `ids` request per view
- [x] T045 [US2] Wire the slice plan, provider changes, refresh use case, and extended reader in `backend/src/PlayNext.Api/Program.cs`; keep the `Catalog:Source` switch behavior from US1

**Checkpoint**: US2 is independently testable against the deep stub; the deck draws from the service's own catalog and the watchlist resolves out-of-pool ids.

---

## Phase 5: User Story 3 - The catalog refreshes, fails, and forgets safely (Priority: P3)

**Goal**: Refreshes run on a schedule through a protected endpoint, promote a
mixed version when a slice fails, report per-slice status, purge data past the
retention limit while keeping referenced titles readable, and keep visitors on
a consistent version throughout.

**Independent Test**: Fail one service slice in the stub and confirm the
promoted version has fresh data for everything else and last-known-good for the
failed slice; age rows past six months, run the purge, and confirm they are gone
while ratings/history remain readable; exercise the admin surface's 404/401/
202/409 paths; run the scheduled workflow via `workflow_dispatch`.

### Tests for User Story 3 ⚠️

> **NOTE: Write these tests FIRST and confirm they FAIL before T050–T061.**

- [x] T046 [P] [US3] Create `backend/tests/PlayNext.Domain.Tests/CatalogRetentionTests.cs`: six-month cutoff calculation, per-row expiry, archive decision when a user record references a title, no archive when unreferenced, and `LatestObservedAt` semantics
- [x] T047 [P] [US3] Create `backend/tests/PlayNext.Api.IntegrationTests/CatalogRetentionTests.cs`: the purge deletes expired catalog and availability rows; a referenced retired title is copied to `CatalogRetiredTitles` with `availability: []`; an `ids` request returns it while a pool request does not; removing the user record lets the next purge delete the archive row; `Interactions`/`WatchHistory` counts are unchanged; an over-age active version answers `503 catalog-not-ready`
- [x] T048 [P] [US3] Extend `backend/tests/PlayNext.Api.IntegrationTests/CatalogRefreshTests.cs`: one failed slice produces `PartiallyFailed` and one promoted version with fresh data everywhere else plus carried data for the failed slice; a first refresh with any failure promotes nothing; a 429 beyond the retry budget aborts as `Failed`; an interrupted rerun completes with no duplicates; a successful general slice writes the snapshot in the promotion transaction (SC-014)
- [x] T049 [P] [US3] Create `backend/tests/PlayNext.Api.IntegrationTests/CatalogAdminTests.cs`: admin routes are absent (`404`) when no token is configured; wrong token → `401 admin-unauthorized`; correct token → `202`; a second request while running → `409 catalog-refresh-running`; status returns `none`, running, and terminal shapes; invalid region/mode → the contract codes; no response or log contains the token

### Implementation for User Story 3

- [x] T050 [P] [US3] Create `backend/src/PlayNext.Domain/CatalogRetention.cs` with the cutoff, expiry, archive decision, and `LatestObservedAt` rules from research D5 and data-model "Retention lifecycle"
- [x] T051 [US3] Implement `backend/src/PlayNext.Infrastructure/Catalog/CatalogRetentionStore.cs`: range-delete expired titles/availability by `(VersionId, LastObservedAt)`, copy referenced retired titles without availability, delete unreferenced archive rows, and recompute the version's `LatestObservedAt`
- [x] T052 [US3] Implement `backend/src/PlayNext.Application/UseCases/CatalogRetentionUseCase.cs` to orchestrate the purge, archive, and archive cleanup after a refresh and at startup
- [x] T053 [US3] Extend `backend/src/PlayNext.Application/UseCases/RefreshCatalogUseCase.cs` with mixed composition: fresh wins per title/service key, failed slices carry last-known-good rows with original `LastObservedAt`, statuses `Succeeded`/`PartiallyFailed`/`Failed`, first-refresh all-or-nothing, 429 abort, and the `RefreshTimeoutMinutes` soft budget
- [x] T054 [US3] Write the rollback snapshot from the freshly observed general pool inside the promotion transaction when the general slice succeeds (FR-029); never fetch the provider twice for it
- [x] T055 [US3] Add the admin routes and fixed-time token comparison in `backend/src/PlayNext.Api/Endpoints/CatalogEndpoints.cs`; map them only when `Catalog:AdminToken` is non-empty, accept `mode=configured|normalized|snapshot`, and never log or echo the token
- [x] T056 [US3] Add lifecycle cleanup: delete `Building` versions older than two hours at startup and at refresh start, mark `Running` runs older than the timeout `Abandoned`, and delete `Superseded` versions after one day; implement in `backend/src/PlayNext.Infrastructure/Catalog/CatalogVersionStore.cs`, `CatalogRefreshRunStore.cs`, and a startup hook in `Program.cs`
- [x] T057 [US3] Add the retention read gate in `backend/src/PlayNext.Application/UseCases/CatalogQueryService.cs` and `backend/src/PlayNext.Infrastructure/Catalog/CatalogPoolReader.cs`: a version whose `LatestObservedAt` is past the cutoff is treated as absent, purged, and answered with `503 catalog-not-ready`
- [x] T058 [US3] Raise Kestrel's `MaxRequestLineSize` to 32 KB in `backend/src/PlayNext.Api/Program.cs` so the `ids` mode fits
- [x] T059 [US3] Add one structured log line per completed slice in `backend/src/PlayNext.Application/UseCases/RefreshCatalogUseCase.cs` (region, slice, status, discovered/fresh/carried counts, duration) with no titles, payloads, headers, or credentials
- [x] T060 [US3] Create `.github/workflows/catalog-refresh.yml` per `contracts/catalog-refresh.md`: daily `0 6 * * *` plus `workflow_dispatch`, `concurrency: catalog-refresh`, base URL from `AZURE_WEBAPP_PUBLISH_PROFILE`, `POST /api/catalog/refresh?region=BR` with `CATALOG_ADMIN_TOKEN`, poll status every 30 s up to 75 min, `PartiallyFailed` warns and exits 0, `Failed`/`Abandoned`/timeout exit 1
- [x] T061 [US3] Wire the retention store/use case, lifecycle cleanup, and admin configuration in `backend/src/PlayNext.Api/Program.cs`

**Checkpoint**: US3 is independently testable; a scheduled refresh, a failed slice, a purge, and the admin surface all behave as specified.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verification, documentation, and hardening across all stories.

- [x] T062 [P] Scan `frontend/dist/`, a sample of API responses, and captured API logs under `backend/` for the TMDB token and the admin token; record zero occurrences (SC-009)
- [x] T063 [P] Validate performance with `EXPLAIN (ANALYZE, BUFFERS)` on the targeted-pool and ids queries in PostgreSQL, confirm index use, and record warm-read/payload numbers against SC-008 and SC-010; add an index only if a plan shows a sequential scan on the pool predicate (results in [perf-results.md](perf-results.md))
- [x] T064 [P] Update `README.md` with the new `Catalog:*` settings, the admin token secret, the refresh workflow, and a pointer to the cutover/rollback sequence in `specs/008-catalog-normalization/contracts/catalog-refresh.md`
- [ ] T065 [P] Execute `specs/008-catalog-normalization/quickstart.md` in staging through the cutover checklist, including the gated live-depth scenarios; record results and any deviations
- [x] T066 [P] Review `backend/src/PlayNext.Domain/`, `backend/src/PlayNext.Application/`, and `backend/src/PlayNext.Infrastructure/` for dead paths, TODO markers, and XML doc gaps; remove the legacy snapshot refresh path only when the user explicitly decides to retire it (out of scope for this feature)
- [x] T067 Run the full suites and production build — `dotnet test` from `backend/`, `npx ng test --watch=false` and `npx ng build` from `frontend/` — and fix every regression before declaring the feature done

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup; **blocks all user stories**.
- **User Story 1 (Phase 3)**: Depends on Foundational.
- **User Story 2 (Phase 4)**: Depends on US1 — it extends `CatalogPoolReader`,
  `CatalogEndpoints`, and the service/catalog types US1 introduces.
- **User Story 3 (Phase 5)**: Depends on US2 — it extends the refresh use case
  built in US2 and needs the per-service data model.
- **Polish (Phase 6)**: Depends on all three stories.

### User Story Dependencies

- **US1 (P1, MVP)**: Independently testable with `Catalog:Source=Snapshot`
  serving traffic; migration and parity are proven before enrichment.
- **US2 (P2)**: Independently testable against the deep stub; does not require
  US3's failure handling, scheduling, or retention.
- **US3 (P3)**: Independently testable with the stub's failure injection; it
  builds on US2's refresh but not on US2's frontend work.

### Within Each User Story

- Tests first; they must fail before the implementation tasks in the same story.
- Domain/contracts before infrastructure; storage before orchestration;
  orchestration before endpoints; backend before frontend integration.
- `CatalogEndpoints.cs`, `Program.cs`, `RefreshCatalogUseCase.cs`, and
  `CatalogPoolReader.cs` are shared files within a story — keep the listed
  order for those tasks.

### Parallel Opportunities

- Foundational: T005/T006/T007 (entity files), T010/T011 (contracts/ports),
  T014/T015 (seeder/stub) can run in parallel.
- US1: T017/T018/T019 (three test files) can run in parallel.
- US2: T028–T034 (tests) can run in parallel; T035/T036 (domain types) and
  T041 (frontend model) can run in parallel with them.
- US3: T046/T047/T048/T049 (tests) and T050 (domain rule) can run in parallel.
- Polish: T062–T066 can run in parallel; T067 is last.

---

## Parallel Example: User Story 2

```text
# Tests, in parallel:
Task: "CatalogSliceTests.cs — slice plan and dedupe"
Task: "CatalogPoolQueryTests.cs — filter normalization and validation"
Task: "NormalizedCatalogTests.cs — targeted filters and ids"
Task: "CatalogRefreshTests.cs — success path and depth"
Task: "catalog.service.spec.ts + http-catalog-source.spec.ts"
Task: "deck.spec.ts — targeted query and rated-id merge"

# Domain types, in parallel:
Task: "CatalogSlice.cs"
Task: "CatalogPoolQuery.cs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. **STOP and VALIDATE**: migrate a real snapshot, compare parity, switch
   sources, roll back by configuration, and confirm user records resolve.
4. Deploy with `Catalog:Source=Snapshot`; the normalized path is proven but
   not yet serving traffic. No behavior change for visitors.

### Incremental Delivery

1. **US1** → normalized storage + migration + rollback. The catalog is now
   queryable, and the riskiest change (user data and parity) is retired.
2. **US2** → deep per-service pools + filters/ids + frontend use. Flip
   `Catalog__Source=Normalized` after parity acceptance; measure Netflix +
   horror.
3. **US3** → mixed-version refresh, retention, admin surface, and the scheduled
   workflow. This is what makes the deeper catalog sustainable.
4. Each story is deployable without breaking the previous one; each has a
   checkpoint to stop and validate.

### Notes

- [P] tasks touch different files and have no incomplete dependency.
- [Story] labels map tasks to spec user stories for traceability.
- Tests are written first in each story and must fail before implementation.
- No ranking, filter, quiz, or screen-shape changes are allowed in any task
  (FR-025). If a task appears to require one, stop and revisit the design.
- Commit after each task or logical group; never commit secrets or the parity
  fixtures.
