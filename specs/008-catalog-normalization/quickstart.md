# Quickstart: Normalized Catalog & Per-Service Pools — Validation Guide

**Feature**: 008 | **Date**: 2026-10-23

Runnable scenarios that prove the feature end to end. The read contract is in
[contracts/catalog-api.md](contracts/catalog-api.md), the operational surface in
[contracts/catalog-refresh.md](contracts/catalog-refresh.md), and the schema in
[data-model.md](data-model.md).

The feature is validated in the same order it is cut over: migrate, prove
parity, prove user data survives, prove the switch works, then enrich and prove
depth.

## Prerequisites

1. **.NET 10 SDK**, Node (the version the frontend pins), a **PostgreSQL 17**
   database, and the `dotnet-ef` tool.
2. **TMDB API Read Access Token** — the long `eyJ…` token, not the 32-character
   API key. The gated depth scenario needs it; every other scenario runs against
   the stub.
3. **Local configuration** (values supplied by the developer; never committed):

   ```powershell
   cd backend/src/PlayNext.Api
   dotnet user-secrets set "Tmdb:ApiKey" "<api-read-access-token>"
   dotnet user-secrets set "Jwt:SigningKey" "<at-least-32-bytes>"
   dotnet user-secrets set "ConnectionStrings:Postgres" "<connection-string>"
   dotnet user-secrets set "Catalog:AdminToken" "<32-random-bytes-base64url>"
   ```

4. **Schema**:

   ```powershell
   cd backend
   dotnet ef database update --project src/PlayNext.Infrastructure --startup-project src/PlayNext.Api
   ```

5. **Run**: API on `http://localhost:5003` (`dotnet run` from
   `backend/src/PlayNext.Api`), frontend with `npm start` from `frontend`
   (the proxy maps `/api` → 5003).

## Automated suites first

```powershell
# Backend: Domain, Application, API integration (stubbed TMDB, no live key needed)
cd backend
dotnet test

# Frontend: the project's working command; `npx vitest run` is not configured
cd frontend
npx ng test --watch=false

# Production build
npx ng build
```

The suites must be green before any scenario below. The integration tests
exercise the refresh, migration, retention, admin, and rollback paths with a
stub that honors `with_watch_providers`, `watch_region`,
`with_watch_monetization_types`, `with_original_language`, provider names, and
region links; they need no provider credential.

## Scenario 1 — Migration parity (US1, FR-005/006/008, SC-001/003)

1. **Warm a snapshot.** Run the API with `Catalog:Source` unset (default
   `Snapshot`) and load a deck, or call:

   ```powershell
   curl.exe "http://localhost:5003/api/catalog?region=BR"
   ```

   A cold region answers `503 catalog-not-ready` while the retrieval runs;
   retry until it is `200`. Confirm the row exists in `CatalogSnapshots`.

2. **Migrate.** Enable the runner and restart:

   ```powershell
   $env:Catalog__Migration__Enabled = "true"
   dotnet run
   ```

   Poll the admin status until the migration run is terminal (the token is the
   one configured above):

   ```powershell
   curl.exe -H "X-PlayNext-Admin-Token: $env:CATALOG_ADMIN_TOKEN" `
     "http://localhost:5003/api/catalog/refresh/status?region=BR"
   ```

   Expected: `kind: "Migration"`, `status: "Succeeded"`, a `versionId`, and
   counts whose `titles` and `availabilityEntries` equal the snapshot's arrays.
   Then set `Catalog__Migration__Enabled` back to `false`.

3. **Capture both responses for the same version.**

   ```powershell
   # Snapshot path (still the configured source)
   curl.exe "http://localhost:5003/api/catalog?region=BR" -o snapshot.json

   # Normalized path
   $env:Catalog__Source = "Normalized"
   # restart the API, then:
   curl.exe "http://localhost:5003/api/catalog?region=BR" -o normalized.json
   ```

   Expected: the two JSON documents are field-identical — the same title ids in
   the same order, the same genres, availability entries, and links. This is the
   fixed-version parity FR-008 measures before enrichment.

4. **Run the parity harness.** Save the two files under
   `frontend/src/app/features/deck/deck-logic/parity/fixtures/` (gitignored) and
   run `npx ng test --watch=false`. The harness builds the 9 genres × 11
   services × 3 media types matrix (plus all-any), runs `rankTitles` over each
   response, and asserts 100% identical eligible ids and order — SC-001's
   matrix. It skips with a clear message when the fixtures are absent.

5. **User data survives.** With real ratings, history, and watchlist entries in
   the database, open the watchlist and history screens. Every row still
   resolves to the same title. Verify the counts directly:

   ```sql
   SELECT count(*) FROM "Interactions";
   SELECT count(*) FROM "WatchHistory";
   SELECT count(*) FROM "CatalogTitleIdentities";
   ```

   Expected: user counts unchanged by the migration; every referenced title id
   has an identity row.

## Scenario 2 — The switch and the rollback (US1, FR-007, SC-005)

1. With `Catalog:Source=Normalized`, load the deck and note the first card and
   a few badge links.
2. Set `Catalog:Source=Snapshot` and restart. Reload the deck.
   Expected: the snapshot path serves the deck; no error; the time from setting
   the value to a working load is under five minutes and involved no
   deployment. Targeted filter parameters are ignored by this path, as the
   contract states; the client's own filters keep the deck correct.
3. Set it back to `Normalized` and restart. Reload. Expected: the normalized
   path serves the same migrated version; because it was idle while rolled
   back, the first read may start a refresh, but the current version is served
   meanwhile.

## Scenario 3 — Targeted pools and the id batch (US2, FR-027/028, SC-012/013)

```powershell
# One service + one genre + one media type
curl.exe "http://localhost:5003/api/catalog?region=BR&services=netflix&genres=horror&mediaTypes=movie" -o netflix-horror.json

# Two services: a title carried by both must appear once
curl.exe "http://localhost:5003/api/catalog?region=BR&services=netflix,max&genres=horror" -o both.json

# Batch resolution, exactly as the watchlist sends it
curl.exe "http://localhost:5003/api/catalog?region=BR&ids=tmdb:movie:27205,tmdb:tv:1396" -o ids.json
```

Expected:

- `netflix-horror.json` contains only matching titles, all with a `netflix`
  badge (plus any other services carrying them), in the unchanged response
  shape. Its title count is the depth measured in scenario 5.
- `both.json` has no duplicate title id; each title carries both services when
  both carry it.
- `ids.json` returns exactly the requested titles that exist; unknown ids are
  omitted; an archived title has `availability: []`. One request per watchlist
  load — verify in the network panel that opening the watchlist issues one
  catalog request, not one per row.
- An empty result (e.g. a service + genre with nothing in the region) is `200`
  with `titles: []`; the deck's existing empty state explains it.
- `services=not-a-service` is `200` with an empty pool (the vocabulary is data);
  `services=Not A Service!` is `400 invalid-service`.

## Scenario 4 — Refresh, failure, and the mixed version (US3, FR-013/014, SC-006)

The deterministic mixed-version case is covered by
`CatalogRefreshTests` in the integration suite, which fails exactly one
service slice in the stub and asserts every other slice's fresh data and the
failed slice's carried data are in one promoted version. Run it directly:

```powershell
cd backend
dotnet test tests/PlayNext.Api.IntegrationTests --filter "FullyQualifiedName~CatalogRefreshTests"
```

For the all-provider-down manual drill, point the provider at a port that
refuses connections, then trigger a refresh:

```powershell
$env:Tmdb__BaseUrl = "https://127.0.0.1:9/3"
$env:Catalog__Source = "Normalized"
dotnet run

curl.exe -X POST -H "X-PlayNext-Admin-Token: $env:CATALOG_ADMIN_TOKEN" `
  "http://localhost:5003/api/catalog/refresh?region=BR"
```

Expected: `202`; status ends `Failed`; the active version, the deck, and the
snapshot are unchanged. A reload during the run serves the active version and
never a partial catalog. Restore `Tmdb__BaseUrl`.

## Scenario 5 — Per-service depth (US2, FR-009/023/024, SC-002)

With a live token, run a full normalized refresh:

```powershell
curl.exe -X POST -H "X-PlayNext-Admin-Token: $env:CATALOG_ADMIN_TOKEN" `
  "http://localhost:5003/api/catalog/refresh?region=BR&mode=normalized"
```

Poll status until terminal (a full refresh is minutes, not seconds). Then count:

```powershell
$body = curl.exe -s "http://localhost:5003/api/catalog?region=BR&services=netflix&genres=horror&mediaTypes=movie" | ConvertFrom-Json
$body.titles.Count
```

Expected: **≥300** (or the provider's full reported depth when lower), against
the measured baseline of 8 on 2026-10-23. Repeat for `max` + `horror` (baseline
15) and for `mediaTypes=tv` and `mediaTypes=anime`. No title is padded: every
returned title carries the requested service's badge. This scenario is gated —
it is the only one that spends live provider quota.

## Scenario 6 — Retention and the readable retired title (FR-015/016, SC-007)

1. Pick a rated title id, then age its active-version row past the cutoff:

   ```sql
   UPDATE "CatalogTitles"
   SET "LastObservedAt" = now() - interval '200 days'
   WHERE "TitleId" = 'tmdb:movie:27205'
     AND "VersionId" = (SELECT "Id" FROM "CatalogVersions"
                        WHERE "Region" = 'BR' AND "State" = 'Active');
   ```

2. Trigger a refresh (or restart with a successful provider) so the purge runs.
3. Verify:

   ```sql
   -- Gone from the active version:
   SELECT count(*) FROM "CatalogTitles" WHERE "TitleId" = 'tmdb:movie:27205'
     AND "VersionId" = (SELECT "Id" FROM "CatalogVersions"
                        WHERE "Region" = 'BR' AND "State" = 'Active');
   -- Readable copy exists because a user record references it:
   SELECT "TitleId", jsonb_array_length("PayloadJson"->'availability')
   FROM "CatalogRetiredTitles" WHERE "TitleId" = 'tmdb:movie:27205';
   -- The rating is untouched:
   SELECT count(*) FROM "Interactions" WHERE "TitleId" = 'tmdb:movie:27205';
   ```

   Expected: `0` in the active version; one archive row with `0` availability
   entries; the user's rating still present. `GET /api/catalog?region=BR&ids=tmdb:movie:27205`
   returns the archived title with an empty `availability` array, and a pool
   request never includes it.
4. Remove the rating; run the purge; the archive row disappears.

## Scenario 7 — Admin surface (FR-018)

```powershell
# No token on the server: route is absent
curl.exe -i -X POST "http://localhost:5003/api/catalog/refresh?region=BR"
# -> 404

# Wrong token
curl.exe -i -X POST -H "X-PlayNext-Admin-Token: wrong" "http://localhost:5003/api/catalog/refresh?region=BR"
# -> 401 admin-unauthorized

# Correct token
curl.exe -i -X POST -H "X-PlayNext-Admin-Token: $env:CATALOG_ADMIN_TOKEN" "http://localhost:5003/api/catalog/refresh?region=BR"
# -> 202 { "started": true, ... }

# Immediately again, while it runs
# -> 409 catalog-refresh-running
```

Status includes per-slice counts and failures, and never contains a title, a
payload, a header, or the provider token. Search a captured status response and
a refresh log for the token value: zero occurrences (SC-009).

## Scenario 8 — Performance and payload (SC-008/010/014)

- **Warm read**: after one load of a given query shape, reload the same deck.
  In DevTools with 4G throttling, the first card must render within 300 ms.
  The normalized read is served from the version-keyed memory cache; the
  response is bounded at 1,000 titles for a targeted pool. Record the payload
  size in the network panel (expected roughly 60–250 KB compressed, depending
  on the slice).
- **Refresh duration**: the status response's `durationSeconds` must be under
  3,600 for a full BR refresh (SC-010). The refresh runs off the request path;
  load the deck during it and confirm zero errors and no incomplete deck.
- **Snapshot freshness**: after a refresh whose general slice succeeded, query
  `CatalogSnapshots.FetchedAt` for BR. It must be no older than that run's
  completion, and a switch to `Snapshot` must serve it with no provider call
  (SC-014).

## Scenario 9 — Regression (SC-011, FR-025)

Run both suites and the production build (see "Automated suites first"). Then
walk the quiz → deck → rate → watchlist → detail → match-found loop. Ranking,
filter rules, quiz content, and screen shapes are unchanged; the only
difference is where the titles came from.

## Cutover checklist

- [ ] Migration run `Succeeded`; counts match the snapshot.
- [ ] Parity: field-identical responses and the 100+ combination harness pass.
- [ ] User sample (≥50 ratings, ≥50 history entries, ≥50 watchlist entries)
      resolves to the same titles.
- [ ] Rollback practiced in staging: setting `Catalog__Source=Snapshot` plus a
      restart serves the deck in under five minutes, no deployment.
- [ ] `Catalog__AdminToken` set in Azure; `CATALOG_ADMIN_TOKEN` set as a GitHub
      secret; the refresh workflow's `workflow_dispatch` succeeds.
- [ ] A full normalized refresh completes under 60 minutes with
      `Succeeded` or a justified `PartiallyFailed`.
- [ ] Netflix + horror and Max + horror reach the target (or provider depth).
- [ ] Retention drill passed: expired catalog data deleted, user data readable.
- [ ] Credential scan: bundle, responses, logs — zero occurrences.
- [ ] The scheduled workflow has run once on its own schedule.

## What this guide does not prove

- **Live depth varies by region and time.** SC-002 is anchored to the
  2026-10-23 measurement; a provider that genuinely carries fewer than 300
  titles passes by reporting its full depth, which is why the count is read
  from the provider rather than asserted blindly.
- **The 300 ms budget is a browser measurement.** The server-side half
  (payload size, warm cache) is reproducible here; the phone measurement needs
  a throttled browser or device.
- **Provider terms.** The retention drill proves the mechanism, not the legal
  interpretation; the six-month ceiling remains the operating rule.
- **`PartiallyFailed` daily.** A chronically failing service will keep its
  last-known-good data and show up in every status response; the workflow warns
  rather than fails so that the failure is visible without paging on day one.
