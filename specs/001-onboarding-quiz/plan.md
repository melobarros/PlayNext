# Implementation Plan: Onboarding Mood Quiz

**Branch**: `001-onboarding-quiz` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-onboarding-quiz/spec.md`

## Summary

Build the PlayNext onboarding quiz — the 3-step preference capture (media
type → genres/themes → streaming services) that feeds the recommendation
deck. This is the first vertical slice (PRD Milestone 1): an Angular PWA
frontend with quiz state persisted in browser LocalStorage for guests, quiz
options served from static in-app configuration (mock data), and no backend
yet. The slice ends at the summary screen with a start-recommendations
hand-off, which is where spec 002 (the deck) will pick up.

Technical approach: a standalone-component Angular app with Tailwind
styling, a small quiz feature module, a versioned LocalStorage persistence
service (the contract later consumed by the deck and later still by the
account-migration feature), and test-first coverage of the quiz's critical
paths per constitution Principle V.

## Technical Context

**Language/Version**: TypeScript 6.0.x (Angular CLI-pinned) + Angular
22.2.0 (zoneless, standalone, strict — all CLI defaults)

**Primary Dependencies**: Angular CLI 22, RxJS 7.8.2, Tailwind CSS 4.3.3
(CSS-first config); no additional libraries (NgRx and Angular Aria
explicitly deferred — see research.md)

**Storage**: Browser LocalStorage only (guest device-local state), single
versioned document per the preference-storage contract; no database in
this slice

**Testing**: Vitest (Angular CLI default runner, `@angular/build:unit-test`,
jsdom) — `ng test`; critical paths test-first per constitution V

**Target Platform**: Mobile-first web / PWA (`ng add @angular/pwa`) —
latest iOS Safari, Android Chrome, desktop Chrome/Firefox/Edge; 360px
minimum viewport, 44px touch targets

**Project Type**: Web application (frontend-only slice; backend arrives
with Milestone 2+)

**Performance Goals**: Quiz fully interactive on mid-range mobile; step
transitions perceived as instant (<100ms); TTI under 3s on 4G

**Constraints**: PWA-only delivery; dark high-contrast styling by default;
no sign-up wall; quiz completable in ≤30s median; all state must survive
refresh and browser restart (LocalStorage); styles in `.css` (Tailwind v4
directives conflict with Sass)

**Scale/Scope**: 3 quiz steps; ~3 media types, ~9 genres, ~10-15 providers
of static options; single-language UI (en) for this slice

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan complies |
|-----------|--------|------------------------|
| I. Mobile-First Experience | PASS | 360px / 44px targets and dark default are acceptance criteria (spec FR-014, SC-005/006); quiz is the fewest-tap path into the deck |
| II. Decision Speed & Simplicity | PASS | Exactly 3 steps, chip-only input, no free text; ≤30s median completion and ≥80% completion are success criteria; "Any / No preference" chip removes dead ends |
| III. Guest-First Access | PASS | No account requirement anywhere; LocalStorage persistence (spec FR-010); account migration is spec 004, not this slice |
| IV. API-First Architecture | PASS (deferred) | This slice has no backend: quiz options come from static in-app config per the spec's Milestone 1 assumption and the PRD roadmap. The config is modeled behind a service interface so Milestone 2 can swap in the REST API without touching quiz components |
| V. Test-First for Critical Paths | PASS | "Onboarding quiz filtering" is a named critical path — quiz validation and persistence logic get tests before implementation (Red-Green-Refactor); scenarios in this plan's quickstart are the acceptance suite |
| VI. Deterministic Recommendations | N/A | No recommendation logic in this slice; the preference shape is defined so the deck's deterministic scorer has a stable input |
| VII. Clean Architecture & Domain Integrity | PASS (frontend scope) | Backend layering does not apply yet. The frontend keeps business rules (step validation, selection rules) in plain TypeScript domain code, free of Angular specifics, so they are testable without the browser — mirroring the constitution's intent |

No gate violations. No complexity tracking needed.

**Re-check after Phase 1 design (2026-09-25)**: still passing. The design
adds no new dependencies beyond the constitution's stack (Tailwind is in
the stack; Vitest ships with the CLI); quiz options are isolated behind a
service interface so the Milestone 2 API swap honors Principle IV;
business rules are plain TypeScript per Principle VII. Note: CI/CD
pipelines (constitution Workflow) arrive with Milestone 4 per the PRD
roadmap — until then, `ng test` and `ng build` are enforced locally and in
PR review as the quality gates.

## Project Structure

### Documentation (this feature)

```text
specs/001-onboarding-quiz/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── preference-storage.md
└── tasks.md             # Phase 2 output (/speckit-tasks - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
frontend/                      # Angular application (this slice)
├── angular.json
├── package.json
├── src/
│   ├── app/
│   │   ├── app.config.ts      # app bootstrap, router, providers
│   │   ├── core/
│   │   │   ├── models/        # domain types: Preference, QuizOptions, ...
│   │   │   └── services/      # QuizOptionsService, PreferenceStore
│   │   └── features/
│   │       └── quiz/          # quiz feature: steps, summary, validation logic
│   │           ├── quiz.component.ts
│   │           ├── steps/     # one component per step
│   │           ├── summary/
│   │           └── quiz-logic/  # plain TS rules (step validation, completion)
│   └── styles.css             # Tailwind entry
└── src/app/... tests co-located as *.spec.ts

backend/                       # RESERVED - .NET solution (Milestone 2+),
                               # not created by this feature
```

**Structure Decision**: Single Angular app in `frontend/`, feature-folder
organization with a `core/` area for shared domain models and services.
Quiz business rules live in plain TypeScript (`quiz-logic/`) with no
Angular imports, so the critical paths are unit-testable without a DOM
(constitution V, VII intent). `backend/` is reserved on disk to keep the
repo layout stable when Milestone 2 lands. The deck (002) consumes the
same `core/models` preference types, so `core/` is the shared seam between
features.

## Complexity Tracking

> No violations — section intentionally left empty.
