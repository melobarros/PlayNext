# Implementation Plan: Recommendation Deck

**Branch**: `002-recommendation-deck` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-recommendation-deck/spec.md`

## Summary

After the quiz completes, the visitor browses one recommendation card at a
time and either advances (swipe or tap) or acts (five rating buttons, or Watch
Now → Match Found). Ratings feed a **deterministic** ranking engine, and two
behaviors are non-negotiable invariants: a title unavailable on the visitor's
services is never suggested (unless they opted into other platforms), and a
title rated Disliked or Not Interested never comes back.

The technical approach mirrors the quiz slice: all decision logic lives in
framework-free TypeScript that is testable with no DOM, the catalog sits
behind a service so Milestone 2 swaps mock data for the API without touching a
component, and a second frozen LocalStorage contract records the visitor's
ratings — designed now to be the exact document that spec 003 builds its
watchlist on and spec 004 migrates to an account.

## Technical Context

**Language/Version**: TypeScript 6.0.x (Angular 22 requires `>=6.0.0 <6.1.0`),
Node.js `^22 || ^24 || ^26`

**Primary Dependencies**: Angular 22.2.0 (signals, standalone, zoneless),
RxJS 7.8.2, Tailwind CSS 4.3.3, `@angular/service-worker`. **No new runtime
dependencies** — the swipe is hand-rolled on Pointer Events (see
[research.md](./research.md)).

**Storage**: Browser LocalStorage. One new versioned document,
`playnext:interactions`, holding the visitor's ratings and watching history;
one ephemeral document, `playnext:deck-session`, holding the running loop. The
quiz document from spec 001 (`playnext:quiz-state`) is a **read-only input**.

**Testing**: Vitest 5 through `@angular/build:unit-test`, jsdom 30

**Target Platform**: PWA, mobile-first — fully usable at 360px with touch,
dark high-contrast by default; latest Chrome, Safari, Firefox, Edge

**Project Type**: Web application — frontend only in this slice
(`frontend/`); `backend/` stays reserved for Milestone 2

**Performance Goals**: next card ready within 300ms of the visitor's action,
in 95% of actions (FR-012, SC-002)

**Constraints**: fully deterministic ranking — no RNG, no ML (FR-011,
constitution VI); no media hosting, deep links only; must degrade without a
dead end when the provider, the network, or the result set fails

**Scale/Scope**: ~48-title mock catalog for Milestone 1; the session document
stays under 1KB; the interactions document is designed for the 500+ entries
spec 003 commits to

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | How this plan satisfies it |
|---|---|---|
| I. Mobile-First Experience | **PASS** | One card at a time at 360px, sticky action bar, every control ≥44px, dark default. PWA-only delivery preserved. |
| II. Decision Speed & Simplicity | **PASS** | Single-card loop, one tap to rate and advance. Ranking re-runs per action — it must, because a rating changes eligibility — but it is `O(n log n)` over a catalog of hundreds (sub-millisecond), so the 300ms budget is really spent on the poster image, which is why the next card's poster is preloaded ([research.md](./research.md)). YAGNI applied — no catalog view, no bottom navigation (003 owns it). |
| III. Guest-First Access | **PASS** | Guest-only, device-local. The interactions document is deliberately shaped as the payload spec 004 migrates into an account. |
| IV. API-First Architecture | **PASS (deferred)** | No backend in this slice, same deferral as 001. The catalog is reached only through `CatalogService`, so Milestone 2 replaces the mock list with the REST API without changing a component. No TMDB key or provider credential reaches the client — M1 ships no external calls at all. |
| V. Test-First for Critical Paths | **PASS** | Both named invariants get Red-Green-Refactor coverage as pure functions: **Filter Enforcement** (a title unavailable on selected services is never suggested) and **Feedback Loop** (Disliked/Not Interested never returns, in-session or later). |
| VI. Deterministic Recommendations | **PASS** | `rankTitles()` is a pure function — hard filters, weighted scoring over genres/ratings/history, then a total order with an id tiebreak. Identical inputs produce an identical sequence (FR-011). No ML, no randomness, no media hosting. |
| VII. Clean Architecture & Domain Integrity | **PASS (frontend scope)** | Business rules live in `features/deck/deck-logic/` as framework-free TypeScript, extending 001's precedent. When the backend arrives this logic relocates to the Domain layer with no behavioral change. |
| Standards: no new dependencies | **PASS** | Swipe uses Pointer Events; collapsible synopsis uses native `<details>`; no CDK, no Hammer, no gesture library. `@angular/aria` is stable at v22.2.0 but is a poor fit for a one-card deck — recorded and deferred in [research.md](./research.md) D8. |
| Standards: one pattern per concern | **PASS** | Storage follows the contract pattern frozen in 001; catalog access follows the service-seam pattern already set by `QuizOptionsService`. |

No violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-recommendation-deck/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── interaction-storage.md     # frozen; consumed by 003 and 004
│   └── recommendation-engine.md   # pure ranking function contract
├── checklists/
│   └── requirements.md  # spec quality (already passing)
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
frontend/src/app/
├── core/
│   ├── models/
│   │   ├── media-title.ts            # MediaTitle, StreamingAvailability
│   │   ├── interaction.ts            # InteractionState vocabulary, Interaction, WatchHistoryEntry
│   │   ├── deck-session.ts           # DeckSession shape
│   │   └── media-catalog.data.ts     # Milestone 1 mock catalog (~48 titles)
│   └── services/
│       ├── catalog.service.ts        # THE Milestone 2 API seam + offline cache
│       ├── interaction-store.ts      # playnext:interactions  (frozen contract)
│       ├── deck-session-store.ts     # playnext:deck-session   (ephemeral)
│       └── connectivity.ts           # online/offline signal (FR-015)
├── features/deck/
│   ├── deck-logic/                   # pure TypeScript, no Angular imports
│   │   ├── recommend.ts              # filters + scoring + deterministic ranking
│   │   ├── deck-session.ts           # loop transitions (advance, rate, new loop)
│   │   └── swipe.ts                  # gesture maths, independent of the DOM
│   ├── deck.ts / deck.html           # the loop shell
│   ├── card/                         # poster, metadata, collapsible synopsis
│   ├── actions/                      # sticky rating bar + Watch Now
│   └── match-found/                  # Match Found view
└── features/quiz/                    # unchanged; Reset Filters reuses startRetake()
```

**Structure Decision**: The existing `frontend/` workspace from spec 001 is
extended; no new project is introduced. Deck rules go in `deck-logic/` as
framework-free modules, exactly as `features/quiz/quiz-logic/quiz-rules.ts`
does, keeping the two constitution invariants testable without a DOM or
TestBed. `core/` holds the shared contracts and the catalog seam. The
`features/deck/deck-stub.ts` placeholder from 001 is deleted, not kept
alongside.

## Design Decisions Carried Into Phase 0

These are the decisions that most affect downstream specs; each is expanded
with alternatives in [research.md](./research.md).

1. **Exclusions are derived, never stored as a list.** The feedback loop is
   computed from the ratings map at ranking time rather than maintained as a
   second `excludedIds` list. Spec 003 requires the exclusion rule to "always
   reflect the current rating state" — a stored list would need dual-write on
   every re-rating and would drift. This is the single most important
   compatibility decision in this plan.
2. **Ratings are keyed by title, history is append-only.** One rating per
   title (003 FR-006, zero duplicates), while the watching history is a log
   that survives re-rating (003's clarification). The two shapes differ on
   purpose.
3. **Two storage keys, not one.** Ratings/history are durable user data that
   004 migrates; the loop cursor is throwaway. Mixing them would make "start a
   new loop" a risky partial write.
4. **Determinism comes from a total order, not a shuffle.** Score descending,
   then title id ascending — so the sequence never depends on sort stability
   or input order.

## Post-Design Constitution Re-check

*Re-evaluated after Phase 1 design artifacts were written.*

All gates still **PASS**, with two strengthened by the design rather than merely
satisfied:

- **Principle V (Test-First)** is now structural. The two named invariants are
  guarantees **G1** and **G2** of a pure function
  ([contracts/recommendation-engine.md](./contracts/recommendation-engine.md)),
  testable with plain TypeScript — no DOM, no TestBed, no network mock. The
  deck's rules can be proven correct before any component exists.
- **Principle VI (Deterministic)** is now provable rather than asserted:
  determinism is guarantee **G3**, resting on an explicit total order, and the
  engine contract documents a worked example whose expected output is fixed.

Two design-time corrections were made during this re-check, both recorded
honestly rather than smoothed over:

1. An earlier draft of this plan claimed ranking runs "once per loop". That is
   wrong — a rating changes eligibility, so ranking must re-run per action
   (research.md **D6**). The claim was corrected; the 300ms budget is met
   anyway, but for a different reason (catalog size, not caching).
2. The "current card" is derived rather than stored (research.md **D5**), which
   the edge case "refresh mid-deck retains position" is satisfied by as a
   consequence of determinism rather than by extra persistence.

**No violations. Complexity Tracking remains empty** — no new project, no new
dependency, no new pattern.

## Deferred (recorded, not silently dropped)

| Item | Deferred to | Why |
|---|---|---|
| Live TMDB/JustWatch data | Milestone 2 | Constitution IV; `CatalogService` is the seam |
| Bottom navigation | spec 003 | No second destination exists yet (D12) |
| Watchlist / history views | spec 003 | Different feature; this slice records the data they read |
| Cross-device sync | spec 004 | Accounts are out of scope for guests |
| Analytics for SC-001/SC-007 | Milestone 4 | No telemetry pipeline exists |
