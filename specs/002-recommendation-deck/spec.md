# Feature Specification: Recommendation Deck

**Feature Branch**: `002-recommendation-deck`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "recommendation deck"

## Clarifications

### Session 2026-09-25

- Q: What does a swipe gesture on a recommendation card mean? → A: Swipe is a
  neutral skip (advances, records nothing); only the rating buttons rate;
  skipped titles stay excluded for the rest of the loop but may appear in
  later loops.
- Q: When the deck has no matches and the visitor taps "Reset Filters", what
  should happen next? → A: Return to the onboarding quiz with previous
  answers pre-filled so the visitor can widen their selections; completing
  the quiz starts a new loop. Disliked/Not Interested exclusions remain
  intact.
- Q: On the Match Found view, should the trailer play inline or open as an
  external link? → A: External link — a button opens the trailer on the
  official trailer service in a new tab; no third-party player code loads
  on the page.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitor browses tailored suggestions one card at a time (Priority: P1)

After completing the onboarding quiz, a visitor is presented with one
recommendation at a time. Each card shows rich details: poster art, title,
release year, ratings, a collapsible synopsis, media type, and the streaming
services where the title is available. The visitor advances with a swipe or a
tap and receives the next suggestion. Every suggestion matches their quiz
preferences (media type, genres) and is available on at least one of their
selected streaming services, unless they enabled "Show content on other
platforms".

**Why this priority**: This is the product's core loop — the entire value
proposition ("stop scrolling, start watching") is the single-card deck with
relevant suggestions. All other stories build on it.

**Independent Test**: Complete the quiz as a new visitor and verify each
card shown is relevant to the quiz answers and carries the full metadata;
advance through 10+ cards without error. Delivers value even before rating
actions exist: the visitor can already decide what to watch.

**Acceptance Scenarios**:

1. **Given** a visitor has completed the quiz, **When** the quiz summary
   action is tapped, **Then** the first recommendation card appears
   immediately with no further input required.
2. **Given** a card is displayed, **When** the visitor swipes it away
   (neutral skip) or taps the advance action, **Then** the next card
   replaces it, one card at a time, and no rating is recorded by either
   action.
3. **Given** quiz preferences of Movie + Horror, **When** cards are
   presented, **Then** every card is a Horror movie, unless the visitor
   changed preferences.
4. **Given** the visitor selected streaming services A and B (and "Show
   content on other platforms" is off), **When** cards are presented, **Then**
   every card is available on A or B.
5. **Given** a title already shown in the current loop, **When** the
   visitor keeps advancing, **Then** that title does not appear again until
   the loop is exhausted or restarted.

---

### User Story 2 - Visitor rates a card or locks in a choice (Priority: P2)

On each card the visitor has one-tap rating actions: Loved It, Liked It,
Disliked, Want to Watch, Not Interested — plus the primary "Watch Now"
action. Rating a card immediately advances to the next suggestion and
remembers the rating. "Watch Now" stops the loop and opens a Match Found
view with direct links to the official streaming services where the title is
available, the trailer when one exists, and an action to start a new
recommendation loop.

**Why this priority**: Ratings are the input that makes the deck smarter
over time, and "Watch Now" is the moment the visitor's problem is solved —
the PRD's headline metric (time to decision) is measured against this
action.

**Independent Test**: Rate three cards in a row and confirm each rating is
remembered and the deck advances; then tap Watch Now and confirm the Match
Found view shows correct links for the chosen title. Delivers value: the
visitor completes a decision with a path to actually watch the title.

**Acceptance Scenarios**:

1. **Given** a card is displayed, **When** the visitor taps Loved It, Liked
   It, Disliked, Want to Watch, or Not Interested, **Then** the rating is
   recorded and the next card appears.
2. **Given** a card is displayed, **When** the visitor taps Watch Now,
   **Then** the loop stops and the Match Found view opens for that title.
3. **Given** the Match Found view, **When** the visitor looks at it, **Then**
   they see direct links to each streaming service where the title is
   available, a button that opens the trailer in a new tab when a trailer
   exists, and a start-new-loop action.
4. **Given** no trailer exists for the chosen title, **When** the Match
   Found view is shown, **Then** the view still works with links and the
   start-new-loop action (no broken areas).

---

### User Story 3 - The deck never repeats rejected titles (Priority: P3)

Titles the visitor rated Disliked or Not Interested are never suggested
again — in the current session, and in later sessions for the same visitor.
This is what makes the deck feel like it "learns" the visitor's taste
without any machine learning.

**Why this priority**: It is a non-negotiable invariant of the product
(constitution, Principle V) and a PRD acceptance criterion; violating it
silently destroys trust in the deck.

**Independent Test**: Rate a title Disliked, advance through 30+ cards, and
confirm it never reappears; close and reopen the app and confirm the same
exclusion still holds.

**Acceptance Scenarios**:

1. **Given** a title was rated Disliked or Not Interested, **When** new
   cards are generated in the same session, **Then** that title is never
   suggested.
2. **Given** a title was rated Disliked in a previous session, **When** the
   same visitor returns and starts a new loop, **Then** that title is still
   excluded.

---

### User Story 4 - The deck degrades gracefully (Priority: P4)

The deck never strands the visitor. If the external media data provider is
unavailable, the deck serves suggestions from its locally cached data with a
visible notice. If nothing matches the current filters, the deck shows an
actionable empty state with a 1-click filter reset. If the visitor's
connection drops mid-session, they can keep browsing already-loaded cards
with an offline notice.

**Why this priority**: The constitution (Principle II) makes graceful
degradation binding — "never a dead end" — and the PRD specifies each of
these fallback behaviors.

**Independent Test**: Simulate a provider outage and verify cached
suggestions still appear with the notice; set impossible filters (narrow
genre + provider with no titles) and verify the empty state with working
1-click reset; go offline mid-session and verify already-loaded cards remain
browsable.

**Acceptance Scenarios**:

1. **Given** the external media data provider is unreachable, **When** the
   visitor requests suggestions, **Then** cached fallback suggestions appear
   with a visible notice that they are offline-cached.
2. **Given** no titles match the current filters, **When** the deck
   requests suggestions, **Then** an empty state appears with a 1-click
   Reset Filters action.
3. **Given** the empty state, **When** the visitor taps Reset Filters,
   **Then** the onboarding quiz reopens with previous answers pre-filled,
   and completing it starts a new loop.
4. **Given** the connection drops mid-session, **When** the visitor swipes
   through already-loaded cards, **Then** browsing continues and an offline
   notice is shown.

---

### Edge Cases

- What happens when a poster image fails to load? A fallback placeholder is
  shown; the card remains fully readable without the artwork.
- What happens when streaming availability data is stale or missing? The
  provider badge area degrades gracefully; the rest of the card is
  unaffected.
- What happens when the visitor rates or swipes very rapidly? Each action
  yields exactly one next card — no cards are skipped or duplicated.
- What happens when the visitor refreshes the page mid-deck? The current
  position and the session's exclusions are retained (see Assumptions).
- What happens when every remaining title has been rated or rejected? The
  empty state appears with the reset action, never a stuck spinner.
- What happens on a 360px-wide phone screen? The card, sticky action
  buttons, and Match Found view are fully usable with touch only.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After the quiz completes, the system MUST present the first
  recommendation immediately, with no further input required.
- **FR-002**: The system MUST show exactly one recommendation card at a
  time.
- **FR-003**: Each card MUST show: title, release year, ratings, a
  collapsible synopsis, poster art, media type, and the streaming providers
  where the title is available.
- **FR-004**: The visitor MUST be able to advance via a swipe gesture and
  via an explicit tap action; every advance yields exactly one next card.
  A swipe is a neutral skip — it records no rating; ratings are recorded
  only through the rating buttons (FR-007).
- **FR-005**: Suggestions MUST match the visitor's quiz preferences (media
  types, genres).
- **FR-006**: The system MUST NOT suggest titles unavailable on the
  visitor's selected streaming services, unless "Show content on other
  platforms" is enabled.
- **FR-007**: Each card MUST offer one-tap actions for Loved It, Liked It,
  Disliked, Want to Watch, and Not Interested; rating a card records the
  rating and advances to the next card.
- **FR-008**: The Watch Now action MUST stop the loop and open a Match
  Found view with direct links to the official streaming services where the
  title is available, a button that opens the trailer on the official
  trailer service in a new tab when a trailer exists, and a start-new-loop
  action. No third-party player code loads on the page.
- **FR-009**: Titles rated Disliked or Not Interested MUST NOT be suggested
  again to the same visitor, in the current session or any later session.
- **FR-010**: A title already shown in the current loop MUST NOT reappear
  until the loop is exhausted or restarted.
- **FR-011**: With identical preferences and history, the system MUST
  produce the same card sequence (deterministic, reproducible).
- **FR-012**: The next card MUST be ready for display within 300ms of the
  visitor's action.
- **FR-013**: When the external media data provider is unreachable, the
  system MUST serve cached fallback suggestions with a visible notice.
- **FR-014**: When no titles match the current filters, the system MUST
  show an empty state with a 1-click Reset Filters action that returns the
  visitor to the onboarding quiz with their previous answers pre-filled so
  they can widen their selections; completing the quiz starts a new loop.
- **FR-015**: During a connection loss, the system MUST allow browsing of
  already-loaded cards and MUST show an offline notice.
- **FR-016**: A failed poster image MUST fall back to a placeholder; the
  card must remain fully readable without artwork.
- **FR-017**: All deck screens MUST remain fully usable at 360px viewport
  width with touch targets of at least 44px and sticky bottom action
  buttons, in dark high-contrast styling.

### Key Entities *(include if feature involves data)*

- **Media Title**: a watchable title — name, release year, genres, media
  type, synopsis, poster, ratings, and streaming availability per provider.
- **Recommendation Card**: the deck's presentation of a Media Title —
  ranked position and the title's display data.
- **Rating / Interaction**: the visitor's recorded action on a title — one
  of Loved, Liked, Disliked, WantToWatch, NotInterested, or WatchingNow —
  plus when it happened. Skipping a card is not recorded as an interaction;
  there is no "Skipped" state.
- **Match**: the locked-in choice — the chosen title, its streaming links,
  and trailer link when available.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Median time from opening the app to tapping Watch Now is
  under 2 minutes.
- **SC-002**: Each next card is ready within 300ms of the visitor's action,
  in 95% of measured actions.
- **SC-003**: 100% of suggested titles match the visitor's quiz preferences
  and selected streaming services (when "Show content on other platforms"
  is off) across a full session.
- **SC-004**: Zero occurrences of Disliked or Not Interested titles being
  suggested again in the same or a later session.
- **SC-005**: Identical preferences and rating history produce an identical
  card sequence.
- **SC-006**: During a simulated media data provider outage, 100% of
  sessions still receive usable suggestions with the cached-data notice.
- **SC-007**: At least 90% of visitors who start the deck advance through
  10 or more cards without an error.
- **SC-008**: The full deck flow (browse, rate, Watch Now, Match Found) is
  completable on a 360px-wide screen with touch input only.

## Assumptions

- The deck consumes quiz preferences produced by the onboarding quiz spec
  (001); the quiz itself is out of scope here.
- Rating actions record the rating in the shared vocabulary (Loved, Liked,
  Disliked, WantToWatch, NotInterested, WatchingNow); persistent history
  and watchlist views, re-rating, and cross-session sync details belong to
  the ratings & watchlist spec (003). This spec only requires that ratings
  are recorded and drive the feedback loop.
- Registered-user accounts and server-side preference sync are out of scope
  (auth spec, 004); the deck must work fully for guests with device-local
  state.
- "Reset Filters" returns the visitor to the onboarding quiz with previous
  answers pre-filled; completing it starts a new loop. Disliked/Not
  Interested exclusions are unaffected by resetting filters.
- Deterministic weighted scoring uses tags, genres, ratings, and user
  history per the PRD; the scoring algorithm itself is an implementation
  detail, but its output must be reproducible (FR-011).
- Trailer availability depends on the media data provider; the Match Found
  view works with or without a trailer. The trailer opens via an external
  link in a new tab — no third-party player is embedded in the view.
- Deep links always point to official streaming services — PlayNext never
  hosts or streams media itself (constitution, Principle VI).
- For Milestone 1, the deck may be driven by mock title data; live media
  data provider integration arrives with Milestone 2 without changing any
  behavior specified here.
- Streaming availability data applies to the visitor's region, consistent
  with the quiz's provider selection.
