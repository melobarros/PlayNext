# Research: Recommendation Deck

**Feature**: 002 | **Date**: 2026-09-26

Decisions behind [plan.md](./plan.md), each with the alternatives it beat. The
first four are the ones that bind later specs; the rest are local choices.

---

## D1. Titles come from a mock catalog behind a service seam

**Decision**: Milestone 1 ships a static catalog of ~48 titles
(`core/models/media-catalog.data.ts`) reached only through
`CatalogService.loadTitles(region)`. The service returns an `Observable` even
though the data is local.

**Rationale**: The spec's own assumption permits mock data for Milestone 1, and
the constitution's Principle IV defers the backend. The `Observable` shape —
copied from spec 001's `QuizOptionsService.loadProviders` — means the loading,
error, and cached-fallback paths (FR-013) are real code today rather than
something bolted on when HTTP arrives. Milestone 2 swaps the data source; no
component and no rule changes.

**Alternatives considered**:
- *Call TMDB directly from the client* — rejected outright: it needs an API key
  in the bundle, which the constitution forbids without qualification.
- *Build the .NET API now* — rejected: it is Milestone 2, and pulling it
  forward would make this slice un-reviewable and block the deck on
  infrastructure.
- *Serve plain arrays synchronously* — rejected: the failure path would be
  unreachable dead code, so FR-013 could not be tested at all.

---

## D2. Exclusions are derived from the ratings map, never stored as a list

**Decision**: `disliked` / `notInterested` titles are computed from
`interactions` at ranking time. There is no `excludedIds` array anywhere.

**Rationale**: This is the most consequential decision in the plan, and it is
driven by spec 003. 003 requires that "the exclusion rule MUST always reflect
the current rating state" and that re-rating away from Disliked makes a title
eligible again. With a derived exclusion that is automatic — one write, one
source of truth. With a stored list, every rating, re-rating, and removal would
need a second write kept perfectly in sync; the first bug leaves the deck and
the watchlist silently disagreeing, which is exactly the failure 003's SC-002
("no stale exclusions") exists to prevent.

**Alternatives considered**:
- *A separate `excludedIds` array* — rejected: dual-write, drift-prone, and it
  duplicates state that is already fully determined by the ratings map.
- *Excluding only `disliked`, treating `notInterested` as a soft signal* —
  rejected: the spec's vocabulary treats both as exclusions (FR-009), and 003
  groups them the same way.

---

## D3. Two storage keys: durable interactions vs ephemeral session

**Decision**: `playnext:interactions` (ratings + watching history) is separate
from `playnext:deck-session` (the loop's `shownTitleIds` and `startedAt`).

**Rationale**: They have different lifetimes and different owners. Interactions
are durable guest data that spec 003 reads and edits and spec 004 migrates;
the session is throwaway that "start a new loop" discards. Combining them would
make starting a new loop a partial write against a document holding the
visitor's ratings — the one thing that must never be lost. Only
`playnext:interactions` is a cross-feature contract; the session key is
deck-private and is documented as not-migrated.

**Alternatives considered**:
- *One `playnext:deck-state` document* — rejected: couples a risky reset to
  durable data.
- *`sessionStorage` for the loop* — rejected: the spec's edge case requires the
  current position to survive a refresh, and sessionStorage survives only
  same-tab reloads; a browser restart would lose it while LocalStorage keeps it
  consistent with everything else in the app.

---

## D4. Determinism comes from a total order, not a shuffle

**Decision**: `rankTitles` returns score-descending, `id`-ascending. No RNG,
no `Date.now()`, no dependence on input order.

**Rationale**: FR-011 and SC-005 require identical inputs to produce an
identical sequence. A stable total order makes that a property of the
comparator rather than a property of `Array.prototype.sort`'s stability plus
whatever order the catalog arrived in — which would differ across devices and
after a catalog change. It also gives a free, testable guarantee for the
refresh-mid-deck edge case (see D5).

**Alternatives considered**:
- *Seeded PRNG shuffle* — rejected: reproducible only if the seed is persisted
  and threaded everywhere, and it makes "why is this card here?" unanswerable.
- *Score-sorted, relying on sort stability for ties* — rejected: stability
  preserves *input* order, so two devices holding the catalog in different
  orders would show different decks for identical preferences.
- *Randomize only within equally-scored titles* — rejected: still
  non-reproducible, and equally-scored ties are common in a small mock catalog.

---

## D5. The current card is derived, never stored

**Decision**: Nothing records "which card am I on". The current card is
`rankTitles(...)` with `shownTitleIds` removed, taking the first result.
Advancing appends the current id to `shownTitleIds`.

**Rationale**: The spec's edge case requires the current position to survive a
refresh. Because ranking is deterministic (D4), recomputing after a reload
yields the same card — so position persistence falls out of the design with no
cursor to store and, more importantly, no stored cursor that can disagree with
the ranked list. A persisted index would break the moment a rating changed the
ordering, which happens on every rating.

**Alternatives considered**:
- *Persist `currentIndex` into the ranked list* — rejected: the list is
  recomputed per action, so an index is meaningless after the ordering shifts.
- *Persist the full ranked list per loop* — rejected: duplicates state, grows
  unbounded, and goes stale the moment an interaction changes.

---

## D6. Ranking re-runs per action; the 300ms budget is an image problem

**Decision**: `rankTitles` runs on every advance and every rating — not once
per loop. The next card's poster is preloaded **exactly one card ahead**, by
`new Image()` followed by `await img.decode()`; the card on screen carries
`fetchpriority="high"`.

**Rationale**: Correctness forces this. A rating changes eligibility (D2), so
a cached ordering would keep suggesting a just-disliked title or miss a
just-un-disliked one. The cost is negligible: filters plus a sort over a
few-hundred-title catalog is sub-millisecond, four orders of magnitude inside
the 300ms budget. The real risk to FR-012 is the poster *image*, so the next
card's poster is fetched before the visitor asks for it.

Fetching alone is not enough. `new Image()` warms the HTTP cache but does not
decode, so the first paint of the new card can still stall; `img.decode()`
resolves once the image is ready to paint, which is what actually removes the
stall. Preloading stops at one card: preloading the whole deck competes with
the current card for bandwidth and delays first paint, so the card the visitor
is looking at is prioritised over ones they may never reach.

**Alternatives considered**:
- *Cache the ranked list for the loop* — rejected: it would serve stale
  eligibility after a rating, violating the Feedback Loop invariant.
- *Precompute the whole sequence at loop start* — rejected: same problem, plus
  it cannot react to a rating made in another tab.

---

## D7. Quality is confidence-weighted, not raw

**Decision**: `weightedRating = (rating × voteCount + 6.5 × 500) / (voteCount + 500)`.

**Rationale**: Raw ratings let a title with a 10.0 from three votes outrank a
well-established 8.4 from twenty thousand, which reads as a bug to any visitor
who notices. The prior pulls thin evidence toward the middle. It is a standard,
explainable shrinkage formula — no ML, deterministic, and a stakeholder can
follow the arithmetic.

**Alternatives considered**:
- *Raw `rating`* — rejected: trivially gameable by low-volume titles and
  visibly wrong at the top of the deck.
- *Ignore ratings entirely and rank on genre match only* — rejected: the spec
  and constitution both name ratings as a scoring input.
- *A learned/tuned weight* — rejected: violates constitution VI (no ML) and
  cannot be explained to a reviewer.

---

## D8. No new dependencies

**Decision**: Swipe is hand-rolled on Pointer Events; the collapsible synopsis
is a native `<details>`; nothing is added to `package.json`.

**Rationale**: The constitution says new dependencies must be justified and the
existing stack preferred. Each candidate library solves a smaller problem than
it brings: a 1-axis swipe is a threshold comparison, and a synopsis disclosure
is what `<details>` has done natively and accessibly for years.

**Alternatives considered**:
- *`@angular/cdk` drag-drop* — rejected: a large dependency for one axis, and
  its drop-list model is aimed at reordering, not thresholded dismissal.
- *Hammer.js* — rejected: unmaintained, and redundant now that Pointer Events
  are universally supported.
- *A carousel/deck library* — rejected: would own the very loop this feature is
  about, and none model the "never show a rejected title again" rule.
- *`@angular/aria`* — rejected **for this slice only**. It is genuinely stable
  at v22.2.0 (the developer-preview tag was removed from all 26 aria files
  before v22 shipped), so it is not a maturity concern. The objection is fit:
  its nearest primitive is `Grid` — two-dimensional cell navigation with a
  roving tabindex — and the deck shows one card at a time with no cells. Keyboard
  access is already served by the sticky action bar, whose native buttons are
  the primary controls and need no ARIA layer. The dependency is not free
  either: it peer-depends on `@angular/cdk`. Revisit in spec 003, where real
  `Tabs` appear and it is a much better fit.

---

## D9. "Reset Filters" reuses spec 001's retake transition

**Decision**: The empty state's action calls spec 001's existing `startRetake`
transition and navigates to `/quiz`, rather than clearing preferences in place.

**Rationale**: The clarification settled this behavior — return to the quiz
with previous answers pre-filled so the visitor can *widen* their selections.
`startRetake` already does exactly that (step 1, `in-progress`, answers
retained), so the correct implementation is to call it. Disliked/Not Interested
exclusions live in a different document entirely, so they survive the reset
untouched, as the clarification requires.

**Alternatives considered**:
- *Clear preferences and show an unfiltered deck* — rejected: contradicts the
  clarification (an earlier checklist note said this; the spec overrides it).
- *A separate "widen filters" screen* — rejected: duplicates the quiz UI.

---

## D10. Match Found is a route, not component state

**Decision**: `/deck/match/:titleId`, resolving the title from the catalog by
id.

**Rationale**: The view is reachable from the browser's back button, survives a
refresh, and needs no state passed through navigation. Resolving by id from the
catalog matches how spec 003 says history entries work — links refresh from
current availability when reopened, rather than being frozen into a record.

**Alternatives considered**:
- *A signal holding the matched title* — rejected: a refresh on the Match Found
  view would drop the visitor back into the loop mid-decision.

---

## D11. The swipe's *decision* is a pure function; the DOM only feeds it samples

**Decision**: `deck-logic/swipe.ts` exports a pure function that takes pointer
samples (positions and timestamps, in a plain array) plus the card's width and
returns one of `'none' | 'dismiss-left' | 'dismiss-right' | 'reset'`. The
component's only job is to bind `pointerdown` / `pointermove` / `pointerup`,
collect samples, ask that function what happened, and apply the resulting
transform. `touch-action: pan-y` on the card keeps vertical scrolling native.

**Rationale**: This is the same split that made spec 001's quiz rules testable
without a DOM, applied to the gesture. Threshold logic — "did this travel far
enough, or fast enough, to count as a swipe?" — is where the bugs live, and as
a pure function it is covered by plain unit tests with no pointer simulation,
no `TestBed`, and no dependence on what jsdom implements. It also makes the
constants (distance threshold, velocity, direction lock) reviewable in one
place instead of buried in event handlers.

A secondary reason: jsdom does not implement pointer capture or a full
`PointerEvent`, so a design that tested the gesture *through* the DOM would be
testing the harness as much as the code. Keeping the maths pure means the part
that matters is verified regardless of the emulation layer's fidelity.

**Alternatives considered**:
- *Threshold logic inline in the event handlers* — rejected: untestable without
  a browser or heavy mocking, for the one interaction the product is named
  after.
- *Judge the swipe only on distance, ignoring velocity* — rejected: a quick
  flick is the natural gesture on a phone and would frequently fall short of a
  pure distance threshold, making the deck feel unresponsive.
- *`@angular/cdk` drag-drop or Hammer.js* — rejected under D8.

**Resolved during Phase 0.** The mechanics of the thin DOM-binding smoke test
were an open question; they were probed empirically against Vitest 5 + jsdom 30
rather than assumed, and the answers are specific enough to write the test from:

- `PointerEvent` **is** a real, working constructor. No polyfill is needed to
  construct or dispatch one.
- **Never pass `view: window`.** Under Vitest it throws
  `member view is not of type Window` — raw jsdom accepts it, so this is a
  Vitest-specific trap and an easy one to lose an afternoon to. Angular's own
  `@angular/cdk` testing helpers work around it by omitting `view`, and the
  pinned version already carries that fix.
- `setPointerCapture` / `releasePointerCapture` / `hasPointerCapture` **do not
  exist** in jsdom 30 and throw when called. jsdom's pointer-capture PR was
  closed unmerged rather than deferred, so this is not a "wait for the next
  release" problem. The component must call them as `el.setPointerCapture?.(id)`
  — which is the right production code anyway, since capture can legitimately
  fail on a detached element.
- `TouchEvent` is **unusable** in jsdom 30 (no `window.Touch`). This corroborates
  D8 rather than changing it: Pointer Events are not merely the preferred path
  here, they are the only gesture path that can be tested at all.
- jsdom never synthesizes pointer events from mouse events. The smoke test
  dispatches them explicitly with a shared `pointerId` and monotonically
  changing `clientX`, and asserts on the deltas the component computes — not on
  capture semantics, which jsdom does not model.

The net effect on the plan is one guarded method call in production code. The
threshold logic — the part that can actually be wrong — remains covered by the
pure function, independent of the emulation layer's fidelity.

---

## D12. Bottom navigation is deferred to spec 003

**Decision**: This slice keeps the deck full-screen with a sticky action bar;
no bottom navigation.

**Rationale**: Spec 002 never asks for navigation, and the constitution's YAGNI
principle applies. Spec 003 is where a second destination (the watchlist)
appears, and where the constitution's "second item in the bottom navigation"
reference becomes meaningful. Adding the shell now would mean designing it
against one destination and reworking it against two.

**Alternatives considered**:
- *Add the nav shell now to avoid rework* — rejected: it would be an unneeded,
  un-specified UI in this slice, and the rework saved is small.
