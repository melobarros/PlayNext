# Feature Specification: Per-Service Catalog Retrieval

**Feature Branch**: `007-per-service-catalog`

**Created**: 2026-10-03

**Status**: Draft

**Input**: User description: "lets go with B and use this plan then, looks good" — Option B from the 2026-10-03 analysis: build each region's pool from what each of the quiz's streaming services actually carries, serve each visitor the slice their own selection can reach, and keep the general popularity pool so the "show other platforms" opt-in still works.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The deck's depth comes from my services, not from a sample (Priority: P1)

A visitor who answers "horror, on Netflix" gets a deck drawn from what Netflix
actually carries in their region — hundreds where there are hundreds — instead
of the eight their preference happened to intersect a popularity sample of 916
titles. The deck stops running dry because the catalog stops guessing: it asks
the provider what each service carries, instead of collecting popular titles
and checking afterwards which ones happen to be on a service.

**Why this priority**: This is the measured defect. "Netflix + horror" is 8 of
916; growing the sample 540 → 916 moved it 2 → 8, and reaching 20 by that route
would need roughly 2,000 titles. The catalog was never asking the question the
visitor asks. Everything else in this feature exists to make this story
affordable and safe.

**Independent Test**: Select one service and one genre; confirm the eligible
set is the depth the provider reports for that service and genre in the region
(up to the depth quota), and that it far exceeds today's measured figure for
the same selection.

**Acceptance Scenarios**:

1. **Given** a visitor who selected one service and one genre, **When** the
   deck loads, **Then** the eligible pool contains the titles that service
   carries in their region, not only those present in the general popularity
   sample.
2. **Given** the same selection and the same catalog, **When** the deck is
   loaded twice, **Then** the same first card appears — ranking remains
   deterministic (002 FR-011).
3. **Given** a title carried by two of the visitor's selected services,
   **When** it is dealt, **Then** it appears once, carrying both badges.

---

### User Story 2 - Every visitor downloads their own slice (Priority: P2)

The catalog request carries the visitor's selection, so the response is the
titles they can actually reach plus the "other platforms" set their opt-in
admits — not the region's whole sample, 44% of which (measured: 404 of 916 in
BR) carries no badge at all and is invisible to any service-selecting visitor.

**Why this priority**: It is what keeps the deeper pool affordable. Payload
becomes proportional to the visitor's own selection instead of everyone paying
for the region's popularity list: a one-service visitor downloads their slice,
not 916 titles to reach their dozens. It is P2 rather than P1 because the deck
works — just thinly — while every visitor still receives the same sample.

**Independent Test**: Request the catalog for a one-service selection and for
the widest selection; confirm both are bounded, the narrow one is materially
smaller than today's payload, and its selection-reachable group contains no
title lacking a badge for a selected service.

**Acceptance Scenarios**:

1. **Given** a visitor with one selected service, **When** the catalog is
   requested, **Then** the response contains the titles reachable by that
   selection plus the "other platforms" set, and nothing else.
2. **Given** the "show content on other platforms" opt-in is on, **Then**
   unbaded titles and titles carried only outside the selection remain
   reachable — none was dropped from the stored pool.
3. **Given** any selection of the quiz's services, **Then** the response stays
   within the payload bound (SC-003) and the first card still renders within
   the PRD's 300 ms budget (SC-004).

---

### User Story 3 - The deeper rebuild never lands on a visitor (Priority: P3)

Building the richer pool takes minutes, not seconds. No visitor ever waits for
it: every request is answered instantly from the stored pool, the rebuild runs
behind the response, and a rebuild that fails or is rate-limited leaves the
previous pool intact and still served.

**Why this priority**: It only matters when the build runs — but the build now
runs longer and costs more, and the failure it guards against is a dead deck.
It is what makes US1 safe to operate rather than a liability.

**Independent Test**: Trigger a rebuild and load the deck while it runs;
confirm the response is served from the stored pool without waiting. Abort a
rebuild mid-flight; confirm the previously stored pool is unchanged and still
served.

**Acceptance Scenarios**:

1. **Given** a stale stored pool, **When** a visitor loads the deck, **Then**
   they are answered from it while a rebuild proceeds — no request waits for
   the build.
2. **Given** a rebuild that fails or is abandoned (including provider rate
   limiting), **Then** the previously stored pool is unchanged and still
   served.
3. **Given** the provider is unreachable and no fresh pool exists, **Then**
   005's degradation holds exactly: the last successful pool with the cached
   notice, and the existing empty state only when nothing was ever retrieved.

---

### Edge Cases

- **A selected service carries nothing in that genre and region** → its
  contribution is empty; the visitor's existing empty state explains it, and
  any other selected services still deal.
- **A service the visitor selected is not carried in their region at all** →
  the same as above: no card is invented, no error is shown.
- **All services selected at once** → the union approaches the region's whole
  stored pool; the payload bound (SC-003) must still hold. The depth quota is
  the lever, not a promise.
- **The opt-in is off** → other-platform titles are still what the response
  carries for that path (the client decides what to do with them); they are
  never dropped from the stored pool — dropping them is exactly what would
  break the opt-in.
- **A service gains or loses titles between rebuilds** → the next rebuild
  carries it; within the cadence, staleness is accepted and never presented as
  live.
- **A service id is added to the quiz later** → until the next rebuild it
  contributes nothing; the rebuild picks it up. Not an error state.
- **A title is carried by a service only through a monetization the badges do
  not represent** (rent/buy) → unchanged 005 rule: badges are subscription,
  free, or ad-supported only; the title is unbadged for it and stays reachable
  through the opt-in.
- **The provider rate-limits the longer build** → the batch is abandoned whole
  (existing rule), the stale pool keeps serving, and the next stale request
  retries.
- **Determinism with far more retrieval chains** → genre and service order are
  fixed, so the same inputs produce the same pool (constitution VI).
- **Anime per service** → the Japanese-animation chains run per service too; a
  service carrying little anime yields little, and the existing empty state
  applies where that exhausts a deck.
- **A title reachable through several services or genres** → one entry
  carrying all its badges (FR-004).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A region's pool MUST be composed from what each of the quiz's
  streaming services actually carries in that region, retrieved per service,
  in addition to the general pool.
- **FR-002**: The visitor's selected services MUST be an input to the catalog
  request, like the region is (005 FR-005), and the response MUST be scoped to
  what that selection can reach: the titles carried by at least one selected
  service, plus the titles the "other platforms" opt-in admits.
- **FR-003**: The "show content on other platforms" opt-in MUST keep working
  exactly: unbaded titles and titles carried only outside the selection MUST
  remain in the stored pool and reachable when it is on.
- **FR-004**: A title reachable through several services or genres MUST remain
  one entry carrying all of its badges.
- **FR-005**: Filtering and ranking MUST remain on the client and
  deterministic (002 FR-011, 005 FR-011). This feature changes how the pool is
  composed and what the request carries, not how the deck chooses.
- **FR-006**: A badge MUST name a service that actually carries the title in
  the region (005 FR-006 preserved). Per-service retrieval MUST NOT introduce
  a badge the provider's data does not support.
- **FR-007**: The response MUST stay bounded for every possible selection,
  from the narrowest to all services at once. A per-service, per-genre depth
  quota is the tuning lever behind this bound, not a contract.
- **FR-008**: When the request carries no selection, the response MUST remain
  the region's general pool — the behavior existing clients already receive.
- **FR-009**: A rebuild MUST happen off the visitor's path: requests are
  always answered from the stored pool while a rebuild runs behind them (005
  FR-012/FR-013 preserved over a longer build).
- **FR-010**: The remaining 005 guarantees hold unchanged: region as a request
  input, adult-content exclusion, title shape, genre and service vocabulary,
  attribution, server-side credential, outage degradation, and the empty
  state.
- **FR-011**: The pools MUST remain deterministic: the same region, selection,
  and stored catalog MUST yield the same titles (constitution VI).
- **FR-012**: Every acceptance scenario in specs 001–005 that passes today
  MUST still pass.

### Key Entities *(include if feature involves data)*

- **Service pool**: what one service carries in one region, per genre and
  media type — the new building block of a region's catalog, bounded by the
  depth quota.
- **Region catalogue (stored pool)**: the union of every service pool plus the
  general pool, enriched once and stored. The same role 005's snapshot has,
  with a larger composition.
- **Selection**: the visitor's chosen services — the new request input — plus
  the opt-in's state, which decides whether the other-platforms set is
  admitted.
- **General pool**: the existing popularity-ranked title set, retained because
  it is the opt-in's only source and the path by which unbaded titles and
  titles carried outside the quiz's services reach the deck.
- **Depth quota**: the per-service, per-genre tuning parameter bounding both
  the rebuild's cost and the response's size.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a single service and single genre, the eligible pool equals
  the depth the provider reports for that service and genre in the region, up
  to the depth quota — not an intersection with a general sample. Floor to
  beat, measured 2026-09-28 for BR: Netflix + horror at 8 of 916.
- **SC-002**: Selections of three or more services keep at least the 005
  SC-001 guarantee of 20 titles per genre, and single-service selections offer
  at least 20 distinct titles for every genre where that service carries that
  many in the region.
- **SC-003**: A single-service visitor's payload is materially smaller than
  today's full-region payload (635,380 bytes raw / 186 KB brotli, measured
  2026-09-28), and no selection's payload exceeds the same order of magnitude.
  Exact bounds are set in planning from SC-001's live measurement.
- **SC-004**: The first card still renders within 300 ms of the deck opening
  on a warm cache over a 4G connection (PRD; 005 SC-002).
- **SC-005**: 100% of deck loads during a rebuild are answered from the stored
  pool without waiting for the build, and 100% of aborted rebuilds leave the
  previously stored pool intact.
- **SC-006**: 0 titles in a response's selection-reachable group lack a badge
  for a selected service, and 0 titles the provider reports for the selection
  are missing from the pool, up to the quota.
- **SC-007**: Every acceptance scenario in specs 001–005 that passes today
  still passes.

## Assumptions

- **The retrieval set is the quiz's 12 services.** Services outside it
  continue to reach the deck through the general pool and 005 FR-010's
  vocabulary rule — never through per-service retrieval. Retrieving for every
  service the provider knows would multiply the build for titles no visitor
  can select.
- **Genres stay client-side.** Only the selection becomes a request input —
  services are the scarce dimension; the deck's genre filters keep working
  over whatever pool the selection returns (FR-005).
- **The general pool is retained, not replaced.** It is the opt-in's only
  source and the fallback path for unbaded titles; the per-service pools are
  added to it.
- **The stored pool grows to the order of a few thousand titles per region**
  and the rebuild to the order of a few thousand upstream calls — minutes,
  paced below the provider's limit. Both are measured in planning before the
  quotas are fixed; this spec deliberately does not pin them.
- **The first planning task is one live measurement**: the provider's true
  count for a couple of service + genre combinations in the region being
  built, replacing this spec's estimates with the number from which quotas are
  then set.
- **Deliberate amendments to 005**: FR-005's "region is an input to the
  catalog request" extends to the selection; FR-020's "the pool carries full
  detail" continues to hold for the returned slice (opening a title still
  needs no second request); and 005 SC-001's assumption that a single
  service's ceiling is "a fact about the region" is superseded — the measured
  ceiling belonged to the sample, not to the service.
- **Azure deployment is unaffected in shape**: server-side batch, stored pool
  in the database, server-side caching, credentials in App Settings / Key
  Vault. Whether rebuilds stay lazy-behind-a-response (today's design) or are
  scheduled is a planning decision; both satisfy FR-009.
- **This slice does not include**: per-combination lazy builds keyed on a full
  filter signature (premature), additional retrieval axes beyond service and
  genre, non-quiz services as retrieval targets, and any change to the deck's
  ranking itself.
