# Quickstart & Validation Guide: Onboarding Mood Quiz

**Feature**: 001 | **Date**: 2026-09-25

Runnable validation scenarios proving the quiz works end-to-end, mapped
to the spec's acceptance scenarios and success criteria. Implementation
details live in `tasks.md` (Phase 2); this guide stays a run/verify
reference.

## Prerequisites

- Node.js (current LTS) + npm
- Latest Chrome or Firefox (desktop), plus a 360px-wide mobile viewport
  via DevTools device emulation for touch checks
- This feature needs no backend and no API keys — all options are static
  config ([data-model.md](./data-model.md), QuizOptions)

## Setup & run

```bash
cd frontend
npm install
ng serve
# open http://localhost:4200
```

## Test commands

```bash
cd frontend
ng test        # unit tests: quiz validation logic + persistence service
ng build       # production build must succeed (quality gate)
```

Critical-path tests (constitution V, written before implementation):

| Test | Covers |
|------|--------|
| Step validation rejects zero selections | FR-005, spec US1 scenario 3 |
| "Any / No preference" chip alone satisfies the step | FR-005, edge case |
| Back retains answers; Next preserves prior steps | FR-008, US3 scenario 1 |
| Completed quiz is skipped on return | FR-011, US2 scenario 2 |
| Retake pre-fills previous answers and replaces on completion | FR-012, US3 |
| Persisted document round-trips (refresh restores step + answers) | FR-010, US2 scenario 1 |
| Corrupt/unknown schemaVersion resets to a first visit | storage contract |
| Provider options fallback after failed retry | FR-013 |

## Manual validation walkthrough (acceptance scenarios)

1. **Fresh visit (US1)**: private window → app opens at step 1 (movie /
   TV / anime chips, progress "Step 1 of 3").
2. **Dead-end guard**: with nothing selected, Next is unavailable; select
   "Any / No preference" alone → Next enables (FR-005).
3. **Complete the quiz**: pick Movie + 2 genres + 2 providers → Next →
   Next → confirm → summary shows all selections + single
   start-recommendations action (FR-009). Expected: ≤30s, one tap per
   selection (SC-002).
4. **Resume mid-quiz (US2)**: at step 2, refresh the page → quiz reopens
   at step 2 with prior answers intact (FR-010).
5. **Skip on return (FR-011)**: after completing, reload → quiz is
   skipped; preferences apply.
6. **Retake (US3)**: open retake → answers pre-filled → change one genre
   → complete → summary reflects the change; old answers replaced.
7. **Fallback providers (FR-013)**: block the provider list (DevTools →
   offline, or simulate a failed load), tap Retry → after retry fails,
   default provider list appears with a notice; quiz completes.
8. **Touch & 360px (SC-005/006)**: in 360px-wide device emulation with
   touch, complete all three steps with no horizontal scrolling; all
   chips ≥44px targets; dark high-contrast theme active by default.
9. **PWA**: `ng build` → serve the production build → Lighthouse PWA
   checks pass (installable, offline shell) per the constitution's
   PWA-only delivery.

## Expected outcomes

- SC-001 (≥80% completion) and SC-006 (≥90% first-attempt completion) are
  product telemetry goals — trackable once analytics exist (Milestone 4);
  design reviews verify no step introduces friction.
- SC-003 (quiz → first recommendation < 2 min) is jointly measured with
  the deck (002) — this slice ends at the hand-off documented in
  [contracts/preference-storage.md](./contracts/preference-storage.md).

## Hand-off to the deck (002)

After the final confirmation, the completed document
(`playnext:quiz-state`, `status: "completed"`) is the deck's input. The
start-recommendations action navigates to the deck route — stubbed in
this slice to a placeholder screen until 002 lands.
