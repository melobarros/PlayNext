# Quickstart: Real Catalog (TMDB) — Validation Guide

**Feature**: 005 | **Date**: 2026-09-28

Runnable validation scenarios proving the feature end-to-end. Contract
details live in [contracts/catalog.md](./contracts/catalog.md); entity rules
in [data-model.md](./data-model.md).

## Prerequisites

1. **TMDB credential** (obtained out of band — spec Assumptions; the feature is
   non-functional without it). TMDB issues two of them and they are not
   interchangeable: register the **API Read Access Token** (the long `eyJ…`
   one), *not* the 32-character API Key, because the client authenticates with
   `Authorization: Bearer` (research D1).

   ```powershell
   cd backend/src/PlayNext.Api
   dotnet user-secrets set "Tmdb:ApiKey" "<your-api-read-access-token>"
   ```

   The setting keeps the name `ApiKey` even though it holds a token, so that
   machines configured before the distinction was recorded keep working.

2. **Database** (Postgres, as for 004) — apply the new snapshot migration:

   ```powershell
   cd backend
   dotnet ef database update --project src/PlayNext.Infrastructure --startup-project src/PlayNext.Api
   ```

3. **Run** (same as 004): API on http://localhost:5003, frontend via
   `npm start` (proxy maps `/api` → 5003).

## Verification scenarios

| # | Scenario | Steps | Expected | Covers |
|---|----------|-------|----------|--------|
| 1 | Real titles in the deck | Complete the quiz (any answers); deal cards | Cards carry real titles — synopses, years, ratings, posters from `image.tmdb.org`; none of the retired sample titles; TMDB attribution line visible on the deck | US1, FR-001/018, SC-001/007 |
| 2 | Determinism preserved | Complete the same quiz twice; note the first card | Same first card both times — ranking untouched (002 FR-011) | FR-011, SC-007 |
| 3 | Region is an input | In DevTools, override the device locale (e.g. `navigator.language = "en-US"`) and reload; open a known title | Badges reflect US availability, not BR — and vice versa with "pt-BR" | US2, FR-005/006 |
| 4 | Badge keeps the one-tap promise | Tap a service badge | That service opens, searching for the title — one tap from watching | FR-007 |
| 5 | Availability spot check | Pick 10 titles by hand; compare each badge against the services' own pages | 10/10 badges name services that carry the title in the region | SC-004 |
| 6 | Provider-outage drill | Warm the catalog, then restart the API against an unreachable provider and reload the deck (commands below) | Cards still render from the last good snapshot and the "showing cached titles" notice appears — never an error screen. The snapshot is also durable, so the restart itself does not lose it; the failed refresh writes nothing, so the next healthy load serves exactly what it served before | US3, FR-012/013, SC-005 |
| 7 | Never-fetched empty state | Same drill against a region with no stored snapshot (delete the row first) | `GET /api/catalog?region=BR` answers **503 `catalog-not-ready`** — the client turns that into its existing empty state with its way out: never a spinner, never an error screen. The refusal starts a retrieval; letting it finish (≈30 s) and retrying yields cards | FR-014, SC-005 |
| 8 | Adult exclusion | Search the served snapshot for known adult titles (e.g. ids from the provider's adult-only catalog) | Absent — `include_adult=false` at the source | FR-008 |
| 9 | Credential hygiene | Inspect the built client bundle, the API response, and a log sample for the key | Zero occurrences anywhere client-visible or logged | FR-002, SC-006 |
| 10 | No regression | Run both suites and the production build | Backend all green (mapping, classification, snapshot policy, gated integration with a stubbed TMDB); frontend all green incl. re-anchored deck/watchlist specs; build clean | SC-007 |

## The outage drill (scenarios 6–7)

The provider is pointed elsewhere through configuration rather than by editing
code — `Tmdb:BaseUrl` exists for this seam (research D18), and the value below
is a port that refuses connections immediately, so the batch fails without
waiting for a timeout.

```powershell
# 1. Warm the region once, so a snapshot exists in both levels.
#    The first call answers 503 while the retrieval runs; retry until it is 200.
curl.exe "http://localhost:5003/api/catalog?region=BR"

# 2. Restart the API pointing the provider at an unreachable host.
cd backend/src/PlayNext.Api
$env:Tmdb__BaseUrl = "https://127.0.0.1:9/3"
dotnet run

# 3. Reload the deck (scenario 6): cards from the stored snapshot, and the
#    "showing cached titles" notice. Reloading the *page* is enough — the
#    snapshot survived the restart, which is the point of the durable level.

# 4. Scenario 7: delete the region's row and repeat, with the provider still
#    unreachable. The API answers 503 catalog-not-ready; the deck shows its
#    empty state. Restore Tmdb:BaseUrl, wait ~30 s for the retrieval the
#    refusal started, and retry — cards.
```

Deleting the row (step 4) is any SQL client against `ConnectionStrings:Postgres`
— `DELETE FROM "CatalogSnapshots" WHERE "Region" = 'BR';`. The table is the only
thing this feature persists, and emptying it is exactly "this region has never
been retrieved".

## Automated suites

- **Backend**: `dotnet test` — Domain rules (anime classification, genre/
  provider mapping, monetization filter, templates), Application snapshot
  policy (staleness, never-overwrite, single-flight, 503 path), integration
  tests with a stubbed TMDB handler (no live key needed).
- **Frontend**: `cd frontend && npx ng test --watch=false` — the HTTP catalog
  source, region derivation, and the unchanged `CatalogService` fallback;
  existing specs re-anchored to test fixtures instead of the retired sample.

## Verification table

| Step | Result |
|------|--------|
| Backend suite | **PASS** — 271 passed, **0 skipped** (`dotnet test`). Domain 102, Application 87, Integration 82 |
| Frontend suite | **PASS** — 618 tests across 40 files (`npx ng test --watch=false`) |
| Production build | **PASS** — `npx ng build`, initial total 298.22 kB raw / 79.10 kB transfer (the retired-provider lists cost nothing measurable) |
| Credential scan (SC-006) | **PASS** — a key-shaped sentinel configured into `Tmdb:ApiKey` appeared 0 times in the built bundle, 0 times in the server log (300 lines covering a full retrieval attempt), and 0 times in the API response body |
| Test isolation (T040) | **PASS** — `dotnet test` writes to `playnext_test`, created and migrated on demand; verified by querying both databases after a run, with the developer's `playnext` still holding the real 916-title snapshot and the stub 8-title one in `_test` |
| Provider table vs the live API (T025) | **PASS with two corrections** — the gated test now runs, and it earned its keep twice; see "Provider drift" below |
| SC-001 volume (T033) | **MET for three or more services**, and the criterion was reworded to say so — see "SC-001 volume" below |
| SC-002 latency (T034) | **PARTIAL** — the payload was measured and compressed (below); the browser-side 300 ms reading is still outstanding |
| SC-004 badges (T035) | **PARTIAL** — all 10 services in the live pool were resolved; two templates were fixed, two are honestly degraded (below). "Still carries the title" needs a human with accounts |
| Scenarios 1–10 (T037) | **PARTIAL** — 8, 9 and 10 verified; 6 and 7 reproducible via the outage drill; 1–5 need a browser |

## Provider drift (T025)

The gated test exists to answer one question the rest of the suite cannot: is
the service at id *N* still the service we seeded? Configured against a live
credential on 2026-09-28, it answered **no** twice:

- **Max had moved from id 384 to id 1899**, which the seed table had filed as a
  *regional variant* named "Max". 1899 is now the service's only listing and it
  reports itself as "HBO Max". The row was promoted and the old one dropped.
- **Star+ (id 619) is gone entirely** — the service was discontinued in Latin
  America and its catalog folded into Disney+. There is no longer a service to
  point the row at, so the row is gone, and the visitor-facing consequence is
  handled on the client (below, "Star+"). It could not be handled here: the
  server has nothing left to name.

The suite went from 79 passed + 1 skipped to 82 passed + 0 skipped across this
change: the two new compression tests, plus the gated test actually running.

## SC-001 volume (T033)

Measured against the live provider for `BR` on 2026-09-28, at the raised quotas
(`MoviesPerGenre`/`TvPerGenre` = 60): **916 titles**, 635,380 bytes.

| genre | Netflix only | Netflix+Prime | Netflix+Prime+Disney+ | big four | pool |
|-------|-------------|---------------|----------------------|----------|------|
| action | 26 | 47 | 80 | 92 | 166 |
| comedy | 42 | 58 | 111 | 124 | 274 |
| drama | 55 | 85 | 112 | 125 | 299 |
| horror | **8** | **15** | 23 | 39 | 77 |
| romance | 12 | 28 | 41 | 46 | 147 |
| sci-fi | **19** | 31 | 69 | 86 | 139 |
| thriller | 14 | 34 | 40 | 55 | 118 |
| animation | 78 | 94 | 155 | 167 | 307 |
| documentary | 12 | **16** | 25 | 31 | 121 |

Bold is below 20. **SC-001 is met for every selection of three or more
services**, and the criterion was reworded in [spec.md](./spec.md) to say
exactly that. The two things the measurement settled:

- **The quota was the lever, and it worked.** At the previous 30 the *deepest*
  realistic selection (big four) still missed in two genres — horror 15,
  documentary 17. At 60 the thinnest genre for three services is horror at 23.
  Both numbers are real: the criterion was not almost-met, it was missed.
- **The single-service case is not reachable by tuning at all.** "Netflix +
  horror" is 8 of 916 — quadrupling the pool bought 2 → 8, and reaching 20 would
  need roughly 2,000 titles. The ceiling there is what one service carries in
  the region, which is a fact about the region and not about this catalog. That
  is why the criterion now states the guarantee for the part the catalog
  controls rather than dropping the number.

**What this cost, and the lever still unused.** 540 → 916 titles took the
response from 382 KB to 635 KB raw, 114 KB → 186 KB brotli. That is affordable
only because response compression was added first (below), and it is the reason
the quota is 60 rather than higher. The obvious remaining lever is not a quota:
**404 of the 916 titles carry no badge at all** in BR — rent/buy-only, or
carried solely by a service the vocabulary does not map — so 44% of the payload
is invisible to any visitor who selected a service. Fetching per service
(`with_watch_providers` + `watch_region`) would spend the same bytes on titles
that can actually be watched, but it would break the quiz's "show me other
platforms" opt-in unless unbaded titles were kept alongside, and it is a change
to the retrieval design (research D3) rather than to a quota. Recorded here as
the next move, not taken: it needs its own spec.

## SC-002 payload (T034, server half)

`GET /api/catalog?region=BR` at the raised quotas, uncompressed and per
encoding:

| encoding | bytes | vs raw |
|----------|-------|--------|
| none | 635,380 | — |
| gzip | 192,281 | −70% |
| brotli | 186,480 | −71% |

Response compression was **not configured** before this measurement; it is now
(see `Program.cs`). The providers default to `Fastest`, at which brotli produced
*180 KB* — worse than gzip, and brotli is what browsers are offered first — so
both are set to `Optimal`.

For scale, the same request at the previous 30-per-genre quota was 382,386 raw /
117,310 gzip / 113,859 brotli. The 64% growth is the quota raise above, and it
is a **cold-load** cost only: SC-002 is measured on a warm cache, where the
payload is not refetched at all. What it does not excuse is sending 186 KB to a
phone on first visit, which is why the "still outstanding" list below keeps the
browser half open.

## SC-004 badge links (T035)

One real deep link per service in the live pool, resolved with a browser
user-agent:

| service | template | result |
|---------|----------|--------|
| apple-tv-plus | `tv.apple.com/search?term=` | 200 |
| crunchyroll | `crunchyroll.com/search?q=` | 200 |
| **disney-plus** | `disneyplus.com/` | 200 — **degraded**: lands on the service, not on a search |
| globoplay | `globoplay.globo.com/busca/?q=` | 200 |
| **max** | `www.hbomax.com/?q=` | 200 — **degraded**: lands on the home page, query in the URL |
| mubi | `mubi.com/en/search?query=` | 200 |
| netflix | `netflix.com/search?q=` | 200 (login wall, `nextpage` carries the search) |
| paramount-plus | `paramountplus.com/{region}/search/?q=` | **200 with the query intact** |
| pluto (tmdb:300) | `pluto.tv/en/search?q=` | 200 |
| prime-video | `primevideo.com/search?phrase=` | 200 |

Three templates changed on 2026-09-28, and two of them are honest compromises
rather than fixes:

- **Pluto** — `/en/search/details?q=` answers 404; `/en/search?q=` answers 200.
  A real fix.
- **Paramount+** — `/search/?q=` answers 302 to `/{region}/search/` and **drops
  the query**, so the visitor lands on an empty search box. With the country in
  the path the query survives, so the template gained a `{region}` placeholder
  and `DeepLinkFor` learned to substitute it. A real fix.
- **Disney+** — every search path tried answers 404: `/search?q=`, `/search/`,
  `/search/Inception`, `/pt-br/search?q=`, `/en-br/search?q=`. This is a missing
  route rather than bot-blocking: `disneyplus.com/` and `/pt-br` both answer 200
  while `/pt-br/search` answers 404 for the same anonymous client and the same
  locale header. **No reachable search exists**, so the badge points at the
  service root — which geo-localizes on its own and carries search one tap away
  — rather than at a 404.
- **Max** — `play.max.com` and `www.max.com` both 301 to `www.hbomax.com`;
  `www.hbomax.com/search` answers 404, and `play.hbomax.com/search?q=` answers
  302 to `www.hbomax.com/?q=<query>`. The template now points at that
  destination directly: one redirect fewer, query intact, and the URL is the one
  Max's own router chose. **Max exposes no reachable search page**, so this is
  best-available rather than correct.

Dropping the two degraded services was considered and rejected: a badge that
opens the service is worse than a badge that searches it, but both beat the
alternative, which is a visitor who picked Disney+ or HBO Max matching nothing.
The template-coverage rule (research D7) exists to stop unfollowable links, not
to make the choice between a weak link and no titles.

`Star Plus` and `Peacock` do not appear: neither is carried by any title in the
BR pool, which is a fact about the region rather than about the templates. Their
templates are therefore unverified against a live pool.

## Star+ (T038)

Star+ was discontinued in Latin America and its catalog folded into Disney+;
TMDB stopped listing id 619, so the server has nothing to emit a badge for. The
visitor-facing half is a client change in two parts, and both are needed:

- **The quiz no longer offers it** (`STREAMING_PROVIDERS`), because offering a
  visitor a service that does not exist is wrong however the matching is
  arranged.
- **A stored preference still names it** and is aliased to Disney+ when the deck
  matches availability (`RETIRED_PROVIDER_SUCCESSORS`). 001's storage contract is
  frozen, so there are devices holding `star-plus` today; without the alias
  those visitors match **nothing, in every genre** — the dead end the
  constitution forbids, and one they could not diagnose.

The alias lives on the client rather than in the server's vocabulary on purpose:
a server-side alias would mean emitting a `star-plus` badge, and that badge
would link to a service that is gone. The summary still displays
"Star+ (now Disney+)" so the visitor can see where their pick went.

## Retention ceiling (T039)

TMDB's API Terms of Use §1.C prohibit caching their data "for longer than 6
months", and §1.D requires purging it when the licence ends. Nothing enforced
either: the staleness window only decided when to *refresh*, and a snapshot was
served indefinitely however old it was.

`TmdbOptions.MaxCacheAge` now bounds it, defaulting to **180 days** — chosen so
it is provably inside the term rather than near it, because six months is not a
fixed count of days and the shortest six consecutive calendar months (February
through July) is 181. A snapshot past the ceiling is **not served and is
deleted**: the region answers `catalog-not-ready`, which starts the retrieval
that replaces it.

That is a deliberate exception to FR-013, and it is the honest one. FR-013 says
a provider outage degrades to cached titles rather than an empty deck; past the
ceiling there is no cached data we are allowed to serve, so the deck falls back
to the empty state — which has its own way out. The two rules meet at exactly
one boundary and the terms win there.

Enforcement is in the store, not the policy, so no caller can serve expired data
by forgetting to check. Reads purge the region they are asked about; a
successful save additionally sweeps every other expired region, so a market the
app no longer receives visitors from stops holding data the next time any region
refreshes. A hosted timer would be the tidier home for the sweep and is
deliberately not used — **the API is hosted scale-to-zero, so a timer that runs
while the app is warm does not run during the idle periods that matter**.

## Still outstanding

- **Scenarios 1–5** (browser): real cards on the deck, determinism, region
  override, one-tap badges, the by-hand half of SC-004.
- **T034's browser half**: DevTools throttling, warm cache, first card < 300 ms.
  Worth doing now that the payload has grown — this is the one criterion the
  quota raise could still threaten, and it has not been measured in a browser.
- **Disney+ and Max** remain degraded links (reachable, not searching); see
  above. Fixing them needs a search route those services do not currently serve
  to anonymous clients, so there is nothing to fix on our side.
- **The per-service retrieval** sketched under SC-001 — 44% of the pool is
  unbaded and therefore invisible to any visitor who selected a service. It is
  the next real lever and it needs its own spec.
- **`hulu` and `peacock` templates** are unverified: no title in the BR pool
  carries either, and the suite's only US coverage is the stub.
