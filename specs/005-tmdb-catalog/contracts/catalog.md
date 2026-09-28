# Contract: Catalog REST API

**Owner**: feature 005 | **Consumers**: Angular frontend (only — constitution
IV) | **Date**: 2026-09-28

One endpoint, one payload. The catalog contract is deliberately a mirror of
the client's `MediaTitle` shape (FR-009): the server produces what the deck
and watchlist already consume, so no screen changes shape because the catalog
became real.

Base URL: `/api` under the API's origin. All bodies are UTF-8 JSON, camelCase
(the existing serializer convention).

## `GET /catalog?region=BR`

**Anonymous** — a guest quiz → deck must work with no session (constitution
III). The only parameter is the region (FR-005).

| Case | Status | Body |
|------|--------|------|
| Snapshot exists (fresh or stale — FR-012) | `200` | the snapshot |
| Region malformed (not `^[A-Z]{2}$`) | `400` | `{ "code": "invalid-region", "errors": ["region must be an ISO 3166-1 alpha-2 code"] }` |
| No snapshot ever retrieved (refresh started in background) | `503` | `{ "code": "catalog-not-ready", "errors": ["The catalog has not been retrieved yet. Try again shortly."] }` |

The 200 body is the **whole pool** at full detail (FR-020):

```jsonc
{
  "region": "BR",
  "fetchedAt": "2026-09-28T14:05:00Z",
  "titles": [
    {
      "id": "tmdb:movie:27205",           // tmdb:{movie|tv}:{id} — underlying type
      "title": "Inception",
      "releaseYear": 2010,
      "mediaType": "movie",               // movie | tv | anime (anime rule, FR-016)
      "genres": ["sci-fi", "thriller", "action"],  // quiz ids + extra tags
      "synopsis": "A thief who steals corporate secrets...",
      "rating": 8.4,
      "voteCount": 36000,
      "runtimeMinutes": 148,              // absent for TV
      "trailerUrl": "https://www.youtube.com/watch?v=YoHD9XEInc0",  // may be absent
      "posterUrl": "https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",  // may be absent
      "availability": [
        { "providerId": "netflix",   "deepLinkUrl": "https://www.netflix.com/search?q=Inception" },
        { "providerId": "tmdb:484",  "deepLinkUrl": "https://tv.apple.com/search?term=Inception" }
      ]
    }
  ]
}
```

## Rules

- **Region is an input, not a filter** (FR-005): the server returns titles
  already scoped to the region; the client never filters by region.
- **Availability is the truth** (FR-006): `availability` lists every service
  TMDB reports carrying the title in that region under flatrate/free/ads —
  the quiz's twelve by their 001 ids, everything else as `tmdb:{provider_id}`
  (FR-010). Empty is normal.
- **`providerId` values are a superset of the quiz's twelve.** The client's
  provider filter matches only ids it knows; unknown ids are ignored by
  filters, never fatal (existing client behavior, verified in 002).
- **`deepLinkUrl` is final** (FR-007): assembled server-side from per-service
  search templates. The client opens it, never builds it.
- **Staleness**: the server may serve a snapshot older than the staleness
  bound — that is FR-012, not a bug. `fetchedAt` is informational; the client
  does not act on it (the provider-reachability notice is driven by its own
  fallback, `usingCachedTitles`, as today).
- **One fetch per session** (FR-019, SC-003): the client calls this endpoint
  at most once per deck session. A 50-card session must not cause a second
  catalog request.
- **Failure semantics**: 5xx or network failure → the client's existing
  `catchError` path serves its cached copy with the "showing cached titles"
  notice, or the existing empty state when it has none (FR-014). A `503`
  here is handled by the same path — the client needs no new error handling.

## Non-goals (this contract deliberately does not offer)

- No title-detail endpoint — the pool carries full detail (FR-020).
- No pagination, search, or query parameters beyond `region` — out of scope
  (spec Assumptions).
- No authorization — this endpoint reads no visitor data.
- No region negotiation — the client derives and sends it (FR-005).

## Client-side companions (frontend-internal, documented for the swap)

- **`CatalogSource` seam** (`core/services/catalog.service.ts`): the HTTP
  source implements `load(region) → Observable<MediaTitle[]>`; the
  `CatalogService` fallback and notice behavior are unchanged.
- **Region derivation** (`core/region.ts`): `navigator.language` → ISO code
  ("pt-BR" → BR); language-only or unmappable tags fall back to
  `DEFAULT_REGION` ("BR").
