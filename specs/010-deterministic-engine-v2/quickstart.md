# Quickstart: Deterministic Engine v2

**Feature**: 010-deterministic-engine-v2 | **Date**: 2026-10-24

How to prove this feature works, from the unit level up to a real deck in a
browser. Every command runs from the repository root unless stated otherwise.

## Prerequisites

- Node and npm installed; `frontend/node_modules` restored (`npm install` in
  `frontend/`).
- .NET 10 SDK for the backend suites (this feature changes no backend file
  except the reason-code vocabulary, but the suite must stay green).
- PostgreSQL reachable for the integration tests, configured as in
  `specs/009-recommendation-telemetry/quickstart.md`.
- No migrations are needed: this feature adds no schema change.

## 1. Unit scenarios — the engine itself

```powershell
cd frontend
npx ng test --watch=false --include=src/app/features/deck/deck-logic/recommend-v2.spec.ts
```

Expected:

- Every v2 rule from `contracts/ranking-engine.md` has a named test (weights,
  normalization, era and runtime terms, calibrated prior, cold start).
- The determinism test runs the same input twice — including a shuffled
  catalog — and asserts the same order.
- The perf guard (D10) builds a 2 000-title catalog, ranks it 20 times, and
  stays under its ceiling.

The re-rank and the reasons have suites of their own:

```powershell
npx ng test --watch=false --include=src/app/features/deck/deck-logic/recommend-diversity.spec.ts --include=src/app/features/deck/deck-logic/recommend-reasons.spec.ts
```

Expected: the MMR contract (window, λ, determinism, permutation, beyond-window
order) and the reason honesty sweep (every reason backed by a positive term,
`none` never speaks, runtime never speaks) pass.

Also run the incumbent's suite to prove the move was verbatim:

```powershell
npx ng test --watch=false --include=src/app/features/deck/deck-logic/recommend-v1.spec.ts
```

Expected: the assertions that lived in `recommend.spec.ts` before this feature
now pass against v1 unchanged.

## 2. Engine selection — `?engine=`

Unit-level, then in the app:

```powershell
npx ng test --watch=false --include=src/app/features/deck/deck.spec.ts
```

Checklist:

| Query | Expected |
|---|---|
| no `engine` parameter | v1 order (the incumbent kept the deck after the T013 fallback); impressions stamp `recommend-v1` |
| `?engine=v2` | v2 order; impressions stamp `recommend-v2` |
| `?engine=v1` | v1 order; impressions stamp `recommend-v1` |
| `?engine=v3`, `?engine=` | v1; no error, no console warning storm |

## 3. Harness — the numbers that decide SC-001/SC-002

```powershell
cd frontend
npm run eval
```

Expected: the report lists four rows — `incumbent` (`recommend-v1`),
`popularity` (`popularity-v1`), `candidate-v2` (`recommend-v2`), and
`candidate-inverted` (`candidate-inverted-v1`).

Recorded outcome (2026-10-24, the full evidence is in `tasks.md`):

- SC-001 was **measured and missed**: `candidate-v2` NDCG@10 0.611 against the
  incumbent's 0.675. The only configurations that cleared the 0.7425 gate did so
  by zeroing history and the mismatch rule or by weakening the FR-008 prior, so
  they were rejected as fixture-fitting. The fallback applies: v1 stays the
  deck's default and v2 stays reachable through `?engine=v2`.
- SC-002 **holds**: `candidate-v2` diversity 0.701 > incumbent 0.691, coverage
  0.685 ≥ 90% of the incumbent's 0.667.

Never edit the fixture when re-running (D9).

Record the final table in `tasks.md` when the harness step completes.

## 4. Backend — the vocabulary accepts the new code

```powershell
dotnet test backend/PlayNext.sln
```

Expected: the reason-code vocabulary test now includes `era-affinity`, the
intake accepts it, and every other suite is unchanged and green.

## 5. Production shape

```powershell
cd frontend
npx ng build
```

Expected: clean build; the bundle carries no server-only fields, and both
engine modules are present (they ship together on purpose — the override needs
v1 in the same bundle).

## 6. End-to-end in a phone-sized viewport

1. Run the app the usual way (`backend` API + `frontend` dev server).
2. Open the deck at 390 px width (through the fixed-size iframe technique the
   project uses for headless checks — desktop windows clamp wider).
3. Complete or skip the quiz, then open `?engine=v2` and swipe 10 cards:
   - no card repeats a genre run so long that the deck reads as one shelf
     (SC-002 by eye);
   - every reason sentence is true of the card it sits on — a reason never
     names a genre, an era, or a service the card does not have;
   - a card with no reason shows no reason row (SC-004);
   - the deck never shows a card already rated (Feedback Loop, visually).
4. Reload with the parameter removed — the incumbent's order — and confirm at
   least one card position differs, proving both the override and the default.
5. Check the Network tab: impressions carry `recommend-v2` under `?engine=v2`
   and `recommend-v1` by default.

## Definition of done

- All commands above pass.
- `specs/010-deterministic-engine-v2/tasks.md` is fully checked.
- The harness table is recorded there, and the rollout comparison described in
  research D12 is possible from stored rows alone.
