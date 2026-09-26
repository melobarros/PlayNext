---

description: "Task list for the recommendation deck implementation"
---

# Tasks: Recommendation Deck

**Input**: Design documents from `/specs/002-recommendation-deck/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **Included, and mandatory.** Constitution Principle V ("Test-First for
Critical Paths", Red-Green-Refactor) makes tests a gate for this feature, not an
option — both named invariants (Filter Enforcement, Feedback Loop) are
constitutionally required. Every test task below is written **before** its
implementation task and must be observed failing first.

**Organization**: Tasks are grouped by user story so each is independently
implementable, testable, and shippable. Story priorities come from spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this belongs to (US1–US4)
- Exact file paths are given in every task

**Paths**: This slice extends the existing `frontend/` Angular workspace built by
spec 001. Tests are co-located `.spec.ts` files, matching 001's convention.
Pure logic lives in `deck-logic/` as framework-free TypeScript, matching
`features/quiz/quiz-logic/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Close the one gap that would otherwise block the first test.

- [ ] T001 [P] Verify this repo's own Vitest + jsdom config can construct and dispatch a `PointerEvent` without a `view` member, by adding `frontend/src/app/features/deck/deck-logic/pointer-events.smoke.spec.ts`. Phase 0 research (research.md D11) proved this in a temp install; this task proves it under this project's actual `@angular/build:unit-test` setup before T019/T022 depend on it. Keep the spec as a regression guard.
- [ ] T002 [P] Add deck design tokens to the Tailwind v4 `@theme` block in `frontend/src/styles.css`: a poster aspect ratio shared by the card (T020) and Match Found (T030). Use the CSS-first `@theme` syntax — this project has no `tailwind.config.js` by design.

**Checkpoint**: Test harness confirmed, tokens available. Nothing else blocks.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The catalog, the two storage documents, and the models every story
ranks, records, or renders.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 [P] Create `MediaTitle` and `StreamingAvailability` in `frontend/src/app/core/models/media-title.ts`, with field rules verbatim from data-model.md: `id` stable/unique/non-empty; `title` non-empty; `releaseYear` a 4-digit year where `0` is invalid; `mediaType: MediaType` imported from `core/models/quiz.ts`; `genres: string[]` of spec 001 `GENRES` ids, may be empty; `synopsis` may be empty; `rating` 0–10 with one decimal; `voteCount` ≥ 0; `runtimeMinutes?`, `trailerUrl?`, `posterUrl?` optional; `availability: StreamingAvailability[]` may be empty. `StreamingAvailability = { providerId: string; deepLinkUrl: string }` where `deepLinkUrl` is an absolute URL to the official service. **No `region` field** — region is a `CatalogService` concern.
- [ ] T004 [P] Create the interaction vocabulary in `frontend/src/app/core/models/interaction.ts`: `InteractionState = 'loved' | 'liked' | 'disliked' | 'wantToWatch' | 'notInterested' | 'watchingNow'`; `Interaction { titleId: string; state: InteractionState; updatedAt: string }`; `WatchHistoryEntry { titleId: string; chosenAt: string }`; `InteractionDocument { schemaVersion: 1; interactions: Record<string, Interaction>; history: WatchHistoryEntry[]; updatedAt: string }`. Document in the file that **only `disliked` and `notInterested` exclude a title**, and that the exclusion set is derived — never stored as a list (research.md D2).
- [ ] T005 [P] Create `DeckSession` in `frontend/src/app/core/models/deck-session.ts`: `{ schemaVersion: 1; startedAt: string; shownTitleIds: string[] }`. Note that the current card is deliberately **not** a field (research.md D5).
- [ ] T006 [P] Author the Milestone 1 mock catalog (~48 titles) in `frontend/src/app/core/models/media-catalog.data.ts`. Constraints that make later tests meaningful: every `genres` entry uses a spec 001 `GENRES` id and every `availability[].providerId` uses a spec 001 `STREAMING_PROVIDERS` id (data-model.md — no mapping table); include **at least 3 titles with no `trailerUrl`** (exercises FR-008 / US2 scenario 4) and **2 titles with empty `availability`** (exercises filter 3); deliberately vary `voteCount` — include one `rating: 10.0` with fewer than 10 votes and one `rating` around 8.4 with more than 10,000 votes, so the D7 shrinkage is observable rather than theoretical.
- [ ] T007 [P] Write contract tests for `InteractionStore` in `frontend/src/app/core/services/interaction-store.spec.ts` — **must fail before T008**. Cover contracts/interaction-storage.md: `schemaVersion !== 1` → treated as absent; unparseable JSON → treated as absent; an unknown `state` value invalidates the document; re-rating a title replaces its entry rather than appending (003 FR-006 "zero duplicates"); `history` is append-only and keeps entries when an interaction changes; `updatedAt` changes on every write; readers receive copies and mutating a read value does not corrupt the stored document; LocalStorage unavailable → in-memory fallback, no throw.
- [ ] T008 Implement `InteractionStore` in `frontend/src/app/core/services/interaction-store.ts` (depends on T004, T007), key `playnext:interactions`, following the read/write pattern established by `core/services/preference-store.ts` in spec 001.
- [ ] T009 [P] Write contract tests for `DeckSessionStore` in `frontend/src/app/core/services/deck-session-store.spec.ts` — **must fail before T010**. Cover key `playnext:deck-session`, `schemaVersion` validation, `shownTitleIds` read as a string array, unknown ids harmless (they simply never match), and "start a new loop" resetting `shownTitleIds` to `[]` with a fresh `startedAt`.
- [ ] T010 Implement `DeckSessionStore` in `frontend/src/app/core/services/deck-session-store.ts` (depends on T005, T009).
- [ ] T011 [P] Write tests for `CatalogService` in `frontend/src/app/core/services/catalog.service.spec.ts` — **must fail before T012**. Cover `loadTitles(region)` returning an `Observable<MediaTitle[]>` and the region-scoping contract, mirroring `QuizOptionsService.loadProviders`.
- [ ] T012 Implement `CatalogService` in `frontend/src/app/core/services/catalog.service.ts` (depends on T003, T006, T011). This is **the** Milestone 2 API seam (plan.md, constitution IV): it returns an `Observable` even though Milestone 1 data is local, so Milestone 2 swaps the data source without touching a component. The FR-013 cached-fallback path is added in T039, not here.

**Checkpoint**: Models, catalog, and both storage documents exist and are tested. User stories can now proceed.

---

## Phase 3: User Story 1 - Visitor browses tailored suggestions one card at a time (Priority: P1) 🎯 MVP

**Goal**: After the quiz, the visitor sees one relevant card at a time and advances by swipe or tap, with full card metadata.

**Independent Test**: Complete the quiz as a new visitor, then advance through 10+ cards. Every card matches the quiz preferences and the selected services, each card carries the full metadata, and no title repeats within the loop.

### Tests for User Story 1 ⚠️

> **Write these FIRST and observe them fail before implementing T017–T019.**

- [ ] T013 [P] [US1] Write the hard-filter tests in `frontend/src/app/features/deck/deck-logic/recommend.spec.ts` — **must fail before T017**. Cover contract filters 1, 2, 3 and 5, including the **Filter Enforcement invariant (G1, FR-006)**: no returned title is unavailable on the selected services unless `includeUnownedProviders` is true; confirm `includeUnownedProviders: true` disables filter 3 entirely; confirm a title with empty `availability` is dropped when the visitor has provider preferences and has not opted into other platforms.
- [ ] T014 [US1] Write the scoring and ordering tests in `frontend/src/app/features/deck/deck-logic/recommend.spec.ts` (same file as T013 — write in sequence) — **must fail before T017**. Cover `matchedGenres`; `historyAffinity` including a **negative** result; `weightedRating` shrinkage (assert the low-vote 10.0 does not outrank the high-vote 8.4 from T006); score-descending then `id`-ascending tie-break; **determinism (G3, FR-011)** — identical inputs produce an element-for-element identical array; **no input mutation (G4)**; an empty result returns `[]` rather than throwing (G5, FR-014).
- [ ] T015 [P] [US1] Write the swipe-decision tests in `frontend/src/app/features/deck/deck-logic/swipe.spec.ts` — **must fail before T019**. Pure function over pointer samples: travel past the distance threshold in each direction, a fast flick that falls short on distance but passes on velocity, direction lock, and a tap (no meaningful travel) returning `'none'`. No DOM, no `TestBed`.
- [ ] T016 [P] [US1] Write the session-transition tests in `frontend/src/app/features/deck/deck-logic/deck-session.spec.ts` — **must fail before T018**. Cover: advancing appends the current id to `shownTitleIds`; **a swipe records no interaction and no history entry (FR-004)**; the derived current card excludes every shown id (FR-010); starting a new loop clears `shownTitleIds`.

### Implementation for User Story 1

- [ ] T017 [US1] Implement `rankTitles` in `frontend/src/app/features/deck/deck-logic/recommend.ts` exactly per [contracts/recommendation-engine.md](./contracts/recommendation-engine.md) — signature `rankTitles(catalog, preferences, interactions, shownTitleIds): MediaTitle[]`, five hard filters, the three-term score, and the `id`-ascending tie-break. No Angular, DOM, clock, or network import; **no randomness anywhere** (constitution VI). Depends on T003, T013, T014.
- [ ] T018 [US1] Implement the loop transitions in `frontend/src/app/features/deck/deck-logic/deck-session.ts` — `advance`, `currentCard`, `startNewLoop` — deriving the current card from `rankTitles` output minus `shownTitleIds`, never storing a cursor (research.md D5). Depends on T005, T016, T017.
- [ ] T019 [US1] Implement the swipe decision as a pure function in `frontend/src/app/features/deck/deck-logic/swipe.ts`, returning `'none' | 'dismiss-left' | 'dismiss-right' | 'reset'` from pointer samples plus card width. Keep the distance threshold, velocity, and direction-lock constants in this file so they are reviewable in one place. Depends on T015.
- [ ] T020 [P] [US1] Build the card in `frontend/src/app/features/deck/card/card.ts` and `card.html` — poster art, title, release year, rating, media type, genres, availability badges, and a collapsible synopsis using **native `<details>`** (research.md D8). Implements FR-003 and **FR-016**: a missing or failed poster falls back to a placeholder and the card stays fully readable without artwork. Availability badges degrade gracefully when `availability` is empty. Every touch target ≥44px; dark high-contrast by default (FR-017).
- [ ] T021 [US1] Build the deck shell in `frontend/src/app/features/deck/deck.ts` and `deck.html` — exactly one card at a time (FR-002), a sticky bottom action bar, and the explicit advance action of FR-004. Preload the **next** card's poster only, via `new Image()` followed by `await img.decode()`, with `fetchpriority="high"` on the visible card (research.md D6) — do not preload the whole deck.
- [ ] T022 [US1] Bind pointer events to the card in the deck shell at `frontend/src/app/features/deck/deck.ts` — `pointerdown` / `pointermove` / `pointerup` collecting samples, a `touch-action: pan-y` style on the card so vertical scrolling stays native, and **`el.setPointerCapture?.(e.pointerId)` guarded with optional chaining** (required: jsdom 30 does not implement pointer capture and jsdom's PR was closed unmerged, research.md D11). All judgement delegates to T019; the component only reports what the pure function returned. Depends on T019, T021.
- [ ] T023 [US1] Replace the placeholder: delete `frontend/src/app/features/deck/deck-stub.ts` and point the `deck` route at the deck shell in `frontend/src/app/app.routes.ts` (FR-001). Keep `app-boot.ts`'s existing `resolveEntryPath` hand-off unchanged — it already routes a completed quiz to `/deck`.
- [ ] T024 [US1] Write the integration test in `frontend/src/app/features/deck/deck.spec.ts` — **DOM-driven, following spec 001's `features/quiz/quiz.spec.ts` pattern**: completing the quiz shows a card immediately with no further input (FR-001, US1 scenario 1); advancing via the tap action and via a dispatched pointer swipe each yield exactly one new card and record nothing (FR-004, US1 scenario 2); 15+ advances produce no repeat (FR-010, US1 scenario 5); and a rating-free session leaves `playnext:interactions` untouched.

**Checkpoint**: User Story 1 is fully functional and independently testable — the MVP. The visitor can already decide what to watch.

---

## Phase 4: User Story 2 - Visitor rates a card or locks in a choice (Priority: P2)

**Goal**: One-tap rating actions that record and advance, plus Watch Now → Match Found.

**Independent Test**: Rate three cards in a row and confirm each rating is persisted and the deck advances; tap Watch Now and confirm Match Found shows correct links for that title.

### Tests for User Story 2 ⚠️

- [ ] T025 [P] [US2] Write the rating tests in `frontend/src/app/features/deck/actions/actions.spec.ts` — **must fail before T028**. Each of the five buttons (Loved It, Liked It, Disliked, Want to Watch, Not Interested) records **exactly one** interaction with the correct `state` and advances the deck (FR-007, US2 scenario 1). Rapid successive taps yield exactly one next card each — no skipped or duplicated cards (spec Edge Cases).
- [ ] T026 [US2] Write the Watch Now tests in `frontend/src/app/features/deck/actions/actions.spec.ts` (same file as T025 — write in sequence) — **must fail before T029**. Tapping Watch Now records a `watchingNow` interaction **and exactly one appended `WatchHistoryEntry`**, then stops the loop (FR-008, US2 scenario 2). Confirm the loop does not advance past the chosen title.
- [ ] T027 [P] [US2] Write the Match Found tests in `frontend/src/app/features/deck/match-found/match-found.spec.ts` — **must fail before T030**. Direct links are rendered from the title's `availability`; the trailer button appears **only** when `trailerUrl` is present and opens in a new tab (`rel="noopener"`); a title with no trailer still renders links and the start-new-loop action with no broken areas (US2 scenario 4); the view resolves its title from the route id and survives a refresh (research.md D10).

### Implementation for User Story 2

- [ ] T028 [US2] Build the action bar in `frontend/src/app/features/deck/actions/actions.ts` — the five rating buttons plus the primary Watch Now action, sticky at the bottom, every target ≥44px (FR-007, FR-017). Depends on T025.
- [ ] T029 [US2] Wire ratings and Watch Now to `InteractionStore` in the deck shell at `frontend/src/app/features/deck/deck.ts` — one write per action, then advance; Watch Now writes the history entry and stops the loop (FR-007, FR-008). Depends on T008, T028.
- [ ] T030 [US2] Build Match Found in `frontend/src/app/features/deck/match-found/match-found.ts` and `match-found.html` — streaming links from the title's current `availability`, a trailer button that opens externally in a new tab, and a start-new-loop action. **No third-party player code loads on the page** (FR-008, clarification of 2026-09-25). Depends on T027.
- [ ] T031 [US2] Add the `deck/match/:titleId` route in `frontend/src/app/app.routes.ts`, resolving the title from the catalog by id (research.md D10). A `titleId` the catalog no longer knows renders as an unavailable entry rather than a crash (data-model.md).

**Checkpoint**: User Stories 1 and 2 both work independently. The visitor can complete a decision with a path to actually watch.

---

## Phase 5: User Story 3 - The deck never repeats rejected titles (Priority: P3)

**Goal**: Disliked and Not Interested titles never return — this session or any later one.

**Independent Test**: Rate a title Disliked, advance through 30+ cards and confirm it never reappears; close and reopen the app and confirm the exclusion still holds.

### Tests for User Story 3 ⚠️

- [ ] T032 [US3] Write the **Feedback Loop invariant tests (G2, FR-009)** in `frontend/src/app/features/deck/deck-logic/recommend.spec.ts`. Cover: a title rated `disliked` is never suggested again in the same loop; `notInterested` is excluded identically; **a `disliked` title present in the interactions map is excluded** (the cross-session half of FR-009 and US3 scenario 2); and **re-rating away from `disliked` makes the title eligible again**, which is the contract compatibility spec 003 FR-007 depends on.

  **Honest note on Red-Green**: filter 4 is part of `rankTitles` and ships with T017 in US1, so these pure-function assertions are expected to **pass immediately** — they are regression coverage proving the invariant holds, not fresh Red-Green. The genuinely new work in US3 is the persistence wiring, and **T033 is the test that must be observed failing** before T034. Stating this rather than pretending every test starts red.
- [ ] T033 [US3] Write the cross-session integration test in `frontend/src/app/features/deck/deck.spec.ts` — rate a title Disliked, tear down the component, re-create it with `localStorage` intact, and advance through 30+ cards confirming the title never returns (US3 scenario 2, SC-004). **Must fail before T034.**

### Implementation for User Story 3

- [ ] T034 [US3] Load persisted interactions from `InteractionStore` in `frontend/src/app/features/deck/deck.ts` at deck start, and pass the current map into `rankTitles` on **every** action — never cache the ranked list for the loop, because a rating changes eligibility (research.md D2, D6). This is the only wiring that makes FR-009 hold across sessions. Depends on T008, T017, T029, T032, T033.

**Checkpoint**: All three stories work; the exclusion invariant holds across reloads.

---

## Phase 6: User Story 4 - The deck degrades gracefully (Priority: P4)

**Goal**: No dead ends — provider outage, empty result set, and lost connection each have a defined, visible fallback.

**Independent Test**: Simulate a provider outage and verify cached suggestions appear with a notice; force impossible filters and verify the empty state with a working 1-click reset; go offline mid-session and verify browsing continues.

### Tests for User Story 4 ⚠️

- [ ] T035 [P] [US4] Write the provider-outage tests in `frontend/src/app/core/services/catalog.service.spec.ts` — **must fail before T039**. When `loadTitles` fails, cached fallback titles are served **and** the app exposes a visible "offline-cached" notice (FR-013, US4 scenario 1, SC-006). Note the precedent set in spec 001: its FR-013 fallback UI is unreachable at runtime because the mock service returns `of(...)` and cannot fail — so this test must **force** the failure rather than assume it can occur.
- [ ] T036 [P] [US4] Write the empty-state tests in `frontend/src/app/features/deck/empty-state/empty-state.spec.ts` — **must fail before T040**. An empty ranked result shows the empty state with a Reset Filters action, never a stuck spinner (FR-014, US4 scenario 2, spec Edge Cases).
- [ ] T037 [US4] Write the Reset Filters test in `frontend/src/app/features/deck/empty-state/empty-state.spec.ts` (same file as T036 — write in sequence) — **must fail before T040**. Tapping Reset Filters calls spec 001's existing `startRetake` transition from `frontend/src/app/features/quiz/quiz-logic/quiz-retake.ts` and navigates to `/quiz` with previous answers pre-filled; completing the quiz starts a new loop; **Disliked/Not Interested exclusions survive the reset untouched** (FR-014, US4 scenario 3, research.md D9).
- [ ] T038 [P] [US4] Write the offline tests in `frontend/src/app/core/services/connectivity.spec.ts` — **must fail before T041**. A dropped connection raises an offline signal and shows a notice while already-loaded cards remain browsable (FR-015, US4 scenario 4).

### Implementation for User Story 4

- [ ] T039 [US4] Add the cached-fallback path to `frontend/src/app/core/services/catalog.service.ts` and the connectivity signal in `frontend/src/app/core/services/connectivity.ts` (FR-013, FR-015). The fallback **reuses `rankTitles` unchanged** over the cached catalog rather than switching to a different ordering, so degraded behavior stays predictable (contracts/recommendation-engine.md, "Deliberate non-goals"). Depends on T012, T035, T038.
- [ ] T040 [US4] Build the empty state in `frontend/src/app/features/deck/empty-state/empty-state.ts` and wire Reset Filters to `startRetake` from `frontend/src/app/features/quiz/quiz-logic/quiz-retake.ts` (FR-014). Do not reimplement the transition — spec 001 already provides it. Depends on T036, T037.
- [ ] T041 [US4] Add the visible notices to the deck shell in `frontend/src/app/features/deck/deck.ts` and `frontend/src/app/features/deck/deck.html` — the offline-cached notice (FR-013) and the offline notice (FR-015) — as non-blocking banners that do not cover the card or the action bar at 360px (FR-017). Depends on T039.

**Checkpoint**: All four stories are independently functional and the deck has no dead end.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T042 [P] Update `frontend/README.md` with the deck's storage keys, the `deck-logic/` convention, and the swipe-testing constraints from research.md D11 (no `view` member; pointer capture guarded). Update the root `README.md` feature list.
- [ ] T043 [P] Confirm no dead code or TODO/FIXME remains without a tracked issue (engineering standards, constitution). Verify `deck-stub.ts` and its imports are fully gone.
- [ ] T044 Run the `build` script in `frontend/package.json` (`npm run build`) and confirm the production build succeeds — the project's stated quality gate alongside the test suite. Record the new initial bundle size next to spec 001's 237.65 kB baseline.
- [ ] T045 Run the [quickstart.md](./quickstart.md) walkthrough and record honestly, in `specs/002-recommendation-deck/tasks.md`, which steps are machine-verifiable in this environment and which are not. Steps 8 (360px rendered) and 9 (Lighthouse) were not machine-verifiable for spec 001 and will not be here either.
- [ ] T046 [P] Manually verify **FR-017 / SC-008** (spec.md) at 360px with touch emulation — no horizontal scrolling, every control ≥44px, action bar sticky, Match Found usable. Record the result in [quickstart.md](./quickstart.md) step 12. **Requires a real browser; cannot be automated here.** If it cannot be run, say so rather than marking the requirement verified.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks all user stories.**
- **User Stories (Phases 3–6)**: All depend on Foundational. Within each story, tests precede the implementation they cover.
- **Polish (Phase 7)**: Depends on the desired stories being complete.

### Critical path

`T001 → T003/T004/T005 → T007 → T008 → T013 → T017 → T018 → T021 → T022 → T023 → T024 → T029 → T034 → T039`

### Within each user story

- Tests are written and observed **failing** before the implementation task they cover (constitution V).
- Models → services → components → route wiring → integration.
- US1's engine (`rankTitles`) must exist before US3 and US4 can build on it.

### Story independence

- **US1 (P1)**: no dependency on other stories. The MVP.
- **US2 (P2)**: depends on Foundational only. Rating buttons and Match Found are additive; US1 alone already delivers value.
- **US3 (P3)**: depends on US1's `rankTitles` and US2's write path. Note a real coupling: filter 4 lives **inside** `rankTitles`, so the exclusion *logic* ships with US1. US3's distinctive contribution is **cross-session persistence** — loading the store at cold start and re-ranking per action (T034). Stated plainly so the story boundary is not overstated.
- **US4 (P4)**: depends on Foundational and US1's shell for the notice surfaces.

---

## Parallel Opportunities

```bash
# Phase 2 — models and catalog are independent files:
T003 MediaTitle model · T004 interaction vocabulary · T005 DeckSession model · T006 mock catalog

# Phase 3 US1 — all four test files are independent, and T020 is component-only:
T013 filter tests · T014 scoring tests · T015 swipe tests · T016 session tests
T020 card component (parallel with T017–T019)

# Phase 4 US2 — test files:
T025 rating tests · T026 Watch Now tests · T027 Match Found tests

# Phase 6 US4 — test files:
T035 outage tests · T036 empty-state tests · T037 Reset Filters test · T038 offline tests
```

**Note on [P]**: three test pairs share a file and are therefore **not** marked [P], even though their content is independent — T013/T014 (`recommend.spec.ts`), T025/T026 (`actions.spec.ts`), T036/T037 (`empty-state.spec.ts`). Write each pair in sequence within its file.

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (blocks everything) → 3. Phase 3 US1 →
4. **STOP and VALIDATE**: the visitor can browse relevant cards and decide.
That is the product's core loop and delivers value with no rating actions at all.

### Incremental delivery

1. Setup + Foundational → foundation ready.
2. US1 → validate → **MVP**.
3. US2 → ratings and Watch Now → validate.
4. US3 → cross-session exclusions → validate.
5. US4 → degradation paths → validate.

### Notes

- Commit after each task or logical group; the branch is `002-recommendation-deck`.
- The deck's two invariants (Filter Enforcement, Feedback Loop) are guarantees of a pure function — they can be proven before any component exists, which is why the engine tasks come before the UI tasks.
- **Honest scoping**: T046 cannot be automated here, and T035's failure path must be forced because Milestone 1's service cannot fail on its own. Both are recorded rather than glossed.
