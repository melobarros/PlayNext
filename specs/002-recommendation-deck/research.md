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

**Amended (2026-09-28, MVP ranking pass)**: "score-descending" is now
"match-tier descending, then within-tier score descending" (D13). The decision
this section is about — a total order whose tiebreak is the id, so the sequence
is a property of the comparator rather than of sort stability — is untouched,
and the alternatives below were rejected against that, so they stand as written.

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

**Amended (2026-09-28, deck visual pass)**: the synopsis half is superseded.
Mobile testing found the deck card had room to spare, so the synopsis is now
shown outright — `hasSynopsis()` and a paragraph, no `<details>`. A synopsis
that needs no interaction is more reachable than one behind a tap, so this
strengthens the rationale rather than departing from it; the tap was a
compactness concession and the constraint is gone. The **no-new-dependencies**
half stands unchanged, and it is the half the D8 alternatives below were
rejected against. See `spec.md` FR-003, reworded to match.

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

## D9. The preferences action (formerly "Reset Filters") reuses spec 001's retake transition

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

---

## D13. Match tiers are a sort key; unselected selectable genres demote

**Decision**: the ranking is two keys deep — `matchedGenres` first, then
`6 × historyAffinity − 10 × mismatchedGenres + weightedRating` — with the `id`
tiebreak unchanged. `mismatchedGenres` counts the title's genres that are in
the quiz's nine selectable ids but **not** in the visitor's selection; it is
`0` under Any, and slug tags never count.

**Rationale**: MVP testing delivered both halves of the failure. First, the
visitor's expectation — "rom-coms first, and when those get exhausted, maybe
start seeing animations" — was not guaranteed: with one flat score, a one-genre
title carrying a full affinity lift beat a two-genre title 28.8 to 26.8, so the
tier was outvotable by the very terms beneath it. Second, the deck filled with
kids animation: TMDB files Shrek and its kind under Comedy, so inside the
comedy tier the mega-vote titles won on confidence-weighted rating alone. A
sort key fixes the first structurally — no arithmetic argument about bounds,
just a comparator that cannot be outvoted — and the demotion term fixes the
second with the visitor's own words: choosing comedy is also a statement about
animation. Only the selectable vocabulary counts, because a visitor can only
have declined a genre they were offered; this is the point the fixture data
cannot exercise and production TMDB data can.

**Alternatives considered**:
- *Raise `MATCHED_GENRE_WEIGHT` until it dominates (e.g. 100)* — rejected:
  dominance would rest on bounds over real data (how many genres a TMDB title
  carries, how many the visitor can love) rather than on the comparison itself.
  One catalog row with enough genres and the guarantee is gone silently.
- *Clamp `historyAffinity` to ±9* — rejected for the same reason plus a second:
  it changes what affinity means to save arithmetic that a sort key makes
  unnecessary.
- *A hard genre filter (drop animation when not selected)* — rejected:
  `matchedGenres` is per-title and the selection is a union; dropping titles
  would empty the deck for visitors who picked animation-adjacent genres, the
  dead end the constitution forbids. Demotion keeps them reachable, later.
- *Weight the demotion at 2 (enough to reorder near-ties)* — rejected: the
  rating spread between a mega-vote kids title and a mid-rated pure one
  exceeds 2, so the crowd-out this exists to fix would survive it. 10 sits
  above that spread and below two loved genres (2 × 6), so the visitor's own
  ratings still speak louder than one unselected genre.
- *Penalize slug tags too* — rejected: a visitor cannot have declined `family`
  because the quiz never offered it; penalizing it would encode a taste
  judgement they never made.

## D14. The card names its reason

**Decision**: `rankTitles` returns `RankedTitle[]` — `MediaTitle` plus a
`reason: string | null` — rather than a bare title list. The reason is one
sentence from a fixed precedence: the quiz's own genre selection ("Because you
picked Comedy"), then a genre the visitor's ratings point at ("Because you loved
Horror"), then the matched service ("On Netflix, one of your services"), then
`null`. The card renders whatever it is handed, in the app's one violet.

**Rationale**: the product's stated differentiation is "no ML, and here is
exactly why this card is here" — a claim the deck was making in its documentation
and nowhere on screen. The engine already computed every input the sentence
needs; the only question was where to compose it. Composing it in the card would
have meant the card re-deriving which signal fired, and the card does not know:
it receives a title, not the score. Putting the sentence in the engine keeps the
ordering and the explanation derived from the same call, so they cannot drift —
the card shown first is the card whose reason is quoted.

Attaching it to the returned value rather than threading a parallel lookup keeps
`MediaTitle` as purely the storage-and-transport shape. A `reason` field on the
API model would be a claim the server does not make: ranking runs on the client,
so the server has no reason to give.

**Alternatives considered**:
- *Compute the reason in the card from `MediaTitle` + preferences* — rejected:
  two derivations of the same fact, and the card would need the preferences
  injected to produce a sentence about a decision it did not make.
- *A parallel `Map<titleId, reason>` returned alongside the array* — rejected:
  two collections to keep in step through `currentCard`, the advance, and every
  filter, for no gain over one field on the item.
- *Show every signal that fired ("Comedy match · on Netflix · 8.4")* — rejected:
  the deck's promise is that a card can be *justified*, not itemized. A row of
  tags is the catalog-browsing surface this product exists to replace.
- *Always show something, inventing a default like "Popular right now"* —
  rejected: it would be the one claim the engine cannot support, on the card of
  a product whose selling point is that every claim is supported. `null` renders
  as nothing, and the card is honest by being quiet.

## D15. A swipe is a rating; Undo is a local rewind

**Decision**: a completed swipe routes into the same `onRating` path as the
rating buttons. Left records `notInterested` and right records `wantToWatch`, a
hint pill names the rating while the finger is still down, and the acknowledgement
strip's Undo takes it back. `Skip` becomes the one advance that records nothing
(FR-004, amended 2026-09-29). Undo is two writes and no stack:
`InteractionStore.remove` clears the rating, and a pure `rewind(session, titleId)`
removes the id from the loop's `shownTitleIds`.

**Rationale**: the amended FR-004 is the *why* for the routing, and D11 already
settled that the gesture's judgement belongs in a pure function. What is worth
recording here is that the four surfaces — buttons, gesture, announcement, Undo —
are one mechanism rather than four. The gesture does not record a rating; it calls
`onRating`, so it is announced, counted and undoable for the same reason the
buttons are, and none of those three had to be extended to cover it. The
alternative, giving the swipe its own write, would have been a second path that
agreed with the first until the day it did not.

`rewind` returns the session **by reference** when the id is not in the walk. The
caller writes whatever comes back, so an equal-but-fresh object would turn
"nothing to undo" into a disk write — and make a double tap on a consumed Undo
strip indistinguishable from a real rewind.

The acknowledgement is an offer, not a prompt: the strip holds the last rating and
nothing else, and is cleared by the next action. It is deliberately not persisted
either — it answers "what did you just do", which a reload cannot know, so a
restored strip could invite undoing a tap from a session days ago. Its one clock
is D16.

**Alternatives considered**:
- *A toast that only the clock dismisses* — rejected: the strip is also cleared by
  the action that supersedes it, which is what makes it never describe a rating
  that is no longer the last one. See D16 for the timer that was added on top,
  and why.
- *An undo stack (repeated Undo walks backwards)* — rejected: it needs history in
  a document whose shape is frozen at three keys, and "undo the last thing" is the
  only guarantee a visitor can form a mental model of.
- *Undo stored in the loop document* — rejected: `DeckSession`'s key set is pinned
  by spec 003's storage contract, and the offer is UI state, not a record.
- *Swipe records nothing, and the hint explains the *absence*** — rejected: it
  documents a dead gesture. The two directions a swipe already means were going
  unused, and one of them is the exclusion FR-009 needs.
- *Swipe records `disliked`/`loved`* — rejected: a swipe is a reflex, and those
  two weigh on the affinity score. The strong claims stay on the buttons, where
  they are deliberate.

**Note on the card swap**: the card surface re-mounts per id through a
single-item `@for`, which replays a CSS `card-in` animation on every advance *and*
on Undo. The animation is on the wrapper element and the drag transform is on the
surface inside it, because a running CSS animation's `transform` beats an inline
style — on one element, a drag begun during those 200ms would leave the card stuck
under the finger, and swiping quickly is exactly when that happens.

## D16. The undo offer withdraws itself after five seconds

**Decision**: the acknowledgement strip stays for five seconds (`UNDO_WINDOW_MS`)
and then removes itself. The count measures *idle* time: hovering the strip or
moving focus into it stops it, and leaving restarts a full window. The timer is
created inside an Angular `effect` and cleared by that effect's `onCleanup`, so
it is owned by the state it belongs to, and `onRating` clears the hold before
replacing the offer so a new rating always gets the whole window.

**Rationale**: the request was three seconds, and the honest answer is that three
is the reflex for a toast and the wrong reflex here — the visitor is not *reading*
the strip, they are travelling past it. Their thumb is on `Loved It`, the tile
they meant is one column over, and the manoeuvre is notice, aim, press. A strip
that vanishes mid-reach is worse than one that never appeared, because it teaches
the visitor the offer is unreliable and they stop counting on it. The costs are
not symmetric: erring long costs one row of card height until the next tap, erring
short makes a mis-tap permanent. Five seconds is where the deck lands.

The hold exists because a countdown on a control fails WCAG 2.2.1 for exactly the
visitor who needs it most. A keyboard user tabs toward Undo through every control
before it; a pointer user has to travel there. Either way the mechanism is present,
is being used, and would be removed by the clock anyway. Suspending on
`focusin`/`pointerenter` makes the window a measure of inattention rather than of
wall-clock time, which is what it always should have been.

`effect` + `onCleanup` rather than a handle field and `ngOnDestroy` because it is
correct by construction: cleanup runs on every re-run, not only on destroy, so a
second rating's timer cannot be shadowed by a first one still pending — the bug
that would withdraw a fresh offer early.

**Alternatives considered**:
- *Three seconds* — rejected above. If it is ever lowered, it should be an
  argument rather than a tidy-up.
- *No timer; cleared by the next action only* — this was the original decision
  and the request reversed it. It survives in the code as the *other* way the
  strip goes away, which is why the timer is additive rather than the mechanism.
- *Resume the remaining time on `pointerleave`* — rejected: a visitor returning to
  the strip is deciding, and a decision should not inherit a deadline they did not
  know they were running against.
- *A CSS animation with `animationend`* — rejected: it would not be pausable on
  hover without duplicating the whole countdown in `animation-play-state`, and it
  would need a reduced-motion fallback for a behaviour that is not motion.
- *`aria-live` announcement of the withdrawal* — rejected: the announcement
  already goes empty when the offer is consumed, and re-announcing a retraction
  would be noise on a screen reader.

## D17. Eligibility is "not rated at all"; rejection is a separate, narrower rule

**Decision**: `isRated(interaction)` — presence of any recorded interaction, asked
of the whole vocabulary rather than of a list of states — is filter 4 of
`rankTitles` (FR-009, amended 2026-09-29). `isRejection(state)`, still exactly
`disliked` and `notInterested`, survives as the negative half of the affinity
signal in `genreSignals` and nothing else. `startNewLoop` continues to clear
`shownTitleIds` and only that.

**Rationale**: the two rules answer different questions and were conflated in one
`EXCLUDING_STATES` list. Eligibility asks "should the deck spend a card on this?",
and a title already judged, saved or watched is not an open question. Affinity
asks "what does this rating say about taste?", and only a rejection says *less like
this* — `Loved It` and `Want to Watch` also keep their title out of the deck, but
counting them as rejections would sink every genre the visitor has ever enjoyed.

The bug that forced the split is the loop boundary. `startNewLoop` clears the walk,
because FR-010 is about not repeating a card *within* a loop; it does not clear the
ratings, because a new loop is a new walk rather than a fresh memory. With
eligibility keyed to two states, that left the other four free to return — so a
visitor could tap Watch Now, open Match Found, start a new loop, and be handed the
film they had just chosen. The deck's strongest claim, contradicted by its own
first card.

Stating eligibility as *presence* rather than as a list is what keeps it honest as
the vocabulary grows: a seventh state is excluded the day it is declared rather
than the day someone remembers to add it here, and `interaction.spec.ts` asserts
exactly that by looping over `INTERACTION_STATES`.

**Two consequences accepted**: rating a title now takes it out of the deck for
good, so "a title is eligible again" is only reachable by *removing* the rating —
which Undo and the watchlist's Remove both do, through the same
`InteractionStore.remove`. And a visitor who rates every title their filters match
reaches an empty deck that a new loop cannot refill, so `DeckOutcome` gained
`'all-rated'`: it offers the preferences action, which is the only one that can
change the situation, and not "Start a new loop", which would be a button that
does nothing.

**Alternatives considered**:
- *Seed `startNewLoop`'s `shownTitleIds` from the rated ids* — rejected: it
  collapses `shownTitleIds`' meaning ("seen, no opinion"), and it only patches the
  loop boundary. Re-rating a disliked title to Loved It would still have made it
  eligible again mid-loop.
- *Keep the two-state list and add the other four* — rejected: the same rule stated
  as a list, which is the version that goes stale.
- *Let `watchingNow` back in after a loop, since the visitor may want to rewatch* —
  rejected: the deck's job is deciding what to watch, and a title they have already
  decided on is not a decision left to make. A rewatch is a watchlist action.
