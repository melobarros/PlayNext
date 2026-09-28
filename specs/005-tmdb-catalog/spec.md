# Feature Specification: Real Catalog (TMDB)

**Feature Branch**: `005-tmdb-catalog`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Real catalog: replace the bundled sample titles
with real movie and TV data from TMDB, served through our own backend. The
backend holds the TMDB credential, caches TMDB responses server-side, and
exposes catalog discovery and title detail to the client, so API keys never
ship to the client. 'Where to watch' availability comes from TMDB's
watch-provider data, scoped to the visitor's region. The visitor's ranking,
filtering and screens stay exactly as they behave now — ranking stays on the
client, deterministic as it is today. When TMDB cannot be reached, the app
degrades to previously cached titles with the existing notice rather than an
empty deck."

## Clarifications

### Session 2026-09-28

- Q: Where should the deterministic recommendation filter run once titles come
  from a real catalog? → A: The client keeps ranking; the server serves a
  region-scoped pool of titles. The PRD's "deterministic recommendation
  filtering endpoint" is deliberately not built, so ranking exists once, where
  002 put it and where it is already tested.
- Q: Where should "where to watch" availability come from? → A: The catalog
  provider's own watch-provider data, already JustWatch-powered and scoped per
  region. No second vendor and no second credential.
- Q: The provider publishes one watch page per title per region, not one link
  per service — what should tapping a service badge do? → A: Open that service
  searching for that title, from a per-service template this feature owns. The
  one-tap promise 002 made is kept; the templates are ours to maintain.
- Q: The provider has no "anime" media type — what decides that a title is
  anime? → A: Animation with a Japanese original language. A Japanese animated
  series classifies as anime rather than a series, which is what the quiz's
  three-way choice has implied since 001.
- Q: When a card renders poster artwork, may the browser load the image
  directly from the catalog provider's public image CDN, or must every image
  also pass through our own API? → A: Direct CDN. Poster artwork loads straight
  from the provider's public image CDN — it is static media, needs no
  credential, and is designed to be hotlinked. FR-001's "must not contact the
  provider" applies to catalog data only.
- Q: Should this slice build a separate title-detail endpoint that the detail
  view calls by title id, or does the fetched title pool carry full detail so
  no second request is ever needed? → A: Pool carries full detail. The region
  pool includes everything a card and the detail view render, so rendering a
  title's detail never requires a second request and no `/catalog/{id}`
  endpoint exists in this slice.
- Q: How does the app determine the visitor's region for the catalog request?
  → A: Browser locale. The device's language-region (for example, "pt-BR") is
  mapped to a country code and sent with every catalog request — no permission
  prompt, no cost, works for guests. When none can be derived, the existing
  default-region edge case applies.
- Q: The quiz offers a fixed set of 12 streaming services, but the provider's
  availability data names many more — what should a card show when a title is
  available only on a service the quiz doesn't offer? → A: Show every real
  service. The 12 keep their ids so stored preferences keep matching; services
  outside them are added to the server-side mapping vocabulary as they appear.
  Badges describe reality, and the deck's filter treats a non-quiz service as
  "other platforms" via the existing toggle.
- Q: The spec assumes metadata comes in a single language for this slice —
  which language is it? → A: English everywhere. Metadata is requested in
  English for all regions: the app's UI is already English, English is the
  provider's most complete metadata language, and no region-to-language mapping
  is needed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The deck offers real, watchable titles (Priority: P1)

A visitor answers the quiz and the deck deals them cards drawn from the whole
of film and television, not from a list of fifty samples compiled into the app.
Whatever they pick — documentaries, anime, a service they actually pay for —
there is something behind it with a real synopsis, a real year, a real rating,
and a real poster.

**Why this priority**: The deck *is* the product. A bundled sample makes
PlayNext a demonstration of a recommendation engine rather than a
recommendation engine, and it caps every downstream feature: the watchlist can
only hold what the deck showed, and the quiz's filters can only be as good as
the titles available to filter. Nothing else in this feature delivers user value
without this.

**Independent Test**: Complete the quiz with any combination of answers and
confirm the deck offers titles that are not among the bundled samples, each with
synopsis, release year, rating, and a poster.

**Acceptance Scenarios**:

1. **Given** a guest who has completed the quiz, **When** the deck loads,
   **Then** the cards carry real titles with real synopses, years, ratings and
   posters.
2. **Given** a visitor whose answers select a genre and a set of services,
   **When** the deck loads, **Then** the titles offered come from the real
   catalog rather than the bundled sample, and the existing filters and ranking
   behave exactly as they did before.
3. **Given** the same quiz answers and the same catalog, **When** the deck is
   loaded twice, **Then** the same first card appears — ranking remains
   deterministic (002 FR-011).

---

### User Story 2 - "Where to watch" is true for my region (Priority: P2)

A visitor in Brazil and a visitor in the United States looking at the same film
see different services, because the film is on different services in those two
countries. The badges on a card, the ways-to-watch list on the detail view, and
the link the visitor taps all reflect availability where they actually are.

**Why this priority**: Availability is the promise the whole product rests on —
"only show me things I can watch tonight". A badge that names a service the
visitor cannot use is worse than no badge: it is the dead end the constitution
forbids, and it costs them a tap to discover. It is P2 rather than P1 only
because the deck still functions while the badges are wrong.

**Independent Test**: Open a title known to stream on a named service in the
visitor's region and confirm the badge and its link are right; then confirm a
title unavailable in that region carries no badge for a service that does not
carry it.

**Acceptance Scenarios**:

1. **Given** a title streaming on a named service in the visitor's region,
   **When** its card or detail view renders, **Then** that service appears with
   a link to the service's own page for the title.
2. **Given** the same title in a region where that service does not carry it,
   **When** the title renders, **Then** that service does not appear.
3. **Given** a title carried by no service in the visitor's region, **When**
   the deck ranks it, **Then** the deck's existing provider filter decides
   whether it is eligible — the card itself still renders and degrades to
   title plus metadata rather than hiding.

---

### User Story 3 - The catalog survives the catalog provider being unavailable (Priority: P3)

The catalog comes from a third party that can be slow, rate-limited, or down.
None of that is the visitor's problem: they still get cards, and when the cards
are not fresh the app says so rather than presenting stale titles as live ones.

**Why this priority**: It is the difference between a bad minute and an outage.
It is P3 rather than higher because it only matters when something else has
already gone wrong — but "already gone wrong" is a scheduled event for any
dependency, and the PRD names it as an edge case with defined behaviour.

**Independent Test**: With the upstream catalog unreachable, confirm the deck
still renders titles from the last successful fetch and carries the existing
cached-titles notice; with no successful fetch ever, confirm the existing empty
state with its way out.

**Acceptance Scenarios**:

1. **Given** the catalog was fetched successfully at some point, **When** the
   upstream provider cannot be reached, **Then** the deck still renders titles
   and the app tells the visitor they are cached rather than live.
2. **Given** the upstream provider has never been reached, **When** the deck
   loads, **Then** the visitor sees the existing empty state with its way out —
   never an endless spinner and never an error screen.
3. **Given** one failed upstream fetch, **When** the next visitor loads the
   deck, **Then** the failure has not replaced or poisoned catalog data that was
   previously good.

---

### Edge Cases

- **A stored rating whose title is no longer in the catalog.** Title identity
  changes with this feature, so ratings and watchlist entries saved against the
  retired sample ids will reference titles that no longer exist. The watchlist
  must render those rows rather than dropping them or crashing; it already has
  the tolerant behaviour this needs, and this feature must not remove it.
- **A title with no poster** → the generated placeholder (002 FR-016), not a
  broken image.
- **A title with no trailer** → Match Found works with or without one (002 FR-008,
  US2 scenario 4).
- **A title missing runtime, or with no rating yet** (a new release) → the card
  degrades to what it has.
- **A title the provider classifies in genres the quiz does not offer**
  (Adventure, Crime, Family, Mystery) → the title must remain reachable; a genre
  a visitor cannot pick must never make a title unreachable.
- **A service the visitor selected that carries nothing in their region** →
  their filters match nothing and the existing empty state explains why, rather
  than the deck appearing broken.
- **A title carried only by a service outside the quiz's fixed set** → the
  badge still names that service, because availability is the provider's claim;
  the deck's filter treats such a service as "other platforms" (the existing
  toggle), since the visitor could not have selected it.
- **The visitor's region cannot be determined** → the app's existing default
  region applies, and the badges describe that region honestly.
- **Two titles with the same name and year** (a remake, a same-named series) →
  they remain distinct entries, because identity is the provider's id rather
  than the name.
- **Upstream rate limiting** → absorbed by the server-side cache; a visitor
  swiping through cards must never see it.
- **A service's search template no longer resolving** (the service renamed a
  path, or shut down) → the badge still renders, because availability is the
  provider's claim and not the template's; but a template that fails is a
  defect this feature owns rather than an accepted cost, and SC-004 samples for
  it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The catalog MUST be served to the client by our own API. The
  client MUST NOT contact the catalog provider for catalog data. Poster
  artwork is the one exception: it is static media on the provider's public
  image CDN, needs no credential, and the browser loads it directly from
  there.
- **FR-002**: The catalog provider's credential MUST remain server-side. It
  MUST NOT appear in the client bundle, in any API response, or in any log.
- **FR-003**: The API MUST cache upstream catalog responses server-side, so
  that browsing many cards does not cause many upstream requests.
- **FR-004**: The API MUST bound how stale a cached catalog may be, and refresh
  it once that bound is passed.
- **FR-005**: The catalog MUST be scoped to the visitor's region, and the region
  MUST be an input to the catalog request rather than a filter over a fixed
  list. The region sent is derived from the visitor's device language-region,
  such as "pt-BR" for Brazil.
- **FR-006**: A title's availability MUST be the services that actually carry it
  in the visitor's region.
- **FR-007**: Tapping a service badge MUST open **that service**, searching for
  that title, so a badge stays one tap from watching. The catalog provider
  publishes one watch page per title per region rather than one link per
  service, so these links are assembled from a per-service template that this
  feature owns and maintains.
- **FR-008**: The catalog MUST exclude adult content.
- **FR-009**: Titles MUST retain the shape the deck and watchlist already
  consume — identifier, name, release year, media type, genres, synopsis,
  rating, vote count, runtime, trailer, poster, availability — so that no screen
  changes shape because the catalog became real.
- **FR-010**: Genre and service identity MUST remain the vocabulary spec 001
  defined for the genres and services 001 already names, so that preferences
  already saved on visitors' devices keep matching real titles. Preferences
  stored before this feature MUST NOT silently stop matching. Services outside
  the quiz's fixed set are not dropped: they enter the server-side mapping
  vocabulary as new entries, so a card's badges can name every service that
  actually carries the title.
- **FR-011**: The deck's filtering and ranking MUST remain on the client and
  MUST remain deterministic (002 FR-011). This feature changes where titles come
  from, not how they are chosen.
- **FR-012**: When the upstream provider cannot be reached, the API MUST serve
  the last catalog it successfully retrieved rather than an error, so the client
  can degrade to cached titles with the existing notice.
- **FR-013**: A failed upstream request MUST NOT discard or overwrite catalog
  data that was previously retrieved successfully.
- **FR-014**: When no catalog has ever been retrieved, the client MUST show its
  existing empty state with its way out, not an endless loading state and not an
  error screen.
- **FR-015**: A stored rating or watchlist entry whose title is absent from the
  catalog MUST remain visible in the watchlist rather than being dropped.
- **FR-016**: A title MUST be classified as anime when it is animation **and**
  its original language is Japanese. The catalog provider has no anime media
  type, so this rule is what the quiz's third choice means: a Japanese animated
  series is anime rather than a series, and animation from anywhere else is not
  anime.
- **FR-017**: Titles with no poster, no trailer, no runtime, or no rating MUST
  degrade to what they have, never break the card.
- **FR-018**: The app MUST display the catalog provider's required attribution.
- **FR-019**: A single deck session MUST NOT cause one upstream request per
  card; the pool a deck session draws on MUST be retrieved in a bounded number
  of upstream calls.
- **FR-020**: The region pool MUST carry complete title detail — everything a
  card and the detail view render — so that showing a title's detail never
  requires a second request. No separate title-detail endpoint exists in this
  slice.

### Key Entities *(include if feature involves data)*

- **Catalog title**: what the deck consumes and the watchlist looks up. Its
  identity is the provider's identifier *plus* its media type, because the
  provider reuses identifiers across types; its name is not an identity, because
  remakes and same-named series exist. Carries everything a card and a detail
  view already render.
- **Availability entry**: one service carrying one title in one region, with the
  link the visitor taps. An empty set is normal, not an error.
- **Region**: the visitor's country. It stops being a filter applied to a fixed
  list and becomes an input to the catalog request.
- **Catalog snapshot**: the server's retained copy of what was last retrieved
  for a region, with the age that decides when it is refreshed. It is what makes
  the outage story work, and it is not a second source of truth — it is a cache
  of the provider's.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A visitor who filters to one genre and the services they selected
  is offered at least 20 distinct titles, **for any selection of three or more
  services** — today the sample catalog cannot offer that for most
  combinations. Below three services the number is bounded by what those
  services carry in the visitor's region rather than by this catalog: a
  Netflix-only visitor in BR is offered 8 horror titles out of a pool of 916,
  and no pool size changes that, so the criterion is stated for the part the
  catalog controls. Measured against the live provider on 2026-09-28; the
  genre-by-service table is in
  [quickstart.md](./quickstart.md#sc-001-volume-t033).
- **SC-002**: The first card renders within 300 ms of the deck opening on a warm
  cache, measured over a 4G connection (PRD performance target).
- **SC-003**: A visitor who views 50 cards in one session causes no more than
  one upstream catalog fetch.
- **SC-004**: For a sample of 10 titles checked by hand against the services'
  own pages, 10 of 10 availability badges name a service that still carries the
  title in the visitor's region.
- **SC-005**: 100% of deck loads with the upstream provider unreachable render
  cards from the last successful fetch, or the empty state if there was none —
  never an error screen.
- **SC-006**: Searching the built client bundle and a sample of server logs
  finds zero occurrences of the provider credential.
- **SC-007**: Every acceptance scenario in 001–003 that passes today still
  passes — the quiz, the deck loop, ratings, and the watchlist are unchanged
  from the visitor's point of view.

## Assumptions

- **Ranking stays on the client** (decided 2026-09-28). The server serves a
  region-scoped pool of titles and the deck ranks it, exactly as it ranks the
  sample today. The PRD's "deterministic recommendation filtering endpoint" is
  deliberately not built: ranking exists once, in the client, where 002 put it
  and where it is already tested.
- **The server returns a bounded pool rather than the whole catalog** — on the
  order of 900 titles per region, taken from the provider's popularity ranking.
  This is the number that makes SC-001 reachable without making the response
  large; it is a tuning parameter, not a contract. It was raised from 540 to 916
  on 2026-09-28 once SC-001 was measured rather than assumed, and once response
  compression had made the extra bytes affordable (quickstart.md).
- **Genre and service identity stays spec 001's vocabulary, translated
  server-side.** This deliberately breaks a stated invariant — 001's model
  comment says "there is no mapping table anywhere in the codebase" — because
  001's identifiers are written into preferences already stored on visitors'
  devices by the frozen 001 storage contract. Adopting the provider's numeric
  identifiers instead would silently orphan those preferences. The mapping table
  therefore exists, on the server, and retiring that invariant is a deliberate
  part of this feature rather than an oversight. The quiz's twelve service ids
  are preserved verbatim; services outside them enter the mapping vocabulary as
  new entries, never merged into an existing id.
- **Title identity becomes the provider's identifier plus media type**, and the
  bundled sample's identifiers retire with the sample. Ratings stored against
  them degrade to the title-less watchlist row the watchlist already tolerates.
- **The bundled sample catalog is retired from the deck.** It is not kept as an
  offline seed: sample titles presented as real ones would be a worse lie than
  the empty state, which already exists and already offers a way out.
- **The quiz's own option lists — genres and services — are not served by the
  backend in this slice.** They stay as they are. The consequence is accepted:
  a visitor may filter to a service the provider does not carry in their region,
  and the existing empty state explains the result.
- **Metadata is requested in a single language — English — for this slice.**
  The app's UI is already English, English is the provider's most complete
  metadata language, and the quiz has no language filter yet, so there is no
  second language to serve.
- **The provider credential is obtained out of band and stored with the other
  secrets.** The feature is non-functional without it, and must say so rather
  than fail obscurely.
- **This slice does not include** offline-first catalog storage on the device,
  user-visible catalog search, cast lists, or trending/personalised discovery
  beyond the provider's popularity ranking.
