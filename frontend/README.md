# PlayNext — frontend

Mobile-first PWA that helps you decide what to watch. This package is the
Angular client; the API lives in `../backend` (Milestone 2+).

Generated with Angular CLI 22.2.0.

## Prerequisites

- **Node.js** `^22`, `^24`, or `^26` (Angular 22 dropped Node 20)
- **npm** 11+

No backend, no API keys, and no environment variables are needed for the
onboarding quiz — all of its options are static config served through
`QuizOptionsService`.

## Setup

```bash
npm install
```

## Run

```bash
npm start          # ng serve → http://localhost:4200
```

The app opens on the quiz. `npm run watch` builds continuously instead.

## Test

```bash
npm test                      # ng test — Vitest in watch mode
npx ng test --watch=false     # single run (CI)
```

Business rules live in framework-free TypeScript
(`src/app/features/quiz/quiz-logic/quiz-rules.ts`), so most of the suite needs
no DOM and no TestBed.

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
  app.routes.ts            '' → boot, /quiz, /deck (stub until feature 002)
  core/models/             domain types + the static quiz option catalog
  core/services/           PreferenceStore (LocalStorage), QuizOptionsService
  features/quiz/
    quiz-logic/            pure rules — validation, transitions, retake
    steps/                 the three quiz screens + shared choice chips
    summary/               answer recap and the retake entry point
  features/deck/           placeholder until feature 002
```

### Where state lives

Guest answers are persisted to LocalStorage under `playnext:quiz-state` as a
single versioned JSON document. That shape is a **frozen contract** shared with
the deck (002), the watchlist (003), and the account migration (004) — see
[`../specs/001-onboarding-quiz/contracts/preference-storage.md`](../specs/001-onboarding-quiz/contracts/preference-storage.md)
before changing it.

An unreadable document, or one written by a newer schema version, is treated as
a first visit and cleared rather than repaired.

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

- Feature spec: [`../specs/001-onboarding-quiz/spec.md`](../specs/001-onboarding-quiz/spec.md)
- Validation walkthrough: [`../specs/001-onboarding-quiz/quickstart.md`](../specs/001-onboarding-quiz/quickstart.md)
- Project principles: [`../.specify/memory/constitution.md`](../.specify/memory/constitution.md)

---

## Angular CLI reference

```bash
ng generate component component-name   # scaffold
ng generate --help                     # all available schematics
```

Full command reference: <https://angular.dev/tools/cli>.
