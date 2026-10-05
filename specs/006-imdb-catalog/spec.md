# Feature Specification: IMDb-Backed Catalog & Ranking

**Feature Branch**: `006-imdb-catalog`

**Created**: 2026-10-02

**Status**: Parked (2026-10-03) — set aside in favour of `007-per-service-catalog`; retained for reference.

**Input**: User description: "I have downloaded IMDb datasets, created new tables in the database and populated them with the data. Do an analysis of what is in the tables and help me understand if it's a good idea to move away from the TMDB API and use the data we have from IMDb to provide the deck with recommendations. I'm aiming to improve the recommendation engine, with loads and loads of movies and TV shows to recommend, without worrying about API usage and things like that. If this makes sense, we can later start a spec-kit process to plan how it will work."

## Clarifications

### Session 2026-10-02

- Q: Where do artwork, synopsis, trailer, "where to watch" availability
  and anime classification come from, given the IMDb datasets contain none of
  them? → A: The incumbent provider stays as enrichment, consulted once per
  title and cached permanently; the same pass supplies the identity mapping
  and the anime classification.
- Q: What replaces the provider's popularity ranking as what the deck sorts
  on? → A: A vote-damped quality score — the rating average pulled toward the
  catalog mean in proportion to how few votes back it. No popularity or
  recency metric participates.
- Q: Should cast data be loaded and used as a similarity signal? → A: No —
  cast is out of this slice; ordering draws on genre, director, era, runtime,
  and the quality score. Deferred to a later increment.
- Q: Should anime leave the media-type vocabulary, or be sourced from a
  dedicated anime dataset? → A: It stays, classified through the enrichment
  record (005 FR-016's rule); a dedicated anime data source is a named
  follow-on, not this slice.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The deck draws from the whole of film and television (Priority: P1)

A visitor picks a genre and the deck has thousands of titles behind it, not the
few hundred a popularity-ranked regional snapshot happens to hold. Whatever
they select, the deck's depth stops being a property of how much the app
downloaded last week and starts being a property of how much actually exists.
Running out of cards stops being a normal event.

**Why this priority**: This is the ask that started the feature. Today's pool
is ~900 titles for one region, composed per genre by the provider's popularity
ranking — measured 2026-10-01, that means "Netflix + horror" is 8 titles in
Brazil, and narrow selections exhaust the deck in a handful of cards. The IMDb
datasets hold 1.29M relevant titles, 65,346 of them with ≥1,000 votes, and the
smallest quiz genre (Sci-Fi) still has 2,994. Nothing else in this feature —
better ranking, no API dependency — delivers value if the catalog stays small.

**Independent Test**: Complete the quiz with a single genre selected and
confirm the deck's eligible pool is at least 2,500 distinct titles, and that at
least one title from outside the current catalog appears on a card.

**Acceptance Scenarios**:

1. **Given** a guest who has completed the quiz, **When** the deck loads,
   **Then** its eligible pool is drawn from the full local dataset rather than
   the incumbent provider's regional snapshot.
2. **Given** a visitor who selected one genre and no service restriction,
   **When** the deck is dealt, **Then** at least 2,500 distinct titles are
   eligible before availability filtering, and the deck does not exhaust.
3. **Given** the same quiz answers and the same catalog, **When** the deck is
   loaded twice, **Then** the same first card appears — ranking remains
   deterministic (002 FR-011).

---

### User Story 2 - Ranking improves, not just the volume (Priority: P2)

The deck's order becomes a measured quality judgment instead of a chase of the
provider's monthly popularity list. A title with a 9.5 average from a handful
of votes can no longer outrank a widely-seen 8.7, and a title's standing does
not swing because the provider re-ranked its trending page.

**Why this priority**: A bigger catalog ranked badly is worse than a small one
ranked well — more noise, same decisions. It is P2 rather than P1 because the
deck is usable the moment the pool is deep, and this story is what makes it
trustworthy. It is also the reason the analysis recommended this move at all:
the local dataset carries a per-title vote count as well as an average, which
is what makes vote-damped ranking possible.

**Independent Test**: With a fixed pool and fixed preferences, load the deck
twice and confirm identical ordering; then confirm a low-vote title with a
higher average ranks below an established, widely-voted title in the same
genre.

**Acceptance Scenarios**:

1. **Given** a fixed catalog and fixed preferences, **When** the deck is
   dealt, **Then** the order is reproducible (002 FR-011) and every dealt
   title carries at least the eligibility minimum of votes.
2. **Given** two titles in the same genre — one at 9.5 from ~1,000 votes, one
   at 8.5 from ≥100,000 — **When** the deck ranks them, **Then** the
   established title ranks above the small-sample one.
3. **Given** a title whose standing comes only from the provider's popularity
   ranking, **When** the catalog switches to the local dataset, **Then** its
   position is decided by the measured rating signal, not by a trend list.

---

### User Story 3 - The deck no longer depends on a live catalog service (Priority: P3)

Opening the deck never waits on, or fails because of, an external catalog
call. There is no rate limit to absorb, no quota to watch, no provider outage
to degrade around, and no credential to protect for the catalog's own data.
Enrichment the dataset does not contain may still come from outside, and it
degrades on its own without taking the deck down with it.

**Why this priority**: "Without worrying about API usage" is half the
motivation for the feature, and it converts the catalog's reliability story
from "cache the provider well" (005's P3) into "the catalog is ours". It is P3
rather than higher because the visitor cannot tell the difference while the
provider is healthy — it only matters when it is not.

**Independent Test**: With all outbound catalog-service calls blocked, load
the deck and confirm cards are dealt from the full pool; confirm only
enrichment-level fields (artwork, availability) degrade, by the existing
rules.

**Acceptance Scenarios**:

1. **Given** the local dataset is loaded, **When** any visitor loads the deck,
   **Then** zero external catalog-service calls are required to deal cards.
2. **Given** every external metadata call fails, **When** the deck loads,
   **Then** cards still render from the full pool with the existing
   degradation (005 FR-017): placeholder in place of artwork, no badges, all
   other fields intact.
3. **Given** the previous identity's stored ratings exist on a device,
   **When** the visitor opens the watchlist after the switch, **Then** every
   rating that maps to the new identity still shows its title (FR-011).

---

### Edge Cases

- **A near-unknown title with a perfect average** → vote-damped ranking keeps
  it from the top of a deck; the eligibility minimum (FR-003) keeps the
  extreme tail out of the pool entirely.
- **A title with no rating at all** (roughly half the relevant dataset) → it
  is not eligible; the deck never deals an unrated card.
- **Episode-level and non-title records in the dataset** → excluded by the
  pool composition (FR-002); the deck never offers an episode, a short, or a
  video game as a card.
- **Adult titles** → excluded, as today (005 FR-008).
- **A catalog title with no enrichment record** → no artwork and no
  availability; the card degrades by the existing rules (005 FR-017) and the
  title stays rankable and rateable. A failed enrichment match is a normal
  state, not an error.
- **A title carried by no service in the visitor's region** → the deck's
  existing availability filter decides eligibility; the card never hides
  because of it (005 US2 scenario 3).
- **Two titles with the same name and year** → distinct entries; identity is
  the dataset's identifier, not the name.
- **A stored rating whose title has no mapping to the new identity** → the
  watchlist renders the existing title-less row (005 FR-015) and the entry
  remains removable. Ratings never vanish silently, and one that cannot map is
  not lost data — it is visible and clearable.
- **An anime title that cannot be classified** (the dataset has no reliable
  Japanese-origin signal — measured 2026-10-01) → it is not anime; the quiz's
  anime choice only ever surfaces positively classified titles.
- **A genre + service selection that still outruns reality** → the existing
  empty state explains it; below three services the cap is what those services
  carry, not the catalog (005 SC-001).
- **The catalog's global reach** → the local dataset is worldwide and carries
  ratings for titles a visitor has never heard of, in languages they do not
  speak (the measured top-rated horror list was dominated by Indian and
  Egyptian titles). Availability filtering and vote-damped ranking soften
  this; there is no language preference in the quiz, and adding one is a
  follow-on, not part of this feature.
- **A dataset refresh that renames or drops a title** a stored rating
  references → the same tolerant watchlist row; the rating stays clearable.
- **The visitor's region cannot be determined** → the existing default region
  applies to enrichment, unchanged from 005.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The catalog MUST be sourced from the owner's own copy of the
  IMDb datasets, served to the client by our own API. Dealing a deck MUST NOT
  require a call to any external catalog service.
- **FR-002**: The eligible pool MUST contain only non-adult movies, TV series,
  TV movies, and limited series. Episodes, shorts, video games, TV specials,
  and every other non-title record type MUST be excluded.
- **FR-003**: A title MUST be eligible only when its rating is backed by at
  least a minimum number of votes. The minimum is a tuning parameter, not a
  contract; its effect is bounded by SC-001 and SC-002.
- **FR-004**: For every genre the quiz offers, the eligible pool MUST be at
  least 2,500 distinct titles before availability filtering. The deck must not
  exhaust in a handful of cards for any single-genre selection.
- **FR-005**: The catalog MUST hold at least 50,000 eligible titles, and MUST
  cover every genre, decade, and media type the quiz can select.
- **FR-006**: Ranking MUST remain deterministic (002 FR-011) and MUST remain
  independent of any external service's live state: the same catalog and the
  same preferences MUST produce the same order.
- **FR-007**: Ranking MUST use a vote-damped quality score: a title's rating
  average pulled toward the catalog mean in proportion to how few votes back
  it. A raw average alone MUST NOT decide the order, and a small vote sample
  MUST NOT outrank an established title of similar quality.
- **FR-008**: No popularity, trending, or recency signal — from any external
  service or any live list — may influence the deck's order. Ordering derives
  only from the locally held dataset's rating average and vote count.
- **FR-009**: Cast-level data MUST NOT be part of the catalog, the ranking
  signal, or the deck's similarity in this slice; ordering and matching draw
  on genre, director, era, runtime, and the quality score (FR-007). Loading
  cast data is a deferred increment, not a requirement here.
- **FR-010**: Artwork, synopsis, trailer, and "where to watch" availability
  MUST continue to be supplied for every catalog title that matches an
  external enrichment record. The incumbent provider remains the enrichment
  source, consulted once per title and cached; a title with no match keeps
  full card behavior minus those fields (FR-014). The same enrichment pass
  supplies FR-011's identity mapping and FR-012's anime classification.
- **FR-011**: A title's identity MUST be the dataset's own title identifier;
  media type is an attribute, not part of the identity. A one-time migration
  MUST map stored ratings and watchlist entries from the retired identity to
  the new one wherever a mapping exists; entries that cannot map MUST degrade
  to the existing title-less row (005 FR-015) rather than being dropped.
- **FR-012**: Anime MUST remain part of the media-type vocabulary (movie,
  series, anime), and 005 FR-016's rule — animation with a Japanese original
  language — MUST be preserved, applied through the enrichment record. A
  title with no enrichment record is not anime.
- **FR-013**: Region-scoped availability MUST keep 005's rules exactly: the
  region is an input, badges name only services that actually carry the title
  there, and tapping a badge opens that service (005 FR-005–FR-007).
- **FR-014**: Titles MUST retain the shape the deck and watchlist already
  consume (005 FR-009): identifier, name, release year, media type, genres,
  synopsis, rating, vote count, runtime, trailer, poster, availability — with
  the existing degradation for anything absent (005 FR-017).
- **FR-015**: Genre and service identity MUST remain spec 001's vocabulary
  (005 FR-010). Preferences already stored on visitors' devices MUST NOT stop
  matching.
- **FR-016**: The catalog MUST reflect the dataset as of its last refresh and
  MUST NOT require the dataset to be live. New releases appear within the
  refresh cadence; staleness inside that cadence is accepted, and the app MUST
  NOT present stale data as live.
- **FR-017**: The first card MUST still render within the PRD's 300 ms budget
  (005 SC-002) with the deeper pool; the pool reaching the client MUST remain
  a bounded number of calls (005 FR-019–FR-020), never one per card.
- **FR-018**: The app MUST display the attribution the dataset's terms
  require, alongside the incumbent provider's (005 FR-018) where its data is
  still used.
- **FR-019**: Any external credential used for enrichment MUST remain
  server-side (005 FR-002), and MUST NOT appear in the client bundle, any API
  response, or any log.
- **FR-020**: Every acceptance scenario in specs 001–005 that passes today
  MUST still pass — the quiz, the deck loop, ratings, the watchlist, and the
  guest→account migration are unchanged from the visitor's point of view.

### Key Entities *(include if feature involves data)*

- **Catalog title**: what the deck ranks and the watchlist looks up. Identity
  is the dataset's title identifier; it carries name, year, media type,
  genres, runtime, rating average, and vote count. Enrichment fields
  (artwork, synopsis, trailer, availability, anime classification) are
  attached where a match exists and are legitimately absent where one does
  not.
- **Eligible pool**: the subset of catalog titles the deck may deal, defined
  by media type, adult exclusion, and the rating vote minimum. Its size is
  the feature's headline outcome (SC-001, SC-002).
- **Quality score**: the ranking signal derived from the rating average and
  its vote count. It replaces the provider's popularity ordering as what the
  deck's deterministic ranking (002 FR-011) sorts on.
- **Enrichment record**: the per-title attachment of everything the dataset
  cannot supply, fetched once and cached. A missing record is a normal state.
- **Identity mapping**: the one-time correspondence between the retired
  identity and the new one, consulted when stored ratings and watchlist
  entries migrate (FR-011).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every genre the quiz offers has at least 2,500 eligible titles
  before availability filtering. Measured floor at the ≥1,000-vote line on
  2026-10-01: Sci-Fi 2,994; the largest is Drama at 35,627.
- **SC-002**: The catalog holds at least 50,000 eligible titles (measured
  2026-10-01: 65,346 titles with ≥1,000 votes; 206,879 with ≥100).
- **SC-003**: The first card renders within 300 ms of the deck opening on a
  warm cache over a 4G connection (PRD performance target, carried from 005
  SC-002).
- **SC-004**: A deck session causes zero external catalog-service calls to
  deal its cards.
- **SC-005**: With every external metadata call blocked, 100% of deck loads
  still deal a full deck from the local pool — degraded fields only, never an
  error screen.
- **SC-006**: In an automated check over the live pool, an established title
  (≥100,000 votes, average 8.5) ranks above a small-sample title (~1,000
  votes, average 9.5) in the same genre, and no dealt card carries fewer votes
  than the eligibility minimum.
- **SC-007**: 100% of stored ratings that map to the new identity survive as
  their original titles; zero ratings disappear silently; unmapped ratings
  render the existing unavailable row and stay removable.
- **SC-008**: Searching the built client bundle and a sample of server logs
  finds zero occurrences of any enrichment credential (005 SC-006 preserved).
- **SC-009**: Every acceptance scenario in 001–005 that passes today still
  passes.

## Assumptions

- **The datasets as obtained are for personal, non-commercial use.** IMDb's
  free datasets are licensed for personal and non-commercial use only;
  commercial deployment would require a licence from IMDb (or a different
  data source) and is an explicit gate on this feature, not a task inside it.
  TMDB, which permits commercial use with attribution, is the
  commercially-safe component of the stack.
- **The dataset is refreshed out of band by its owner**, by re-running the
  load. Freshness measured in days to weeks is acceptable (FR-016); there is
  no live sync, and no incremental update machinery in this slice.
- **The media-type vocabulary is preserved**: `tvMovie` and `tvMiniSeries`
  classify as `tv`; `movie` as `movie`; anime keeps 005 FR-016's rule. A
  Japanese animated series is anime rather than a series, exactly as the quiz
  has implied since 001.
- **Anime is kept, and no dedicated anime data source is introduced**
  (decided 2026-10-02). With enrichment retained, the anime rule is
  available for free; removing the media type instead would force the quiz,
  the media-type vocabulary, and stored preferences through a migration for
  no gain. Dedicated anime sources — MyAnimeList-style APIs, or merged
  community anime databases — would deepen anime coverage beyond what the
  provider's catalogue knows, but each is a third integration with its own
  identity mapping and licensing questions: a named follow-on, not this
  slice.
- **The vote minimum is a tuning parameter** (FR-003). The analysis measured
  65,346 eligible titles at ≥1,000 votes and 206,879 at ≥100; the line is set
  in planning to keep SC-001 and SC-002 comfortable without importing the
  dataset's noise. A well-loved but obscure film below the line is
  unreachable — an accepted cost, revisit-able by tuning.
- **The catalog becomes global in a way it was not before.** The previous
  pool was a popularity-ranked regional snapshot; the local dataset is
  worldwide, so titles in many languages become eligible. Locality now comes
  from availability filtering and the visitor's own selections. A language
  preference is deliberately out of scope and named as a follow-on.
- **The incumbent provider stops being the catalog and remains as enrichment**
  (decided 2026-10-02). It is fetched once per title and
  cached, which converts per-visitor API usage into a bounded, one-time cost.
  The identity mapping (FR-011) comes from the same enrichment pass, since
  the datasets contain no correspondence to the provider's identifiers.
- **Ranking stays on the client where 002 and 005 put it.** This feature
  changes what the ranking sorts on (the quality score), not where it runs.
  The PRD's "deterministic recommendation filtering endpoint" remains
  deliberately unbuilt.
- **The bundled sample ids and any pre-005 ratings against them stay
  orphans** — already accepted by 005, and handled by the same tolerant
  watchlist row this feature relies on.
- **This slice does not include**: user-facing catalog search, a language
  preference, cast data of any kind (FR-009), a dedicated anime data source,
  per-service catalog retrieval (deferred by 005), or commercial licensing of
  the data.
