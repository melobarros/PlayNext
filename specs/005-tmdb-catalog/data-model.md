# Data Model: Real Catalog (TMDB)

**Feature**: 005 | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

The catalog is a **read model of the provider's data** — PlayNext owns none of
these facts, it caches and translates them. The only persisted entity is the
snapshot; everything else is derived at refresh time by pure rules.

## Entities

### CatalogTitle (derived — the wire shape, unchanged from 002)

The deck and watchlist already consume exactly this shape
(`frontend/src/app/core/models/media-title.ts`); the server produces it.

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | `tmdb:{movie\|tv}:{providerId}` — the **underlying** type, never the anime-classified one (identity is stable; TMDB ids collide only across types — spec Key Entities). Stable, unique, non-empty |
| `title` | string | Non-empty display name, English (clarified) |
| `releaseYear` | number | 4-digit year; derived from `release_date` (movies) / `first_air_date` (TV); a title with no date → the current year is NOT invented — see FR-017 fallback below |
| `mediaType` | `movie \| tv \| anime` | `anime` iff genre 16 ∈ genres AND `original_language == "ja"` (FR-016); otherwise the underlying type |
| `genres` | string[] | Mapped to the nine quiz ids where a mapping exists (D6); unmapped TMDB genres kept as extra tags. May be empty |
| `synopsis` | string | TMDB `overview`, trimmed client-side-safe; may be empty (FR-017) |
| `rating` | number | `vote_average`, 0–10, one decimal |
| `voteCount` | number | `vote_count`, ≥ 0 |
| `runtimeMinutes` | number \| absent | Movies: `runtime`; TV: absent (episode lengths are not a title runtime) — the card degrades (FR-017) |
| `trailerUrl` | string \| absent | First YouTube `videos` result of type Trailer, `https://www.youtube.com/watch?v={key}`; absent is normal (FR-017, 002 FR-008) |
| `posterUrl` | string \| absent | `https://image.tmdb.org/t/p/w500{poster_path}`; absent → the existing CSS placeholder (FR-017, 002 FR-016) |
| `availability` | StreamingAvailability[] | May be empty — normal, not an error |

**Identity**: `id` alone. Name + year is not identity (remakes, same-named
series — spec edge case).

### StreamingAvailability (derived)

One service carrying one title in the visitor's region.

| Field | Type | Rules |
|-------|------|-------|
| `providerId` | string | A 001 id for the twelve quiz providers (D7 mapping); `tmdb:{provider_id}` for anything else (FR-010, clarified). Never dropped, never merged |
| `deepLinkUrl` | string | Final URL from the provider's search template with the URL-encoded title (FR-007, D8). Absolute, official — PlayNext hosts nothing |

**Selection rule** (D5): included only when TMDB reports the provider for the
region under monetization types **flatrate, free, or ads**. Rent/buy are
excluded. **Template-coverage rule** (D7): a provider without a search
template is excluded from availability and logged — a badge that cannot keep
the one-tap promise must not render.

### CatalogSnapshot (persisted — the only stored entity)

The server's retained copy of what was last retrieved for a region (spec Key
Entities). A cache of the provider, never a second source of truth.

| Field | Type | Rules |
|-------|------|-------|
| `Region` | string, PK | ISO 3166-1 alpha-2, uppercase |
| `FetchedAt` | DateTimeOffset | When the batch that produced this snapshot succeeded |
| `PayloadJson` | string (jsonb) | The whole snapshot as served: `{ region, fetchedAt, titles[] }` |

**Storage**: Postgres table `CatalogSnapshots` (EF Core migration — the
constitution's schema rule), mirrored in `IMemoryCache` as L1. L1 miss loads
L2 lazily.

**State transitions** (the invariant set FR-012/013 and FR-004 make):

```text
None ──(first successful batch)──▶ Fresh (age ≤ 24 h)
Fresh ──(age passes bound)───────▶ Stale
Stale ──(batch succeeds)─────────▶ Fresh        (payload swapped atomically)
Stale ──(batch fails)────────────▶ Stale        (unchanged — FR-013)
None  ──(batch fails)────────────▶ None         (nothing to serve — FR-014)
Fresh ──(batch fails)────────────▶ Fresh        (a refresh attempt never ages the good data)
```

A failed batch writes **nothing** — not the L1 entry, not the L2 row. The
swap is all-or-nothing.

### Vocabulary mappings (static configuration, not stored data)

| Mapping | Shape | Seed |
|---------|-------|------|
| Genre | TMDB genre id → 001 genre id | action=28, comedy=35, drama=18, horror=27, romance=10749, sci-fi=878, thriller=53, animation=16, documentary=99 |
| Provider | TMDB provider id → { `vocabId`, `displayName`, `searchTemplate` } | netflix=8, prime-video=119, disney-plus=337, max=384 (alias 1899), apple-tv-plus=350, paramount-plus=531, crunchyroll=283, mubi=11, globoplay=307, star-plus=619, hulu=15, peacock=386 — templates per service; ids marked with a ✓ in research D7 are cross-checked, the rest are asserted by a verification test against `/watch/providers/{movie\|tv}` |

Unlisted provider ids enter the vocabulary as `tmdb:{provider_id}` with
TMDB's display name (D7).

## Data volume

≈ 600 titles per region snapshot (9 genres × 30 movie + 30 TV + 60 anime
quota, deduplicated) ≈ 400 KB raw / ~100 KB gzipped per response — one fetch
per client session (FR-019, SC-003). Quotas are config, the SC-001 lever.

## Relationship to existing entities

Ratings and watchlist entries reference `CatalogTitle.id`. Old sample ids
retire with the sample; the watchlist's tolerant title-less row (FR-015,
already implemented) is the specified degradation. No FK relationship exists
or is added — the snapshot is not referenced by any other table.
