# Feature Specification: Ratings & Watchlist

**Feature Branch**: `003-ratings-watchlist`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "ratings & watchlist"

## Clarifications

### Session 2026-09-25

- Q: Should the watchlist show only the three PRD tabs, or should "Liked"
  ratings also be visible? → A: Three tabs (Want to Watch, Loved, Disliked);
  the Loved tab also includes Liked titles.
- Q: Can a visitor mark a title "Watching Now" directly from the watchlist?
  → A: No — "Watching Now" is set only by the deck's Watch Now action; the
  watchlist's re-rating covers the other five states.
- Q: If a visitor re-rates a title they once locked in with Watch Now,
  should the old entry stay in the watching history? → A: History is a log —
  the entry stays even if the visitor re-rates the title later; the current
  rating is shown on the watchlist tabs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitor browses their rated titles in a tabbed watchlist (Priority: P1)

Every rating a visitor makes in the deck lands in a watchlist organized into
tabs: Want to Watch, Loved, and Disliked (the Loved tab also holds Liked
titles). Each entry shows the poster, title, year, rating state, and where
it is streaming. The visitor can open an entry to see the title's details
and streaming links, and everything they rated earlier is still there when
they come back — across refreshes and browser restarts.

**Why this priority**: The watchlist is the PRD's "Watchlist & History
View", the second item in the app's bottom navigation, and the place where
the visitor's deck decisions accumulate into a personal collection. Without
it, ratings vanish into the void after the card advances.

**Independent Test**: Rate three titles in the deck (one each Want to Watch,
Loved, Disliked), open the Watchlist, and confirm each appears in the right
tab with its details; refresh and confirm nothing is lost.

**Acceptance Scenarios**:

1. **Given** a visitor rated a title Want to Watch in the deck, **When**
   they open the Watchlist, **Then** that title appears in the Want to
   Watch tab with poster, title, year, and streaming availability.
2. **Given** a visitor rated titles Loved and Disliked, **When** they view
   the Watchlist, **Then** each title appears in the matching tab, and a
   Liked title appears in the Loved tab.
3. **Given** a watchlist entry, **When** the visitor taps it, **Then** the
   title's details open with its streaming links.
4. **Given** a visitor with saved ratings, **When** they refresh the page
   or reopen the app, **Then** all ratings and tabs are intact.

---

### User Story 2 - Visitor changes or removes a rating (Priority: P2)

Tastes change: the visitor re-rates a title (for example, Loved becomes
Want to Watch) or removes a title from the watchlist entirely. The change
applies everywhere immediately — including the deck, which must respect the
new state: a title that is no longer Disliked or Not Interested becomes
eligible to be suggested again in the next loop.

**Why this priority**: Re-rating closes the loop between the watchlist and
the deck. Without it, a mis-tapped Dislike would exclude a title forever,
and the deck and watchlist would slowly disagree with each other.

**Independent Test**: From the Disliked tab, change a title to Loved; start
a new deck loop and confirm the title can appear again. Also remove a Want
to Watch entry and confirm it disappears from the tab without breaking the
other entries.

**Acceptance Scenarios**:

1. **Given** an entry in any tab, **When** the visitor changes its rating
   to one of the other five states (Loved, Liked, Disliked, Want to Watch,
   Not Interested), **Then** the entry moves to the matching tab and the
   deck treats the title according to the new state.
2. **Given** an entry, **When** the visitor removes the rating, **Then**
   the entry disappears from the watchlist and the title returns to an
   unrated, suggestible state.
3. **Given** a title changed from Disliked to another state, **When** the
   visitor starts a new deck loop, **Then** the title is eligible to be
   suggested again.
4. **Given** a title rated Disliked from the watchlist itself, **When** the
   visitor browses the deck, **Then** that title is excluded from
   suggestions.

---

### User Story 3 - Visitor revisits their "Watching Now" history (Priority: P3)

Every time the visitor locks in a choice with Watch Now, the decision is
recorded in a watching history: the title, when it was chosen, and the
streaming links from the Match Found view. Later, the visitor can reopen any
past choice and get straight back to those links — no need to search again.

**Why this priority**: It completes the decision history story: ratings are
the loop's *inputs*, watching history is the loop's *output*. It also gives
visitors a one-tap path back to a title they already decided to watch.

**Independent Test**: Lock in two choices via Watch Now; open the history
and confirm both appear with working streaming links; reopen one and
confirm the links are still correct.

**Acceptance Scenarios**:

1. **Given** the visitor completed a Watch Now flow, **When** they open the
   history, **Then** that title appears with its choice time and streaming
   links.
2. **Given** a history entry, **When** the visitor taps it, **Then** the
   title's details and streaming links open, ready to watch.
3. **Given** the visitor has never locked in a choice, **When** they open
   the history, **Then** a friendly empty state is shown.

---

### Edge Cases

- What happens when the visitor rates the same title twice? The existing
  rating is updated — there is never a duplicate entry for the same title.
- What happens when a rating changes while a deck loop is running? The
  change applies to the next loop; the current loop's already-shown titles
  do not reappear (deck spec, FR-010).
- What happens when a tab is empty? A friendly empty state invites the
  visitor to rate cards as they browse.
- What happens when a poster image is missing in a list? A placeholder is
  shown, like on deck cards; the entry remains readable.
- What happens with very large lists (hundreds of entries)? Browsing stays
  smooth and responsive.
- What happens when the visitor is offline? Already-saved lists remain
  viewable with an offline notice; changes require a connection.
- What happens when a visitor re-rates a title that is in the watching
  history? The history entry stays — the history is a log; only the
  watchlist tabs reflect the new rating.
- What happens if the visitor rates from the deck and re-rates from the
  watchlist in quick succession? The last action wins; no duplicates are
  created.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Watchlist MUST organize ratings into three tabs: Want to
  Watch, Loved, and Disliked. The Loved tab MUST also include titles rated
  Liked.
- **FR-002**: Each entry MUST show poster, title, year, rating state, and
  streaming availability.
- **FR-003**: Every rating recorded in the deck (Loved, Liked, Disliked,
  Want to Watch, Not Interested, Watching Now) MUST be stored; the watchlist
  shows Loved and Liked under the Loved tab, Want to Watch and Disliked
  under their own tabs, plus the watching history.
- **FR-004**: The visitor MUST be able to change a title's rating to any of
  the other five states (Loved, Liked, Disliked, Want to Watch, Not
  Interested) from the watchlist; "Watching Now" is set only by the deck's
  Watch Now action, never from the watchlist.
- **FR-005**: The visitor MUST be able to remove a rating entirely,
  returning the title to an unrated state.
- **FR-006**: The system MUST keep exactly one rating per visitor per
  title; re-rating updates it, never duplicates it.
- **FR-007**: The deck's exclusion rule MUST always reflect the current
  rating state: Disliked and Not Interested titles are excluded; any other
  or unrated state is eligible.
- **FR-008**: Every Watch Now lock-in MUST be recorded in a watching
  history with the title, choice time, and streaming links; the visitor
  MUST be able to reopen a history entry and its links. The history is a
  permanent log — re-rating the title later does NOT remove its entry.
- **FR-009**: Ratings and history MUST survive page refreshes and browser
  restarts for the same visitor.
- **FR-010**: Empty tabs and an empty history MUST show friendly empty
  states.
- **FR-011**: Lists MUST remain smooth and responsive with 500 or more
  entries.
- **FR-012**: While offline, already-saved lists MUST remain viewable with
  an offline notice.
- **FR-013**: The Watchlist MUST be reachable from the app's bottom
  navigation and remain fully usable at 360px viewport width with touch
  targets of at least 44px, in dark high-contrast styling.

### Key Entities *(include if feature involves data)*

- **Rating / Interaction**: the visitor's action on a title — one of Loved,
  Liked, Disliked, WantToWatch, NotInterested, or WatchingNow — plus when it
  happened. One per visitor per title; re-rating replaces the state and
  timestamp.
- **Watching History Entry**: a Watch Now decision — the title, the time it
  was chosen, and its streaming links.
- **Media Title**: as defined in the deck spec (002) — the shared title
  record the watchlist displays.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of ratings recorded in the deck appear in the correct
  watchlist tab or history immediately after recording.
- **SC-002**: After a re-rating or removal, the deck's next loop reflects
  the new state for 100% of titles (no stale exclusions).
- **SC-003**: 100% of ratings survive page refreshes and browser restarts
  for the same visitor.
- **SC-004**: Zero duplicate entries for the same title.
- **SC-005**: Lists with 500+ entries remain smooth to browse without
  noticeable delays.
- **SC-006**: A visitor can find and reopen any previously rated or watched
  title within 10 seconds from the watchlist or history.
- **SC-007**: The complete watchlist flow (browse, re-rate, remove, open
  history) is usable on a 360px-wide screen with touch input only.

## Assumptions

- Tabs: Want to Watch, Loved, Disliked — with the Loved tab also showing
  Liked titles. "Not Interested" ratings are recorded and used by the
  deck's exclusions but are not listed.
- The deck spec (002) owns the rating buttons and card advancing; this spec
  owns persistence, the watchlist and history views, re-rating, and the
  exclusion contract with the deck.
- Account sync is out of scope (auth spec, 004); guests keep ratings
  device-local, and the persistence contract in FR-009 applies to
  registered users across sessions once 004 lands.
- Removing a rating returns the title to an unrated state; the visitor may
  encounter it again in the deck.
- A rating change made mid-loop affects the next loop only (deck spec
  FR-010 still governs the running loop).
- Streaming links shown in the history come from the Match Found data
  (deck spec); if availability changes later, links are refreshed when the
  entry is reopened.
