# Implementation Plan: Deterministic Engine v2

**Branch**: `010-deterministic-engine-v2` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-deterministic-engine-v2/spec.md`

## Summary

Ship a second, deterministic ranking engine that orders the deck measurably
better than the incumbent and spaces out its genre runs, without changing what
a candidate is. `recommend-v1` moves verbatim into its own module;
`recommend-v2` scores the shared candidate pool with the features the catalog
actually carries (genres, release year, runtime, rating, votes), re-ranks the
top of the list with MMR, and explains each card with a reason that a score
term backs. The offline harness gains a `candidate-v2` row so SC-001/SC-002
are numbers, not opinions, and the deck's engine is selectable once via
`?engine=v1` for a staged comparison that 009's stored events can judge.

**Shipped outcome (T013 fallback)**: the harness measured v2 below the
incumbent's NDCG@10, so by the spec clarification of 2026-10-24 v2 did **not**
become the default. v1 still serves the deck; `?engine=v2` selects the
candidate and the harness reports both rows. The measured numbers and the
tuning ceiling are in `tasks.md` § Evidence.

## Technical Context

**Language/Version**: TypeScript 5.x on Angular 22 (frontend, where the engine
lives); C# 14 on .NET 10 (backend, only the reason-code vocabulary changes).

**Primary Dependencies**: none new. The engine is plain TypeScript inside the
existing Angular app; the backend change touches existing Domain constants.

**Storage**: unchanged. No migration. The only persisted vocabulary that grows
is `RecommendationImpressions.ReasonCode` (one new value).

**Testing**: Vitest through Angular's test builder
(`npx ng test --watch=false`) for the engine, deck, and harness; xUnit for the
backend vocabulary and intake (`dotnet test backend/PlayNext.sln`).

**Target Platform**: mobile web / PWA first (360 px), the same browsers the
constitution lists; the engine runs client-side in the deck.

**Project Type**: web application with an Angular frontend and a .NET backend;
this feature is frontend-heavy.

**Performance Goals**: a recommendation card still renders in under 300 ms;
ranking is `O(n log n)` plus a bounded `50²` re-rank (SC-006, D10).

**Constraints**: pure function of its inputs — no clock, network, randomness,
or cached profile (FR-001/FR-002); only `+ − × ÷` and `Math.max` (D3); the
incumbent must keep running unchanged (FR-013); the fixture is read-only (D9);
the 009 record shape does not change.

**Scale/Scope**: the deck's catalog (a few thousand titles) and the frozen
`personas-v1` fixture (54 titles, four personas); one new module, one split,
one vocabulary member, one harness row.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Mobile-First Experience | No UI change beyond the card's reason sentence; the deck stays one-card-at-a-time at 360 px; verified in the phone-width quickstart | **PASS** — no layout change; reasons render in the existing reason row |
| II. Decision Speed & Simplicity | Card under 300 ms; the feature removes choice paralysis rather than adding steps; simplest implementation satisfying the spec | **PASS** — no new screen, no new dependency; one pure function per engine (D1) |
| III. Guest-First Access | Guests get v2 exactly as signed-in users do; nothing requires an account | **PASS** — the engine reads the same guest state the incumbent reads |
| IV. API-First Architecture | No persistent state moves into the client; no provider credential is touched; the client still renders what the API provides | **PASS** — ranking was and remains a client-side pure function (the clarification of 2026-10-24 confirmed it stays there) |
| V. Test-First for Critical Paths | The recommendation path is a critical path; **tests precede implementation**, and both invariants (Filter Enforcement, Feedback Loop) are covered for v2 | **PASS** — tasks.md puts every v2 test before its code; v2 shares the one eligibility function, and invariant tests run against both engines |
| VI. Deterministic Recommendations | Deterministic weighted scoring, no ML, reproducible, explainable, testable in isolation | **PASS** — pure arithmetic (D3), no learning, every card's reason is backed by a positive term (D8); no ML was chosen for this round by the research's §13 decision |
| VII. Clean Architecture & Domain Integrity | The backend change stays in the Domain vocabulary; no layering break | **PASS** — a constant added to an existing Domain class; the ranking itself was always frontend-side, as 002 established |
| Engineering Standards | No new dependency; no dead code; no formatting churn; secrets untouched | **PASS** |
| Development Workflow | Spec → plan → tasks → implement; PR with review; build and test gates | **PASS** — this feature follows the flow; the PR opens after the user reviews |

No violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/010-deterministic-engine-v2/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — decisions D1–D12
├── data-model.md        # Phase 1 — derived profile, vocabularies
├── quickstart.md        # Phase 1 — validation run book
├── contracts/
│   └── ranking-engine.md  # Phase 1 — the engine contract
├── checklists/
│   └── requirements.md  # Spec quality gate (16/16)
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── PlayNext.Domain/
│   │   └── RecommendationReasonCodes.cs        # + era-affinity
│   ├── PlayNext.Application/
│   │   ├── Contracts/RecommendationEventsContracts.cs   # reason type (wire)
│   │   └── Validation/RecommendationEventValidator.cs   # accepts the new code
│   └── PlayNext.Infrastructure/                # untouched
└── tests/
    ├── PlayNext.Application.Tests/
    │   └── RecordRecommendationEventsUseCaseTests.cs    # vocabulary test
    └── PlayNext.Api.IntegrationTests/
        └── RecommendationEventTests.cs       # intake accepts era-affinity

frontend/
├── src/app/
│   ├── core/models/
│   │   └── telemetry.ts                       # ReasonCode union + era-affinity
│   └── features/deck/
│       ├── deck.ts                            # resolves ?engine=; stamps version
│       ├── deck.spec.ts                       # override + stamping tests
│       └── deck-logic/
│           ├── recommend.ts                   # registry, default, re-exports
│           ├── recommend.spec.ts              # registry/default tests
│           ├── recommend-shared.ts            # eligibility, labels, RankedTitle
│           ├── recommend-v1.ts                # the incumbent, verbatim
│           ├── recommend-v1.spec.ts           # today's ordering tests, moved
│           ├── recommend-v2.ts                # the new engine
│           ├── recommend-v2.spec.ts           # v2 rules, determinism, perf
│           ├── recommend-invariants.spec.ts   # both invariants, both engines
│           ├── recommend-diversity.spec.ts    # US2 — the MMR rule
│           ├── recommend-reasons.spec.ts      # US3 — reason honesty
│           └── evaluation/
│               ├── rankers.ts                 # + candidate-v2; incumbent pins v1
│               └── harness.spec.ts            # four rows, unchanged measures
└── package.json                               # `npm run eval` unchanged
```

**Structure Decision**: the web-application layout the repository already has.
The feature is almost entirely inside `frontend/src/app/features/deck/deck-logic/`
because the ranking engine is a client-side pure function (established by 002,
confirmed by this feature's clarifications). The backend participates only to
keep the closed reason-code vocabulary in sync everywhere it is validated.

## Phase 0: Research

Complete. `research.md` records D1–D12; every unknown the Technical Context
would have raised is resolved there (engine split, feature set, arithmetic
constraints, normalization, prior, MMR, override, reasons, harness, perf,
recency, rollout). No NEEDS CLARIFICATION remains.

## Phase 1: Design & Contracts

Complete.

- `data-model.md` — the derived taste profile (no stored entity), the engine
  choice table, the reason-code and engine-version vocabularies, and the
  unchanged report shape.
- `contracts/ranking-engine.md` — inputs/outputs, the shared eligibility rule,
  the v2 scoring terms with starting weights, the MMR procedure, reason
  precedence with `era-affinity`, the override table, and the harness row.
- `quickstart.md` — the run book from unit tests to a phone-width end-to-end
  check.

### Post-design Constitution re-check

Re-run after the design above: all gates still pass. Two points worth naming:

- **Principle V** — the design puts the v2 rule tests and the two invariant
  tests ahead of the implementation in `tasks.md`, and the invariant tests are
  written once against the shared eligibility function so both engines carry
  them.
- **Principle II** — the design adds no screen, no dependency, and no stored
  field; the largest new surface is one pure function and its tests. MMR is
  bounded to 50 candidates precisely so it cannot cost the card its budget.

## Complexity Tracking

No constitution violations. Nothing to justify.
