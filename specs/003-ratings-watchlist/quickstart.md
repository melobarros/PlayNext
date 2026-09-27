# Quickstart & Validation Guide: Ratings & Watchlist

**Feature**: 003 | **Date**: 2026-09-26

Runnable validation scenarios proving the watchlist works end-to-end, mapped to
the spec's acceptance scenarios and success criteria. Implementation details live
in `tasks.md`; this guide stays a run/verify reference.

## Prerequisites

- Node.js `^22 || ^24 || ^26` + npm
- Specs 001 and 002 merged (the watchlist reads the ratings the deck writes)
- Latest Chrome or Firefox, plus DevTools device emulation at 360px for touch
  checks
- No backend and no API keys — Milestone 1 keeps the mock catalog

## Setup & run

```bash
cd frontend
npm install
npm start          # → http://localhost:4200
```

Complete the quiz to reach the deck, rate a few titles, then use the bottom
navigation to open the Watchlist.

**State persists between runs.** To start clean, use a private window or:

```js
localStorage.clear()   // DevTools console, then reload
```

To reach a specific state quickly, write it directly (the schema is frozen and
documented in
[`../002-recommendation-deck/contracts/interaction-storage.md`](../002-recommendation-deck/contracts/interaction-storage.md)):

```js
// five titles across every tab and the history, in one paste
localStorage.setItem('playnext:interactions', JSON.stringify({
  schemaVersion: 1,
  interactions: {
    'midnight-static': { state: 'loved',        updatedAt: new Date().toISOString() },
    'paper-lanterns':  { state: 'liked',        updatedAt: new Date().toISOString() },
    'the-long-quiet':  { state: 'wantToWatch',  updatedAt: new Date().toISOString() },
    'salt-and-ash':    { state: 'disliked',     updatedAt: new Date().toISOString() },
    'neon-verdict':    { state: 'notInterested',updatedAt: new Date().toISOString() },
  },
  history: [{ titleId: 'midnight-static', chosenAt: new Date().toISOString() }],
  updatedAt: new Date().toISOString(),
}));
```

*(Replace the ids with real ones from
`frontend/src/app/core/models/media-catalog.data.ts` — the ones above are
illustrative.)*

## Test commands

```bash
cd frontend
npx ng test --watch=false    # single run
npm test                     # watch mode — use this, not `npx vitest run`
npm run build                # production build must succeed (quality gate)
```

Critical-path tests (constitution V — Red-Green-Refactor, written before
implementation):

| Test | Covers |
|------|--------|
| Every rating in the deck appears in its tab immediately | FR-003, SC-001 |
| Liked appears in the Loved tab; Not Interested in the Disliked tab, labelled | FR-001, US1 scenario 2 |
| Re-rating moves an entry between tabs, and never duplicates it | FR-004, FR-006, SC-004 |
| Removing a rating makes the title eligible in the deck again | FR-005, FR-007, SC-002 |
| Re-rating away from Disliked makes the title eligible again | FR-007, SC-002 |
| Removing a rating does **not** remove its watching-history entry | FR-008 |
| Ratings survive a reload | FR-009, SC-003 |
| Every state in the vocabulary maps to exactly one surface | data-model.md — no state stored and invisible |
| A rated title missing from the catalog renders as unavailable and stays removable | FR-002 edge case |
| Grouping 500+ entries stays correct | FR-011, SC-005 (logic only — see below) |

## Manual validation walkthrough (acceptance scenarios)

1. **Tabs (US1 scenario 1)**: rate a title Want to Watch in the deck, open the
   Watchlist → it is in the Want to Watch tab with poster, title, year and
   streaming availability.
2. **Merged tabs (US1 scenario 2)**: rate titles Loved, Liked, Disliked and Not
   Interested → Liked is in the Loved tab; Disliked and Not Interested are both
   in the Disliked tab, each labelled with its own state so they are told apart.
3. **Details (US1 scenario 3)**: tap an entry → the title's details open with
   its streaming links.
4. **Persistence (US1 scenario 4)**: reload the page, and reopen the browser →
   every tab and entry is intact.
5. **Re-rate (US2 scenario 1)**: from the Disliked tab, change a title to Loved
   → it moves to the Loved tab.
6. **Remove (US2 scenario 2)**: remove a Want to Watch entry → it leaves the
   tab without disturbing the others, and the other tabs still render.
7. **Deck respects the change (US2 scenarios 3–4, SC-002)**: after changing a
   title from Disliked to Loved, start a new deck loop → the title can be
   suggested again. Then rate a title Disliked from the watchlist → the deck
   excludes it.
8. **History (US3 scenarios 1–3)**: lock in two choices with Watch Now; open the
   history → both appear with their choice time and working streaming links.
   Reopen one → the links are still correct. With a cleared store, the history
   shows a friendly empty state.
9. **History survives removal (FR-008)**: remove the rating for a title you
   watched → its history entry is still there.
10. **Empty tabs (Edge Cases)**: clear everything → each tab shows a friendly
    empty state inviting the visitor to rate cards, not a blank panel.
11. **Poster fallback (Edge Cases)**: point a rated title's `posterUrl` at a bad
    URL in the catalog → the list shows the placeholder and the row stays
    readable.
12. **Offline (FR-012)**: load the watchlist, then DevTools → Network → Offline
    → the saved lists remain viewable with an offline notice.
13. **360px touch (FR-013, SC-007)**: at 360px with touch emulation, browse the
    tabs, re-rate, remove, and open the history → no horizontal scrolling, every
    control ≥44px, the bottom nav reachable, both nav and content usable.
14. **Scale (FR-011, SC-005)**: paste a 500-entry interactions document into
    LocalStorage → the tabs render and stay smooth to scroll.

## Expected outcomes

- **SC-001, SC-002, SC-003, SC-004** are enforced by the critical-path tests.
- **SC-005** (500+ entries smooth) is split: the grouping logic is unit-tested at
  500+; the *rendering* is step 14, a browser check. jsdom has no layout engine,
  so the plan does not claim to have verified smoothness.
- **SC-006** (find a title within 10 seconds) is a usability goal — design
  review confirms tabs and history are one tap from the nav; it is not
  machine-checkable.

## What this slice does not include

- **Server-side persistence.** Ratings stay device-local until Milestone 3;
  clearing browser data loses them (FR-009 is per-device, per the spec's
  Assumptions).
- **Accounts and sync.** Spec 004 owns guest→account migration.
- **Live media data.** Still the mock catalog; Milestone 2 replaces
  `CatalogService`'s source behind the existing seam.
- **Any change to how ratings are made in the deck.** The deck's action bar is
  002's; 003 reads what it writes. The one deck change in this slice is layout:
  the bottom nav is added beneath the action bar (research D5).
