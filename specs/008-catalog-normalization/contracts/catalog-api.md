# Contract: Catalog REST API

**Owner**: feature 008 | **Consumers**: Angular frontend (only — constitution
IV) | **Supersedes**: 005's `contracts/catalog.md` by extension (the response
shape and the no-filter request are unchanged)

One endpoint, one payload, additive optional filters. The catalog is anonymous:
a guest quiz → deck → watchlist flow works with no session (constitution III).
No provider credential is ever part of a request, response, or header on this
endpoint.

Base URL: `/api` under the API's origin. All bodies are UTF-8 JSON, camelCase.

## `GET /catalog`

| Parameter | Required | Format | Meaning |
|---|---|---|---|
| `region` | yes | `^[A-Z]{2}$` | ISO 3166-1 alpha-2; scopes the catalog and availability |
| `services` | no | comma-separated service ids | Keep titles available on **any** of these services |
| `genres` | no | comma-separated genre slugs | Keep titles carrying **any** of these genres |
| `mediaTypes` | no | comma-separated `movie`, `tv`, `anime` | Keep these presentation media types |
| `ids` | no | comma-separated title ids | Resolve these exact titles, active version first, then the retired-title archive |

All optional dimensions are **OR within a dimension and AND across
dimensions** — the same semantics as the deck's own filters. Empty values are
ignored. Duplicates are removed.

### Response

`200` with the unchanged shape:

```jsonc
{
  "region": "BR",
  "fetchedAt": "2026-10-23T06:41:12Z",
  "titles": [
    {
      "id": "tmdb:movie:27205",              // tmdb:{movie|tv}:{id}; never renumbered
      "title": "Inception",
      "releaseYear": 2010,
      "mediaType": "movie",                  // movie | tv | anime
      "genres": ["sci-fi", "thriller", "action"],  // quiz ids first, then tags
      "synopsis": "A thief who steals corporate secrets...",
      "rating": 8.4,
      "voteCount": 36000,
      "runtimeMinutes": 148,                 // null for series
      "trailerUrl": "https://www.youtube.com/watch?v=YoHD9XEInc0",  // may be null
      "posterUrl": "https://image.tmdb.org/t/p/w500/...jpg",         // may be null
      "availability": [
        { "providerId": "netflix",  "deepLinkUrl": "https://www.netflix.com/search?q=Inception" },
        { "providerId": "tmdb:484", "deepLinkUrl": "https://www.themoviedb.org/movie/27205/watch?locale=BR" }
      ]
    }
  ]
}
```

The shape does not vary by request mode. `availability` may be empty; an
unknown service is named on its badge rather than dropped (`tmdb:{provider_id}`
id, TMDB region-link fallback). `deepLinkUrl` is final — the client opens it,
never builds it.

### Request-mode semantics

| Request | Titles returned |
|---|---|
| No optional parameters | Today's **general pool**, in its stable order. This is the backward-compatibility promise (FR-004): an existing client sees what it saw before, modulo the catalog refresh itself. |
| Any of `services`/`genres`/`mediaTypes` | Only titles matching **all supplied** dimensions, over the whole active version (not just the general pool), capped at `Catalog:MaxPoolTitles` (default 1000), ordered by popularity descending then title id. |
| `ids` | The requested titles that exist in the active version, then any that exist only in the retired-title archive. Ids not found anywhere are omitted. A supplied filter is ANDed with the id set. Ids bypass the pool cap but are limited to `Catalog:MaxIdsPerRequest` (default 1000). |
| `ids` + filters | Intersection. An archived title has `availability: []`. |

An empty result is `200` with `"titles": []` — a service + genre that genuinely
has no titles in the region is a normal answer, not an error. The deck's
existing empty state explains it.

`fetchedAt` is the active version's observation time. It is informational; the
client does not act on it (the cached-catalog notice is still driven by
`usingCachedTitles`).

### Ordering

- General pool: the same discovery order as today (`PoolPosition`, then id).
- Targeted: `Popularity DESC, TitleId ASC` before the cap. This is the
  deterministic selection order, not a ranking. The client re-ranks the whole
  response with `rankTitles`; the contract does not promise that the server's
  order is the deck's order.
- Ids: deterministic (general-pool position where available, then popularity,
  then id). Clients look titles up by id.

### Validation

Syntactic only, because services and genres are data (FR-021). An unknown but
well-formed value yields a smaller or empty pool; it is not an error.

| Case | Status | Body |
|---|---|---|
| `region` missing or not `^[A-Z]{2}$` | `400` | `{ "code": "invalid-region", "errors": ["region must be an ISO 3166-1 alpha-2 code"] }` |
| A service id not matching `^[a-z0-9][a-z0-9-]{0,63}$` or `^tmdb:[0-9]{1,10}$` | `400` | `{ "code": "invalid-service", "errors": [...] }` |
| A genre id not matching `^[a-z0-9][a-z0-9-]{0,63}$` | `400` | `{ "code": "invalid-genre", "errors": [...] }` |
| A media type other than `movie`/`tv`/`anime` | `400` | `{ "code": "invalid-media-type", "errors": [...] }` |
| An id not matching `^tmdb:(movie|tv):[0-9]{1,10}$` | `400` | `{ "code": "invalid-title-id", "errors": [...] }` |
| More than `MaxIdsPerRequest` ids | `400` | `{ "code": "too-many-ids", "errors": ["at most 1000 ids are accepted in one request"] }` |
| No active catalog version (cold region) | `503` | `{ "code": "catalog-not-ready", "errors": ["The catalog has not been retrieved yet. Try again shortly."] }` — a refresh is started in the background |
| Active version older than the retention limit | `503` | same `catalog-not-ready` body; the version is purged and a refresh starts |

The query string is bounded by Kestrel's `MaxRequestLineSize` (32 KB, raised
for the `ids` mode). A URL over the limit receives Kestrel's standard `414`.

### Rollback behavior

While `Catalog:Source=Snapshot`:

- `services`, `genres`, and `mediaTypes` are **ignored**; the request returns
  the snapshot's general pool with `200`. The client's own filters keep the
  deck correct (spec assumption), and the payload is today's pool.
- `ids` is honored by filtering the snapshot's titles. An id that only existed
  in a per-service pool is omitted; the watchlist renders its existing
  null-title row.

No error code changes; no client change is needed for a rollback.

### Rules

- **Anonymous.** No authorization, no session, no visitor data is read.
- **Server-side only.** The API is the only thing that talks to TMDB; the
  credential is never echoed.
- **Region is an input, not a filter.** The server scopes every query; the
  client never filters by region.
- **Availability is the truth.** Every entry is a streamable monetization
  (`flatrate`, `free`, or `ads`), canonicalized to one service, with a final
  link. A migrated entry may carry `unknown` for its monetization; the wire
  shape has no monetization field, so this is invisible to clients.
- **The response is capped, not paginated.** A broad targeted request returns
  the first 1,000 titles by popularity. Narrowing the filters is the way to go
  deeper. There is no cursor.
- **No HTTP caching contract.** `Cache-Control` behavior is unchanged; the
  server may answer from memory, and the client keeps its in-memory fallback.

## Screen usage

| Screen | Request |
|---|---|
| Deck | `region` plus `services` (omitted when the quiz says any **or**
  "Show content on other platforms" is on), `genres` (omitted when any),
  `mediaTypes` (omitted when any) — plus a supplementary `ids` request for the
  visitor's rated titles, merged before ranking so history affinity is
  unchanged |
| Watchlist | `region` + `ids` = the interaction document's title ids |
| History | `region` + `ids` = the unique title ids in the watching log |
| Watchlist detail | `region` + `ids` = `[titleId]` |
| Match Found | `region` + `ids` = `[titleId]` |

Each screen makes one logical catalog load per view; the deck makes two (pool
and rated ids) because the two sets cannot be combined (the server ANDs
filters).

## Non-goals

- No per-title detail endpoint — the pool and the `ids` mode carry full detail.
- No pagination, cursor, or streaming response.
- No search, cast, crew, or episode data.
- No server-side ranking or final filter decision (FR-025).
- No authorization or personalization on the server.
- No real-time availability; data is as fresh as the last promoted version.
