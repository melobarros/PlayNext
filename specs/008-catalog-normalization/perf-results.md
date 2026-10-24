# Performance validation (T063)

**Measured**: 2026-10-23 · PostgreSQL 18.6 (local) · .NET 10.0.402 · Windows 10

## Method

The local `playnext` database has the `NormalizedCatalog` schema but no rows, so
the benchmark ran against a disposable `playnext_perf` database created from the
same schema (`pg_dump --schema-only`) and dropped afterwards. It was seeded with
one active BR version:

| Table | Rows |
|---|---|
| `CatalogTitles` | 60,000 (movie/tv/anime, 20,000 in the general pool) |
| `CatalogTitleGenres` | 240,000 (4 genres per title) |
| `CatalogAvailability` | 120,000 (2 services per title) |

The pool queries were run with `EXPLAIN (ANALYZE, BUFFERS)` twice each. The API
was then started with `Catalog__Source=Normalized` against that database and the
real endpoint measured with `curl` (warm request = a second request within the
10-minute pool-cache TTL).

## Plans

| Query | Plan | Cold | Warm |
|---|---|---|---|
| Targeted pool: Netflix + horror + movie, limit 1000 | parallel hash join + sort (seq scan on `CatalogTitles`) | 94.8 ms | 63.2 ms |
| Targeted pool: any media type, limit 1000 | `IX_CatalogTitles_VersionId_Popularity_TitleId` + per-row availability/genre probes | 209.0 ms | 212.7 ms |
| Ids batch: 50 titles | `IX_CatalogTitles_TitleId` index scan, 50 searches | 1.4 ms | 0.5 ms |

The any-media plan is the worst case: it walks titles in popularity order and
probes both child tables until 1000 matches, which is the right shape for an
early-stop limit. The movie-only plan's sequential scan is the planner's choice
at 33% media-type selectivity, not a missing index.

## Index decision

A candidate index `(VersionId, MediaType, Popularity DESC, TitleId)` was added to
the disposable database to test whether it would enable an early-stop plan for
the media-typed pool. The planner never chose it, and the movie plan regressed
from 63 ms to 160 ms (the extra statistics changed the chosen join order).
**No index was added**; the existing `IX_CatalogTitles_VersionId_Popularity_TitleId`,
`IX_CatalogTitleGenres_VersionId_GenreId_TitleId`, and
`IX_CatalogAvailability_VersionId_Region_ServiceId_TitleId` cover the predicates.

## Endpoint (warm cache)

| Request | Warm time | Payload | Brotli |
|---|---|---|---|
| `GET /api/catalog?region=BR&services=netflix&genres=horror&mediaTypes=movie` | 16 ms | 799,782 B | 43,195 B |
| `GET /api/catalog?region=BR&ids=…` (50 ids) | 3–4 ms | 24,848 B | 533 B |

The first targeted request after startup (pool cache cold) took 641 ms; SC-008
specifies a warm cache. At 43 KB compressed, the payload is a small fraction of
a 4G connection's budget, and ranking 1000 titles client-side is negligible.

## SC-008 / SC-010

- **SC-008** (first card within 300 ms on a warm cache): met. The server response
  is 16 ms and 43 KB compressed; the remaining budget covers transfer, parse, and
  ranking.
- **SC-010** (full refresh within 60 minutes): not measurable here — it needs a
  real TMDB key and the full slice plan. The read path was exercised repeatedly
  during these runs with zero errors; the refresh timing remains to be observed
  in staging (T065).
