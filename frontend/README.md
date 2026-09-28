# PlayNext — frontend

Mobile-first PWA that helps you decide what to watch. This package is the
Angular client; the API lives in [`../backend`](../backend).

Generated with Angular CLI 22.2.0.

## Prerequisites

- **Node.js** `^22`, `^24`, or `^26` (Angular 22 dropped Node 20)
- **npm** 11+

No backend, no API keys, and no environment variables are needed to *use* the
app — as a guest, every feature works, because every feature reads LocalStorage.
The quiz's options are static config served through `QuizOptionsService` and the
catalog is a bundled array served through `CatalogService`; nothing is fetched.

**API keys never ship to the client.** When the catalog becomes a real TMDB
call (Milestone 2) it goes through the backend, which holds the credentials and
caches the responses; the Angular app talks only to our own API.

## Run with the backend

Accounts and sync (004) need the API, and the API needs .NET SDK 9, PostgreSQL,
and two secrets in user-secrets. None of that is required for guest mode.

```bash
# terminal 1
cd ../backend
dotnet run --project src/PlayNext.Api

# terminal 2
npm start
```

The client calls the API on its own origin — `API_BASE_URL` defaults to `''`, so
requests go to `/api/...` — and `proxy.conf.json` forwards those to the backend
on `http://localhost:5003`. Production wants the same shape for the same reason:
one origin means no CORS preflight on ordinary requests. The full setup —
creating the connection string and JWT signing key, applying migrations, and the
walkthrough that verifies the feature end to end — is in the
[004 quickstart](../specs/004-guest-auth-migration/quickstart.md).

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
  core/services/           stores (LocalStorage), quiz options, catalog, connectivity,
                           and the auth/sync layer: auth, account-cache, session-boot,
                           sync, write-sink, session.interceptor
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
| `playnext:session` | who is signed in — a user id and an email, and **never a credential** | **Frozen contract.** Written by `AuthService` and nothing else. Holds no token by design: the access token lives in memory for its fifteen minutes and the refresh token is in an httpOnly cookie no script can read ([004 storage contract](../specs/004-guest-auth-migration/contracts/device-storage.md)). |
| `playnext:sync-pending` | signed-in changes that have not reached the account yet | **Frozen contract.** Written by `SyncService` and nothing else. FIFO, never deduplicated on the device, and cleared only once the server confirms the sync. |

One more key lives in **sessionStorage** and is deliberately short-lived:
`playnext:account-nudge-dismissed`, so turning down the invitation to sign up
holds for the rest of the tab session and no longer. A rejection is a decision
about now, not a setting.

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

### How auth reaches code that predates it

001–003 do not know that accounts exist, and 004 did not rewrite them to find
out. The seam is `WriteSink`: the stores (`InteractionStore`, `PreferenceStore`)
announce what they just wrote, and `SyncService` — the only observer — decides
what that means for an account. Nothing in the deck, the watchlist, or the quiz
mentions sessions or HTTP, which is why 004 changed almost none of their code.

The other direction is a cache, not a second source of truth. When the server
returns canonical state, `AccountCache` writes it into the same two 001/002
documents the app already reads, so a signed-in visitor's screens render the
account's copy without knowing it.

Four pieces do the work:

- **`auth.service.ts`** holds the access token **in memory only** and the
  session marker in LocalStorage. Putting the token in storage would trade a
  real XSS exposure for surviving a reload, and a reload is handled by the
  refresh cookie instead.
- **`session.interceptor.ts`** attaches that token to every `/api` request that
  should carry one, and handles a 401: one silent refresh, one retry, and on a
  *refusal* a drop to guest mode with the cached data intact. It skips
  `/api/auth/`, where a 401 is an answer rather than an expiry — a wrong
  password must not be retried, because `/auth/login` counts failures against
  the five-attempt lockout.
- **`session-boot.ts`** runs once at start and distinguishes the two ways a
  refresh can fail: the server refused (the session is over) from the server was
  never reached (nothing is known, so the visitor stays signed in and works from
  the cache). Once the session is confirmed it also settles the two copies
  against each other — the account's state down into the cache, then whatever
  this device queued while it was offline back up, in that order, so the
  account's merged answer is the last thing written. Boot is *also* what brings
  `SyncService` into existence, and its constructor is where `WriteSink` gains
  its only observer: without that, a rating taken on the deck is announced to
  nobody, and nothing fails.
- **`sync.service.ts`** pushes a signed-in write, queues it when the network is
  down, and writes the server's canonical response back through `AccountCache`.
  It also owns the queue's two ways out: the connection returning (it subscribes
  to `Connectivity.cameOnline` — the *transition*, since "online" is true all
  the time and a level cannot say "it just came back") and, via `SessionBoot`,
  the app opening.
- **`connectivity.ts`** answers both questions the app has about the network:
  `isOnline` for a banner that has to know the current state, `cameOnline` for
  the queue, which has to know it changed.

`expire()` and `signOut()` are deliberately not one method. Expiry drops the
marker and keeps the cache, because the visitor did not ask to leave; signing
out removes the account's data from the device, because they did.

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
- Accounts & migration: [`spec.md`](../specs/004-guest-auth-migration/spec.md) ·
  [walkthrough](../specs/004-guest-auth-migration/quickstart.md) ·
  [API contract](../specs/004-guest-auth-migration/contracts/api.md) ·
  [storage contract](../specs/004-guest-auth-migration/contracts/device-storage.md)
- Project principles: [`../.specify/memory/constitution.md`](../.specify/memory/constitution.md)

---

## Angular CLI reference

```bash
ng generate component component-name   # scaffold
ng generate --help                     # all available schematics
```

Full command reference: <https://angular.dev/tools/cli>.
