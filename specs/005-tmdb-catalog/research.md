# Phase 0 Research: Real Catalog (TMDB)

**Feature**: 005 | **Date**: 2026-09-28

Every open question from the spec and Technical Context, resolved. Format:
Decision / Rationale / Alternatives considered. Sources at the end.

## D1 — TMDB API version and credential

- **Decision**: TMDB's **v3 endpoints** (`discover`, `watch/providers`,
  `videos`, `append_to_response`) authenticated with the **API Read Access
  Token**, sent as `Authorization: Bearer` on every upstream call.
- **Rationale**: TMDB issues two credentials and they are not interchangeable.
  The **API Read Access Token** (a long `eyJ…` JWT) is the one that belongs in
  an `Authorization: Bearer` header, and TMDB presents it as the default,
  recommended method; it authenticates against both the v3 and v4 endpoints,
  so choosing it costs nothing. The **API Key** (32 hex characters) is the
  v3-native credential and belongs in a `?api_key=` query string. This client
  sends a header, so it sends the token — and it sends *only* the header, so a
  stale query key can never mask a rejected token.
  The value lives in `Tmdb:ApiKey` (user-secrets locally, App Settings / Key
  Vault on Azure, per the constitution); the configuration *name* is narrower
  than what it holds, which the options doc comment records. It appears in
  **no** log line, response, or bundle (FR-002, SC-006). The existing
  structured logging never logs request payloads, and the API's own outbound
  call carries the credential only in a header.
- **Alternatives**: the 32-character API key in a query string — trivially easy
  to paste, but it ends up in proxy and CDN access logs, and the header form is
  what TMDB recommends, so the header wins. A v4-only client — adds nothing
  this feature needs.
- **Corrected 2026-09-28**: this decision originally recorded the reverse —
  an `api_key` sent as `Authorization: Bearer`, dismissing the Read Access
  Token as something v4 "adds". That was wrong in both directions, and the
  first live call proved it: the token is what Bearer accepts.

## D2 — One endpoint, one pool; no detail endpoint

- **Decision**: `GET /api/catalog?region=BR` is the only new endpoint. It
  returns the whole region snapshot, titles at full card+detail depth
  (FR-020, clarified). No `/catalog/{id}` exists in this slice.
- **Rationale**: FR-019/SC-003 cap the client at one fetch per deck session;
  a detail endpoint would add a second fetch path and a loading state to the
  detail view for no user-visible gain — YAGNI (constitution II). Titles
  absent from the current pool degrade per FR-015.
- **Alternatives**: separate summary pool + detail endpoint — rejected by
  clarification; provider-id lookups for off-pool watchlist rows — postponed.

## D3 — Pool composition: per-genre quotas, not one popularity list

- **Decision**: the snapshot pool is composed per region as the union of
  bounded `discover` queries — **60 movies + 60 TV titles per quiz genre**
  (9 genres → 1,080 before dedup) plus an **anime quota of 60** (`with_genres=16`
  + `with_original_language=ja`), deduplicated → **916 titles** measured for BR
  on 2026-09-28. Quotas are config values, not contracts.
  **Raised from 30 to 60 on 2026-09-28, on measurement rather than intuition**
  (T033). At 30 the deepest realistic selection — Netflix, Prime Video, Disney+
  and HBO Max — still missed SC-001 in two genres (horror 15, documentary 17);
  at 60 the thinnest genre for any three-service selection is horror at 23.
  The cost is the whole reason it is not higher: 382 KB → 635 KB raw,
  114 KB → 186 KB brotli. And no quota makes a *single*-service selection reach
  twenty — Netflix-only horror went 2 → 8 across a quadrupling of the pool,
  because what caps it is what that one service carries in the region. That
  measurement is what reworded SC-001 rather than what raised the quota.
- **Rationale**: SC-001 (one genre + own services → ≥ 20 titles) is
  unreachable from a single popularity-ranked list: one global top-600 is
  dominated by a few genres, and niche genres (documentary, anime) would
  starve. Per-genre quotas guarantee depth in every quiz genre. The exact
  numbers are the SC-001 tuning lever (spec Assumptions: "a tuning parameter,
  not a contract") and are verified by a measured task during implementation.
  Composition is deterministic: popularity ordering within one snapshot.
- **Alternatives**: one big popularity pool (fails SC-001); server-side
  preference-aware composition (moves filtering server-side — forbidden by
  FR-011 and the clarification that the server serves a *region*-scoped pool).

## D4 — True availability requires per-title calls; refresh is one bounded batch

- **Decision**: per-title enrichment uses `append_to_response=watch/providers,videos`
  — one upstream call per title returning both availability and trailer. A
  region refresh is therefore ≈ 39 `discover` calls + ≈ 600 per-title calls,
  run **in the background**, throttled to ~30 rps, single-flight per region.
- **Rationale**: `watch/providers` is the only TMDB surface that returns
  *every* service carrying a title — `discover`'s `with_watch_providers`
  filters by providers you already name, which cannot honor FR-010's
  "badges name every real service" for services outside the quiz's twelve.
  `videos` is likewise per-title. Folding both into one call via
  `append_to_response` (comma list, max 20 — verified) halves the batch.
  Throttling respects TMDB's soft rate limit (~40 rps; 429 responses carry
  `Retry-After`). The visitor never sees any of this: the client causes one
  API call, zero upstream calls (SC-003), and the 24 h staleness bound
  (FR-004) means a refresh happens at most a few times a day per region.
- **Alternatives**: `discover` with `with_watch_providers` per quiz provider
  (216+ queries, but silent about non-quiz services — violates FR-010);
  lazy per-title fetches on client demand (violates FR-019/SC-003).

## D5 — Which monetization types count as "available"

- **Decision**: a service carries a title when TMDB reports it under
  **flatrate, free, or ads** — rent and buy are excluded.
- **Rationale**: the quiz asks which services the visitor *pays for* and the
  promise is "watch tonight" with no extra purchase; a VOD rental badge would
  put the dead-end link back that FR-007 exists to remove.
- **Alternatives**: include rent/buy (contradicts the product promise);
  flatrate only (hides ad-supported and free tiers that genuinely stream it).

## D6 — Genre mapping: the quiz's nine, translated

- **Decision**: server-side mapping table TMDB genre id → 001 genre id,
  seeded: action=28, comedy=35, drama=18, horror=27, romance=10749,
  sci-fi=878, thriller=53, animation=16, documentary=99. TMDB genres with no
  mapping (Adventure 12, Crime 80, Family 10751, Mystery 9648, …) are kept on
  the title as **extra genre tags**, never dropped.
- **Rationale**: FR-010 keeps 001's ids so stored preferences keep matching;
  the spec's own edge case requires that a genre a visitor cannot pick never
  makes a title unreachable — dropping the tags would not make titles
  unreachable, but keeping them costs nothing and lets cards stay truthful.
  The client's genre filter only matches the nine quiz ids, so extra tags are
  inert for filtering.
- **Alternatives**: adopt TMDB's numeric ids (orphans stored preferences —
  rejected in the spec); drop unmapped genres (loses information for nothing).

## D7 — Provider mapping: the twelve, plus pass-throughs

- **Decision**: server-side mapping table TMDB provider id → 001 provider id,
  seeded (values verified where marked): netflix=8 ✓, prime-video=119 ✓,
  disney-plus=337 ✓, max=1899 ✓, apple-tv-plus=350, crunchyroll=283,
  mubi=11 ✓, globoplay=307, paramount-plus=531, hulu=15, peacock=386. A provider id with
  no quiz mapping enters the vocabulary as **`tmdb:{provider_id}`** with
  TMDB's display name — never dropped (FR-010, clarified), and the client
  already tolerates unknown provider ids (catalog.service's `servesRegion`).
  **Template-coverage rule**: an availability entry needs a search template
  (D8); a provider appearing in region data without one is excluded from
  snapshots and its id logged (structured, id only), until its template is
  added. The seed covers the twelve plus the majors TMDB reports for BR/US.
- **Rationale**: the twelve ids are frozen on visitors' devices (001's storage
  contract); everything else still deserves an honest badge. The
  template-coverage rule keeps FR-007's promise real: a badge that cannot be
  one tap from watching must not render (002's own rule).
- **Alternatives**: quiz's twelve only (rejected by clarification — false
  "unavailable" look); auto-generated Google search links for unmapped
  providers (a badge that doesn't open *that service* violates FR-007).
- **Corrected 2026-09-28 by the gated live test (T025), which earned its keep
  twice.** The seed had two rows wrong, and only a live call could have said so:
  - **Max had moved from 384 to 1899.** 384 was filed as a *regional variant*
    and 1899 as the variant; the truth is the reverse — 1899 is the service's
    only current listing and it calls itself "HBO Max", so 384's row was a
    duplicate pointing at a dead id. The real id was promoted and the old row
    dropped. The client's display name was corrected with it (`'Max'` →
    `'HBO Max'`), because a badge naming a service by a name it no longer uses
    is the same defect one layer up.
  - **Star+ (619) is gone entirely** — the service was discontinued in Latin
    America and its catalog folded into Disney+. There is no service left to
    point the row at, so the row is gone; the client handles the visitors who
    already selected it (D20).
  - The remaining seed ids — paramount-plus=531, crunchyroll=283,
    globoplay=307 — were **re-verified** by the same run and still name the
    right services; the digits can move again, which is what the gated test is
    for.

## D8 — Badge deep links: server-side per-service templates

- **Decision**: each mapped provider carries a **search URL template**
  (e.g. `https://www.netflix.com/search?q={title}`), applied server-side at
  snapshot build; the client receives the final `deepLinkUrl` per availability
  entry (FR-007 — the templates are "this feature's" to own and maintain).
  The title's name is URL-encoded into the template.
- **Rationale**: TMDB publishes one watch page per title, not per service, so
  the links must be assembled somewhere; assembling them server-side keeps the
  client's `StreamingAvailability` shape exactly as it is today and puts the
  template table next to the other mapping data, where a renamed path is a
  one-row fix (spec edge case: "a template that fails is a defect this feature
  owns").
- **Alternatives**: client-side templates (spreads mapping knowledge across
  two codebases; violates FR-010's "server-side mapping table" premise).
- **Amended 2026-09-28 (T035): two placeholders, not one.** Resolving one live
  deep link per service in the BR pool found that a single `{title}` cannot
  express every service's search URL:
  - **Paramount+ needs the country in the path.** `/search/?q=` answers 302 to
    `/{region}/search/` and **drops the query**, so the badge landed the visitor
    on an empty search box — a one-tap promise kept in form and broken in fact.
    With the country in the path the query survives, so the template gained a
    `{region}` placeholder and `DeepLinkFor` learned to substitute it,
    lowercased on the way in (every service that wants one writes it that way).
  - **`TemplatePlaceholders` is now the single list** both the substitution and
    `Every_template_uses_only_known_placeholders` read, so a template naming a
    placeholder the code does not know fails a test instead of shipping the
    braces verbatim into a URL.
  Two services remain **degraded rather than fixed**, and the difference is
  recorded so a later reader does not mistake it for an oversight: **Disney+**
  serves no search page to an anonymous client at all (`/` and `/pt-br` answer
  200 while `/pt-br/search` answers 404 for the same client and locale header),
  and **Max** exposes none either (`play.max.com/search` 404s;
  `play.hbomax.com/search?q=` 302s to `www.hbomax.com/?q=`, which is where the
  template now points — one redirect fewer and the query intact). Both badges
  therefore open the service but do not search it. Dropping those two services
  was considered and rejected: a badge that opens the service beats a visitor
  who selected it matching nothing.

## D9 — Anime classification (FR-016)

- **Decision**: a title is `anime` iff TMDB genre 16 (Animation) is among its
  genres **and** `original_language == "ja"`. The classification overrides
  the underlying movie/tv type in the `mediaType` field. Title identity stays
  the *underlying* type: id = `tmdb:{movie|tv}:{numeric id}`.
- **Rationale**: TMDB has no anime media type; the clarified rule is the
  quiz's three-way choice made real. Keeping the underlying type in the id
  makes identity immune to classification drift and still unique (TMDB ids
  collide only across types — the spec's Key Entities).
- **Alternatives**: a keyword-based anime heuristic (keyword 210024 —
  brittle, keyword coverage is patchy); TMDB's own `watch_region` "anime"
  genre buckets (same data, no rule).

## D10 — Cache: IMemoryCache L1 + Postgres L2, 24 h staleness

- **Decision**: per-region snapshot cached in `IMemoryCache` (L1); the last
  good snapshot also persisted to a `CatalogSnapshots` table (L2, jsonb).
  Staleness bound: 24 h (config). On GET: L1 → L2 → (nothing) → kick a
  background refresh and answer 503 (D11). When a snapshot is stale, serve it
  and refresh in the background — never block a request on the ~25 s batch.
  A failed refresh leaves the existing snapshot untouched (FR-013).
- **Rationale**: the constitution names `IMemoryCache` for TMDB data, but the
  same constitution's infra note hosts the API scale-to-zero — a memory-only
  cache makes the first visitor after every scale-up pay the refresh, and
  FR-012/013's "last successful catalog" would not survive the exact restart
  that accompanies an outage. The L2 is the spec's own "Catalog snapshot"
  entity made durable; it is a cache of the provider, not a second source of
  truth. **Durability is also what makes a retention ceiling necessary**: data
  that survives a restart survives indefinitely, which is precisely what the
  provider's terms forbid (D19).
- **Alternatives**: memory-only (rejected above); L2-only without L1 (DB read
  per request on the 300 ms path); refresh-inline-on-stale (one unlucky
  visitor blocks for ~25 s — violates SC-002's spirit).

## D11 — Cold-cache semantics: answer, never stall

- **Decision**: with no snapshot in L1 or L2, the endpoint starts the
  background refresh (single-flight) and returns **503
  `{code: "catalog-not-ready"}`**. The client's existing `catchError` path
  falls back to its cached copy or `[]` and shows the existing empty state
  with its way out (FR-014). The refresh completes ~30 s later; the next load
  gets cards. A retry from the visitor's empty state is that next load.
- **Rationale**: blocking the first request on a ~620-call upstream batch is
  an endless spinner in all but name. FR-014 is explicit: no catalog ever
  retrieved → the existing empty state with its way out. The 503 is the honest
  transport for "nothing yet, working on it" and reuses the client's
  already-tested unreachable-provider path unchanged.
- **Alternatives**: inline fetch (stalls, rejected above); 204/200 with empty
  array (client would show the empty state *and* cache an empty snapshot —
  the empty array would then look like the catalog, poisoning the fallback;
  FR-013's "never overwrite good data" logic would have to special-case it).

## D12 — Poster delivery: direct CDN, w500

- **Decision**: the server builds poster URLs as
  `https://image.tmdb.org/t/p/w500{poster_path}` and the browser loads them
  directly from TMDB's image CDN (FR-001's clarified carve-out). A title with
  no `poster_path` gets `posterUrl: null` → the existing CSS placeholder
  (FR-017, 002 FR-016).
- **Rationale**: the CDN needs no credential and is designed to be hotlinked;
  proxying would double image latency and add an image-cache path for no
  security gain. One size (w500) serves card and list-thumbnail alike.
- **Alternatives**: backend image proxy (rejected by clarification);
  per-surface sizes (complexity for no measured gain this slice).

## D13 — Attribution (FR-018)

- **Decision**: one footer line on the deck screen — "This product uses the
  TMDB API but is not endorsed or certified by TMDB", linking to TMDB.
- **Rationale**: TMDB's attribution requirement; the smallest surface that
  keeps every screen's card visible and satisfies it.
- **Alternatives**: attribution on every card (noise); an About screen (a new
  screen for one sentence — constitution I).

## D14 — Region derivation and validation (FR-005)

- **Decision**: client derives the region from
  `navigator.language` — the 2-letter country subtag of a language-region tag
  ("pt-BR" → BR, "en-US" → US); a language-only tag ("pt") falls back to the
  existing `DEFAULT_REGION` ("BR"), and so does anything unmappable. The
  server validates `^[A-Z]{2}$` and answers 400 `{code:"invalid-region"}`
  otherwise. All metadata is requested in English (clarified), regardless of
  region.
- **Rationale**: clarified decision — zero permission, zero cost, guest-first;
  wrong locales (travelers, default-English browsers) degrade per the spec's
  "region cannot be determined → default applies" edge case.
- **Alternatives**: IP geolocation (accuracy vs. extra service + VPN
  misleads — deferred); a region picker (friction, constitution I/II).

## D15 — Adult content (FR-008)

- **Decision**: `include_adult=false` on **every** upstream query (discover
  and per-title), not a post-filter.
- **Rationale**: the exclusion belongs at the source so adult titles never
  enter a snapshot at all; a post-filter would still have fetched them.
- **Alternatives**: post-filter only (pointless upstream traffic for content
  that must never appear).

## D16 — Upstream failure handling (FR-012/013, rate limits)

- **Decision**: any upstream failure (timeout, 5xx, 429) aborts the refresh
  and keeps the existing snapshot; 429 responses honor `Retry-After` and back
  off. A refresh is retried on the next stale-request trigger. Nothing from a
  failed refresh is written anywhere (FR-013). Failures log a structured
  warning (region, endpoint, status) — never a payload or a key.
- **Rationale**: the spec is explicit that a failed request must not discard
  or overwrite good data; the batch is atomic — the snapshot is swapped only
  when the whole batch succeeded. The provider being down must look identical
  to the visitor whether the cache is fresh or stale (SC-005).
- **Alternatives**: partial snapshots from a half-failed batch (mixes good and
  possibly-poisoned data — violates FR-013's spirit); retry storms (against
  a provider that just said 429).

## D17 — Frontend swap: the 002 seam, closed

- **Decision**: new `httpCatalogSource` (Angular `HttpClient` →
  `/api/catalog?region=`) becomes the `CATALOG_SOURCE` factory;
  `localCatalogSource`, `media-catalog.data.ts`, and `public/posters/*.svg`
  are deleted. `CatalogService.loadTitles` — including the `cachedCopyOf`
  fallback and `usingCachedTitles` notice — is **unchanged**. The deck passes
  the derived region (D14) where it passed `DEFAULT_REGION`. Component tests
  switch from the retired sample to their own small fixtures; SC-007's
  scenarios, not the fixtures, must keep passing.
- **Rationale**: this is the swap the seam's own comment promised ("`load`
  becomes the REST request, and no component changes"). Deleting the sample
  rather than keeping it as an offline seed is the spec's assumption: sample
  titles presented as real ones would be a worse lie than the empty state.
- **Alternatives**: keep the sample as the fallback (spec rejects it);
  persist the snapshot client-side for offline (explicitly out of scope this
  slice).

## D18 — Backend layering (constitution VII)

- **Decision**: Domain holds `CatalogTitle`, `StreamingAvailability`, and the
  pure rules (genre mapping, provider mapping, monetization filter, anime
  classification, template application). Application holds the use case
  (snapshot policy: fresh/stale/never-overwrite, single-flight) behind two
  ports — `ICatalogProvider` (fetch + enrich) and `ICatalogSnapshotStore`
  (L1+L2). Infrastructure implements both (typed `HttpClient` "tmdb",
  throttled batch; `IMemoryCache` + EF). Api exposes the one endpoint, maps
  DTOs, validates the region. Config: `Tmdb` section (`ApiKey`, `BaseUrl`,
  `Staleness`, quotas) — `BaseUrl` is overridable so tests and the outage
  drill can point at a stub host.
- **Rationale**: the classification/mapping rules are the critical path
  (constitution V) and must be testable with no HTTP or database; the batch
  mechanics and the cache are infrastructure. One pattern per concern — the
  snapshot cache is the only new pattern and is the spec's own entity.
- **Alternatives**: rules in Infrastructure (untestable without stubs);
  caching in the use case (framework types leak into Application).

## D19 — Retention ceiling: the licence, not the freshness policy

- **Decision**: a second, much longer bound sits beside `Staleness`.
  `TmdbOptions.MaxCacheAge` defaults to **180 days**; a snapshot older than it
  is **neither served nor kept** — the read purges the row it was asked about
  and answers `catalog-not-ready`, which starts the retrieval that replaces it.
  A successful save additionally sweeps every *other* expired region.
- **Rationale**: §1.C of TMDB's API Terms of Use prohibits caching their data
  "for longer than 6 months", and §1.D requires purging it when the licence
  ends. Nothing enforced either until now: `Staleness` decides only when to
  *refresh*, so a snapshot nobody had refreshed *behind* was served
  indefinitely. **180 days is chosen to be provably inside the term rather than
  near it** — "six months" is not a fixed day count, and the shortest six
  consecutive calendar months (February through July) is 181, so any count
  below 181 is always fewer than six months whatever the calendar is doing.
  A ceiling of "six months" written as 183 days could exceed the term; this one
  cannot.
- **Enforced in the store, not the policy.** A ceiling each caller has to
  remember is a ceiling that holds until someone adds a caller, so
  `CatalogSnapshotStore` refuses to return an over-age snapshot and deletes it —
  and the Application layer cannot serve expired data by omission.
- **This is a deliberate exception to FR-013**, and worth naming as one. FR-013
  says a failed refresh must not discard good data; past the ceiling the
  alternative to discarding is serving data we are not licensed to keep, so the
  deck falls back to the empty state — which has its own way out. The two rules
  meet at exactly one boundary and the terms win there.
- **Alternatives**: a hosted `BackgroundService` sweeper — rejected, and the
  rejection is the interesting part. The API is hosted **scale-to-zero**, so a
  timer that runs while the app is warm is a timer that does not run during the
  idle periods that matter. Sweeping on read covers every region anyone looks
  at; sweeping on save covers the ones nobody does, at the only moment the app
  is guaranteed to be awake. Documenting the ceiling without enforcing it —
  rejected as the failure mode that looks like compliance.

## D20 — A retired service is aliased on the client, not the server

- **Decision**: `star-plus` is **removed from the quiz's offered services** and
  added to a client-side `RETIRED_PROVIDERS` list (so it can still be *named*),
  with `RETIRED_PROVIDER_SUCCESSORS` mapping it to `disney-plus` where the deck
  matches availability. The server's vocabulary carries no `star-plus` row.
- **Rationale**: three separate problems that look like one.
  A visitor cannot be offered a service that does not exist — that is wrong
  however the matching is arranged (constitution II, never a dead end). But
  001's storage contract is **frozen**, so devices in the wild hold `star-plus`
  in stored preferences, and an id the app cannot name renders as *nothing*:
  the visitor's own selection would quietly shrink, with no explanation and no
  way to ask. And the selection itself must still match, or those visitors get
  an empty deck in every genre — the dead end again, this time undiagnosable.
  Hence three lists rather than one: offered, named, and successor-mapped.
- **Why the client and not the server's table.** The server could not express
  this honestly: aliasing there would mean emitting a `star-plus` badge, and
  that badge would link to a service that is gone. The server has nothing left
  to name; the client has a stored preference to reconcile.
- **Alternatives**: leaving the row in the server table pointing at Disney+
  (emits a badge for a service that does not exist — worse than no badge);
  migrating stored preferences (the 001 storage contract is frozen, and a
  migration cannot see a device that has not opened the app yet); dropping the
  id everywhere (silently shrinks a stored selection, which is the failure this
  is arranged to prevent).

## Sources

- TMDB watch provider endpoints and regional scoping — [Movie watch providers](https://developer.themoviedb.org/reference/movie-watch-providers), [TV providers list](https://developer.themoviedb.org/reference/watch-provider-tv-list), [Movie providers list](https://developer.themoviedb.org/reference/watch-providers-movie-list)
- `append_to_response` (comma-separated, max 20) — [tmdbR vignette](https://cran.r-project.org/web/packages/tmdbR/vignettes/getting-started.html)
- Rate limiting: soft limit ~40 req/s, `Retry-After` on 429 — [TMDB agent-skills reference](https://github.com/magnus919/agent-skills/blob/main/tmdb/references/auth-pagination-and-errors.md)
- Provider id cross-check (Netflix 8, Prime Video 119, Disney+ 337, Max 384/1899, Apple TV+ 350, Hulu 15, Peacock 386, MUBI 11) — [TMDbLib issue 482](https://github.com/jellyfin/TMDbLib/issues/482), [TVM provider map](https://github.com/GL-327/TVM/blob/main/apps/core/src/providers/apps.ts)
- TMDB attribution wording — developer.themoviedb.org attribution requirements
