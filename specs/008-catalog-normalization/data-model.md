# Data Model: Normalized Catalog & Per-Service Pools

**Feature**: 008-catalog-normalization | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

**Storage**: PostgreSQL 17 via EF Core 10 / Npgsql. All timestamps are
`timestamptz` in UTC. Ids are text with explicit maximum lengths. The schema
below is created by **one** EF migration; vocabulary rows are seeded by an
idempotent startup upsert, not by `HasData`, because services and genres are
data (FR-021) and adding one must not require a schema change.

The central rule: **catalog rows belong to a version, and a version becomes
visible only by promotion.** Readers pin the active version id once and use it
for every query, so they never mix two versions.

---

## Entity overview

```text
CatalogGenres 1──* CatalogTitleGenres *──1 CatalogTitles *──1 CatalogVersions
CatalogServices 1──* CatalogAvailability *──1 CatalogTitles       │
       │ 1                                                          │
       *                                                          │
CatalogServiceProviders                                          │
                                                                  │
CatalogTitleIdentities 1──* CatalogTitles (FK TitleId)            │
        │ 1──* CatalogRetiredTitles                                │
        │ 1──* Interactions.TitleId      (FK, existing table)      │
        │ 1──* WatchHistory.TitleId      (FK, existing table)      │

CatalogRefreshRuns *──1 CatalogVersions (VersionId, nullable)
CatalogSnapshots (Region PK) — rollback document, written on general success
```

---

## 1. `CatalogGenres`

The controlled genre vocabulary, shared by the quiz, stored preferences, and
the catalog. The nine selectable genres keep the 001 ids and order; the tag
genres (crime, family, fantasy, …) are stored so a title can carry them without
being selectable.

| Column | Type | Notes |
|---|---|---|
| `Id` | `varchar(64)` PK | `action`, `comedy`, …, or a tag slug such as `crime` |
| `DisplayName` | `varchar(128)` | English display name |
| `TmdbId` | `int NULL` | Unique when present; null for a genre the provider does not have |
| `IsSelectable` | `boolean` | True for the nine quiz genres |
| `Position` | `int` | Quiz order for selectable genres; tag order otherwise |

`Id` is the wire value in `genres[]`. Unknown provider genre ids are dropped at
the mapping boundary, exactly as today, so no row can be invented from a
response.

## 2. `CatalogServices`

A streaming service that can carry a title in a region. Quiz services carry
their 001 ids; every other service gets a stable id derived from the provider
(`tmdb:{provider_id}`) so an unknown service is stored as data rather than
dropped.

| Column | Type | Notes |
|---|---|---|
| `Id` | `varchar(64)` PK | `netflix`, `prime-video`, …, or `tmdb:300` |
| `DisplayName` | `varchar(128)` | From the vocabulary, or `provider_name` for an unknown service |
| `SearchTemplate` | `text NULL` | The 005 deep-link template; null when there is no template |
| `IsQuizService` | `boolean` | True for the 11 offered services; drives slice planning |
| `Position` | `int` | Display/iteration order |

## 3. `CatalogServiceProviders`

The provider-id mapping that makes aliases and unknown ids explicit.

| Column | Type | Notes |
|---|---|---|
| `TmdbProviderId` | `int` PK | e.g. 8, 1796, 119, 2100 |
| `ServiceId` | `varchar(64)` FK → `CatalogServices` | Canonical service |

Index: `(ServiceId)`. Seeded with every provider id in `CatalogVocabulary`,
including aliases (Netflix 8 + 1796; Prime 119 + 2100) and the non-quiz services
already known (Pluto, Tubi, YouTube, Freevee). A refresh upserts new ids.

## 4. `CatalogVersions`

One complete view of a region's catalog. Rows below reference it by id.

| Column | Type | Notes |
|---|---|---|
| `Id` | `uuid` PK | Generated at build start |
| `Region` | `varchar(2)` | ISO 3166-1 alpha-2; not a filter over a fixed list (FR-020) |
| `State` | `varchar(16)` | `Building`, `Active`, `Superseded` |
| `Source` | `varchar(16)` | `Refresh` or `Migration` |
| `CreatedAt` | `timestamptz` | Build start |
| `CompletedAt` | `timestamptz NULL` | Promotion time |
| `FetchedAt` | `timestamptz` | Served as the response's `fetchedAt`: the snapshot's time for a migration, the run completion time for a refresh |
| `LatestObservedAt` | `timestamptz NULL` | Maximum `LastObservedAt` across the version's rows; recomputed after purge |

Indexes:

- Unique `(Region) WHERE State = 'Active'` — at most one active version.
- Unique `(Region) WHERE State = 'Building'` — at most one build at a time.
- `(Region, State)`.

## 5. `CatalogTitles`

One title in one version. Every attribute the card and detail view render is a
column except the two ordered child collections, which are in their own tables
so their order is explicit and queryable.

| Column | Type | Notes |
|---|---|---|
| `VersionId` | `uuid` PK part, FK → `CatalogVersions` (cascade) | |
| `TitleId` | `varchar(64)` PK part, FK → `CatalogTitleIdentities` | `tmdb:{movie|tv}:{id}`, unchanged from 005 (FR-002) |
| `Name` | `varchar(512)` | |
| `ReleaseYear` | `int` | |
| `MediaType` | `varchar(8)` | `movie`, `tv`, `anime` (existing classification) |
| `Synopsis` | `text` | |
| `Rating` | `double precision` | |
| `VoteCount` | `int` | |
| `RuntimeMinutes` | `int NULL` | Absent for series |
| `TrailerUrl` | `text NULL` | |
| `PosterUrl` | `text NULL` | |
| `Popularity` | `double precision` | Discovery popularity; 0 for migrated titles |
| `InGeneralPool` | `boolean` | True when the general slice produced or carried it |
| `PoolPosition` | `int` | Position within the general pool; discovery order otherwise |
| `LastObservedAt` | `timestamptz` | When this title was last seen; retained across carries |

Indexes:

- PK `(VersionId, TitleId)` — the id lookup and the title identity within a
  version.
- `(VersionId, InGeneralPool, PoolPosition)` — the no-filter general pool, in
  its stable order.
- `(VersionId, MediaType, TitleId)` — media-type-targeted pools.
- `(VersionId, Popularity DESC, TitleId)` — the capped targeted pool's ordering.
- `(VersionId, LastObservedAt)` — the retention purge and the read gate.

## 6. `CatalogTitleGenres`

A title's genres, in wire order. Quiz genres first, then tags, matching 005's
`MapGenres` rule; `Position` preserves it.

| Column | Type | Notes |
|---|---|---|
| `VersionId` | `uuid` PK part | |
| `TitleId` | `varchar(64)` PK part | |
| `GenreId` | `varchar(64)` PK part, FK → `CatalogGenres` | |
| `Position` | `int` | Zero-based wire order |

Composite FK `(VersionId, TitleId)` → `CatalogTitles` with cascade delete.
Indexes: PK `(VersionId, TitleId, GenreId)`; unique
`(VersionId, TitleId, Position)`; `(VersionId, GenreId, TitleId)` for the
`EXISTS` genre predicate.

## 7. `CatalogAvailability`

One streamable service carrying one title in one region. Empty is normal.

| Column | Type | Notes |
|---|---|---|
| `VersionId` | `uuid` PK part | |
| `TitleId` | `varchar(64)` PK part | |
| `ServiceId` | `varchar(64)` PK part, FK → `CatalogServices` | Canonical service, aliases resolved |
| `Region` | `varchar(2)` PK part | Explicit, even though the version is region-scoped (FR-012) |
| `Monetization` | `varchar(16)` | `flatrate`, `free`, `ads`, or `unknown` for migrated rows |
| `DeepLinkUrl` | `text` | Final URL; the client never builds one |
| `Position` | `int` | Badge order within the title |
| `LastObservedAt` | `timestamptz` | When this entry was last observed |

Composite FK `(VersionId, TitleId)` → `CatalogTitles` with cascade delete.
Indexes: PK `(VersionId, TitleId, ServiceId, Region)`; unique
`(VersionId, TitleId, Position)`; `(VersionId, Region, ServiceId, TitleId)` for
the service `EXISTS` predicate; `(VersionId, LastObservedAt)` for purge.

The PK means one entry per service per title per region. When TMDB reports the
same service under two monetizations, the stronger bucket wins in the order
`flatrate` → `free` → `ads`, exactly as today's badge dedupe does.

## 8. `CatalogRefreshRuns`

One execution of a refresh or a migration. This is the operational record FR-018
requires; it never contains titles, payloads, or credentials.

| Column | Type | Notes |
|---|---|---|
| `Id` | `uuid` PK | |
| `Kind` | `varchar(16)` | `Refresh` or `Migration` |
| `Mode` | `varchar(16) NULL` | For a refresh: `Configured`, `Normalized`, `Snapshot`; null for a migration |
| `Region` | `varchar(2)` | |
| `Status` | `varchar(24)` | `Running`, `Succeeded`, `PartiallyFailed`, `Failed`, `Abandoned` |
| `StartedAt` | `timestamptz` | |
| `CompletedAt` | `timestamptz NULL` | |
| `VersionId` | `uuid NULL` FK → `CatalogVersions` | The version promoted by this run |
| `CountsJson` | `jsonb` | Per-slice counts: discovered, fresh, carried, skipped, enriched, availability entries |
| `FailuresJson` | `jsonb` | Per-slice failure reason, sanitized of URLs' credentials and payloads |
| `Error` | `text NULL` | Run-level failure summary |

Index: `(Region, StartedAt DESC)`; `(Status)` for stale-run cleanup.

## 9. `CatalogTitleIdentities`

The durable title-id anchor and the target of the new foreign keys. It holds no
provider metadata, so it is not governed by the catalog retention limit.

| Column | Type | Notes |
|---|---|---|
| `TitleId` | `varchar(64)` PK | The 005 identity, unchanged |
| `FirstSeenAt` | `timestamptz` | First catalog or user-record observation |

Existing `Interactions.TitleId` and `WatchHistory.TitleId` gain
`REFERENCES CatalogTitleIdentities(TitleId) ON DELETE RESTRICT`, plus a
secondary index on `TitleId` in each table. The EF migration backfills
identities from both user tables **before** adding the constraints. The account
merge path upserts the ids in the merged document inside its transaction
(`INSERT … ON CONFLICT DO NOTHING`), so a rating for an id the catalog has never
seen still saves — the tolerant behavior 005 guarantees is preserved.

## 10. `CatalogRetiredTitles`

The readable copy of a title that has left the catalog but is still referenced
by a visitor. It is never returned in a pool, only by an `ids` lookup.

| Column | Type | Notes |
|---|---|---|
| `TitleId` | `varchar(64)` PK, FK → `CatalogTitleIdentities` | |
| `PayloadJson` | `jsonb` | The wire title with its genres and **`availability: []`** |
| `LastObservedAt` | `timestamptz` | The last catalog observation this copy came from |
| `RetiredAt` | `timestamptz` | When the copy was taken |

No availability is archived: provider carriage data past the retention limit is
exactly what must not be kept. The row is deleted when no interaction or history
entry references its id any more.

## 11. `CatalogSnapshots` (existing, unchanged)

`Region` PK, `FetchedAt`, `PayloadJson jsonb`. It remains the rollback document.
While the normalized source is active, **every successful general-slice refresh
writes it in the promotion transaction** (FR-029) from the freshly observed
general pool, with `FetchedAt` = the refresh's observation time. It is never
written from an independent provider fetch. While the snapshot source is active,
the legacy refresh keeps it current as it does today.

## 12. Existing user tables (unchanged shape, new constraint)

| Table | Change |
|---|---|
| `Interactions` | FK `TitleId` → `CatalogTitleIdentities`; index `TitleId`. No column change. |
| `WatchHistory` | FK `TitleId` → `CatalogTitleIdentities`; index `TitleId`. No column change. |
| `Preferences` | None — preferences name genres and services, not titles. |

No user row is rewritten, renumbered, or deleted by this feature (FR-006).

---

## State transitions

### Catalog version

```text
            build starts                 promotion transaction
   (none) ─────────────▶ Building ─────────────────────────▶ Active
                              │                                  │
                              │ superseded by a newer build      │ next promotion
                              │ (stale, abandoned)               ▼
                              └──────────────▶ Superseded ──(1 day)──▶ deleted
```

- `Building → Active` happens only when every slice is fresh or carried, and
  always in the same transaction as the previous `Active → Superseded`.
- A `Building` version older than two hours is deleted at startup and at the
  start of each refresh; it was never visible.
- A `Superseded` version is deleted after one day, after archiving any
  referenced title that is not in the active version.

### Refresh run

```text
Running ──▶ Succeeded
   │   ├──▶ PartiallyFailed   (mixed version promoted; at least one slice carried)
   │   ├──▶ Failed            (no promotion; active version unchanged)
   │   └──▶ Abandoned         (process died; stale run cleanup)
```

`Abandoned` is set by the stale-run cleanup when a `Running` row is older than
the refresh timeout and no process owns it.

---

## Query semantics

The read path resolves the active version once, then runs three queries pinned
to its id (titles, genres, availability). Genres and availability are loaded by
the returned title ids, not joined, so no row multiplication or `DISTINCT` is
needed.

| Mode | Title predicate | Order | Limit |
|---|---|---|---|
| General (no filters) | `InGeneralPool = true` | `PoolPosition, TitleId` | none beyond the general slice |
| Targeted | `MediaType IN (…)` if supplied; `EXISTS` genre if supplied; `EXISTS` service if supplied; all ANDed | `Popularity DESC, TitleId ASC` | `Catalog:MaxPoolTitles` (default 1000) |
| Ids | `TitleId IN (…)`, plus any supplied filters; archive for misses | `PoolPosition` (general) else `Popularity DESC, TitleId` | `MaxIdsPerRequest` (default 1000) |

Genre and service filters are **OR within a dimension, AND across dimensions**
— the same semantics as the client's filters, so the server's narrowing is a
subset of what the client would keep.

Every read also applies `LastObservedAt >= now − retention`. A version whose
`LatestObservedAt` is older than the cutoff is treated as absent: the API
returns `503 catalog-not-ready` and starts a refresh.

---

## Migration mapping (snapshot → normalized rows)

| Snapshot field | Destination |
|---|---|
| `region` | `CatalogVersions.Region` |
| `fetchedAt` | `CatalogVersions.FetchedAt`, and every row's `LastObservedAt` |
| `titles[i].id` | `CatalogTitles.TitleId` (verbatim; no renumbering) |
| `titles[i].title` | `Name` |
| `titles[i].releaseYear` | `ReleaseYear` |
| `titles[i].mediaType` | `MediaType` |
| `titles[i].genres[j]` | `CatalogTitleGenres.GenreId`, `Position = j` |
| `titles[i].synopsis` | `Synopsis` |
| `titles[i].rating` | `Rating` |
| `titles[i].voteCount` | `VoteCount` |
| `titles[i].runtimeMinutes` | `RuntimeMinutes` |
| `titles[i].trailerUrl` | `TrailerUrl` |
| `titles[i].posterUrl` | `PosterUrl` |
| `titles[i].availability[k].providerId` | `CatalogAvailability.ServiceId` via `CatalogServiceProviders`/`CatalogServices` (upsert if unknown) |
| `titles[i].availability[k].deepLinkUrl` | `DeepLinkUrl` |
| (not in the snapshot) | `Monetization = "unknown"`, `Position = k`, `InGeneralPool = true`, `PoolPosition = i`, `Popularity = 0` |

Rows are written in the snapshot's array order, so the migrated version's
general-pool order and badge order are identical to the snapshot's.

## Refresh composition invariants

- One row per `TitleId` per version; a title discovered by several services or
  genres is merged once (FR-011).
- Fresh data wins over carried data for the same title and the same
  `(ServiceId, Region)` availability key.
- A carried slice contributes only titles that existed in the previous version
  and match that slice's prior contribution (a service's availability entries,
  or `InGeneralPool` for the general slice).
- A title that a successful slice no longer rediscovers is dropped; a failed
  slice never drops anything.
- `LastObservedAt` is per row, never copy-forwarded silently: a carried row
  keeps its original timestamp, which is what makes retention measurable from
  the data (FR-019).
- `PoolPosition` comes from the general slice; a service-only title's position
  is its discovery order in the first successful slice that saw it and is used
  only as a deterministic order for id lookups.
- `LatestObservedAt` on the version is recomputed after any purge and is the
  retention gate for reads.

## Retention lifecycle

```text
observed now ──▶ in active version, InGeneralPool or service pool
      │
      ├─ 180 days without a fresh observation while a slice keeps carrying it
      │        → row skipped from the next version (and deleted from the active one)
      │        → if referenced by a user record: copied to CatalogRetiredTitles
      │        → availability is not copied
      │
      └─ user record removed later → archive row becomes unreferenced
               → deleted by the next purge
```

## Size estimate

| Table | Rows per version | Approx. size |
|---|---|---|
| `CatalogTitles` | 10,000–20,000 | 8–16 MB |
| `CatalogTitleGenres` | 25,000–50,000 | 2–4 MB |
| `CatalogAvailability` | 15,000–30,000 | 6–12 MB |
| Indexes | — | roughly equal to the above |
| `CatalogRetiredTitles` | only referenced retired titles | < 1 MB |

Two live versions per region stay under ~100 MB including indexes, within the
Neon free tier the project already runs on. No partitioning is needed at this
size.
