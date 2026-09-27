# PlayNext — frontend

Mobile-first PWA that helps you decide what to watch. This package is the
Angular client; the API lives in `../backend` (Milestone 2+).

Generated with Angular CLI 22.2.0.

## Prerequisites

- **Node.js** `^22`, `^24`, or `^26` (Angular 22 dropped Node 20)
- **npm** 11+

No backend, no API keys, and no environment variables are needed for the
onboarding quiz or the recommendation deck — the quiz's options are static
config served through `QuizOptionsService`, and the catalog is a bundled array
served through `CatalogService`.

**API keys never ship to the client.** When the catalog becomes a real TMDB
call (Milestone 2) it goes through the backend, which holds the credentials and
caches the responses; the Angular app talks only to our own API.

## Setup

```bash
npm install
```

## Run

```bash
npm start          # ng serve → http://localhost:4200
```

The app opens on the quiz the first time, and on the deck once the quiz has been
answered. `npm run watch` builds continuously instead. From there the bottom nav
reaches the deck and the watchlist; a title's details, and the watching history,
are one tap further in.

## Test

```bash
npm test                      # ng test — Vitest in watch mode
npx ng test --watch=false     # single run (CI)
```

Business rules live in framework-free TypeScript — `features/quiz/quiz-logic/`
and `features/deck/deck-logic/` — so most of the suite needs no DOM and no
TestBed.

Use `npm test`, not `npx vitest run`. The Angular builder owns the Vitest
config, so invoking the binary directly leaves the test globals undefined and
the suite fails on `describe is not defined`.

## Build

```bash
npm run build      # production build → dist/playnext
```

The production build emits the service worker (`ngsw-worker.js`), the web
manifest, and an offline app shell. Verify service-worker behaviour against a
**served production build**, not `ng serve` — the worker is disabled in dev
mode by design.

```bash
npx http-server dist/playnext/browser   # any static server works
```

## Project layout

```
src/app/
  app-boot.ts              entry hop: reads saved state, forwards to quiz or deck
  app.routes.ts            '' → boot, /quiz, then the shell's children
  shell/                   the frame: bottom nav + outlet (FR-013, 003)
  core/models/             domain types + the static quiz and catalog data
  core/services/           stores (LocalStorage), quiz options, catalog, connectivity
  shared/                  presentational pieces used by more than one feature
  features/quiz/
    quiz-logic/            pure rules — validation, transitions, retake
    steps/                 the three quiz screens + shared choice chips
    summary/               answer recap and the retake entry point
  features/deck/
    deck-logic/            pure rules — ranking, scoring, loop transitions, swipe
    card/                  the poster card (FR-002, FR-016)
    actions/               the rating bar; reports taps, holds no state
    empty-state/           why there is no card, and the way out of it (FR-014)
    match-found/           where the chosen title lands (FR-008)
  features/watchlist/
    watchlist-logic/       pure rules — grouping, ordering, catalog lookup, dates
    entry/                 one watchlist row; presentation only
    detail/                the shared title view + re-rate + remove
    history/               the watching-history list (US3)
```

### Two tiers of route

`''` (the entry hop) and `/quiz` sit **outside** the shell; everything else is a
child of it. A route's tier *is* whether it has a bottom nav, so the shell spec
navigates real URLs rather than mounting the component.

`/watchlist/title/:titleId` carries the `title/` segment for a reason: without
it the route would be `/watchlist/:titleId` and `/watchlist/history` would be
shadowed by whichever was declared first. A path shape that cannot collide beats
an ordering everyone has to remember, and `history.spec.ts` asserts the address
opens the history rather than a detail view for a title called "history".

### The `*-logic/` convention

Everything under `features/*/[name]-logic/` is plain TypeScript: no Angular
imports, no DOM, no storage. `quiz-logic/`, `deck-logic/` (`deck-session.ts`,
`recommend.ts`, `swipe.ts`) and `watchlist-logic/` (`entries.ts` for grouping,
ordering and lookup; `dates.ts` for the history's date rule) are functions over
values, which is why their specs need no TestBed.

Components keep the parts that genuinely need a runtime — reading stores,
handling pointer events, navigating. `deck.ts` is the only file that knows about
Angular, storage, and gestures at once.

### The `shared/` convention

`src/app/shared/` holds presentational components and formatting helpers used by
**more than one feature**. `core/` is state and contracts; a shared component is
neither, which is why the poster does not live in `features/deck/card/` where it
started.

The rule that admits a member is a *second* caller, not a plausible one (YAGNI):
`poster/` (the card and every watchlist row), `ways-to-watch/` (Match Found and
the detail view), `display-names.ts` (provider and genre ids → names, on three
screens), and `title-facts.ts` (`formatRating` / `formatRuntime`, in the card
and the detail view). Each was extracted when the duplicate appeared, and the
extraction kept the original spec green without editing it — which is the check
that it moved a behaviour rather than changing one.

The history's date format is **not** here. It has one caller, so it lives in
`watchlist-logic/dates.ts` until a second one exists.

### Where state lives

Everything lives in LocalStorage, one versioned JSON document per key:

| Key | Holds | Durability |
|-----|-------|------------|
| `playnext:quiz-state` | the guest's quiz answers | **Frozen contract.** Shared with the deck (002), the watchlist (003), and the account migration (004) — see [`../specs/001-onboarding-quiz/contracts/preference-storage.md`](../specs/001-onboarding-quiz/contracts/preference-storage.md) before changing it. |
| `playnext:interactions` | ratings and the watch history | **Frozen contract.** One rating per title (keyed by title id), plus an append-only log of Watch Now decisions — see [`../specs/002-recommendation-deck/contracts/interaction-storage.md`](../specs/002-recommendation-deck/contracts/interaction-storage.md) and [`../specs/003-ratings-watchlist/contracts/watchlist-storage.md`](../specs/003-ratings-watchlist/contracts/watchlist-storage.md). Survives re-taking the quiz: the answers change, what you already told us about a title does not. |
| `playnext:deck-session` | which titles this loop has already shown | Throwaway. Re-take the quiz and the loop starts over (FR-014). |

An unreadable document, or one written by a newer schema version, is treated as
a first visit and cleared rather than repaired.

**Removing a rating touches `interactions` only.** The watch history is a log of
what happened, not of what you currently think, so a title you watched and later
unrated keeps its entry (003 FR-008).

The watchlist is a **derived view**: no fourth storage key, nothing cached. The
tabs, their counts and the history are computed from the interaction document
plus the catalog every time either changes, so a tab badge cannot disagree with
the rows beneath it. The same holds for the deck's current card, which is
**derived, never stored**
([research D5](../specs/002-recommendation-deck/research.md)): ranking is
deterministic (FR-011), so recomputing after a reload lands on the same card
without a cursor to persist and desynchronise.

Streaming links are resolved from the catalog **at render time**, never read
back from anything saved. A saved link would be a snapshot of availability at
the moment of rating, and a dead deep link in your own watchlist is worse than
one that reflects today's truth.

### Testing gestures in jsdom

The swipe path is covered at two levels: `deck-logic/swipe.ts` takes plain
`{x, y, t}` samples, so most of it is tested as arithmetic, and `deck.spec.ts`
drives the real pointer handlers on the card. jsdom's `PointerEvent` is a real
constructor but the surrounding implementation is partial — these are the
constraints that cost time to rediscover
([research D11](../specs/002-recommendation-deck/research.md)):

- **Never pass `view: window`.** The init dictionary member throws in jsdom.
- **`setPointerCapture` / `releasePointerCapture` do not exist.** Production
  code calls them as `el.setPointerCapture?.(id)` — a nicety the gesture works
  without, not a requirement.
- **`event.timeStamp` cannot be set by a test.** It is read-only and derived
  from the real clock, so a velocity assertion has to come through
  `swipeDecision` and hand-built samples rather than a synthesised gesture.
- **jsdom never derives pointer events from mouse events,** and `TouchEvent` is
  unusable. Dispatch `new PointerEvent('pointermove', { clientX, clientY })`
  directly.

### Styling

Tailwind CSS v4, configured CSS-first in `src/styles.css` via `@theme` — there
is no `tailwind.config.js`. Two things to know before adding styles:

- `@source "./app"` is what makes Tailwind scan the inline templates in `.ts`
  files. Without it those utilities are silently dropped from the build.
- `@apply` inside a *component's* styles needs `@reference "tailwindcss";` at
  the top of that file.

Dark, high-contrast is the default theme, and every interactive target is at
least 44px tall (the `touch-target` utility).

## Further reading

- Onboarding quiz: [`spec.md`](../specs/001-onboarding-quiz/spec.md) ·
  [walkthrough](../specs/001-onboarding-quiz/quickstart.md)
- Recommendation deck: [`spec.md`](../specs/002-recommendation-deck/spec.md) ·
  [walkthrough](../specs/002-recommendation-deck/quickstart.md) ·
  [scoring rules](../specs/002-recommendation-deck/contracts/recommendation-engine.md)
- Ratings & watchlist: [`spec.md`](../specs/003-ratings-watchlist/spec.md) ·
  [walkthrough](../specs/003-ratings-watchlist/quickstart.md) ·
  [storage contract](../specs/003-ratings-watchlist/contracts/watchlist-storage.md)
- Project principles: [`../.specify/memory/constitution.md`](../.specify/memory/constitution.md)

---

## Angular CLI reference

```bash
ng generate component component-name   # scaffold
ng generate --help                     # all available schematics
```

Full command reference: <https://angular.dev/tools/cli>.
