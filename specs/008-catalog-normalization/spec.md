# Feature Specification: Normalized Catalog & Per-Service Pools

**Feature Branch**: `008-catalog-normalization`

**Created**: 2026-10-23

**Status**: Draft

**Input**: User description: "Normalize the TMDB catalog into queryable PostgreSQL tables and use them to build per-service candidate pools. Today the catalog is one JSON snapshot per region; ratings and history reference opaque title ids with no foreign key. The refactor must keep the deck's behavior identical for a fixed catalog version, migrate existing snapshots without data loss, and preserve the existing API contract while the new path is behind a feature flag. After parity, the catalog refresh must fetch and store availability per selected service and region so that a service + genre combination (for example Netflix + horror in BR) returns a deep pool instead of the current sample. The catalog remains server-side; no TMDB credentials reach the client. Data older than the provider's retention limit must be purged. Per-service depth from the former spec 007 is part of this feature."

## Clarifications

### Session 2026-10-23

- Q: How should the deck request the deeper per-service pool while keeping today's catalog response contract? → A: Add optional service, genre, and media-type filters to the existing catalog request; the response shape stays unchanged, and a request with no filters keeps today's general pool. The deck sends the quiz selections; the server narrows the candidate set while ranking and final filtering remain on the client.
- Q: What per-service depth should the refresh target, and therefore bound the catalog's size? → A: 300 titles per service, genre, and media type, bounded by the provider's actual depth. The target sets the refresh cap; where the provider carries fewer, the provider's full depth is the pool.
- Q: How should the watchlist resolve a rated title that came from a per-service pool but is not in the general catalog pool? → A: Add an optional `ids` filter to the catalog request. The watchlist sends the ids from the interaction document in one request and receives those titles regardless of which pool they came from; the stored interaction document is unchanged.
- Q: While the normalized catalog serves traffic, should the old snapshot keep being refreshed as a live rollback path? → A: Yes. Every successful general-pool refresh also writes the snapshot, so a rollback serves data no older than the last successful refresh, with no independent provider fetch.
- Q: When a refresh succeeds for some service/region slices and fails for others, what should readers see for the failed slices? → A: Promote a mixed version: successful slices carry their new data, failed slices carry their last-known-good data into the same complete version, and readers never see a partial catalog.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The storage change is invisible (Priority: P1)

The catalog moves out of its one-document-per-region shape and into structured
records that can be queried, but nobody visiting PlayNext can tell. For a fixed
catalog version, the same quiz answers produce the same cards in the same order.
Ratings, swipes, history, watchlist entries, and preferences saved before the
move still point at the same titles afterwards. If anything looks wrong, the
operator can put the old path back without shipping code.

**Why this priority**: The catalog is the data every other feature stands on.
A change to how it is stored reaches the deck, ratings, history, the watchlist,
and every account merge. A behavior difference during that change is
indistinguishable from a product regression, and user data lost in the move
cannot be recovered. Parity is the precondition for every later improvement —
including the deeper per-service pools in US2, which are only safe to build on
top of a catalog proven to behave exactly as it does today.

**Independent Test**: Freeze one catalog version. For a representative set of
quiz answers, record the eligible titles and their order before the migration.
Run the migration, serve the same frozen version from the new storage, and
compare. Then confirm a sample of ratings, history entries, and watchlist
entries created before the migration still resolve to the same title. Finally,
flip the configuration back and confirm the old path serves the same deck.

**Acceptance Scenarios**:

1. **Given** a fixed catalog version and any completed quiz, **When** the deck
   loads before and after the migration, **Then** the same titles are eligible
   and appear in the same order.
2. **Given** a visitor with saved ratings, history, watchlist entries, and
   preferences, **When** the catalog is migrated, **Then** every saved record
   still resolves to the same title and remains visible exactly as before.
3. **Given** the normalized catalog is serving the deck, **When** an operator
   switches the catalog source back by configuration, **Then** the previous
   path serves reads again without a code deployment.
4. **Given** a rating whose title is not present in the normalized catalog,
   **When** the watchlist renders, **Then** the row still appears with the
   tolerant behavior spec 005 already guarantees.

---

### User Story 2 - A service's depth comes from that service (Priority: P2)

A visitor who picks horror and says they have Netflix gets a deck drawn from
what Netflix actually carries in Brazil, not eight horror titles left over from
a general popularity sample. If the same film is on Netflix and Max and the
visitor selected both, it appears once with both badges. A title that only
lives on a service they did not select stays out of the deck unless they turn on
"Show content on other platforms."

**Why this priority**: This is the defect that motivated the feature. The
catalog today collects popular titles first and checks availability afterwards,
so a service + genre combination is only as deep as the overlap between a
general sample and that service's catalog. Measured on 2026-10-23: 917 titles
in Brazil, of which Netflix + horror is 8 and Max + horror is 15. The deck is
the product, and for a visitor with a specific taste and a specific service it
runs dry almost immediately. It is P2 rather than P1 because it is an
improvement to a working deck, whereas a parity break would be a regression in
the working deck.

**Independent Test**: Select one service and one genre with known depth, load
the deck, and count the eligible titles. Confirm the anchor combination
(Netflix + horror in BR) reaches at least 300 distinct titles, up from 8, or the
provider's full depth if lower. Confirm a title available on two selected
services appears once with both services, and that a title available only
outside the selection is excluded unless the "other platforms" toggle is on.

**Acceptance Scenarios**:

1. **Given** a visitor who selects Netflix and horror in Brazil, **When** the
   deck loads, **Then** the eligible pool contains at least 300 distinct titles,
   or the provider's full depth if lower.
2. **Given** a title carried by two services the visitor selected, **When** it
   is dealt, **Then** it appears once and shows both services.
3. **Given** a title carried only by a service the visitor did not select,
   **When** the deck ranks it, **Then** it is excluded while "Show content on
   other platforms" is off, and eligible when it is on.
4. **Given** a service and genre for which that service genuinely carries
   nothing in the region, **When** the deck loads, **Then** the existing empty
   state explains why rather than the deck appearing broken.
5. **Given** a title reached through a per-service pool, **When** its card and
   detail view render, **Then** they carry the same complete detail as before
   and need no second request.

---

### User Story 3 - The catalog refreshes, fails, and forgets safely (Priority: P3)

The catalog is rebuilt on a schedule, one service and region at a time. If one
slice fails, the last known good data for that slice stays in service while the
other slices update. Visitors browsing during a refresh never see a half-written
catalog. Catalog data that has passed the provider's retention limit is purged,
while the visitor's own ratings and history survive.

**Why this priority**: Per-service fetching multiplies the number of upstream
calls and the number of ways a refresh can fail. The catalog also carries a
legal retention limit, so it must be able to forget without forgetting the
visitor. It is P3 because the deck still works until one of these things goes
wrong — but "eventually goes wrong" is certain for a third-party dependency,
and a failure that poisons the catalog would take the deck down with it.

**Independent Test**: Run a refresh and confirm deck reads stay consistent
throughout. Make one service/region slice fail and confirm its last good data
remains while other slices update and the failure is reported. Seed catalog
data older than six months, run the purge, and confirm it is removed while
ratings and history remain readable. Interrupt a refresh and confirm a rerun
completes without duplicates.

**Acceptance Scenarios**:

1. **Given** a scheduled refresh is running, **When** visitors load the deck,
   **Then** they see a consistent last-known-good catalog and never a partial
   one.
2. **Given** one service/region slice fails during a refresh, **When** the
   refresh ends, **Then** that slice keeps its last good data and the other
   slices' new data in the same promoted version, and the failure is reported.
3. **Given** catalog data whose last successful observation is older than the
   provider's retention limit, **When** the purge runs, **Then** that catalog
   data is removed and every stored rating, history entry, and watchlist entry
   remains readable.
4. **Given** a refresh interrupted partway through, **When** it runs again,
   **Then** it completes without duplicate titles or availability entries.
5. **Given** the provider has been unreachable since the last good refresh,
   **When** the deck loads, **Then** the existing cached-catalog notice applies;
   if no catalog has ever been retrieved, the existing empty state applies.

---

### Edge Cases

- **A title carried by two selected services** → one card, both services shown.
  Identity is the title, not the availability entry.
- **A title drops off every service in a region** → it leaves the per-service
  pools. A visitor who already rated it keeps the rating and watchlist row.
- **A title leaves the provider entirely** → its catalog rows age out under the
  retention purge; user records that reference it remain readable.
- **An unknown service id appears in provider data** → it is stored as data and
  named on the badge where it is shown, rather than dropping the availability
  entry. Services outside the quiz keep working as "other platforms."
- **The same numeric id exists as both a film and a series** → identity includes
  the media type, as in 005; they remain distinct titles.
- **A refresh fails for one service or region** → the last good data for that
  slice remains; the other slices still update; the failure is recorded.
- **A refresh runs while visitors read** → readers stay on the current version
  until the new version has data for every slice, then the new version is
  promoted in one step.
- **Two refreshes overlap** → one runs, the other is skipped or deferred; writes
  never interleave into a mixed catalog.
- **The migration is interrupted** → it is idempotent and resumable; rerunning
  completes it without duplicates and without deleting anything already
  imported.
- **The existing snapshot for a region is missing or malformed** → the
  migration refuses that region, records why, and leaves existing user data
  untouched; a fresh refresh can rebuild the region.
- **A rating references a title absent from the catalog** → the watchlist row
  still renders, exactly as 005 FR-015 requires.
- **A service plus genre genuinely has no titles in the region** → the existing
  empty state with its way out; an empty pool is normal, not an error.
- **The provider rate-limits a refresh** → requests are paced and retried; the
  refresh keeps its partial progress, and last-known-good data stays in service.
- **The provider has been unreachable for longer than the retention limit** →
  the stale catalog is purged anyway; the existing empty state takes over. The
  legal retention limit wins over keeping stale data.
- **A visitor has "Show content on other platforms" on** → the general pool
  still supplies titles outside the selected services; per-service pools do not
  remove that behavior.
- **A region has never been refreshed** → the existing empty state, never an
  endless spinner and never an error screen.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The catalog MUST be stored as structured, queryable records for
  titles, genres, services, and availability, so that the system can answer
  "titles on service X in region Y in genre Z" without loading an entire
  region's catalog into memory.
- **FR-002**: Title identity MUST be stable and shared by the catalog, ratings,
  history, watchlist entries, and preferences. Titles that exist today MUST keep
  their current identifiers; the migration MUST NOT renumber them.
- **FR-003**: The system MUST be able to produce a candidate pool directly for a
  combination of services, genre(s), media type, and region, without first
  enumerating unrelated titles.
- **FR-004**: The existing catalog response MUST remain backward compatible.
  Existing clients that send no filters MUST continue to receive today's general
  pool and render unchanged, and the screens MUST NOT change shape. The deck MAY
  send the optional filters defined in FR-027.
- **FR-005**: The migration of existing snapshots MUST be idempotent and
  resumable, and MUST produce no duplicate titles, no lost titles, and no lost
  availability entries.
- **FR-006**: The migration MUST preserve every existing rating, history entry,
  watchlist entry, and preference. None may be deleted, orphaned, or made
  unreadable by the change.
- **FR-007**: The active catalog source MUST be switchable by configuration at
  runtime, without a code deployment. Switching back MUST make the previous
  source serve reads again without a deployment.
- **FR-008**: For a fixed catalog version and the same quiz answers, the
  eligible titles and their order MUST be identical before and after
  normalization. Parity is measured before per-service enrichment, because
  enrichment changes the pool by design.
- **FR-009**: The catalog refresh MUST build per-service candidate pools by
  querying each service's own catalog in each active region, not by filtering a
  general popularity sample after the fact.
- **FR-010**: The refresh MUST continue to maintain the general region pool
  alongside the per-service pools, so the existing "Show content on other
  platforms" behavior and titles outside the quiz's services keep working.
- **FR-011**: A title available on more than one selected service MUST appear
  once in a pool, carrying all of its services, rather than once per service.
- **FR-012**: Each availability entry MUST record the service, the region, the
  monetization type (for example included with a subscription, free, or
  ad-supported), and the link the visitor taps. The existing per-service link
  templates from 005 continue to apply.
- **FR-013**: A refresh failure for one service or region MUST NOT discard or
  overwrite the last good data for that slice, and MUST NOT prevent other
  slices from updating.
- **FR-014**: Readers MUST always see a consistent catalog version. A refresh
  promotes a mixed version: successful slices carry their new data, failed or
  skipped slices carry their last-known-good data into the same version. An
  in-progress, interrupted, or failed refresh MUST NOT expose a partial catalog.
- **FR-015**: Catalog data whose last successful observation is older than the
  provider's retention limit (six months today) MUST be purged automatically.
- **FR-016**: The purge MUST NOT delete titles referenced by ratings, history,
  or watchlist entries. A retired title MUST remain readable to the visitors who
  already have it, but MUST NOT be recommended as new.
- **FR-017**: The provider credential MUST remain server-side. It MUST NOT
  appear in the client bundle, in any API response, or in any log.
- **FR-018**: Every refresh MUST record operational status: when it last
  succeeded, how long it took, how many titles and availability entries it
  produced per service and region, and which slices failed.
- **FR-019**: Each availability entry MUST record when it was last observed and
  which service and region it describes. A catalog title MUST also record when
  it was last observed even when it has no availability entries, so freshness
  and retention can be evaluated from the data itself.
- **FR-020**: The catalog model MUST support multiple regions. Brazil is the
  only active region today, and no behavior may assume a single region.
- **FR-021**: Services and genres MUST be data, not fixed in the storage
  structure. Adding a service or a genre MUST NOT require a schema change, and
  the quiz's existing identifiers MUST remain valid.
- **FR-022**: The normalized catalog MUST preserve every title attribute the
  card and detail view render — name, release year, media type, genres,
  synopsis, rating, vote count, runtime, trailer, poster, and availability — so
  no screen changes shape.
- **FR-023**: Per-service depth MUST be bounded both by a configured target of
  300 titles per service, genre, and media type, and by what the provider
  actually reports. The system MUST NOT invent availability or pad a pool with
  titles the service does not carry.
- **FR-024**: Where a service genuinely carries a genre deeply in a region, the
  refresh MUST page deeply enough to meet the configured target. The anchor is
  Netflix + horror in Brazil at 300 or more distinct titles, or the provider's
  full depth if lower, against a measured baseline of 8 on 2026-10-23.
- **FR-025**: This feature MUST NOT change ranking weights, filter rules, quiz
  content, or any client-visible recommendation behavior. It changes what the
  pool is and how it is stored, not how titles are chosen.
- **FR-026**: The existing degradation behavior MUST be preserved: when the
  provider is unreachable, serve the last-known-good catalog with the existing
  notice; when there has never been a catalog, show the existing empty state.
- **FR-027**: The existing catalog request MUST accept optional service, genre,
  and media-type filters, so the deck can request the pool matching the
  visitor's quiz selections. The response payload shape MUST stay the same, and
  a request without filters MUST keep today's behavior. The server narrows the
  candidate set only; ranking and the final filter decision remain on the
  client.
- **FR-028**: The catalog request MUST accept an optional set of title ids, so
  the watchlist can resolve the titles a visitor has rated in one request. The
  response shape MUST stay the same, and an id MUST resolve to its title
  regardless of which catalog pool supplied it.
- **FR-029**: While the normalized catalog is active, every successful
  general-pool refresh MUST also refresh the snapshot, so the rollback path is
  never older than the last successful refresh. The snapshot MUST NOT require an
  independent provider fetch.

### Key Entities *(include if feature involves data)*

- **Catalog title**: a film or series the deck can offer. Its identity is the
  provider's identifier plus its media type, and it is shared with every user
  record that references it. Carries everything a card and the detail view
  render, plus the time it was last observed.
- **Genre**: a controlled vocabulary shared with the quiz and with stored
  preferences. The quiz's existing genre identifiers remain valid.
- **Service**: a streaming service that can carry a title in a region. It has a
  stable identifier, a display name, a quiz identifier where it is one of the
  twelve, and the link template used when a visitor taps its badge.
- **Availability entry**: one service carrying one title in one region, with its
  monetization type, the link the visitor taps, and the time it was last
  observed. An empty set is normal, not an error.
- **Region**: the visitor's country. It is an input to catalog queries and
  refresh scopes, not a filter over a fixed list.
- **Catalog version**: one complete, consistent view of the catalog that readers
  see. A refresh produces a candidate version in which every slice carries
  either fresh data or its last-known-good data, and only a version with data
  for every slice replaces the one in service.
- **Refresh run**: one execution of the catalog refresh, with its scope, start
  and finish, per-slice counts, and failures. It is what makes a failed slice
  explainable.
- **Existing user records**: ratings, history entries, watchlist entries, and
  preferences. They already reference title identity; this feature makes that
  relationship explicit and non-destructive, and never deletes them.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a representative matrix of at least 100 quiz combinations
  spanning media types, genres, and service selections, 100% produce the same
  eligible titles in the same order before and after normalization, on the same
  catalog version.
- **SC-002**: Netflix + horror in Brazil offers at least 300 distinct titles,
  up from 8 measured on 2026-10-23, and Max + horror offers at least 300, up
  from 15 — or the provider's full reported depth where that is lower.
- **SC-003**: 100% of a sample of at least 50 ratings, 50 history entries, and
  50 watchlist entries created before the migration remain readable and attached
  to the same title afterwards.
- **SC-004**: In 100% of sampled cases, a title carried by two selected services
  appears once and shows both services.
- **SC-005**: Switching the catalog source back takes under 5 minutes, requires
  only a configuration change and no deployment, and 100% of deck loads after
  the switch are served by the previous source without errors.
- **SC-006**: With one service/region slice failing during a refresh, 100% of
  requests are served the last-known-good data for that slice inside the newly
  promoted version, and every other slice's new data is in that same version.
- **SC-007**: The purge removes 100% of catalog data whose last observation is
  older than six months while 100% of stored ratings, history entries, and
  watchlist entries remain readable.
- **SC-008**: The first card renders within 300 ms of the deck opening on a warm
  cache after normalization, measured over a 4G connection (the constitution's
  budget).
- **SC-009**: Searching the built client bundle, a sample of API responses, and
  a sample of server logs finds zero occurrences of the provider credential.
- **SC-010**: A full refresh of every active service and region completes within
  60 minutes, and a refresh running during peak traffic causes zero
  visitor-visible errors and zero incomplete deck loads.
- **SC-011**: Every acceptance scenario in 001–005 that passes today still
  passes — the quiz, the deck loop, ratings, the watchlist, and the catalog
  screens are unchanged from the visitor's point of view.
- **SC-012**: For the same catalog version, a catalog request with no filters
  returns today's general pool, and a targeted request returns only titles
  matching the requested services, genres, and media type. Both use the same
  response shape, so an existing client can consume either without changes.
- **SC-013**: The watchlist resolves 100% of rated titles that exist anywhere in
  the catalog, including titles outside the general pool, using one catalog
  request per load.
- **SC-014**: After any successful general-pool refresh, the rollback snapshot
  is no older than that refresh, and a switch back serves it without an
  additional provider call.

## Assumptions

- **The existing per-region snapshot remains the fallback and the migration
  source.** It is retired only after parity is accepted and the normalized path
  has served production traffic, and it is refreshed from the normalized general
  pool for as long as the switch exists. This is what makes the runtime switch
  and the rollback possible without a second upstream fetch.
- **Parity is measured on the same catalog version, before per-service
  enrichment.** Enrichment deliberately changes the pool; comparing a normalized
  catalog against an enriched one would compare two different products.
- **Per-service refresh covers the services the quiz offers.** The general
  popularity pool continues to exist for titles outside those services and for
  the "Show content on other platforms" behavior. This feature does not turn
  every service on earth into a separately refreshed slice.
- **Title identifiers do not change.** The existing `tmdb:{movie|tv}:{id}` form
  remains the shared identity, so ratings, history, and watchlist entries keep
  resolving without a data rewrite. Adding a foreign key does not mean
  renumbering.
- **The retention limit is six months**, the provider's current limit. The purge
  runs at least as often as the limit, so in normal operation it removes only
  data that has already left the catalog — never current data.
- **Brazil is the only active region.** The model supports more, but turning on
  another region is a separate product decision and is out of scope.
- **Metadata stays in English**, per the 005 decision, and availability keeps the
  same monetization scope as today (included with a subscription, free, and
  ad-supported).
- **The provider's rate limits allow a paced full refresh.** No second provider
  is introduced, and no new credential is required.
- **Ranking, filtering, and the quiz stay exactly as they are.** The client
  continues to rank and enforce the final filter over the pool it receives; the
  server only narrows the candidate set using the visitor's selected services,
  genres, and media type, so the payload stays bounded. This feature does not
  move ranking or the final filter decision to the server. A request without
  filters keeps today's general pool, and the previous catalog source may ignore
  the optional filters during a rollback; the client's own filtering keeps the
  deck correct either way.
- **The migration can run online.** Visitors keep using the snapshot while the
  normalized catalog is built and verified; the switch is a configuration
  change, not a maintenance window.
- **The project remains non-commercial.** The free provider key is valid only
  while PlayNext earns nothing; this feature adds no ads, affiliate links, or
  paid placements. No machine-learning pipeline is introduced (constitution
  Principle VI).
- **The configured depth target is 300 titles per service, genre, and media
  type.** It bounds the refresh so the catalog cannot grow without limit, and it
  never overrides what the provider actually reports; where the provider carries
  fewer, the provider's full depth is the pool. At the target, a full Brazil
  refresh is expected to hold on the order of 10,000–20,000 unique titles.

## Out of Scope

- Any change to ranking weights, scoring formulas, or filter rules (feature 010
  and later).
- Advanced user-facing filters.
- Changes to the quiz's genres, services, or wording.
- Rebuilding the catalog UI, deck, detail view, or watchlist.
- Monetization, ads, affiliate links, or sponsored placements.
- Machine learning, embeddings, or collaborative filtering.
- Enabling additional regions beyond proving that the model supports them.
- A per-title detail endpoint. The watchlist's batch id lookup is part of the
  existing catalog request, not a separate per-title endpoint. Offline catalog
  storage, cast lists, and user-visible catalog search are also out of scope.
- Real-time availability. The catalog is refreshed on a schedule, not live.
