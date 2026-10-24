# Phase 0 Research: Normalized Catalog & Per-Service Pools

**Feature**: 008-catalog-normalization | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

This file resolves every unknown behind the plan. Each decision is stated with
its rationale and the alternatives that were rejected; the data model and
contracts that follow from them are in [data-model.md](data-model.md) and
[contracts/](contracts/).

## Starting point (measured, not assumed)

- The catalog is one JSON document per region: `CatalogSnapshots(Region PK,
  FetchedAt, PayloadJson jsonb)`, served through `IMemoryCache` (L1) and
  PostgreSQL (L2). There is no `CatalogTitles` table.
- `Interactions.TitleId` and `WatchHistory.TitleId` are `varchar(64)` strings
  with no foreign key. They are opaque to PostgreSQL; only the client knows the
  `tmdb:{movie|tv}:{id}` form.
- `TmdbClient.FetchAsync` runs 9 genres × {movie, tv} at 60 titles each, plus an
  anime quota of 60 (`with_genres=16` + `with_original_language=ja`). Every
  candidate is enriched through `append_to_response=watch/providers,videos`
  with `watch_region=BR`. Requests are paced at 30 rps; a 429 aborts the batch.
- Ranking is entirely client-side (`recommend.ts`): five hard filters, a tier
  sort by matched-genre count, then `6 × historyAffinity − 10 × mismatchedGenres
  + weightedRating`, with the title id as the final tiebreak. `historyAffinity`
  scans the **whole catalog** for rated titles, including titles the rating
  filter later removes.
- Baseline on 2026-10-23: 917 titles in BR; 524 with availability, 393 without;
  Netflix + horror = 8, Max + horror = 15. That is the defect feature 008
  exists to fix.
- Retention in the current store is 180 days, purged by the snapshot store.

The design has to change three things at once — storage, refresh, and read
shape — without changing what the visitor's deck does. The decisions below keep
those three separable.

---

## D1. Versioned normalized rows with one active version per region

**Decision.** Store the catalog as immutable, version-scoped rows:
`CatalogVersions`, `CatalogTitles`, `CatalogTitleGenres`, and
`CatalogAvailability` (full schema in [data-model.md](data-model.md)). A region
has at most one `Building` and at most one `Active` version, enforced by two
partial unique indexes. A refresh builds an invisible version, then promotes it
in **one transaction**: previous `Active` → `Superseded`, `Building` → `Active`,
and (when the general slice succeeded) the rollback snapshot is written in the
same transaction. Readers resolve the active version id **once** and pass it to
every query, so a reader never observes a mix of versions even if promotion
commits between two of its queries.

**Rationale.** FR-014 requires a complete, mixed version and forbids partial
catalogs; FR-013 requires one failed slice not to discard another slice's work.
Version-scoped rows are the simplest structure that gives both. A promotion is
a metadata update, not a data copy. Deletion is a range delete by version id,
which keeps retention cheap. Pinning the version id on the read path removes the
need for repeatable-read transactions or locks — the rows a reader references
cannot change under it.

**Alternatives considered.**
- *Mutate rows in place.* A reader can see the new availability with the old
  title set (or vice versa), which is the partial catalog the spec forbids.
- *Copy-on-write per slice.* There is no single version boundary, so "which
  combination is live?" has no answer.
- *Partition tables by version.* Same deletion benefit, much more operational
  surface (partition management, EF migration complexity) for a table whose
  largest version is on the order of 20,000 titles. Rejected as overkill.
- *One row per title with a `ValidFrom/ValidTo` range.* Powerful, but every
  query carries a temporal predicate, and promotion is a mass update. Version
  ids are simpler and faster.

**Storage estimate.** 10,000–20,000 titles per version; ~2.5 genre rows and
~1.5 availability rows per title. At ~400 B per title row, ~40 B per genre row,
and ~250 B per availability row (links dominate), that is roughly 10–20 MB of
heap per version plus a comparable index footprint. Keeping the active version
and the previous one for a day puts a region at well under 100 MB — inside Neon's
free tier, which the project already uses. No partitioning.

---

## D2. The slice plan: general + one slice per quiz service

**Decision.** A refresh plans and builds these slices per region:

1. **General slice** — exactly today's queries: the 9 quiz genres × {movie, tv}
   at `MoviesPerGenre`/`TvPerGenre` = 60 each, plus the anime quota of 60
   (`with_genres=16&with_original_language=ja`), in the same order, deduped the
   same way. This slice produces `InGeneralPool = true` rows and is what the
   rollback snapshot is written from.
2. **One service slice per quiz service** (the 11 in the vocabulary) — for each
   of the 9 quiz genres and each underlying endpoint (`movie`, `tv`), page
   `discover` until **300 distinct titles of that presentation media type** are
   collected or the provider has no more pages. Then, for each quiz genre, page
   the anime query (`with_genres=16,<genre>` + `with_original_language=ja`) on
   both endpoints until 300 anime titles for that genre, plus an
   anime-any-genre stream per service (300 total). Dedupe by title id across
   every stream of the slice.

The 300 target is per **(service, genre, media type)**, so the movie, TV, and
anime buckets are counted separately after classification. A horror anime
returned by the movie+horror query counts toward anime+horror, not movie+horror;
paging continues until the movie bucket itself reaches 300. Where the provider
runs out of pages, the provider's depth is the pool (FR-023/FR-024) — no
padding, no synthetic availability.

**Rationale.** FR-009 says per-service pools come from each service's catalog,
not from filtering a general sample. `discover` with `with_watch_providers` and
`watch_region` is the only TMDB surface that can enumerate a service's titles
deeply; `with_watch_monetization_types=flatrate|free|ads` keeps the same
streamable scope the product already promises (005's decision, unchanged).
Anime is a **classification**, not a discover endpoint, so it needs the
animation + Japanese filter per genre to reach depth; without the per-genre
anime streams, "anime + horror" would be limited to whatever the movie/TV horror
pages happened to contain.

The general slice is deliberately kept at today's limits rather than grown: it
exists for "other platforms" and for the rollback snapshot, both of which
should keep today's shape. Depth lives in the service slices.

**Alternatives considered.**
- *One query per service without a genre.* Cannot bound the work or hit a
  per-genre depth target; the page set is unbounded and the composition
  arbitrary.
- *Only per-service genre queries, no anime streams.* Guarantees shallow anime
  and makes the anime media type a second-class citizen.
- *Discover by service only and stop at 300 total.* Would starve every genre
  after the first, which is exactly the defect being fixed.
- *Grow the general pool to 300 per genre too.* Multiplies the rollback
  snapshot and changes the no-filter deck by design, which parity (FR-008) and
  the rollback assumption both argue against.

---

## D3. Enrichment, complete availability, and unknown services

**Decision.** Discovery supplies candidate ids, `genre_ids`, `popularity`,
`original_language`, and the card's basic metadata. Every unique candidate id
across all slices is then enriched **once** through
`/{movie|tv}/{id}?append_to_response=watch/providers,videos&language=en-US&watch_region={region}`.
That single pass produces runtime, complete availability, and the trailer.

Availability selection is unchanged from 005 except for the unknown-service
case: buckets are read `flatrate` → `free` → `ads`; the first entry per
canonical service wins; alias provider ids are canonicalized to one service
(Netflix `8` + `1796`, Prime `119` + `2100`); badges are deduped by service and
stored with a `Position` so the wire order is stable.

- **Known service**: deep link from the 005 search template, as today.
- **Unknown service**: upsert a `CatalogServices` row (`Id = "tmdb:{id}"`,
  `DisplayName` from the provider payload, no template, not a quiz service),
  upsert the provider-id mapping, and use the **region-level TMDB `link`** as
  the badge's deep link. If TMDB supplies no region link, the badge is omitted
  (there is nothing to open). This is the deliberate replacement of 005's
  "exclude the provider" rule, required by the spec's edge case: an unknown
  service is data, named on the badge, not dropped.

Title attributes come from the **first discovery** of the title in the fixed
slice/query order (general first, then services in vocabulary order; within a
slice, genres in vocabulary order, then movie/tv, then anime). This preserves
the current genre ordering rule — quiz genres first, then tags, provider order
— and makes the choice deterministic when a title is discovered by several
queries. Merging genres from every discovery would change the card's genre list,
which parity forbids.

**Rationale.** `discover` can filter *by* a service but cannot list every
service carrying a title; per-title `watch/providers` remains the only complete
source, and the current implementation already relies on it. Enriching the
union once rather than once per slice is what keeps a 10,000–20,000-title
refresh inside the call budget. The region-link fallback prevents a badge that
is a dead end (constitution II) while still naming the service honestly.

**Alternatives considered.**
- *Keep excluding unknown services.* Contradicts the spec's explicit edge case,
  and hides a real way to watch the title.
- *Name the unknown service but omit its link.* A badge that does nothing is a
  dead end.
- *Enrich per slice.* Multiplies detail calls by the number of services a title
  appears on, with no gain — the detail payload is already regional and
  complete.

---

## D4. Refresh orchestration, failure isolation, and mixed promotion

**Decision.** The refresh runs in four phases, all off the request path:

1. **Plan** — build the slice list for the region.
2. **Discover** — collect candidates per slice. A slice is **all-or-nothing on
   discovery**: if any stream still fails after retries, the slice is marked
   failed and its fresh candidates are discarded. Partial discovery must never
   silently shrink a slice, because a title's absence from a truncated page set
   is not evidence that the service dropped it.
3. **Enrich** — one pass over the unique candidate ids. A per-title enrichment
   failure carries that title's previous row (attributes and availability) if
   one exists, and drops it otherwise; the count is recorded.
4. **Compose and promote** — merge fresh and carried results into the new
   version, then promote in one transaction.

Merge rules, applied in plan order (general, then services):

- A title seen by any fresh slice exists once. Its availability starts from the
  fresh enrichment; carried availability entries fill only service keys the
  fresh data does not already have. **Fresh wins per service key.**
- `LastObservedAt` is the maximum of the merged contributions (fresh = now;
  carried = the previous value).
- `InGeneralPool` is true if the general slice produced or carried the title.
  `PoolPosition` comes from the general slice when present, otherwise discovery
  order within the first fresh slice that saw the title.
- A carried service slice contributes the previous version's titles that have an
  availability entry for that service in the region. A carried general slice
  contributes the previous version's `InGeneralPool` titles.
- A title that only a **successful** slice used to carry and that it no longer
  rediscovers is dropped. This is the replacement semantics that keeps the
  catalog bounded at the configured depth; a failed slice never drops anything.

Failure handling:

- **429** — honor `Retry-After` (capped), retry up to `MaxRetries`; if the
  provider is still limiting, abort the run. No version is promoted; the active
  version stays whole; the run records the partial counts it reached. This is
  the only safe reaction to a provider-wide stop.
- **5xx / network / timeout** — retry twice with jittered backoff. A slice that
  still fails is carried; other slices proceed.
- **First normalized refresh** — there is no last-known-good to carry. The
  first refresh promotes only if **every** slice succeeds; otherwise it is
  recorded `Failed`, the migrated version (general pool only) stays active, and
  the next schedule retries.
- **At least one slice fresh, previous version present** — promote the mixed
  version (FR-014, SC-006).
- **Nothing fresh and no previous version** — record `Failed`; no active
  version; readers see the existing not-ready path.

Run status is `Running`, `Succeeded`, `PartiallyFailed`, `Failed`, or
`Abandoned`. Every run records per-slice discovered/fresh/carried/failed title
counts and availability counts, duration, the promoted version id, and failure
messages that contain no credentials or payloads (FR-018).

**Rationale.** The slice is the unit the spec names for failure isolation, so
it is the unit the refresh commits. All-or-nothing discovery is the only way to
avoid a transient failure being mistaken for titles leaving the catalog. The
first-refresh rule follows the spec's definition of a complete version: a
failed slice with no last-known-good is not data, so a first version containing
it would be partial.

**Alternatives considered.**
- *Per-query failure isolation.* Smaller blast radius on paper, but a failed
  page quietly shrinks the slice and the title looks retired; rejected.
- *Promote the first refresh even with failed slices.* Violates the definition
  of a complete version and would make the depth target unverifiable.
- *Retry indefinitely on 429.* Blows the 60-minute budget and risks a ban;
  abort-and-retry-next-schedule is safer.

---

## D5. Retention, purge, and user-record protection

**Decision.** Reuse the existing 180-day (`TmdbOptions.MaxCacheAge`) limit as
the retention bound, with two layers:

- **Read gate** — every catalog read filters `LastObservedAt >= now − 180d`.
  Even if physical cleanup lags, no over-age data is served.
- **Physical purge** — runs at the start of every refresh attempt (whether or
  not the provider answers) and again after promotion:
  1. Archive referenced titles that are leaving the active version (see below).
  2. Delete expired rows from the active version, then recompute the version's
     `LatestObservedAt`.
  3. Delete `Superseded` versions whose `CompletedAt` is more than a day old.
     The one-day grace is many orders of magnitude longer than any read, so no
     in-flight reader can lose rows; a reader that pinned the version id before
     deletion finishes in milliseconds.
  4. Delete stale `Building` versions (older than two hours) left by a recycled
     process.
  5. Delete retired-title archive rows that no interaction or history entry
     references any more.

If the provider has been unreachable longer than the limit, the purge still
runs and the catalog empties. A read that finds `LatestObservedAt` older than
the cutoff returns `503 catalog-not-ready` and starts a refresh — the existing
empty/not-ready behavior, not a stale catalog.

**User records.** `CatalogTitleIdentities(TitleId)` is the durable anchor:
every title id ever written by a visitor gets a row (`INSERT … ON CONFLICT DO
NOTHING` in the account-merge transaction), and `Interactions.TitleId` /
`WatchHistory.TitleId` gain foreign keys to it. Migration backfills identities
from both user tables before the constraints are added. Identities are not
provider metadata; they are ids, so keeping an unreferenced one costs nothing
and deleting them is not required.

**Retired titles.** A title is *retired* when it is referenced by a rating,
history entry, or watchlist entry but is no longer in the active version (or its
last observation has expired). Before its catalog rows are deleted, its title
attributes — everything the card renders, **without availability** — are copied
into `CatalogRetiredTitles` as the wire payload. The `ids` lookup unions the
active version and the archive, so a retired title still resolves. It never
appears in a pool, which is FR-016's "readable but not recommended as new."
Availability is deliberately not archived: provider carriage data past the
retention limit is exactly what must not be kept.

**Rationale.** FR-015 and FR-016 pull in opposite directions; the spec's own
wording resolves it: purge catalog data, never delete referenced titles. Keeping
title attributes for referenced titles and dropping their availability keeps the
watchlist readable while honoring the provider's retention limit on the part
that matters (availability). The identity table makes the id relationship
explicit without forcing a title row to exist forever.

**Alternatives considered.**
- *No foreign key.* The spec assumption explicitly anticipates one, and the
  user's framing names the missing link as part of the problem.
- *Foreign key without an upsert on write.* A rating arriving for an id not yet
  in identities would fail the whole save — a dead end, and a regression in the
  tolerant watchlist behavior.
- *Archive availability too.* Retains provider carriage data indefinitely;
  rejected.
- *Rely on version deletion alone for retention.* Leaves the active version's
  expired rows in place when refreshes fail; the read gate helps but the data
  still exists. Physical deletion is required.

---

## D6. Snapshot migration: online, idempotent, resumable

**Decision.** A hosted runner (`CatalogMigrationRunner`) runs once at startup
when `Catalog:Migration:Enabled` is true. It creates a `Building` version per
region whose snapshot is readable and whose `FetchedAt` is within retention,
then:

- Titles keep their existing `Id`; `LastObservedAt = snapshot.FetchedAt`,
  `InGeneralPool = true`, `PoolPosition` = the title's array index,
  `Popularity = 0`, `Monetization = "unknown"` (the 005 snapshot never carried
  monetization), genre `Position` = array index, availability `Position` = array
  index. Every attribute in the snapshot is copied verbatim (FR-022).
- Availability `providerId` maps to a `CatalogServices` row; unknown ids are
  inserted as data, not dropped.
- A version is promoted only after every title and availability entry is
  written, in one transaction. The snapshot row is left untouched — it is the
  rollback path.
- **Idempotency/resume**: a rerun with the same `snapshot.FetchedAt` upserts
  into the same `Building` version (primary-key conflicts are no-ops) and
  promotes if still building. A rerun with a newer snapshot discards the stale
  `Building` version (never visible) and starts a new one. A version already
  `Active` or `Superseded` with the same source timestamp is skipped.
- **Refusal**: a missing or malformed payload, an invalid region, or a snapshot
  older than retention records a failed run and leaves that region and every
  user record untouched. A fresh refresh can rebuild it.
- The runner records a `CatalogRefreshRuns` row with `Kind = Migration`, so
  counts and failures are visible through the same status endpoint.

**Rationale.** The snapshot is the only existing source; reusing it is the only
migration that cannot renumber ids (FR-002) or lose availability (FR-005).
Running online means the snapshot path keeps serving while the normalized
version is built, which is the assumption behind the runtime switch. A hosted
runner avoids both a console project that App Service cannot easily run and a
data migration inside an EF migration that would be hard to make idempotent.

**Alternatives considered.**
- *Migrate inside the EF migration.* JSON parsing, provider mapping, and
  promotion do not belong in schema DDL, and a failure would block the deploy.
- *A separate console tool.* Works locally, but there is no reliable way to run
  it against App Service F1; the operator would need the production secret.
- *Re-fetch from TMDB instead of migrating.* Would change the catalog at
  cutover, make parity unmeasurable, and double provider cost for no benefit.

---

## D7. Runtime source switch and rollback behavior

**Decision.** `Catalog:Source` is `Snapshot` (default) or `Normalized`, read
per request through `IOptionsMonitor<CatalogOptions>`:

- `Snapshot` — the existing `CatalogUseCases.GetAsync` path. The legacy
  refresh (general pool only → snapshot) runs on staleness. Service, genre, and
  media-type filters are ignored (the spec's assumption permits it; the client's
  own filters keep the deck correct); `ids` is honored by filtering the
  snapshot's titles, which is a one-line improvement and keeps the watchlist
  small.
- `Normalized` — the new read path. When no active version exists, the response
  is `503 catalog-not-ready` and a refresh starts, exactly like a cold region
  today. When the active version is stale, it is served and a refresh starts.
  The refresh builds the mixed version and, on a successful general slice,
  writes the snapshot in the same transaction (FR-029). While rolled back, the
  normalized version is not refreshed (the legacy refresh writes only the
  snapshot); on switching back, its staleness is detected on the first read and
  a full refresh starts.
- Rollback is an app-setting change plus an app restart. On App Service that is
  well under five minutes and involves no deployment (SC-005).

**Rationale.** A configuration switch read per request, not an injected
singleton decision, is what makes a restartless-in-code rollback possible and
keeps the two paths testable in one process (the integration tests can build a
factory per mode). The asymmetry — rollback ignores filters but honors ids — is
the smallest behavior that keeps existing clients and the watchlist working
during a rollback without pretending the snapshot has per-service depth.

**Alternatives considered.**
- *Deploy the normalized path and remove the snapshot.* Violates FR-007 and
  removes the rollback path.
- *A query-string flag to choose the source.* Puts an operator decision on the
  visitor's URL and invites clients to select their own source; rejected.
- *Keep the normalized refresh running while rolled back.* Burns provider calls
  for a catalog nobody is reading, and the run's snapshot write would be the
  only visible effect. Request-triggered refresh handles the return.

---

## D8. Read path: pinned version, query shapes, cache, and payload cap

**Decision.** A normalized read is:

1. Resolve the active version: `(Id, FetchedAt, LatestObservedAt)` for the
   region. No active version, or `LatestObservedAt < cutoff` → not ready.
2. Query titles pinned to `VersionId`, with `EXISTS` predicates for genres and
   services and `LIMIT` where the pool is capped. No joins that multiply rows;
   genres and availability are loaded in two follow-up queries keyed by the
   returned title ids. Three queries, one pinned version.
3. Project into the existing `CatalogSnapshot` contract (region, fetchedAt,
   titles) so the API response shape does not change.

Query modes:

| Request | Predicate | Order | Cap |
|---|---|---|---|
| no optional params | `InGeneralPool` | `PoolPosition, TitleId` | none (general slice's own bound) |
| any of services/genres/mediaTypes | AND of supplied predicates over all active-version titles | `Popularity DESC, TitleId ASC` | `Catalog:MaxPoolTitles` (1000) |
| `ids` present | `TitleId IN (…)` plus any supplied filters; active version first, archive for misses | `PoolPosition` when in the general pool, else `Popularity DESC, TitleId` | `MaxIdsPerRequest` (1000), not the pool cap |

Targeted membership is `MediaType IN (…)` when supplied and `EXISTS
(CatalogTitleGenres WHERE GenreId IN (…))` / `EXISTS (CatalogAvailability WHERE
ServiceId IN (…))` when supplied. Service matching ignores monetization because
only streamable entries are ever written (`flatrate`, `free`, `ads`, or the
migration's `unknown`).

Indexes (details in [data-model.md](data-model.md)): `(VersionId, InGeneralPool,
PoolPosition)`, `(VersionId, MediaType, TitleId)`, `(VersionId, Popularity DESC,
TitleId)`, `(VersionId, GenreId, TitleId)`, `(VersionId, Region, ServiceId,
TitleId)`. The last two serve the `EXISTS` predicates.

**Payload cap.** Broad targeted requests (e.g. "any genre, any service, other
platforms on") can match the whole 10,000–20,000-title catalog. Returning it
would break the constitutional 300 ms first-card budget on a 4G connection and
would make the client rank thousands of titles it can never show. `MaxPoolTitles
= 1000` bounds the response to a set roughly the size of today's catalog; a
single service + genre is 300, two genres 600, three 900. The cap is applied
after dedupe, ordered by popularity (a stable, provider-derived proxy) and then
id for determinism. It is a research decision, not a spec requirement; the knob
exists so the number can be tuned after measuring SC-008.

**Cache.** `IMemoryCache` keyed by `(region, versionId, canonical filter set)`
with a 10-minute absolute expiration and a `CancellationChangeToken` per region
that is cancelled on promotion, so entries from a superseded version become
unreachable and are evicted immediately. This keeps the warm read in the
single-digit-millisecond range after the first visitor asks for a given shape.
The `ids` path is not cached: it is small and its shape is visitor-specific.

**Rationale.** Three queries with `EXISTS` avoid the row multiplication that a
join to genres and availability would cause (a title with 3 genres and 2
services would otherwise return 6 rows and need `DISTINCT`). Pinning the version
id gives consistency without a transaction. The cap is the only lever that
keeps a broad pool inside the mobile budget without changing ranking or
filtering.

**Alternatives considered.**
- *One joined query with `DISTINCT`.* PostgreSQL can do it, but the row count
  and sort are larger and the genre order needs an extra ordering key; three
  simple queries are easier to reason about and index.
- *No cap, rely on compression.* 10–20k titles is 5–15 MB of JSON before
  compression; no mobile budget survives that.
- *Server-side pagination.* The client must rank the whole candidate set to
  choose the first card, so pagination would change the product, not just the
  transport.
- *No read cache.* Every deck load pays the query and projection cost; the
  version-keyed cache is a few lines and is invalidated for free by promotion.

---

## D9. Catalog API: optional filters and id resolution

**Decision.** Keep `GET /api/catalog` and its response shape. Add optional,
comma-separated query parameters:

- `services` — service ids (`netflix`, `prime-video`, …, or `tmdb:{id}` for a
  non-quiz service)
- `genres` — genre slugs (`action`, `horror`, …)
- `mediaTypes` — `movie`, `tv`, `anime` (plural because the quiz's choice is
  multi-select)
- `ids` — title ids in the `tmdb:{movie|tv}:{id}` form

Rules:

- No optional parameters → today's general pool, uncapped, same shape.
- Any filter → AND of the supplied filters over the active version's titles.
  An empty result is `200` with `titles: []` — a service + genre with no titles
  is a normal answer (edge case), not an error.
- `ids` → active version first, then the retired-title archive; ids not found
  anywhere are omitted. The response shape is unchanged; archived titles have
  `availability: []`.
- Validation is **syntactic** for services and genres (`^[a-z0-9][a-z0-9-]{0,63}$`
  or `^tmdb:\d{1,10}$`) and exact for media types and title ids. Unknown but
  well-formed service/genre is not an error — the vocabulary is data (FR-021),
  and a new service must not require a code change. Bad values return the
  existing `ErrorResponse` with `400`.
- `ids` is limited to `Catalog:MaxIdsPerRequest` (1000, ~21 KB of query
  string); Kestrel's request-line limit is raised to 32 KB to fit it. Over the
  limit → `400 too-many-ids`.
- During a rollback (`Catalog:Source=Snapshot`), `services`/`genres`/`mediaTypes`
  are ignored and `ids` filters the snapshot.
- Every response keeps `Cache-Control` behavior unchanged (the client caches in
  memory; no new HTTP caching contract).

**Rationale.** FR-004 and FR-027 require the existing request to stay
backward-compatible and the deck to be able to narrow the pool without moving
ranking or filtering to the server. A single endpoint with additive optional
parameters is the smallest change that satisfies both, and it lets the same
client code consume either source. Data-driven validation is required by FR-021;
the spec's own edge case says new services are data. The id cap is a practical
bound: a visitor with more than 1,000 rated titles is far beyond the product's
use, and the client can chunk if that ever changes.

**Alternatives considered.**
- *Separate `/api/catalog/pool` and `/api/catalog/titles` endpoints.* Cleaner
  URLs, but two response types and two cache keys for one document shape;
  rejected as unnecessary surface.
- *POST for ids.* Avoids URL length, but breaks the existing GET contract and
  needs a body/caching story for what is still a read.
- *Validate services/genres against the database.* Rejects data the refresh is
  about to add and couples validation to a round trip. Syntax is enough; an
  unknown value yields an empty pool, which is honest.

---

## D10. Refresh scheduling and operational surface

**Decision.** Two triggers, one implementation:

1. **Scheduled GitHub Actions workflow** (`.github/workflows/catalog-refresh.yml`),
   daily and `workflow_dispatch`, calls
   `POST /api/catalog/refresh?region=BR` with `X-PlayNext-Admin-Token`, then
   polls `GET /api/catalog/refresh/status?region=BR` every 30 seconds until the
   run is terminal or a 75-minute job timeout. The base URL is derived from the
   existing `AZURE_WEBAPP_PUBLISH_PROFILE` secret with the same parsing the
   deploy workflow's smoke test already uses; the token is a new
   `CATALOG_ADMIN_TOKEN` GitHub secret and an Azure app setting. Polling is also
   what keeps the F1 instance awake while the in-process refresh runs.
2. **Request-triggered staleness** remains the fallback. A read of a stale
   version starts a refresh, so a missed schedule self-heals on the first
   visitor (and the first visitor gets the stale data while it runs, as today).

The admin endpoints are gated by `Catalog:AdminToken`. An unset token disables
them (`404`, as if the route did not exist); a wrong token returns `401
admin-unauthorized`. Comparison uses `CryptographicOperations.FixedTimeEquals`.
The token never reaches the client or the logs.

The refresh runs in-process via the existing `Task.Run` single-flight pattern,
with a soft timeout (`Catalog:RefreshTimeoutMinutes` = 55) that stops scheduling
new provider calls and lets the run finish as `Failed` rather than blocking a
later run. Stale `Building` versions are cleaned up at startup and at the start
of each refresh.

**Rationale.** App Service F1 scales to zero and has no always-on facility, so
an in-process timer is not a schedule; a GitHub Actions cron is free, already
part of the project's operations, and can keep the app warm by polling. FR-018
becomes verifiable through the status endpoint. Keeping the request-triggered
path preserves the current self-healing property and means the scheduled
workflow is an optimization, not a new single point of failure.

**Alternatives considered.**
- *Azure WebJob / Timer trigger.* F1 has no always-on; a WebJob is tied to the
  same instance lifecycle. Rejected.
- *In-process `PeriodicTimer` alone.* Dies with scale-to-zero and is untestable
  against the real deployment. Rejected.
- *A separate container/Function.* A new billable resource for one daily job;
  contradicts the low-cost footprint standard.
- *A public refresh endpoint.* Anyone could burn the provider quota. Rejected.

---

## D11. Frontend: targeted requests, supplementary ids, unchanged ranking

**Decision.** `CatalogSource.load` takes a query object `{ region, services?,
genres?, mediaTypes?, ids? }`. `httpCatalogSource` serializes non-empty arrays
as comma-separated params and omits everything else. `CatalogService` keeps one
primary method and one supplementary method:

- `loadTitles(query)` — **primary**, total by contract, sets
  `usingCachedTitles` on failure. On success it caches by the canonical query
  key (services/genres/mediaTypes sorted) and merges titles into the pool
  caches. On failure it returns the same-key cache, then the cached general
  pool, then `[]`.
- `loadTitlesById(region, ids)` — **supplementary**, also total, but does not
  touch `usingCachedTitles`. It is used only by the deck to bring rated titles
  back into the ranking for `historyAffinity`. On failure it filters the cached
  pools down to the requested ids.

Screen requests:

| Screen | Request |
|---|---|
| Deck | pool query from the quiz (services omitted when `provider.any` **or** `includeUnownedProviders`; genres omitted when `genre.any`; media types omitted when `mediaType.any`) + `loadTitlesById` for the rated ids, merged with pool-wins |
| Watchlist | `{ region, ids: keys(interactions) }` |
| History | `{ region, ids: unique(history.titleId) }` |
| Watchlist detail | `{ region, ids: [titleId] }` |
| Match Found | `{ region, ids: [titleId] }` |

The deck merges the pool and the rated titles **before** calling `rankTitles`.
No ranking, filter, or quiz code changes: the rated titles are dropped by
filter 4 (already rated) after contributing to `genreSignals`, which is exactly
the current behavior over the whole catalog. The merge is what makes FR-008's
parity argument hold for the deck: the candidate set the ranker sees is a
superset of the old one restricted to the quiz filters, plus the rated titles it
needs for affinity.

No screen changes shape. A failed ids request degrades the watchlist to its
existing null-title rows; a failed pool request uses the existing cached/empty
notices.

**Rationale.** The server narrowing matches the client's hard filters exactly,
so the deck's ranked result is unchanged while the payload shrinks from the
whole catalog to the selected slice. Sending the rated ids separately is the
one part that cannot be folded into the pool query (the server ANDs filters, so
ids would narrow rather than add), and it is essential for history affinity.
Two service methods with explicit different fallback semantics avoid a race
where a failed supplementary request would raise the "cached titles" notice
while the deck is showing fresh data.

**Alternatives considered.**
- *Server-side ranking.* Explicitly out of scope (FR-025).
- *Load the whole catalog and filter client-side as today.* Throws away the
  depth work's payload benefit and keeps the 10–20k-title response on the
  critical path.
- *Have the deck skip rated-title affinity.* Changes recommendations, which
  FR-025 forbids.
- *Cache every response under one key.* A failed targeted request would fall
  back to an unrelated pool; keyed caches keep the fallback honest.

---

## D12. Test strategy and the parity harness

**Decision.** The feature is delivered test-first on the constitution's critical
paths:

- **Domain unit tests** — slice planning and ordering, pool-query normalization
  and validation, retention cutoff/expiry, media classification (unchanged).
- **Application tests** — refresh phases with fakes: all-fresh promotion,
  mixed promotion, first-refresh all-or-nothing, 429 abort, retry exhaustion,
  per-title enrichment carry, snapshot written only when the general slice
  succeeds, retention purge and archive, migration idempotency/resume/refusal.
- **API integration tests** — the existing `CatalogApiFactory` extended with a
  stub that honors `with_watch_providers`, `watch_region`,
  `with_monetization_types`, `with_original_language`, provider names, and
  region links; a generated deep catalog (350 synthetic Netflix+horror titles)
  for the depth tests; contract tests for filters, ids, errors, rollback,
  admin auth, and the unchanged no-filter shape.
- **Frontend tests** — `CatalogSource` parameter serialization, `CatalogService`
  fallback keying and supplementary isolation, deck request building and merge,
  each screen's ids request, and the existing ranking suite unchanged.
- **Parity harness** — a Vitest harness that takes two captured catalog
  responses (snapshot path and normalized path for the same migrated version)
  and runs `rankTitles` over a 100+ combination matrix spanning media types,
  genres, and service selections, asserting identical eligible ids and order
  (`SC-001`). The integration test first asserts the two responses are
  field-identical for the fixed version; the harness proves the client's ranked
  output is identical for the matrix. The matrix is generated deterministically
  from the 3 media types × 9 genres × 11 services plus all-any combinations, so
  a reviewer can reproduce it.
- **Gated live tests** — provider depth for Netflix+horror and Max+horror
  (SC-002), provider alias ids, and a full refresh timing measurement
  (SC-010). These are skipped without a real key, as the existing gated tests
  are.

**Rationale.** SC-001 through SC-014 are mostly measurable outcomes, not
implementation details; each maps to a test or a quickstart scenario. The
parity harness is the only way to test the client ranking before/after without
duplicating the ranking in C#. Extending the stub rather than mocking
`ICatalogProvider` for API tests keeps the HTTP path (pacing, query building,
parsing) under test.

**Alternatives considered.**
- *Reimplement `rankTitles` in C# for a backend parity test.* Two implementations
  of the ranking is exactly the drift the constitution's determinism principle
  forbids.
- *Only field-diff the two responses.* Necessary but not sufficient for SC-001's
  "same order"; the harness closes that gap.
- *Run live TMDB in CI.* Slow, flaky, and spends the shared rate limit; gated
  tests are the established pattern.

---

## D13. Scale, cost, dependencies, and risks

**Decision.** No new runtime dependency, no new Azure resource. The only new
operational artifacts are the normalized tables, one EF migration, the hosted
migration runner, two admin endpoints, and one scheduled workflow.

Measured/estimated envelope:

| Quantity | Estimate |
|---|---|
| Unique titles per version | 10,000–20,000 |
| Version storage + indexes | ~20–40 MB |
| Versions kept | active + previous (≤1 day) |
| Discovery calls (worst case) | ~6,300 (11 services × 38 streams × ≤15 pages) + ~60 general |
| Enrichment calls | one per unique title, ~10,000–20,000 |
| Total at 30 rps | ~9–15 minutes; budget 60 |
| Read pool | ≤1,000 titles, ~60–250 KB compressed |

Risks and mitigations:

- **TMDB page-depth limits** — TMDB caps `page` at 500 and may return fewer
  results late in a catalog. The target stops at the provider's depth and never
  pads (FR-023); `MaxDiscoverPages` is a safety cap, and a stream that hits the
  last page is a success, not a failure.
- **Provider alias drift** — aliases are seeded data and covered by the gated
  provider-id test; enrichment canonicalizes whichever id appears.
- **F1 process recycling** — a refresh can die mid-build. The stale `Building`
  cleanup plus upsert-on-rerun makes the next run complete without duplicates.
- **Neon storage** — two versions and a day of grace stay far below the free
  tier; the one-day superseded grace is the main lever if a version grows
  unexpectedly.
- **429 with a long `Retry-After`** — retries are capped, the run aborts before
  the 60-minute budget, and the active version stays whole.
- **Payload cap vs. depth** — a very broad request is capped at 1,000 titles;
  the deck's filters are the way to go deeper. The value is configurable and
  will be measured against SC-008 rather than assumed.

No open questions remain. Every `NEEDS CLARIFICATION` in the technical context
is resolved by D1–D13.
