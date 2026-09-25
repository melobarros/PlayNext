---
description: "Task list for PlayNext onboarding quiz (001)"
---

# Tasks: Onboarding Mood Quiz

**Input**: Design documents from `/specs/001-onboarding-quiz/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: INCLUDED — constitution Principle V names onboarding quiz
filtering a critical path with Red-Green-Refactor, so tests are written
FIRST in each story and must fail before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Web app (this feature)**: `frontend/src/...` (Angular app per plan.md; `backend/` reserved for Milestone 2+)
- Feature modules under `frontend/src/app/features/quiz/`; shared code under `frontend/src/app/core/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Scaffold the Angular app per research.md: run `ng new playnext --directory=frontend --style=tailwind --routing --ssr=false --test-runner=vitest --package-manager=npm` (Angular 22.2.0, zoneless + standalone + strict defaults, Tailwind 4.3.3 CSS-first, Vitest runner); commit the generated workspace
- [X] T002 Add PWA support with `ng add @angular/pwa` (creates frontend/ngsw-config.json, frontend/src/manifest.webmanifest, icons, wires provideServiceWorker)
- [X] T003 [P] Configure dark-by-default theme: set dark background + high-contrast tokens via Tailwind v4 `@theme` in frontend/src/styles.css; set dark `theme-color` in frontend/src/manifest.webmanifest and frontend/src/index.html meta tags
- [X] T004 [P] Add `.editorconfig` at the repository root with formatting rules for TS/HTML/CSS/JSON (constitution code-quality standard)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Create domain types in frontend/src/app/core/models/quiz.ts exactly per data-model.md: `MediaType` ('movie' | 'tv' | 'anime'), `DimensionChoice<T>` (`values: T[]`, `any: boolean`), `QuizState` (`schemaVersion: 1`; `status: 'in-progress' | 'completed'`; `step: 1 | 2 | 3`; `mediaType`, `genre`, `provider` dimensions; `includeUnownedProviders: boolean`; `completedAt?: string`; `updatedAt: string`), `StreamingProvider` (`id`, `displayName`, `regions`), `Genre` (`id`, `displayName`), `QuizOptions`
- [X] T006 [P] Create static quiz options in frontend/src/app/core/models/quiz-options.data.ts: 3 media types; 9 curated genres (Action, Comedy, Drama, Horror, Romance, Sci-Fi, Thriller, Animation, Documentary per FR-003); region-relevant provider list plus a `fallbackProviders` default popular list (FR-013)
- [X] T007 Create PreferenceStore in frontend/src/app/core/services/preference-store.ts implementing contracts/preference-storage.md: LocalStorage key `playnext:quiz-state`; unknown `schemaVersion` or unparseable JSON MUST reset to a first visit; `updatedAt` set on every write; write failures non-fatal with last successful state retained
- [X] T008 [P] Create QuizOptionsService in frontend/src/app/core/services/quiz-options.service.ts exposing the static options behind an interface (the Milestone 2 API swap seam per research.md), with an explicit provider-list failure/fallback path (FR-013)
- [X] T009 Create quiz rules in plain TypeScript (no Angular imports) in frontend/src/app/features/quiz/quiz-logic/quiz-rules.ts implementing data-model.md state transitions and validation: a step is complete iff `values.length > 0 || any === true` (FR-005); `any === true` MUST imply `values` is empty (exclusive chip); exactly 3 steps in fixed order (FR-001); completion sets `status: 'completed'` with non-null `completedAt`
- [X] T010 Create app shell in frontend/src/app/app.component.ts with routes in frontend/src/app/app.routes.ts: quiz route (default) and a placeholder `deck` route stubbed for the spec 002 hand-off; bottom navigation area left to the deck slice
- [X] T011 Wire QuizOptionsService and PreferenceStore providers in frontend/src/app/app.config.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - First-time visitor completes the quiz (Priority: P1) 🎯 MVP

**Goal**: A new visitor walks through the 3-step quiz (media type → genres → providers), sees a progress indicator, and finishes at a summary with a single start-recommendations action.

**Independent Test**: In a private window: app opens at step 1; select Movie + 2 genres + 2 providers (Next unavailable until valid per FR-005); confirm summary shows all selections and one primary action.

### Tests for User Story 1 (write FIRST, ensure they FAIL) ⚠️

- [X] T012 [P] [US1] Write failing tests for quiz rules in frontend/src/app/features/quiz/quiz-logic/quiz-rules.spec.ts: zero selections rejected (FR-005); "Any / No preference" chip alone satisfies the step; selecting Any clears values; step advance rules; completion sets non-null completedAt
- [X] T013 [P] [US1] Write failing tests for PreferenceStore in frontend/src/app/core/services/preference-store.spec.ts: completed document round-trips per contract schema; corrupt JSON and unknown schemaVersion reset to a first visit; updatedAt changes on every write

### Implementation for User Story 1

- [X] T014 [P] [US1] Implement step 1 in frontend/src/app/features/quiz/steps/step-media-type.component.ts: Movie/TV/Anime multi-select chips + exclusive "Any / No preference" chip, 44px touch targets
- [X] T015 [P] [US1] Implement step 2 in frontend/src/app/features/quiz/steps/step-genres.component.ts: genre multi-select chips + exclusive Any chip, 44px touch targets
- [X] T016 [P] [US1] Implement step 3 in frontend/src/app/features/quiz/steps/step-providers.component.ts: provider multi-select chips + exclusive Any chip; "Show content on other platforms" toggle defaulting off (FR-006); load failure shows Retry then the fallback list with a notice (FR-013)
- [X] T017 [US1] Implement the quiz shell in frontend/src/app/features/quiz/quiz.component.ts: stepper wiring, "Step X of 3" progress indicator (FR-007), Next disabled until the current step is valid (FR-005), QuizState held in a signal
- [X] T018 [US1] Implement the summary in frontend/src/app/features/quiz/summary/summary.component.ts: shows all selections with a single primary start-recommendations action (FR-009); on confirm, write `status: 'completed'` via PreferenceStore and navigate to the deck stub route

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Guest leaves mid-quiz without losing progress (Priority: P2)

**Goal**: A guest who refreshes or closes the browser mid-quiz resumes at the same step with answers intact; a guest who already completed is never shown the quiz again.

**Independent Test**: Complete steps 1-2, refresh, confirm the quiz reopens on step 3 with prior answers; complete the quiz, reload, confirm it is skipped.

### Tests for User Story 2 (write FIRST, ensure they FAIL) ⚠️

- [X] T019 [US2] Add failing resume tests to frontend/src/app/core/services/preference-store.spec.ts: in-progress document round-trips restoring step + answers (FR-010); completed document drives the skip decision (FR-011)
- [X] T020 [P] [US2] Write failing boot-decision tests in frontend/src/app/app-boot.spec.ts: no saved state → quiz step 1; in-progress state → quiz at saved step with answers; completed state → deck stub route

### Implementation for User Story 2

- [X] T021 [US2] Implement boot decision in frontend/src/app/app.component.ts: read PreferenceStore on load; in-progress → quiz at saved step with prior answers; completed → deck stub (FR-011)
- [X] T022 [US2] Persist every transition: quiz shell (frontend/src/app/features/quiz/quiz.component.ts) writes the in-progress QuizState to PreferenceStore on each selection and navigation change (FR-010)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Visitor edits answers or retakes the quiz (Priority: P3)

**Goal**: Back navigation retains all answers; a returning visitor can retake the quiz with previous answers pre-filled, and completing the retake replaces the saved preferences.

**Independent Test**: From the summary, go Back through the steps, change one genre, complete again — the summary reflects the change and the new answers replace the old ones.

### Tests for User Story 3 (write FIRST, ensure they FAIL) ⚠️

- [X] T023 [P] [US3] Write failing retake tests in frontend/src/app/features/quiz/quiz-logic/quiz-retake.spec.ts: retake transition resets to step 1 with values pre-filled from the saved document (FR-012); completing a retake REPLACES the document (US3 scenario 3)

### Implementation for User Story 3

- [X] T024 [US3] Implement Back navigation in frontend/src/app/features/quiz/quiz.component.ts: Back from step n returns to step n-1 with all previously entered answers retained (FR-008)
- [X] T025 [US3] Implement the retake entry point in frontend/src/app/features/quiz/summary/summary.component.ts: "Retake quiz" action → status 'in-progress', step 1, answers pre-filled from the saved document (FR-012)
- [X] T026 [US3] Implement replace-on-complete: completing a retake overwrites the saved document via the quiz-rules transition and PreferenceStore (US3 scenario 3)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T027 [P] 360px/touch/dark audit across all quiz screens: every chip and action ≥44px, no horizontal scrolling at 360px viewport, dark high-contrast styling (FR-014); fix any findings in frontend/src/app/features/quiz/
- [X] T028 [P] PWA validation: `ng build --configuration=production`, serve the build, verify installable manifest and that the offline shell serves the quiz (constitution PWA-only delivery; SC-005)
- [X] T029 Run the quickstart.md validation walkthrough end-to-end (all 9 steps), record results, fix any failures found
- [X] T030 [P] Update README.md with frontend prerequisites and run/test instructions (`npm install`, `ng serve`, `ng test`, `ng build`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - depends on US1's quiz shell (quiz.component.ts) and PreferenceStore; independently testable via its boot/resume scenarios
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - extends US1's summary and quiz shell; independently testable via the retake scenario

### Within Each User Story

- Tests (included per constitution V) MUST be written and FAIL before implementation
- Models before services
- Services before components
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T003, T004 in Setup can run in parallel
- T006, T008 in Foundational can run in parallel (T007, T009 depend on T005's types)
- T012, T013 (US1 tests) can run in parallel
- T014, T015, T016 (step components) can run in parallel
- T020 (US2 boot tests) and T023 (US3 retake tests) can run in parallel with US1 implementation once Foundational is done
- T027, T028, T030 in Polish can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (must fail first):
Task: "T012 Write failing tests for quiz rules in frontend/src/app/features/quiz/quiz-logic/quiz-rules.spec.ts"
Task: "T013 Write failing tests for PreferenceStore in frontend/src/app/core/services/preference-store.spec.ts"

# Then launch all step components together:
Task: "T014 Implement step 1 in frontend/src/app/features/quiz/steps/step-media-type.component.ts"
Task: "T015 Implement step 2 in frontend/src/app/features/quiz/steps/step-genres.component.ts"
Task: "T016 Implement step 3 in frontend/src/app/features/quiz/steps/step-providers.component.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently (private window, full 3-step flow)
5. Deploy/demo if ready — this is the first vertical slice of the PRD's Milestone 1

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo (persistence guarantee)
4. Add User Story 3 → Test independently → Deploy/Demo (retake)
5. Each story adds value without breaking previous stories
6. Then `/speckit-plan` + `/speckit-tasks` for spec 002 (deck) which consumes the preference-storage contract

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (quiz flow)
   - Developer B: User Story 2 (boot + resume logic, tests first)
   - Developer C: User Story 3 (retake logic, tests first)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (constitution V Red-Green-Refactor)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence

---

## Deviations from plan (recorded during implementation)

- **File naming**: tasks name `*.component.ts` files; the Angular 22 scaffold's
  own convention is suffix-less (`quiz.ts`, `step-providers.ts`,
  `summary.ts`). The scaffold convention was followed. Task intent is
  unchanged — every listed component exists at the corresponding path.
- **T010/T021 (boot decision)**: lives in `frontend/src/app/app-boot.ts`, not
  `app.component.ts`. The default route loads an `Entry` component that reads
  `PreferenceStore` and forwards to `/quiz` or `/deck`. `app.component.ts` is
  `app.ts` in this workspace.
- **T011 (provider wiring)**: no work required —
  `PreferenceStore` and `QuizOptionsService` are both `providedIn: 'root'`.
- **T022 (persist every transition)**: implemented inside the quiz shell's
  private `update()` during US1, so every transition was durable from the start
  rather than retrofitted in US2.
- **Test placement**: the FR-013 provider fallback test lives in
  `step-providers.spec.ts` (a rendered component test) rather than the quiz
  rules tests, since the fallback is a component-level flow. An additional
  shell-level integration suite, `quiz.spec.ts`, drives the whole quiz through
  the DOM and covers quickstart walkthrough steps 1–6.
- **Not machine-verifiable**: walkthrough steps 8 (360px touch rendering) and
  9 (Lighthouse PWA audit) were verified statically — layout audit, chip-width
  arithmetic, and serving the production build to confirm the manifest, service
  worker and app shell are delivered. A real-browser pass is still outstanding.
