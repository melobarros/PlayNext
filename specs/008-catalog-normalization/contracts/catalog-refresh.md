# Contract: Catalog Refresh, Status, and Migration

**Owner**: feature 008 | **Consumers**: operators and the scheduled GitHub
Actions workflow — never the Angular client | **Date**: 2026-10-23

The read API is in [catalog-api.md](catalog-api.md). This document covers the
server-to-server surface that drives a refresh and reports what happened. It is
not part of the public product API, is disabled unless configured, and never
returns catalog payloads or credentials.

Base URL: `/api` under the API's origin. All bodies are UTF-8 JSON, camelCase.

## Authentication

Every admin route requires the header:

```http
X-PlayNext-Admin-Token: <Catalog:AdminToken>
```

- `Catalog:AdminToken` is an Azure app setting (secret), at least 32 random
  bytes, base64url-encoded. It is also a scoped GitHub secret
  (`CATALOG_ADMIN_TOKEN`) for the scheduled workflow.
- Comparison uses `CryptographicOperations.FixedTimeEquals` over the UTF-8
  bytes.
- If the setting is absent or empty, the routes are **not mapped**: the API
  returns its normal `404` for an unknown route, exactly as if the feature were
  not deployed. A disabled feature must not advertise itself.
- A present but wrong token returns `401` with
  `{ "code": "admin-unauthorized", "errors": ["admin token is not valid"] }`.
- The token is never logged, never echoed, and never placed in a URL. It is not
  available to the client bundle.

## `POST /catalog/refresh`

Starts a refresh in the background and returns immediately. At most one refresh
runs per region; a request while one is running is refused rather than queued.

| Parameter | Required | Format | Meaning |
|---|---|---|---|
| `region` | yes | `^[A-Z]{2}$` | Region to refresh |
| `mode` | no | `configured`, `normalized`, `snapshot` | Default `configured` |

Modes:

- **`configured`** — runs whatever `Catalog:Source` names: the normalized
  refresh when the source is `Normalized`, the legacy general refresh when it is
  `Snapshot`. This is what the scheduled workflow and the request-triggered
  self-heal use.
- **`normalized`** — builds and promotes a normalized version even while reads
  are still served from the snapshot. Used once during cutover to enrich the
  catalog before flipping the read source, without exposing an incomplete new
  path. Readers stay on the snapshot until the source changes.
- **`snapshot`** — runs the legacy general refresh and rewrites only the
  snapshot. Used to verify the rollback path and to refresh the snapshot while
  rolled back.

Responses:

| Case | Status | Body |
|---|---|---|
| Started | `202` | `{ "started": true, "region": "BR", "mode": "Normalized" }` |
| Already running for the region | `409` | `{ "code": "catalog-refresh-running", "errors": ["a catalog refresh is already running for BR"] }` |
| Missing/malformed region | `400` | `{ "code": "invalid-region", "errors": [...] }` |
| Unknown mode | `400` | `{ "code": "invalid-mode", "errors": ["mode must be configured, normalized, or snapshot"] }` |
| Bad token | `401` | `{ "code": "admin-unauthorized", "errors": ["admin token is not valid"] }` |
| Admin surface disabled | `404` | normal unknown-route response |

The background run owns its own scope and cancellation. A request timeout or a
client disconnect does not cancel it; the run's own soft timeout
(`Catalog:RefreshTimeoutMinutes`, default 55) and the stale-run cleanup do.

## `GET /catalog/refresh/status`

Returns the most recent run for a region, including a run that is still
`Running`. This is the observability surface FR-018 requires.

| Parameter | Required | Format |
|---|---|---|
| `region` | yes | `^[A-Z]{2}$` |

`200` with the latest run:

```jsonc
{
  "region": "BR",
  "kind": "Refresh",                 // Refresh | Migration
  "mode": "Normalized",              // Configured | Normalized | Snapshot | null for Migration
  "status": "PartiallyFailed",       // Running | Succeeded | PartiallyFailed | Failed | Abandoned
  "startedAt": "2026-10-23T06:00:04Z",
  "completedAt": "2026-10-23T06:12:31Z",
  "durationSeconds": 747,
  "versionId": "0f0d6c1e-...",       // the version this run promoted, or null
  "counts": {
    "general": { "discovered": 1041, "fresh": 1041, "carried": 0, "enriched": 1039, "availabilityEntries": 1502 },
    "netflix": { "discovered": 3120, "fresh": 3120, "carried": 0, "enriched": 3120, "availabilityEntries": 4021 },
    "max":     { "discovered": 0, "fresh": 0, "carried": 2871, "enriched": 0, "availabilityEntries": 3900 }
  },
  "failures": {
    "max": "provider returned HTTP 503 after 3 attempts; last-known-good carried"
  }
}
```

While `status` is `Running`, `completedAt`, `durationSeconds`, `versionId`, and
`counts` may be `null`; `counts` is written when the run finishes. If the region
has never had a run:

```json
{ "region": "BR", "status": "none" }
```

`failures` keys are slice names (`general`, `netflix`, …); values are sanitized
summaries — status code, attempt count, and disposition. No response bodies, no
headers, no provider key, no title data.

## Run lifecycle

```text
Running ──▶ Succeeded          every planned slice fresh
   │   ├──▶ PartiallyFailed    mixed version promoted; at least one slice carried
   │   ├──▶ Failed             no promotion; active version unchanged
   │   └──▶ Abandoned          process died; cleaned up on the next start/run
```

- `Succeeded` requires every slice fresh **or**, after the first version exists,
  every failed slice carried from a previous version. A first refresh with any
  failed slice is `Failed` (there is nothing to carry, so the version would not
  be complete).
- `PartiallyFailed` is a promoted version and a successful outcome for readers.
- `Failed` means the active version is untouched. The next schedule or the next
  stale read retries.
- `Abandoned` is set for a `Running` row older than the refresh timeout when no
  build is in progress; its `Building` version is deleted (never visible).
- A 429 that survives the retry budget aborts the run as `Failed`; no version is
  promoted. Partial counts are still recorded.

## Migration

There is no public migration endpoint. The migration is an opt-in hosted runner:

- `Catalog:Migration__Enabled=true` at startup runs one migration attempt for
  every region whose snapshot is readable and within retention.
- It is idempotent and resumable (research D6): rerunning with the same snapshot
  timestamp upserts into the same building version; a newer snapshot discards
  the stale building version; an already promoted version with the same source
  timestamp is skipped.
- A missing, malformed, or over-age snapshot records a `Failed` migration run
  for that region and leaves the region and every user record untouched.
- Migration runs appear in `GET /catalog/refresh/status` with
  `kind: "Migration"`, `mode: null`, and per-region counts
  (`titles`, `availabilityEntries`, `genres`, `skippedTitles`).
- The runner never deletes `CatalogSnapshots`, never touches user rows, and
  never promotes a version that was not fully written.

Enable it for one restart, verify the migration run, then disable it. Leaving it
enabled is harmless (it skips already-migrated timestamps) but unnecessary.

## Scheduled workflow

`.github/workflows/catalog-refresh.yml` owns the daily schedule:

```yaml
on:
  schedule:
    - cron: '0 6 * * *'      # 06:00 UTC, before the European morning
  workflow_dispatch:
concurrency:
  group: catalog-refresh
  cancel-in-progress: false
```

Steps:

1. Derive the app's base URL from `secrets.AZURE_WEBAPP_PUBLISH_PROFILE` using
   the same publish-profile parsing the deploy workflow's smoke test already
   uses. No new URL variable to drift.
2. `POST /api/catalog/refresh?region=BR` with
   `X-PlayNext-Admin-Token: ${{ secrets.CATALOG_ADMIN_TOKEN }}`.
   - `202` → continue.
   - `409` → another run is already in progress; exit successfully (the other
     run reports itself).
   - Any other status → fail the job.
3. Poll `GET /api/catalog/refresh/status?region=BR` every 30 seconds, for up to
   75 minutes. Polling also keeps the F1 instance awake while the in-process
   refresh runs.
4. Terminal outcomes:
   - `Succeeded` → success.
   - `PartiallyFailed` → emit `::warning` with the failure keys; exit `0`. A
     single flaky service should be visible without waking anyone every day.
   - `Failed` / `Abandoned` / timeout → exit non-zero.

The workflow uses no checkout, no build, and no `az` login. The only secret it
reads is the publish profile (URL) and the admin token. Neither is echoed.

## Operational sequence (cutover and rollback)

1. **Deploy** the schema, code, and vocabulary seeder with defaults:
   `Catalog:Source` absent (`Snapshot`), `Catalog:Migration:Enabled` absent
   (`false`). The visitor path is unchanged.
2. **Configure** `Catalog__AdminToken` (random, ≥32 bytes) as an Azure app
   setting and `CATALOG_ADMIN_TOKEN` as a GitHub secret. Restart the app.
3. **Migrate** — set `Catalog__Migration__Enabled=true`, restart, poll status
   until the `Migration` run is terminal, then set it back to `false`.
4. **Pre-build (optional)** — `POST /api/catalog/refresh?region=BR&mode=normalized`
   while reads still use the snapshot. This pays the full refresh cost before
   the switch. The promoted version is invisible to visitors.
5. **Flip** — set `Catalog__Source=Normalized`, restart. Reads now use the
   normalized version; the snapshot stays as the rollback document.
6. **Verify** — the no-filter response matches the migrated snapshot's general
   pool; Netflix + horror reaches the target; the watchlist resolves its ids.
7. **Roll back** if anything is wrong — set `Catalog__Source=Snapshot`,
   restart. No deployment. The snapshot is no older than the last successful
   general refresh.

App settings used by this feature:

| Setting | Default | Purpose |
|---|---|---|
| `Catalog__Source` | `Snapshot` | `Snapshot` or `Normalized`; read per request |
| `Catalog__AdminToken` | empty | Enables the admin routes; server-to-server secret |
| `Catalog__Migration__Enabled` | `false` | Runs the snapshot migration once at startup |
| `Catalog__MaxPoolTitles` | `1000` | Cap for a targeted pool response |
| `Catalog__MaxIdsPerRequest` | `1000` | Cap for an `ids` batch |
| `Catalog__RefreshTimeoutMinutes` | `55` | Soft budget for one refresh |
| `Tmdb__ServiceTitlesPerGenre` | `300` | Depth target per service/genre/media type |
| `Tmdb__MaxDiscoverPages` | `25` | Safety cap on paging (target needs 15 at 20/page) |
| `Tmdb__MaxRetries` | `2` | Retries for transient provider failures |

## Credential and logging rules

- The TMDB bearer token and the admin token are read from configuration only;
  neither is ever written to the client bundle, a response body, a URL, or a
  log line.
- Run failures record a status code, an attempt count, and a disposition. They
  never include headers, request URLs with credentials, or response payloads.
- The refresh logs one structured line per slice at completion: region, slice,
  status, discovered/fresh/carried counts, duration. No title data.

## Non-goals

- No public or user-authenticated refresh trigger.
- No arbitrary region activation; the endpoint accepts any well-formed region,
  but only regions with a configured refresh are operated.
- No job queue or external scheduler beyond GitHub Actions.
- No per-title or per-slice manual mutation endpoints.
