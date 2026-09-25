# Research: Onboarding Mood Quiz

**Feature**: 001 | **Date**: 2026-09-25

Resolves every Technical Context unknown. Versions verified against the
npm registry, angular.dev, and endoflife.date (September 2026).

## Decision: Angular 22.2.0

- **Rationale**: Latest stable (v22 released 2026-06-03; 22.2.0 published
  2026-09-23). Majors every ~6 months with 18-month support each; v21 is
  already LTS-only. Starting on v22 buys ~9 months of active support.
- **Alternatives considered**: v21 (LTS-only, security fixes only —
  rejected); waiting for v23 (~Nov/Dec 2026 — rejected, would stall the
  slice).

## Decision: Scaffold with the CLI defaults (zoneless, standalone, strict)

- **Rationale**: `standalone: true` has been default since v19, zoneless
  change detection is default since v21 (no zone.js), `strict` is default.
  A greenfield project should take every default — nothing to configure
  and no legacy idioms to unlearn. `ChangeDetectionStrategy.OnPush` is the
  default in v22 (`Default` is deprecated).
- **Scaffold command** (project name `playnext`, created in the
  `frontend/` directory):
  `ng new playnext --directory=frontend --style=tailwind --routing
  --ssr=false --test-runner=vitest --package-manager=npm`
- **Alternatives considered**: NgModules + zone.js (obsolete — rejected);
  SSR (`--ssr=true` — rejected: a PWA with LocalStorage state adds
  hydration complexity for zero product value in this slice; YAGNI).

## Decision: Tailwind CSS 4.3.3, CSS-first configuration

- **Rationale**: v4 is current (4.3.3); v3 is obsolete. `--style=tailwind`
  in `ng new` scaffolds it directly; configuration is CSS-first (`@theme`
  in styles.css) with no `tailwind.config.js`.
- **Gotchas adopted as constraints**: the Angular application builder only
  reads `.postcssrc.json` (not `postcss.config.js`); styles use `.css`
  (v4 directives conflict with Sass); `@apply` inside component styles
  needs `@reference "tailwindcss";` at the top of the file.
- **Alternatives considered**: v3 (obsolete — rejected); Angular Material
  with a custom dark theme (rejected — the PRD prefers Tailwind for the
  card/deck aesthetic; Material would add a large dependency for chips
  only).

## Decision: Vitest as the test runner (CLI default)

- **Rationale**: Karma was deprecated and removed from the application
  builder in v20; `--test-runner=vitest` is the default in v21/v22 via
  `@angular/build:unit-test`, with zero-config `ng test` on jsdom.
- **Alternatives considered**: Jest via jest-preset-angular
  (community-only, not first-party — rejected for a greenfield project).

## Decision: PWA via `ng add @angular/pwa`, no custom service worker yet

- **Rationale**: The official schematic installs `@angular/service-worker`,
  generates `ngsw-config.json` + `manifest.webmanifest`, and wires
  `provideServiceWorker` for standalone apps. Sufficient for this slice's
  needs (installable shell, static asset caching, offline quiz shell).
- **Known limitation**: the Angular service worker is maintenance-mode
  ("simple offline support" only). Background sync for offline account
  changes (spec 004 FR-017) will need native Cache Storage/IndexedDB —
  planned for in 004, not here.
- **Alternatives considered**: hand-rolled service worker now (rejected —
  overkill for a static quiz); relying on `ng serve` for SW testing
  (doesn't work — SW verification needs a production build on localhost
  or HTTPS).

## Decision: RxJS 7.8.2 + signals; no NgRx, no Angular Aria yet

- **Rationale**: RxJS is still the first-party peer (Angular 22 peer range
  allows 7.x; latest stable 7.8.2 — RxJS 8 never shipped stable, 9 is
  beta). State management is signals-first: the quiz's state is a single
  LocalStorage-backed document, so plain component signals plus one
  signal-based store service are enough. NgRx SignalStore is reserved for
  when feature state outgrows signal services (deck, if ever). Angular
  Aria (stable in v22) is not added — the quiz uses semantic HTML/ARIA on
  native elements; adding a dependency needs a problem it solves
  (constitution: new deps must be justified).
- **Alternatives considered**: NgRx SignalStore from day one (rejected —
  YAGNI, Principle II); hand-rolled RxJS Subjects for quiz state (rejected
  — signals are the current idiom and simpler).

## Decision: TypeScript 6.0.x and Node 22+ pinned by tooling

- **Rationale**: Angular 22 requires TypeScript `>=6.0.0 <6.1.0`; npm's
  `latest` is TS 7.x which breaks the build, so the CLI pin is never
  overridden. Node support is `^22 || ^24 || ^26` (Node 20 dropped) —
  CI uses Node 22 LTS.
- **Alternatives considered**: TypeScript 7 (incompatible — rejected).

## Decision: Static quiz options behind a service interface

- **Rationale**: Milestone 1 serves options from static in-app config
  (spec assumption). They are exposed only through `QuizOptionsService`,
  so Milestone 2 can swap in the REST API (`httpResource`) without
  touching quiz components — preserving the constitution's API-first
  direction during a frontend-only slice.
- **Alternatives considered**: hardcoding option arrays in components
  (rejected — breaks the 002 hand-off and forces rework in Milestone 2).

## Non-decisions (deferred)

- Error boundaries (`@boundary`) — availability in v22 not verified;
  not needed for the quiz.
- Offline sync primitives — feature 004's concern.
