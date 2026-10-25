# Tasks: Deterministic Engine v2

**Input**: Design documents from `/specs/010-deterministic-engine-v2/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ranking-engine.md, quickstart.md

**Tests**: Required. The recommendation engine is a constitution critical path
(Principle V, test-first), so every implementation task below has its tests
written first, in the same phase, before the code.

**Organization**: Tasks are grouped by user story so each can be implemented and
verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every task names its exact file path.

## Path Conventions

- Frontend: `frontend/src/app/features/deck/…`
- Backend: `backend/src/…`, `backend/tests/…`
- Specs: `specs/010-deterministic-engine-v2/…`

---

## Phase 1: Setup

**Purpose**: Establish the yardstick before any code moves.

- [X] T001 Run `npm run eval` from `frontend/` on the pre-change code and record its three-row table (`incumbent`, `popularity`, `candidate-inverted`) in the Evidence section of `specs/010-deterministic-engine-v2/tasks.md`. This is the baseline every later number is compared against (SC-001, SC-002).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Split the incumbent out without changing a single behavior. Both
user stories need `recommend-v2.ts` to exist beside a working v1, and the
harness must keep reporting the same incumbent row.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete and
the full suite is green with no test edits.

- [X] T002 [P] Create `frontend/src/app/features/deck/deck-logic/recommend-shared.ts` and move the shared pieces out of `recommend.ts` **verbatim, comments included**: the `RankedTitle` interface; `GENRE_LABELS`, `PROVIDER_LABELS`, `SELECTABLE_GENRE_IDS`, `POSITIVE_STATES`; `RATING_PRIOR = 6.5` and `RATING_PRIOR_WEIGHT = 500` with `weightedRating(title)`; `eligibleTitles`, `isEligible`, `isScorable`, `isAvailableOnSelectedService`, `isOnSelectedService`; `matchedGenres`, `mismatchedGenres`, `compareIds`. No behavior change.
- [X] T003 Create `frontend/src/app/features/deck/deck-logic/recommend-v1.ts` containing the incumbent unchanged: `HISTORY_AFFINITY_WEIGHT = 6`, `MISMATCHED_GENRE_PENALTY = 10`, `genreSignals`, `historyAffinity`, its `reasonFor`/`labelFor`, and `rankTitlesV1(catalog, preferences, interactions, shownTitleIds): RankedTitle[]` with the two-key sort `b.matches - a.matches || b.within - a.within || compareIds(...)`. Export `RECOMMEND_V1_ENGINE_VERSION = 'recommend-v1'`. It imports eligibility and labels from `recommend-shared.ts`.
- [X] T004 Rewire `frontend/src/app/features/deck/deck-logic/recommend.ts` to re-export the shared surface (`RankedTitle`, `ReasonCode`, `eligibleTitles`, `weightedRating`) and implement `rankTitles(...)` as a temporary pass-through to `rankTitlesV1`; keep `RECOMMEND_ENGINE_VERSION = 'recommend-v1'` for now. Run `npx ng test --watch=false` — every existing test must pass with no edits.
- [X] T005 [P] Move today's ordering assertions from `frontend/src/app/features/deck/deck-logic/recommend.spec.ts` to `frontend/src/app/features/deck/deck-logic/recommend-v1.spec.ts`, importing `rankTitlesV1` and the shared helpers; delete the moved assertions from `recommend.spec.ts` (the registry tests arrive in US1). Run `npx ng test --watch=false` — green.

**Checkpoint**: v1 is a module, shared eligibility has one home, and the suite is
green without a behavior change — the regression net for the rest of the work.

---

## Phase 3: User Story 1 — Better ranking (Priority: P1) 🎯 MVP

**Goal**: v2 scores the shared candidate pool with genres, era, runtime, and
calibrated quality; it becomes the deck's default engine and beats the incumbent
by the agreed margin on the standard fixture.

**Independent Test**: `recommend-v2.spec.ts` and `recommend-invariants.spec.ts`
pass, the harness reports `candidate-v2` with NDCG@10 ≥ 1.10 × incumbent and
MRR/hit rate not lower, and `?engine=v1` still serves the old order.

### Tests for User Story 1 (write first, expect red)

- [X] T006 [P] [US1] Write `frontend/src/app/features/deck/deck-logic/recommend-v2.spec.ts` covering the contract's scoring rules: weighted genre term lets a strong one-genre title outrank a weaker two-genre one (FR-004); history affinity is divided by the title's distinct genre count (D4); era fit `max(0, 1 − |releaseYear − eraCentre| / 20)` and neutral below 3 positives (FR-006); runtime fit `max(0, 1 − |runtimeMinutes − runtimeCentre| / 45)`, neutral below 3 positives carrying a runtime, and silent (FR-007); calibrated prior `(rating·votes + μ·m) / (votes + m)` with catalog means (FR-008); cold start and rejections-only produce a valid non-empty order (FR-014); duplicate genre counts once; all-same-year is constant; shuffled catalog yields identical order; id tiebreak decides ties (SC-003/SC-007); and the 2 000-title × 20-run perf guard from D10. Tests must fail: the module does not exist yet.
- [X] T007 [P] [US1] Write `frontend/src/app/features/deck/deck-logic/recommend-invariants.spec.ts` running **both** `rankTitlesV1` and `rankTitlesV2` against the same scenarios: Filter Enforcement (no title off the selected services, successor map honored, `includeUnownedProviders` honored) and Feedback Loop (every rated state and every shown id excluded); every returned id is unique and was eligible in the input (SC-005).
- [X] T008 [P] [US1] Write `frontend/src/app/features/deck/deck-logic/recommend.spec.ts` registry tests: `engineChoiceFrom(null) === 'v2'`, `engineChoiceFrom('v1') === 'v1'`, unknown value → `'v2'`; `DEFAULT_ENGINE === 'v2'`; `ENGINE_VERSIONS` maps `v1 → 'recommend-v1'`, `v2 → 'recommend-v2'`; `rankTitles(..., 'v1')` equals `rankTitlesV1`.
- [X] T009 [P] [US1] Extend `frontend/src/app/features/deck/deck.spec.ts`: with no `engine` parameter the deck ranks with v2 and stamps `recommend-v2` on impressions; with `?engine=v1` it ranks with v1 and stamps `recommend-v1`; an unknown value does not throw and stamps `recommend-v2` (FR-012/FR-013).

### Implementation for User Story 1

- [X] T010 [US1] Implement scoring in `frontend/src/app/features/deck/deck-logic/recommend-v2.ts`: the derived taste profile (`genreWeights` signed ±1 per rated title, `positiveCount`, `eraCentre`, `runtimeCentre`, `runtimeEvidence`), the term weights from `contracts/ranking-engine.md` as named constants (`GENRE_MATCH_WEIGHT = 4`, `HISTORY_WEIGHT = 6`, `MISMATCHED_GENRE_PENALTY = 10`, `SERVICE_WEIGHT = 1`, `ERA_WEIGHT = 2.5`, `RUNTIME_WEIGHT = 1.5`, `ERA_SPAN_YEARS = 20`, `RUNTIME_SPAN_MINUTES = 45`, `MIN_ERA_EVIDENCE = 3`, `MIN_RUNTIME_EVIDENCE = 3`), the catalog-calibrated prior, the reason branches for the existing codes only (`genre-picked`, `genre-affinity`, `service`, `none`), and `rankTitlesV2` sorting by score then `compareIds`. Export `RECOMMEND_V2_ENGINE_VERSION = 'recommend-v2'`. No `Math.log/sqrt/exp/pow`, no clock, no randomness (D3, FR-001/FR-002). Make T006/T007 pass.
- [X] T011 [US1] Complete the registry in `frontend/src/app/features/deck/deck-logic/recommend.ts`: `EngineChoice = 'v1' | 'v2'`, `DEFAULT_ENGINE = 'v2'`, `ENGINE_VERSIONS`, `engineChoiceFrom(value: string | null)`, `RECOMMEND_ENGINE_VERSION = 'recommend-v2'`, and `rankTitles(..., engine = DEFAULT_ENGINE)` dispatching to the two modules. In `frontend/src/app/features/deck/deck.ts`, resolve the choice once from `route.snapshot.queryParamMap.get('engine')` and stamp `ENGINE_VERSIONS[choice]` in the impression at the existing `engineVersion` site. Make T008/T009 pass.
- [X] T012 [US1] Update `frontend/src/app/features/deck/deck-logic/evaluation/rankers.ts`: pin `incumbentRanker` to `rankTitles(..., 'v1')` with `engineVersion: 'recommend-v1'`; pin `invertedRanker` to v1 as well; add `candidateV2Ranker` (`name: 'candidate-v2'`, `engineVersion: 'recommend-v2'`) wrapping the default; leave `popularityRanker` untouched. Extend `evaluation/harness.spec.ts` to expect four rows and unchanged measures/columns.
- [X] T013 [US1] Run `npm run eval` from `frontend/` and tune the weight constants in `recommend-v2.ts` until, for every persona, `candidate-v2` NDCG@10 is at least 10% above `incumbent`'s and MRR/hit rate@10 are not lower (SC-001). Record the final harness table in the Evidence section. **If any persona misses after honest tuning, set `DEFAULT_ENGINE = 'v1'`, keep v2 reachable by override and in the harness, and report the numbers instead of shipping v2 as default** (spec clarification of 2026-10-24).

**Checkpoint**: both engines are tested against the invariants. **Outcome of
T013: the SC-001 gate was measured and missed, so the spec clarification's
fallback applies — v1 stays the deck's default, v2 is served through
`?engine=v2` and reported by the harness.** See Evidence.

---

## Phase 4: User Story 2 — A deck that does not repeat itself (Priority: P2)

**Goal**: MMR re-ranks the top 50 candidates, raising intra-list diversity
without collapsing NDCG or coverage.

**Independent Test**: `recommend-diversity.spec.ts` passes and the harness shows
higher diversity than the incumbent with coverage ≥ 90% of it.

### Tests for User Story 2 (write first, expect red)

- [X] T014 [P] [US2] Write `frontend/src/app/features/deck/deck-logic/recommend-diversity.spec.ts`: a near-duplicate-genre catalog produces a more varied order than score order; two runs are identical; a shuffled catalog is identical; fewer than 50 candidates still re-ranks validly; candidates beyond the window keep score order; the output is a permutation of the same scored titles (nothing injected); window boundary at exactly 50; λ constant is 0.75; fixture coverage is ≥ 90% of v1's (SC-002, SC-003).

### Implementation for User Story 2

- [X] T015 [US2] Implement the MMR re-rank in `frontend/src/app/features/deck/deck-logic/recommend-v2.ts` exactly as `contracts/ranking-engine.md` § Diversity re-rank: window `50`, min-max relevance over the window (all `1` when max = min), Jaccard genre similarity (`0` for two empty sets), greedy `λ·r − (1 − λ)·maxSim` with `MMR_LAMBDA = 0.75`, ties to original score order, and score order appended beyond the window. Make T014 pass.
- [X] T016 [US2] Run `npm run eval` and confirm SC-002 on the fixture (diversity above the incumbent, coverage ≥ 90% of it) while SC-001 still holds; tune λ only within 0.70–0.80 if needed and record the report in Evidence.

**Checkpoint**: US1 and US2 both hold their measured floors.

---

## Phase 5: User Story 3 — Reasons that stay honest (Priority: P3)

**Goal**: every reason is backed by a positive score term, the vocabulary gains
`era-affinity` end to end, and runtime never speaks.

**Independent Test**: `recommend-reasons.spec.ts` and the backend vocabulary
tests pass; a fixture replay shows 100% of reasons have a positive contribution
and 0% of reasonless cards have one (SC-004).

### Tests for User Story 3 (write first, expect red)

- [X] T017 [P] [US3] Extend `backend/tests/PlayNext.Application.Tests/RecordRecommendationEventsUseCaseTests.cs` and `backend/tests/PlayNext.Api.IntegrationTests/RecommendationEventTests.cs` to accept `era-affinity` while still rejecting an unknown code; run `dotnet test backend/PlayNext.sln` and expect red until T019.
- [X] T018 [P] [US3] Write `frontend/src/app/features/deck/deck-logic/recommend-reasons.spec.ts`: for a replayed fixture, every card with a reason has a positive contribution from the named feature and every `none` card shows no reason (SC-004); `era-affinity` appears only when `positiveCount ≥ 3` and `eraFit > 0`; `service` appears only when the availability term is 1; runtime never produces a reason; every emitted code is in the closed vocabulary.

### Implementation for User Story 3

- [X] T019 [US3] Add `EraAffinity = "era-affinity"` to `backend/src/PlayNext.Domain/RecommendationReasonCodes.cs`, inserted in `All` between `GenreAffinity` and `Service` (precedence order), and add `'era-affinity'` to `ReasonCode` in `frontend/src/app/core/models/telemetry.ts`. Make T017 pass.
- [X] T020 [US3] Add the era branch to `recommend-v2.ts`'s `reasonFor` at precedence position 3 — sentence `Because you loved ${decade}s titles` where decade is `Math.floor(title.releaseYear / 10) * 10` of the card's own year — firing only when `eraFit > 0`; move the service branch last with its existing positive-term guard. Make T018 pass.
- [X] T021 [US3] Amend `specs/009-recommendation-telemetry/contracts/recommendation-events.md`'s reason-code enum to include `era-affinity` marked "added by feature 010"; change nothing else in that contract.

**Checkpoint**: all three stories are independently green.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T022 [P] Reconcile `specs/010-deterministic-engine-v2/plan.md`'s source tree with the shipped files (the 009 lesson: the plan names what exists).
- [X] T023 Run the full verification set: `npx ng test --watch=false` and `npx ng build` in `frontend/`, `dotnet test backend/PlayNext.sln` at the root. All green, zero skipped tests that CI expects to run. Record suite totals in Evidence.
- [X] T024 Run `npm run eval` twice and compare reports — identical measures for every ranker (SC-003). Record both runs.
- [X] T025 Run the quickstart end-to-end checks from `specs/010-deterministic-engine-v2/quickstart.md`, including the 390 px deck walkthrough, the `?engine=v1` comparison, and engine version on impressions in the Network tab. Record observations.
- [X] T026 Remove dead code left by the split (unused re-exports, orphaned imports), confirm no `TODO`/`FIXME` was introduced, record every piece of evidence in this file, and mark all tasks `[X]`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: no dependencies.
- **Foundational (T002–T005)**: depends on T001; blocks every user story.
  T002 → T003 → T004; T005 depends on T003/T004.
- **US1 (T006–T013)**: depends on T004. T006–T009 are test-only and [P] with each other; T010 depends on T006/T007; T011 on T008/T009/T010; T012 on T011; T013 on T012.
- **US2 (T014–T016)**: depends on T010 (v2 module exists). T014 before T015; T016 after T015.
- **US3 (T017–T021)**: T017/T018 [P] after T010. T019 after T017; T020 after T018/T019; T021 independent.
- **Polish (T022–T026)**: after all desired stories.

### User Story Dependencies

- **US1** is the MVP and the base for the others (it creates v2).
- **US2** extends v2's ordering; it does not depend on US3.
- **US3** extends v2's reasons; it does not depend on US2.

### Parallel Opportunities

- T006, T007, T008, T009 — four different spec files.
- T002 can run beside T005's planning but not beside T003 (shared imports).
- T017 (backend tests) and T018 (frontend reason tests) — different stacks.
- T022 can run beside T023.

## Parallel Example: User Story 1 tests

```bash
# Four independent test files, one message:
T006 recommend-v2.spec.ts        # scoring rules
T007 recommend-invariants.spec.ts # Filter Enforcement + Feedback Loop
T008 recommend.spec.ts           # registry
T009 deck.spec.ts                # ?engine= and version stamping
```

## Implementation Strategy

### MVP First

1. T001 (baseline) → T002–T005 (split, suite green).
2. T006–T013 (US1): v2 implemented and measured; the gate missed, so v1 stays
   the default and v2 ships behind `?engine=v2` (T013 fallback).
3. Stop and validate US1 independently before touching diversity or reasons.

### Incremental Delivery

- US1 → measured ranking win, default engine, override working.
- US2 → measured diversity win on top, floors re-checked.
- US3 → vocabulary and honesty guarantee; backend and frontend in sync.
- Polish → full suites, determinism, quickstart, evidence.

## Notes

- Tests are not optional here: Principle V makes the recommendation path
  test-first, and both constitution invariants are part of US1's tests.
- The fixture `personas-v1` is read-only throughout (D9). Tune weights, never
  data.
- Every weight change that reorders the deck is an engine-version concern
  (FR-012); the version strings are set in T010/T011 and must not change after
  T013 without a harness run.
- No dependency, migration, or catalog change is permitted (FR-016).

---

## Evidence

### T001 — Baseline, pre-change (2026-10-24)

`npm run eval` — fixture `personas-v1`, catalog `2026-09-30T00:00:00.000Z`,
60 decisions.

| Ranker | NDCG@10 | MRR | Hit@10 | Precision@10 | Coverage | Diversity |
|---|---|---|---|---|---|---|
| incumbent `recommend-v1` | 0.675 | 0.625 | 1.000 | 0.380 | 0.667 | 0.691 |
| popularity `popularity-v1` | 0.285 | 0.388 | 0.917 | 0.140 | 0.333 | 0.849 |
| candidate-inverted `candidate-inverted-v1` | 0.000 | 0.000 | 0.000 | 0.000 | 0.852 | 0.742 |

Acceptance targets derived from it:

- **SC-001** — candidate NDCG@10 ≥ **0.7425** (0.675 × 1.10); MRR ≥ **0.625**;
  hit rate@10 ≥ **1.000** (already perfect, so exactly 1.000 is required).
- **SC-002** — candidate diversity > **0.691**; coverage ≥ **0.600**
  (0.667 × 0.90).

### T002–T005 — Foundational split

- `recommend-shared.ts` holds eligibility, labels, `RankedTitle`, and the fixed
  popularity prior; `recommend-v1.ts` is the incumbent verbatim; `recommend.ts`
  was a pass-through to v1 at this checkpoint.
- Full suite after T004: **870 passed**, with no test edits — the regression net
  the rest of the feature relies on.
- T005 moved the historical ordering assertions to `recommend-v1.spec.ts`
  unchanged (`rankTitles` → `rankTitlesV1`, version constant renamed).

### T006–T012 — US1 implementation

- `recommend-v2.spec.ts` — 30 tests (weighted genre term, normalized affinity,
  era/runtime neutrals and kernels, calibrated prior, cold start, duplicate
  tags, determinism, id tiebreak, purity, finite scores, 2 000-title × 20-run
  perf guard).
- `recommend-invariants.spec.ts` — Filter Enforcement and Feedback Loop run
  against **both** engines, plus a membership equality check: the two engines
  admit the same candidates.
- `recommend.spec.ts` — registry tests; `deck.spec.ts` — engine stamping on the
  impression.
- Harness gained the `candidate-v2` row and a variadic `evaluate(...candidates)`;
  `incumbent` and `candidate-inverted` are pinned to v1 by name.

### T013 — SC-001 measurement and fallback (2026-10-24)

`npm run eval`, current code (fixture `personas-v1`, 60 decisions):

| Ranker | NDCG@10 | MRR | Hit@10 | Precision@10 | Coverage | Diversity |
|---|---|---|---|---|---|---|
| incumbent `recommend-v1` | 0.675 | 0.625 | 1.000 | 0.380 | 0.667 | 0.691 |
| popularity `popularity-v1` | 0.285 | 0.388 | 0.917 | 0.140 | 0.333 | 0.849 |
| candidate-v2 `recommend-v2` | 0.623 | 0.553 | 0.983 | 0.352 | 0.685 | 0.682 |
| candidate-inverted `candidate-inverted-v1` | 0.000 | 0.000 | 0.000 | 0.000 | 0.852 | 0.742 |

The fixture was not edited (D9). Tuning was done with a throwaway parametric
copy of the contract formula (verified faithful: it reproduces the
`candidate-v2` row byte-for-byte), swept over 25 308 weight configurations
across the named constants, the quality prior, and the affinity/quality scales.

**Best configurations found**

| Configuration | NDCG@10 | MRR | Hit@10 | Status |
|---|---|---|---|---|
| gate (SC-001) | ≥ 0.7425 | ≥ 0.625 | = 1.000 | required |
| v2, contract starting weights | 0.623 | 0.553 | 0.983 | misses |
| v2, best reweighting that keeps the contract's quality prior | 0.6429 | 0.5944 | 0.9833 | misses; below the incumbent |
| v2, best found anywhere (`HISTORY_WEIGHT = 0`, `MISMATCH = 0`, `ERA_WEIGHT = 10`, prior votes = 0.045 × catalog mean) | 0.7444 | 0.8475 | 1.000 | violates FR-005/FR-008; pre-MMR |

The best reweighting that keeps the contract's quality prior was
`G = 2, H = 2, M = 10, E = 5, S = 1`; the plateau around it does not move the
aggregate past 0.643. Per-persona ceilings within that contract:

| Persona | Incumbent NDCG@10 | Best v2 session NDCG in sweep | Needed (1.10×) |
|---|---|---|---|
| horror | 0.807 | 0.8802 | 0.888 |
| prestige-drama | 0.569 | 0.4882 | 0.626 |
| family-animation | 0.649 | 0.5607 | 0.714 |
| science-fiction | — (no labels) | — | — |

**Why the degenerate set is not a tuning result.** It only clears the gate by
turning off the two terms the feature is built on — the visitor's own genre
history (`HISTORY_WEIGHT = 0`, contradicting FR-005 and US1 scenario 2) and the
mismatch rule the contract keeps from v1 — and by weakening the quality prior
so a lone 10.0 from 640 votes stays near 9.9 on this catalog (FR-008 requires
the catalog mean as the prior). It is fixture-fitting, not tuning, and US2's
diversity re-rank (not yet applied at this measurement) only moves NDCG down.

**Outcome** — the spec clarification of 2026-10-24 applies: v2 does not become
the default.

- `DEFAULT_ENGINE = 'v1'`; `engineChoiceFrom('v1')`/`engineChoiceFrom('v2')`
  select by name, and anything else — absent, empty, unknown — returns the
  default (v1).
- `?engine=v2` serves the candidate; the harness always reports both rows.
- v2's constants stay at the contract's starting values; the sweep's compliant
  best (0.643) would encode fixture noise without reaching the gate, and the
  module's rules did not change, so `recommend-v2` keeps its version string
  (FR-012).
- Registry and deck tests were updated to the post-fallback mapping; full suite
  green. Final suite totals are recorded under T023.

### T014–T016 — US2: the diversity re-rank

`recommend-diversity.spec.ts` — ten tests: the near-duplicate catalog's top ten
becomes materially more varied than the incumbent's; two runs identical; a
reversed catalog identical; the output is a permutation of the scored pool;
the card keeps its raw score when the re-rank moves it; the first 50 are
re-ranked and the rest appended in score order; the boundary is exactly 50; a
pool smaller than the window still re-ranks; `MMR_WINDOW = 50` and
`MMR_LAMBDA = 0.75`; the fixture's coverage stays ≥ 90% of the incumbent's.

The re-rank lives in `recommend-v2.ts` after the score sort: min-max relevance
over the window, Jaccard genre similarity (0 for two empty sets), greedy
`λ·r − (1−λ)·maxSim`, ties to score order, window tail appended untouched.
`genreSimilarity` is deliberately local rather than the harness's
`genreJaccard`: the measure treats two genre-less titles as similar, the
re-rank treats them as no evidence (contract).

Harness after T015 (`npm run eval`, fixture `personas-v1`, 60 decisions):

| Ranker | NDCG@10 | MRR | Hit@10 | Precision@10 | Coverage | Diversity |
|---|---|---|---|---|---|---|
| incumbent `recommend-v1` | 0.675 | 0.625 | 1.000 | 0.380 | 0.667 | 0.691 |
| popularity `popularity-v1` | 0.285 | 0.388 | 0.917 | 0.140 | 0.333 | 0.849 |
| candidate-v2 `recommend-v2` | 0.611 | 0.542 | 1.000 | 0.353 | 0.685 | 0.701 |

**SC-002 holds**: diversity 0.701 > incumbent 0.691, coverage 0.685 ≥ 90% of
0.667 (0.600). λ was not tuned — the contract value 0.75 clears the floor, so
there was nothing to tune within 0.70–0.80.

The re-rank moved NDCG 0.623 → 0.611 and MRR 0.553 → 0.542 while raising hit@10
0.983 → 1.000. It cannot change SC-001's outcome: NDCG remains below the
incumbent's 0.675, and the T013 fallback (v1 stays the default) is what makes
that acceptable. US2's floors are independent of that decision.

### T017–T021 — US3: reasons that stay honest

`recommend-reasons.spec.ts` — seven tests. The central one replays the whole
fixture through a recording ranker, so every card is checked against the exact
input it was ranked from: a `genre-picked` card must have a selected-genre
match, `genre-affinity` a positive averaged affinity, `era-affinity` a positive
era fit, `service` a `1` availability term; a `none` card must be the one with
no positive contribution at all and must carry `reason: null`. The contribution
checks recompute the profile and the fit from the contract independently of
the engine, so the test can disagree with it. Focused tests pin the era's three
guards (three positives, inside the 20-year span, the card's own decade), the
service guard under `Any`, and that runtime never produces a sentence. The
vocabulary is pinned to the five wire values.

The era branch sits at precedence 3 in `reasonFor`, between affinity and
service, and speaks only when `eraFit > 0`:

- `Because you loved 2000s titles` for a 2004 card with a 1995-era taste centre
  (`Math.floor(releaseYear / 10) * 10` — the card's decade, not the centre's).

Backend:

- `RecommendationReasonCodes.EraAffinity = "era-affinity"`, inserted in `All`
  between `GenreAffinity` and `Service` (precedence order).
- `RecordRecommendationEventsUseCaseTests`: a theory over the five wire strings
  (red until this change on the `era-affinity` case), a loop over
  `RecommendationReasonCodes.All` proving the intake accepts the domain
  vocabulary without restating it, and a fact that an unknown code
  (`era-preference`) is still refused before the store.
- `RecommendationEventTests` (gated integration): a 202 for an era-affinity
  impression, with the stored row's `ReasonCode` read back as `era-affinity`.
- `frontend/src/app/core/models/telemetry.ts`: `ReasonCode` gained
  `'era-affinity'` in precedence position.
- `specs/009-recommendation-telemetry/contracts/recommendation-events.md`: the
  enum row now lists `era-affinity` with a footnote naming feature 010; nothing
  else in that contract changed.

### T022 — Documentation reconciled after the fallback

The 009 lesson applied: every artifact now describes what shipped, not what the
plan intended before T013.

- `plan.md` — Summary gained the "Shipped outcome (T013 fallback)" note; the
  source tree lists the four harness/evaluation files that exist
  (`rankers.ts` pins the incumbent to v1; `harness.spec.ts` shows four rows).
- `data-model.md` — engine-choice table is v1 default / `v2` via `?engine=v2` /
  anything else → v1; `RECOMMEND_ENGINE_VERSION` names v1.
- `contracts/ranking-engine.md` — input comment `// 'v1'`; the engine table says
  absent → v1, `v2` → v2, anything else → v1, with the fallback paragraph.
- `quickstart.md` — checklist expectations match the post-fallback stamping,
  records the T013 miss and SC-002 pass, and the walkthrough opens with
  `?engine=v2` then reloads without the parameter.

### T023 — Full verification set (2026-10-24)

Frontend, `npx ng test --watch=false`:

- **53 files passed, 1 skipped; 946 tests passed, 299 skipped, 0 failed.**
- The count includes the throwaway `evaluation/tune.spec.ts` (removed in T026;
  the post-removal total is recorded there). The skips are the gated tests the
  suite always skips (perf guards and environment-gated cases).

Frontend, `npx ng build`: "Application bundle generation complete", output
`frontend/dist/playnext`, no warnings.

Backend, `dotnet test backend/PlayNext.sln`:

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| `PlayNext.Domain.Tests` | 211 | 0 | 0 |
| `PlayNext.Application.Tests` | 178 | 0 | 0 |
| `PlayNext.Api.IntegrationTests` | 130 | 0 | 0 (2m02s) |

The integration suite ran ungated against Postgres and included the new
`An_era_affinity_impression_is_accepted` round trip.

### T024 — SC-003: two harness runs, identical reports (2026-10-24)

`npm run eval` twice in a row; the report tables diffed clean (byte-identical).
Both runs:

| Ranker | NDCG@10 | MRR | Hit@10 | Precision@10 | Coverage | Diversity | Decisions |
|---|---|---|---|---|---|---|---|
| incumbent `recommend-v1` | 0.675 | 0.625 | 1.000 | 0.380 | 0.667 | 0.691 | 60 |
| popularity `popularity-v1` | 0.285 | 0.388 | 0.917 | 0.140 | 0.333 | 0.849 | 60 |
| candidate-v2 `recommend-v2` | 0.611 | 0.542 | 1.000 | 0.353 | 0.685 | 0.701 | 60 |
| candidate-inverted `candidate-inverted-v1` | 0.000 | 0.000 | 0.000 | 0.000 | 0.852 | 0.742 | 60 |

Every measure matches the T016 table, so the shipped code reproduces the
recorded v2 numbers exactly (SC-003).

### T025 — Quickstart end-to-end, real browser (2026-10-24)

Method: the API (`http://localhost:5003`) and the dev server
(`http://localhost:4200`) running locally; real Chrome driven over CDP with
`Emulation.setDeviceMetricsOverride` at **390 × 844, DPR 2** (the window-size
clamp the earlier quickstarts worked around with an iframe does not apply to
emulation). The quiz was completed through the UI — Movie, Drama, Netflix — and
the deck swiped 10 times per run with the same action sequence
(liked, skip, liked, disliked, skip, liked, skip, liked, disliked, skip),
clearing browser storage between runs.

| Check | Observation |
|---|---|
| Default URL (no `engine`) | 11 cards shown; every impression recorded `recommend-v1`; 2 POSTs, both 202 |
| `?engine=v2`, same fresh visitor | every impression recorded `recommend-v2`; 2 POSTs, both 202 |
| `?engine=v1` | deck renders; impressions `recommend-v1` |
| `?engine=v3` and `?engine=` | deck renders the v1 order; impressions `recommend-v1`; zero console warnings/errors |
| Order differs between engines | first difference at **position 4** — v1: The Departed → The Whisper Man; v2: The Departed → Fight Club (positions 1–3 identical) |
| Network shape | 11 impressions and 10 actions per run, flushed as 2 batches (threshold 20 events), server 202 |
| Reason honesty (SC-004 by eye) | all 22 observed reasons were "Because you picked Drama", and every card's catalog entry carries `drama` — no sentence names a genre, era, or service its card lacks |
| No-reason card | none appeared in these runs, correctly: with a real genre selection the `genre-picked` branch always has a positive contribution. The no-row rendering stays pinned by the card component spec |
| Genre spread (SC-002 by eye) | every card shares the selected `drama` by construction; the secondary genres varied (crime, thriller, romance, fantasy, horror, action, war), so no run read as one shelf. The exact SC-002 number is the harness diversity 0.701 > 0.691 |

Screenshots captured during the run confirmed the phone layout: one card at a
time, the reason row in the card's violet, the action bar above the bottom nav.

Operational note: this API process started with no active catalog, so the first
catalog request answered `catalog-not-ready` while a full TMDB retrieval ran;
once it completed, the deck's filters returned 960 titles. Not a feature
change — the 503 path is 008's designed behaviour.

### T026 — Dead code removed, final verification (2026-10-24)

Removed:

- `frontend/src/app/features/deck/deck-logic/evaluation/tune.spec.ts` — the
  throwaway T013 sweep (five exploratory tests), never part of the suite by
  design.
- The `export` on `SELECTABLE_GENRE_IDS` in `recommend-shared.ts` — used only
  inside that module by `mismatchedGenres`, so the split's re-export was dead
  surface.
- `export type { ReasonCode }` (and its import) in `recommend.ts` — nothing
  imported the type through the registry; callers take it from
  `core/models/telemetry` where it is defined.

Checked:

- No `TODO`/`FIXME` in any added line of the working diff or in any untracked
  file (the only match is this task's own text).
- No orphaned imports in `recommend-v1.ts`, `recommend-v2.ts`,
  `recommend-shared.ts`, or `recommend.ts` (every imported symbol is used).

Final suite, after the removal — `npx ng test --watch=false`:

- **52 files passed, 1 skipped; 941 tests passed, 299 skipped, 0 failed**
  (T023's 946 minus the throwaway spec's 5).
- `npx ng build`: clean, output `frontend/dist/playnext`.

The backend is untouched by T026; its last recorded run is T023's (211 + 178 +
130 passed, 0 failed).
