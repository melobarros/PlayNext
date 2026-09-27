---

description: "Task list for the ratings & watchlist implementation"
---

# Tasks: Ratings & Watchlist

**Input**: Design documents from `/specs/003-ratings-watchlist/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/watchlist-storage.md](./contracts/watchlist-storage.md)

**Tests**: **Included, and mandatory.** Constitution Principle V ("Test-First for
Critical Paths", Red-Green-Refactor) names **rating persistence** as a critical
path — this feature *is* that critical path, so tests are a gate here rather
than an option. Every test task below is written **before** the implementation
task it covers and must be observed failing first.

**Organization**: Tasks are grouped by user story so each is independently
implementable, testable, and shippable. Story priorities come from spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this belongs to (US1–US3)
- Exact file paths are given in every task

**Paths**: This slice extends the existing `frontend/` Angular workspace built
by spec 001 and the `features/deck/` slice built by spec 002. Tests are
co-located `.spec.ts` files, matching that convention. Pure logic lives in
`watchlist-logic/` as framework-free TypeScript, matching `deck-logic/` and
`quiz-logic/`.

**Run tests with `npm test`.** `npx vitest run` fails with
`ReferenceError: describe is not defined` — the Angular builder owns the Vitest
config. This cost real time to diagnose in 002.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The one refactor two stories depend on. No project initialization
is needed — the workspace, the test runner and the design tokens all exist.

- [ ] T001 [P] Establish the `frontend/src/app/shared/` convention (proposed in plan.md's Structure Decision) by writing `frontend/src/app/shared/poster/poster.spec.ts` — **must fail before T002**. Assert the shared poster's contract: a URL renders an `<img>` with that `src` and the given accessible name; **no URL renders the CSS-only placeholder with no `<img>` and therefore no request**; an `error` event replaces the image with the placeholder and **never retries** (a second request fails for the same reason the first did); both branches carry the same accessible name. Adapt the poster assertions currently in `frontend/src/app/features/deck/card/card.spec.ts` rather than inventing new ones.

- [ ] T002 Extract the poster from the deck card into `frontend/src/app/shared/poster/poster.ts` and `poster.html` (depends on T001) — move the markup at `frontend/src/app/features/deck/card/card.html` lines 5–29 and the `posterFailed` signal, `posterSrc`, `posterAlt` and `onPosterError` out of `frontend/src/app/features/deck/card/card.ts`. `Card` keeps its own layout and renders `<app-poster>`; it must not keep a second copy of any of it (research.md D11 — extracted, not copied). **`card.spec.ts` must stay green with no assertion changes**, which is what proves the deck's behaviour is unchanged.

**Checkpoint**: `shared/` exists with one member, and the deck is provably unchanged.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The tab table, the one new store operation, the pure grouping logic,
and the navigation shell every story is reached through.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 [P] Add the tab-membership table to `frontend/src/app/core/models/interaction.ts` — `WATCHLIST_SURFACES`, the single table three consumers agree on (research.md D3): Want to Watch → `wantToWatch`; Loved → `loved`, `liked`; Disliked → `disliked`, `notInterested`; History → `watchingNow`. Add tests **in the same commit** asserting the invariant data-model.md names: **every state in `INTERACTION_STATES` appears in exactly one surface**. A state added to the vocabulary with no surface is stored and then invisible — the exact defect the 2026-09-26 clarification fixed for `notInterested`, and this test is what stops it recurring.

- [ ] T004 [P] Write the `remove()` contract tests in `frontend/src/app/core/services/interaction-store.spec.ts` — **must fail before T005**. Cover [contracts/watchlist-storage.md](./contracts/watchlist-storage.md) guarantees 2 and 4 and data-model.md's operation rules: the key is deleted from `interactions`; **`history` is untouched** (FR-008 — the log records what happened, not what the visitor currently thinks); removing a title that was never rated is a **no-op, not an error**; `updatedAt` is refreshed; sibling entries are unaffected; the resulting document still passes `isValidInteractionDocument` (003 writes no shape 002 would reject).

- [ ] T005 Implement `InteractionStore.remove(titleId: string): void` in `frontend/src/app/core/services/interaction-store.ts` (depends on T004). Read, `delete` the key, write back — the `write()` private already refreshes `updatedAt`. Do **not** add a `rerate()` alias for `record()`; data-model.md records that as a deliberate omission.

- [ ] T006 [P] Write the grouping tests in `frontend/src/app/features/watchlist/watchlist-logic/entries.spec.ts` — **must fail before T007**. Cover: entries group into the four surfaces from `WATCHLIST_SURFACES`; each tab's count equals its list length (data-model.md: badges are derived, so a badge cannot disagree with the list beneath it); each entry carries `stateLabel` from `INTERACTION_STATE_LABELS`; **a rated `titleId` absent from the catalog yields `title: null` and is still listed** (data-model.md — an entry the visitor can see is always one they can remove); ordering is deterministic with a documented tie-break; and **500+ entries group correctly**, built from a synthesized document (research.md D7 — 500 is unreachable through a 48-title catalog).

- [ ] T007 Implement `frontend/src/app/features/watchlist/watchlist-logic/entries.ts` (depends on T003, T006) — pure TypeScript, **no Angular imports**, exporting `WatchlistEntry` and the grouping/lookup functions per data-model.md. Build the `Map` from id to title **once per call**, not once per entry (research.md D7), and take catalog input as an argument rather than injecting anything.

- [ ] T008 [P] Write the shell tests in `frontend/src/app/features/shell/shell.spec.ts` — **must fail before T009**. Assert the nav is present on the deck; **absent on the quiz and on the entry hop** (research.md D5 — onboarding is a linear flow, and "skip to my watchlist" mid-quiz undercuts the quiz); the watchlist is one tap from the nav on every main screen (FR-013, SC-006); every nav target meets the 44px minimum (constitution I).

- [ ] T009 Build the shell in `frontend/src/app/features/shell/shell.ts` and `shell.html` (depends on T008) — the bottom nav plus a `<router-outlet>`, and restructure `frontend/src/app/app.routes.ts` so `deck` and `deck/match/:titleId` become its children while `''` and `quiz` stay outside it. Leave room for the nav (content must not hide behind it). **Do not add watchlist routes yet** — each story adds its own, so nothing here references a component that does not exist.

- [ ] T010 Fix the deck's layout for the nav in `frontend/src/app/features/deck/deck.html` (depends on T009) — the action bar's `sticky bottom-0` is no longer the viewport bottom, so the footer's placement and the `<main>`'s vertical rhythm both need revisiting. Update whatever `frontend/src/app/features/deck/deck.spec.ts` asserts about that class pairing. **This is the deck's only behavioural risk in this slice**; run the deck's full suite before moving on.

**Checkpoint**: The tab table, the store operation, the pure logic and the nav all exist and are tested. User stories can now proceed.

---

## Phase 3: User Story 1 - Visitor browses their rated titles in a tabbed watchlist (Priority: P1) 🎯 MVP

**Goal**: Every rating made in the deck lands in the right tab, with its poster, title, year, state and availability; tapping one opens the title's details and streaming links; a refresh loses nothing.

**Independent Test**: Rate three titles in the deck (Want to Watch, Loved, Disliked) plus one Not Interested, open the Watchlist, and confirm each appears in the right tab with its own state label; open one entry; refresh and confirm nothing is lost.

### Tests for User Story 1 ⚠️

> **Write these FIRST and observe them failing before T014–T017.**

- [ ] T011 [P] [US1] Write the watchlist view tests in `frontend/src/app/features/watchlist/watchlist.spec.ts` — **must fail before T015**. US1 scenarios 1, 2 and 4 and FR-001/FR-002/FR-003/FR-009/FR-010: Want to Watch appears under its own tab; **Liked appears in the Loved tab; Disliked and Not Interested both appear in the Disliked tab, each labelled with its own state** so a merged tab is never ambiguous; every entry shows poster, title, year, state and availability; a refresh of the document leaves every tab intact; and each empty tab shows a friendly empty state inviting the visitor to rate cards, never a blank panel.

- [ ] T012 [P] [US1] Write the row tests in `frontend/src/app/features/watchlist/entry/entry.spec.ts` — **must fail before T014**. FR-002's fields; the missing/failed-poster fallback comes from the shared `Poster` (T002) rather than a local copy; and **a rated title absent from the catalog renders as unavailable while staying removable** (data-model.md, research.md D10) — it must not throw and must not silently vanish.

- [ ] T013 [P] [US1] Write the detail-view tests in `frontend/src/app/features/watchlist/detail/detail.spec.ts` — **must fail before T016**. US1 scenario 3 and FR-008's link requirement: the view resolves its `:titleId` from the route and the catalog (research.md D10), renders the title's details and its streaming links **from current availability, never from storage**, and degrades to an unavailable state — reusing `match-found.ts`'s documented behaviour — when the catalog no longer knows the id. Deduplicate links by provider and skip unknown provider ids, matching `providerLinks` in `frontend/src/app/features/deck/match-found/match-found.ts`.

### Implementation for User Story 1

- [ ] T014 [P] [US1] Build the list row in `frontend/src/app/features/watchlist/entry/entry.ts` and `entry.html` (depends on T012) — poster via `<app-poster>`, title, year, the state label, and availability badges. Presentation only, like `Card`: it renders what it is given and reports nothing back. The whole row is one touch target ≥44px.

- [ ] T015 [US1] Build the tabbed watchlist in `frontend/src/app/features/watchlist/watchlist.ts` and `watchlist.html` (depends on T006, T007, T011, T014) — three tabs with derived counts, the entry list per `WATCHLIST_SURFACES`, and the empty states. Read `InteractionStore` and `CatalogService` on construction, following 002's read-after-write pattern (research.md D4). Use `@for` with `track` so Angular reuses DOM nodes at scale (research.md D7).

- [ ] T016 [US1] Build the shared detail view in `frontend/src/app/features/watchlist/detail/detail.ts` and `detail.html` (depends on T013) — resolves `:titleId` from the route via `withComponentInputBinding()`, renders details and streaming links at render time. **This is the surface US3 also uses** (research.md D9); build it so a history entry can open it unchanged. Do not add re-rating here — that is T020.

- [ ] T017 [US1] Add the `watchlist` and `watchlist/title/:titleId` routes to the shell's children in `frontend/src/app/app.routes.ts` (depends on T009, T015, T016). Use the `title/` path segment rather than a bare `:titleId` so US3's `watchlist/history` cannot be shadowed by a title id (plan.md — path shape over route ordering).

**Checkpoint**: User Story 1 is fully functional and independently testable — the MVP. The visitor's decisions stop vanishing when the card advances.

---

## Phase 4: User Story 2 - Visitor changes or removes a rating (Priority: P2)

**Goal**: Re-rate an entry to any of the five states, or remove it entirely, and have the deck respect the change on its next loop.

**Independent Test**: From the Disliked tab, change a title to Loved; start a new deck loop and confirm the title can be suggested again. Remove a Want to Watch entry and confirm it leaves the tab without disturbing the others.

### Tests for User Story 2 ⚠️

- [ ] T018 [US2] Add the re-rate tests to `frontend/src/app/features/watchlist/detail/detail.spec.ts` (same file as T013 — write in sequence) — **must fail before T020**. FR-004/FR-005/FR-006 and US2 scenarios 1–2: the control offers **exactly `RATING_ACTIONS`** — all five and `watchingNow` absent, since it is the deck's Watch Now action alone (FR-004, research.md D6); choosing a state persists it and the entry moves to the matching tab; **Remove is a separate action, not folded into the five** (research.md D6 — "no rating" is not a sixth rating); Remove deletes the entry without disturbing its siblings.

- [ ] T019 [US2] Write the cross-view eligibility test in `frontend/src/app/features/watchlist/detail/detail.spec.ts` (same file — write in sequence) — **must fail before T020**. FR-007, SC-002 and US2 scenarios 3–4: after re-rating a title from Disliked to Loved **through the watchlist view**, constructing the deck finds that title eligible again; after rating a title Disliked from the watchlist, the deck excludes it.

  **Read 002's T033 note before writing this.** A version of this test passed immediately and for the wrong reason — with the loop document intact, `shownTitleIds` kept the title away whether or not the ratings were ever loaded. Discard the loop document (`playnext:deck-session`) before constructing the deck, and reset the testing module so root-singleton stores do not hand the "new" component the old memory fallback. Then **prove it is load-bearing by mutation**: break the eligibility path, confirm this test goes red, and restore. An initial green is not evidence.

### Implementation for User Story 2

- [ ] T020 [US2] Add the re-rate control and Remove to `frontend/src/app/features/watchlist/detail/detail.ts` and `detail.html` (depends on T018, T019) — five buttons from `RATING_ACTIONS` calling `record(titleId, state)`, plus a visually separate Remove calling `remove(titleId)` (FR-004, FR-005). One constraint worth stating: **`INTERACTION_STATE_LABELS['watchingNow']` is `'Watch Now'`, a verb** — rendering it as a *current state* next to five action buttons reads as a sixth button. Show a current-state indicator only when the stored state is one of the five, so a history entry's detail view says what the title is without offering to "Watch Now" it again.

**Checkpoint**: User Stories 1 and 2 both work independently. A mis-tapped Dislike is no longer permanent.

---

## Phase 5: User Story 3 - Visitor revisits their "Watching Now" history (Priority: P3)

**Goal**: Every Watch Now lock-in is listed with its choice time and working links, and can be reopened.

**Independent Test**: Lock in two choices via Watch Now; open the history and confirm both appear with their choice time and streaming links; reopen one and confirm the links are still correct.

### Tests for User Story 3 ⚠️

- [ ] T021 [P] [US3] Write the history tests in `frontend/src/app/features/watchlist/history/history.spec.ts` — **must fail before T022**. US3 scenarios 1–3 and FR-008/FR-010: each `WatchHistoryEntry` appears with its title, **its choice time**, and its streaming links resolved at render (research.md D10 — a title that left the catalog degrades to unavailable rather than crashing); tapping an entry opens the shared detail view **with the re-rate control available** (research.md D9 — a `watchingNow` title lives in no tab, so without this its rating is the same dead end the 2026-09-26 clarification closed for `notInterested`); the empty state when nothing has been watched; and **removing a title's rating leaves its history entry standing** (FR-008) — the view-level half of T004's store-level guarantee.

### Implementation for User Story 3

- [ ] T022 [US3] Build the history list in `frontend/src/app/features/watchlist/history/history.ts` and `history.html` (depends on T007, T021) — resolve each `WatchHistoryEntry.titleId` through the catalog, show the choice time, and link each row to `/watchlist/title/:titleId` (T016's shared view). **Do not render a state label on these rows**: the surface *is* the state, and the only label available for it is the action verb "Watch Now". The same title may legitimately appear more than once — a visitor can decide to watch something twice — so `track` on a per-entry key, not on `titleId`.

- [ ] T023 [US3] Add the `watchlist/history` route to the shell's children in `frontend/src/app/app.routes.ts` (depends on T017, T022).

**Checkpoint**: All three stories are independently functional. Every state in the vocabulary is reachable, labelled, and changeable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T024 [P] Add the offline notice to the watchlist in `frontend/src/app/features/watchlist/watchlist.ts` and `watchlist.html` (FR-012) — reuse `Connectivity.isOffline` from `frontend/src/app/core/services/connectivity.ts` and the non-blocking banner treatment `deck.html` already uses. Already-saved lists stay viewable; the notice explains why changes will not stick.

- [ ] T025 [P] Update `frontend/README.md` with the new `shared/` convention (and why the poster lives there rather than in `features/deck/`), the `watchlist-logic/` module, and the shell's route structure; update the root `README.md` feature table to mark 003 done and re-state the remaining gaps honestly.

- [ ] T026 [P] Confirm no dead code or `TODO`/`FIXME` remains without a tracked issue (engineering standards, constitution). Specifically verify the poster's members and markup in `frontend/src/app/features/deck/card/card.ts` and `card.html` are **fully gone** rather than left behind after T002.

- [ ] T027 Run `npm run build` in `frontend/` and confirm the production build succeeds — the project's stated quality gate alongside the test suite. Record the initial bundle size next to 002's **256.99 kB raw / 69.10 kB transfer** baseline, and note which of the new weight lands in lazy chunks.

- [ ] T028 [P] Manually verify **FR-011 / SC-005's render half** in a browser: paste a 500-entry interactions document into LocalStorage (see [quickstart.md](./quickstart.md) step 14) and confirm the tabs render and stay smooth to scroll. The logic half is T006; this half has no test because jsdom has no layout engine. **If it cannot be run, say so rather than marking the requirement verified.**

- [ ] T029 [P] Manually verify **FR-013 / SC-007** at 360px with touch emulation — browse the tabs, re-rate, remove, and open the history; no horizontal scrolling, every control ≥44px, the bottom nav reachable and not covering content. **Then re-verify 002's FR-017 / SC-008**, which T010 invalidated: the deck's action bar moved. Record both results in [quickstart.md](./quickstart.md). **This requirement is unverified in 002 and must not be inherited as passing** (plan.md, Constitution Check I). Requires a real browser; cannot be automated here.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks all user stories.**
- **User Stories (Phases 3–5)**: All depend on Foundational. Within each story, tests precede the implementation they cover.
- **Polish (Phase 6)**: Depends on the desired stories being complete. T024 needs US1; T029 needs every story.

### Critical path

`T001 → T002 → T003 → T006 → T007 → T008 → T009 → T010 → T011 → T015 → T017 → T014 → T016 → T018 → T020 → T021 → T022`

### Within each user story

- Tests are written and observed **failing** before the implementation task they cover (constitution V).
- Models → pure logic → components → route wiring → integration.
- US1's detail view (T016) must exist before US2 adds re-rating to it and before US3 links to it.

### Story independence

- **US1 (P1)**: no dependency on other stories. The MVP.
- **US2 (P2)**: depends on Foundational **and US1's detail view** — T020 edits the component T016 creates. That is a real coupling, stated plainly rather than pretended away: "change a rating" has to be changed *somewhere*, and the watchlist row is not the place. US2 is still independently *testable* (T018/T019), just not independently buildable.
- **US3 (P3)**: depends on Foundational and US1's shared detail view (T016) for its tap-through. Its own list is additive.

---

## Parallel Opportunities

```bash
# Phase 2 — independent files, different layers:
T003 tab table · T004 remove() tests · T006 grouping tests · T008 shell tests

# Phase 3 US1 — three independent test files:
T011 watchlist tests · T012 entry tests · T013 detail tests
# T014 (the row component) is independent of T015/T016:
T014 entry component · T015 watchlist view · T016 detail view

# Phase 6 — independent artifacts:
T024 offline notice · T025 documentation · T026 dead-code check
T028 500-entry browser check · T029 360px browser check
```

**Note on [P]**: three pairs share a file and are therefore **not** marked [P],
even though their content is independent — T003's invariant test lives in the
file it changes, T018/T019 (`detail.spec.ts`), and T021 already covers US3.
Write each pair in sequence within its file.

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (blocks everything) → 3. Phase 3 US1 →
4. **STOP and VALIDATE**: the visitor can see everything they have decided, and
   nothing they rated is lost. That closes the constitution's "never a dead end"
   gap on its own.

### Incremental delivery

1. Setup + Foundational → the nav exists, the store can delete.
2. US1 → validate → **MVP**.
3. US2 → re-rate and remove → validate → the deck agrees with the watchlist.
4. US3 → history → validate → every recorded state is reachable.

### Notes

- **The branch does not exist yet.** `.specify/extensions.yml` is absent, so no
  `before_specify` git hook ran and `/speckit-specify 003` created only the spec
  directory. Create `003-ratings-watchlist` from `main` before the first commit
  — 001 and 002 were stacked, and that is no longer the workflow
  (`stacked-feature-branches` memory: the stack landed on `main` at `19d9540`).
- Commit after each task or logical group.
- `InteractionStore` stays **non-reactive** (research.md D4). Read on
  construction, re-read after your own writes. Do not convert it to signals in
  this slice — that is a codebase-wide pattern change belonging in its own, and
  the caveat that makes it safe (one live view at a time) is recorded in D4.
- The `watchlist-logic/` module must have **no Angular imports**, so it relocates
  to the API's Domain layer in Milestone 2 with no behavioural change.
- **Honest scoping**: T029 cannot be automated in this environment, and
  FR-017/SC-008 arrive at this slice *already* unverified from 002. T019 is the
  task most likely to pass for the wrong reason — 002's T033 is the precedent,
  and the mutation check is not optional.
