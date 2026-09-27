# Implementation Plan: Ratings & Watchlist

**Branch**: `003-ratings-watchlist` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-ratings-watchlist/spec.md`

## Summary

Give the visitor a screen over the ratings they have already made: three tabs
(Want to Watch, Loved, Disliked), a watching history, and the ability to
re-rate or remove an entry — with the deck respecting the change on its next
loop.

The technical shape follows from one observation: **the data already exists.**
002 shipped `InteractionStore` over the frozen `playnext:interactions` document,
holding all six states and the append-only history. 003 adds a **read side**,
plus exactly two operations 002 never needed — re-rate from outside the deck
(which is just the existing `record`) and `remove(titleId)`. No new storage key,
no schema change, no new dependency.

So this is mostly a UI slice: a tabbed list, a shared detail view, a history
view, and the app's bottom navigation. The engineering weight sits in three
places — keeping the stored contract intact, keeping every recorded rating
reachable (see the two clarifications of 2026-09-26), and adding navigation
without breaking the deck's layout or its tests.

## Technical Context

**Language/Version**: TypeScript 6.0.x (Angular 22 requires `>=6.0.0 <6.1.0`),
the version spec 001 pinned and 002 used.

**Primary Dependencies**: Angular 22.2.0 (signals, standalone, zoneless),
Tailwind CSS v4, RxJS 7.8. **No new dependencies** — see
[research.md](./research.md) D8.

**Storage**: Browser LocalStorage, **existing key only** —
`playnext:interactions`, schema version 1, owned and frozen by 002
([contract](./contracts/watchlist-storage.md)). 003 adds no key and no field.

**Testing**: Vitest 5 through `@angular/build:unit-test`, jsdom 30 — the
existing setup. Run with `npm test`; `npx vitest run` fails on undefined test
globals because the Angular builder owns the config.

**Target Platform**: PWA, mobile-first — fully usable at 360px with touch, dark
by default, per constitution I.

**Project Type**: Web application — frontend only in this slice, as with 001
and 002.

**Performance Goals**: the deck's 300ms card budget is unaffected. For the
watchlist, FR-011 / SC-005 name 500+ entries staying smooth; the grouping and
lookup logic is bounded and unit-tested at that size, the rendering is a browser
check (research D7).

**Constraints**: no backend, no external calls, no API keys — Milestone 1 keeps
the mock catalog. The stored document is frozen; a document written by 003 must
be indistinguishable from one written by 002.

**Scale/Scope**: 3 new routes under a new shell route, 4 new components, 1 new
pure-logic module, 2 additions to existing files (`InteractionStore.remove`, the
tab-mapping table). Existing catalog of 48 titles unchanged.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | How this plan satisfies it |
|---|---|---|
| I. Mobile-First Experience | **PASS (with a manual gate)** | Bottom nav on every main screen, 360px target, every control ≥44px, dark default (FR-013). **Note:** this slice changes the deck's layout — the action bar is no longer at the viewport bottom — so 002's unverified FR-017/SC-008 must be re-checked here rather than inherited. Recorded as a manual step, not assumed. |
| II. Decision Speed & Simplicity | **PASS** | The watchlist is a **review** surface, not a discovery one: it shows decisions the visitor already made and never offers titles they haven't seen. Principle II forbids catalog-style browsing as the primary flow — the deck remains the entry point and nothing here competes with it. YAGNI: no pagination, no virtual scroll, no sort or filter controls (research D8). The "never a dead end" clause is the driving constraint behind both 2026-09-26 clarifications. |
| III. Guest-First Access | **PASS** | Guest-only, device-local, no account required at any point. The document read and written here is deliberately the payload 004 migrates into an account (002's design), so nothing in this slice has to change for that to work. |
| IV. API-First Architecture | **PASS (deferred)** | No backend in this slice, the same deferral as 001 and 002. No TMDB or JustWatch access, no keys, no external calls. The grouping logic is pure TypeScript so it relocates to the Domain layer in Milestone 2 with no behavioural change. |
| V. Test-First for Critical Paths | **PASS** | **Rating persistence is a named critical path in the constitution**, so Red-Green-Refactor applies directly rather than by analogy. Every guarantee in the storage contract gets a test written first: one entry per title, history stays append-only on removal, exclusions stay derived, removal makes a title eligible again. |
| VI. Deterministic Recommendations | **PASS** | Grouping and ordering are deterministic — a total order over a keyed map, no randomness, no ML. 003 does not touch the ranking engine; it changes what the engine reads on its next run (FR-007). |
| VII. Clean Architecture & Domain Integrity | **PASS (frontend scope)** | `features/watchlist/watchlist-logic/` holds framework-free grouping and counting, mirroring `deck-logic/` and `quiz-logic/`. The backend half of this principle does not apply until Milestone 2. |
| Standards: no new dependencies | **PASS** | Three tabs, a list and a nav are Tailwind and Angular primitives. The one candidate considered and rejected was a virtual scroller for FR-011 — recorded with its rationale in research D8. |
| Standards: one pattern per concern | **PASS** | Storage access keeps 002's read-after-write pattern rather than introducing a reactive store (research D4, with its caveat stated). The poster fallback is **extracted, not copied**, so the same behaviour does not exist twice (research D11). |
| Standards: no dead code | **PASS** | The only deletion is the poster markup, which moves rather than disappears. No `TODO`/`FIXME` is introduced; the deferred items are recorded in this plan. |

**No violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/003-ratings-watchlist/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── watchlist-storage.md   # read/write contract over 002's frozen document
├── checklists/
│   └── requirements.md  # spec quality (already passing)
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
frontend/src/app/
├── app.routes.ts                     # deck/watchlist become children of the shell route
├── app.ts / app.html                 # unchanged — the nav does NOT go here (D5)
├── core/
│   ├── models/
│   │   └── interaction.ts            # + WATCHLIST_SURFACES table (D3)
│   └── services/
│       └── interaction-store.ts      # + remove(titleId) (D2)
├── shared/
│   └── poster/                       # extracted from card.html — used by deck + watchlist (D11)
└── features/
    ├── shell/
    │   └── shell.ts / shell.html     # bottom nav + <router-outlet> (D5)
    ├── watchlist/
    │   ├── watchlist-logic/          # pure TypeScript, no Angular imports (D1, D3)
    │   │   └── entries.ts            # grouping, counts, ordering, catalog lookup
    │   ├── watchlist.ts / .html      # the tabbed list
    │   ├── entry/                    # one list row (poster, title, year, state, availability)
    │   ├── detail/                   # shared detail view + re-rate + remove (D9)
    │   └── history/                  # the watching-history list
    └── deck/
        ├── card/                     # poster markup moves out (D11)
        └── deck.html                 # action bar sits above the nav, not at the viewport bottom
```

**Structure Decision**: the existing `frontend/` workspace is extended; no new
project. Watchlist rules go in `watchlist-logic/` as framework-free modules,
exactly as `features/quiz/quiz-logic/` and `features/deck/deck-logic/` do.

**One new pattern, proposed here as the standards require**: a
`frontend/src/app/shared/` directory for presentational components used by more
than one feature, starting with the extracted `Poster`. `core/` is state and
contracts; a shared component is neither. Introducing it now, with one member,
is cheaper than the alternative — a second copy of the poster fallback inside
`features/watchlist/`, which is exactly the divergence the "one pattern per
concern" standard exists to prevent.

**Routes**, with the collisions resolved by path shape rather than ordering:

```text
''                        → Entry (boot hop)          — outside the shell
'quiz'                    → Quiz                      — outside the shell
  ── shell (bottom nav) ──
'deck'                    → Deck
'deck/match/:titleId'     → MatchFound
'watchlist'               → Watchlist (tabs)
'watchlist/history'       → History
'watchlist/title/:titleId'→ Detail
```

`watchlist/title/:titleId` rather than `watchlist/:titleId`, so the history
route cannot be shadowed by a title id — path shape over route ordering, which
is the kind of thing that breaks silently when someone reorders an array.

## Design Decisions Carried Into Phase 0

These most affect downstream work; each is expanded with alternatives in
[research.md](./research.md).

1. **002's storage contract is untouched.** No new key, no new field, no schema
   bump. `remove` deletes a key, and absence already means "unrated" — so a
   document written by 003 is indistinguishable from one written by 002. This is
   the single most important compatibility decision here, and it is what keeps
   004's migration a data move rather than a data reconciliation.
2. **Every recorded rating has a surface.** `watchingNow` lives in the history;
   `notInterested` sits in the Disliked tab, labelled. FR-003 was amended to
   require this, because the alternative — a rating that is stored and then
   hidden — is a state the visitor can enter and never leave.
3. **The history is a log, the ratings map is a state.** Removal edits the map
   and leaves the log alone. Two shapes, two meanings, deliberately not unified.
4. **Navigation is a layout route, not a condition.** The nav belongs to the
   routes that should have it, expressed with the router rather than an `@if`
   on the URL.
5. **The store stays non-reactive.** Read on construction, re-read after your
   own writes. The caveat is recorded: this holds only while one view is alive
   at a time.

## Post-Design Constitution Re-check

*Re-evaluated after Phase 1 design artifacts were written.*

All gates still **PASS**. Two are strengthened by the design rather than merely
satisfied:

- **II. Decision Speed & Simplicity** — the design surfaced a dead end the spec
  had shipped with (`notInterested` recorded but unlisted, unreachable once set)
  and closed it. Principle II's "never a dead end" clause is what made it
  visible; it was not caught by reading requirements in isolation. A second,
  narrower instance — a `watchingNow` title reachable only through a history
  view that offered no re-rating — was closed by the same reasoning (research
  D9).
- **V. Test-First** — the storage contract's guarantees became the test list
  before any component was designed. Because removal is the one new mutation,
  the append-only-history guarantee is the test most likely to be quietly
  broken, and it is now written down as a contract clause rather than left as
  an implementation detail.

One gate gained a **manual obligation** rather than a pass: Principle I. This
slice adds a bottom nav and changes the deck's vertical layout, so 002's
FR-017 / SC-008 — never verified in a browser — must be re-checked here.
Inheriting an unverified claim across a layout change would be exactly the kind
of unearned assertion the constitution's verification standard forbids.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| *None* | — | — |

The one new structural element — the `shared/` directory — is a proposed
pattern, not a complexity violation: it replaces duplication rather than adding
abstraction. See Structure Decision.

## Deferred (recorded, not silently dropped)

| Item | Deferred to | Why |
|---|---|---|
| Server-side ratings | Milestone 3 | Constitution IV; the document is already shaped for migration |
| Account sync and merge | spec 004 | 004 owns guest→account migration |
| Live TMDB/JustWatch data | Milestone 2 | `CatalogService` is the seam; unchanged here |
| Bottom-nav badges / unread counts | not planned | No notification concept exists; YAGNI |
| Virtual scrolling for very large lists | reopen research D8 | Only if a browser measurement shows 500 rows are not smooth |
| Sort and filter controls on the watchlist | not planned | Principle II — the watchlist is a review surface, not a browsing one |
| 360px / FR-017 browser verification | this feature, manual | Carry-over from 002 **and** a fresh obligation: the deck's layout changes here |
