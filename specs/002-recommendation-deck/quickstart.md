# Quickstart & Validation Guide: Recommendation Deck

**Feature**: 002 | **Date**: 2026-09-26

Runnable validation scenarios proving the deck works end-to-end, mapped to the
spec's acceptance scenarios and success criteria. Implementation details live in
`tasks.md`; this guide stays a run/verify reference.

## Prerequisites

- Node.js `^22 || ^24 || ^26` + npm
- The spec 001 workspace in `frontend/` (the deck builds on its app shell,
  storage contract, and quiz output)
- Latest Chrome or Firefox, plus DevTools device emulation at 360px for touch
  checks
- No backend and no API keys — Milestone 1 drives the deck from the mock
  catalog in `core/models/media-catalog.data.ts`

## Setup & run

```bash
cd frontend
npm install
npm start          # → http://localhost:4200
```

The app opens on the quiz (spec 001). Finish it to reach the deck.

**State persists between runs.** Once you have rated titles, reopening returns
you to the deck with the same ratings. For a clean run, use a private window or:

```js
localStorage.clear()   // DevTools console, then reload
```

## Test commands

```bash
cd frontend
npx ng test --watch=false    # single run
npm test                     # watch mode
npm run build                # production build must succeed (quality gate)
```

Critical-path tests (constitution V — Red-Green-Refactor, written before
implementation):

| Test | Covers |
|------|--------|
| A title unavailable on the selected services is never suggested | FR-006, **Filter Enforcement invariant** |
| "Show content on other platforms" disables the provider filter | FR-006, spec 001 FR-006 |
| A Disliked title is never suggested again in the same loop | FR-009, **Feedback Loop invariant** |
| A Disliked title is still excluded in a later session | FR-009, SC-004 |
| A Not Interested title is excluded identically to Disliked | FR-009 |
| Re-rating away from Disliked makes a title eligible again | spec 003 FR-007 (contract compatibility) |
| Identical inputs produce an identical sequence | FR-011, SC-005 |
| A title already shown does not reappear until the loop restarts | FR-010 |
| A swipe records no interaction | FR-004 |
| Rating advances the deck and records exactly one interaction | FR-007 |
| Watch Now stops the loop and appends one history entry | FR-008 |
| No matches produces the empty state, not an error | FR-014 |
| The next card is chosen in well under 300ms | FR-012, SC-002 |

## Manual validation walkthrough (acceptance scenarios)

1. **First card (US1 scenario 1)**: complete the quiz → the deck shows a card
   immediately, with no further input.
2. **Advance (US1 scenario 2)**: swipe left, then tap the advance action →
   exactly one new card each time; nothing is recorded as a rating.
3. **Relevance (US1 scenarios 3–4)**: with Movie + Horror and two services
   selected, every card is a horror movie available on one of those services.
4. **No repeats (US1 scenario 5)**: advance through 15+ cards → no title
   appears twice.
5. **Rating (US2 scenario 1)**: tap Loved It → the next card appears and
   `playnext:interactions` in DevTools → Application → Local Storage shows the
   rating recorded.
6. **Watch Now (US2 scenarios 2–3)**: tap Watch Now → the loop stops, Match
   Found opens with working links to the official services, a trailer button
   (opens in a new tab), and a start-new-loop action.
7. **Permanence (US3)**: rate a title Disliked, then reload and advance
   through 30+ cards → it never returns.
8. **Un-dislike (contract check)**: in the console, set that title's
   interaction state to `"loved"`, reload, start a new loop → the title is
   eligible again. This is the behavior spec 003 depends on.
9. **Empty state (US4 scenarios 2–3)**: narrow the quiz answers until nothing
   matches (a rare genre + a service with no matching titles) → an empty state
   with Reset Filters; tapping it reopens the quiz with previous answers
   pre-filled, and completing it starts a new loop.
10. **Offline (US4 scenario 4)**: load the deck, then DevTools → Network →
    Offline → keep swiping → already-loaded cards still work with an offline
    notice.
11. **Poster fallback (FR-016)**: block `image.tmdb.org` in DevTools (or point
    a mock poster at a bad URL) → the placeholder appears and the card stays
    readable.
12. **360px touch (FR-017, SC-008)**: at 360px with touch emulation, browse,
    rate, and complete Watch Now → no horizontal scrolling, every control
    ≥44px, action bar sticky.
13. **Determinism (SC-005)**: `localStorage.clear()`, answer the quiz
    identically twice → the card sequence is identical both times.

## Expected outcomes

- **SC-001** (median < 2 min to Watch Now) and **SC-007** (90% reach 10+ cards)
  are product telemetry goals — measurable once analytics exist (Milestone 4).
  Design reviews verify no added friction.
- **SC-002** (300ms) is verifiable in the browser: the ranking is
  sub-millisecond, so a missed budget points at the poster image, not the
  engine.
- **SC-003/004/005/006** are enforced by the critical-path tests above.

## What this slice does not include

- **Live media data.** Titles come from the mock catalog. Milestone 2 replaces
  `CatalogService`'s data source with the REST API; no component or rule
  changes, per the plan's API-First seam.
- **The watchlist and history views.** Ratings are recorded here and are
  readable at `playnext:interactions`; spec 003 owns the UI over them and the
  re-rating/removal flows.
- **Bottom navigation.** The deck is full-screen in this slice; spec 003 adds
  the app's bottom navigation when there is more than one destination.
- **Accounts.** Guest-only, device-local; spec 004 migrates these documents.
