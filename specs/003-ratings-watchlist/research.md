# Research: Ratings & Watchlist

**Feature**: 003 | **Date**: 2026-09-26

Decisions taken before design. Each one is a choice that constrains the
implementation, with the alternative it beat and why.

Most of this feature's *data* already exists: 002 shipped `InteractionStore`
over the frozen `playnext:interactions` document, holding all six states and the
watching history. What 003 adds is the **read side** — a screen over that data,
plus the two operations 002 never needed (re-rate from outside the deck, and
remove). That framing decides most of what follows.

---

## D1. The watchlist is a derived view; it adds no storage key

**Decision**: the watchlist reads `playnext:interactions` through the existing
`InteractionStore` and computes its entries from `(interactions, catalog)` on
each render. No fourth LocalStorage key, no cached index, no denormalized copy.

**Rationale**: every fact the watchlist displays already has an owner. The
rating lives in `interactions` (keyed by title, one entry per title, guaranteed
by the map's shape); the poster, year and availability live in the catalog,
looked up by the same id. A third copy would be a third thing to keep in step —
and the failure mode is silent: a watchlist entry that disagrees with the deck's
exclusion set is a bug the visitor sees as "I disliked this, why is it still
being suggested?"

This is 002's D2 applied one level up. There, the exclusion *set* was derived
rather than stored; here, the whole watchlist *view* is.

**Alternatives considered**: a `playnext:watchlist` document kept in sync on
every rating — rejected, it duplicates `interactions` and drifts. A
materialized index for the 500-entry case — rejected under YAGNI; see D7.

---

## D2. Add `remove(titleId)` to `InteractionStore`; the document shape is untouched

**Decision**: 003 adds exactly one mutating operation to the store — delete a
key from `interactions`. The stored document keeps its schema version, its three
fields, and its meaning. `playnext:interactions` remains frozen.

**Rationale**: FR-005 (remove a rating) needs a delete, and deleting a key
changes no schema — an absent key already means "unrated", which is precisely
what `read()` returns for a first visit. So the frozen contract in
`specs/002-recommendation-deck/contracts/interaction-storage.md` holds verbatim,
and a document written by 003 is indistinguishable from one written by 002.

**The one rule that matters**: removal touches `interactions` only. `history` is
append-only (FR-008), so removing the rating for a title the visitor already
chose with Watch Now leaves its history entry standing. That is the spec's
intent — the history records what happened, not what the visitor currently
thinks.

**Alternatives considered**: a tombstone value (`state: 'none'`) instead of
deleting — rejected, it adds a seventh state to the constitution's ubiquitous
language, which is a contract change, to express something absence already
expresses.

---

## D3. Tab membership is one table in the model, not a condition in a template

**Decision**: the state → tab mapping is a module-level table in
`core/models/interaction.ts`, alongside `EXCLUDING_STATES` and the labels:

| Tab | States |
|-----|--------|
| Want to Watch | `wantToWatch` |
| Loved | `loved`, `liked` |
| Disliked | `disliked`, `notInterested` |
| History | `watchingNow` |

**Rationale**: three separate places need to agree on this — the tabs, the
re-rate control's "which tab will this land in" behaviour, and the empty-state
logic. A table is one place for them to agree in; an `@if` chain in a template
is three.

The History row is the one worth stating out loud. `watchingNow` is set only by
Watch Now (003 FR-004), so a title in that state appears in **no tab** — its
surface is the history. FR-003 says every recorded rating must be reachable
somewhere; the history is where this one lives.

**Alternatives considered**: deriving the tab from `EXCLUDING_STATES` plus
labels — rejected, exclusion and tab membership are different questions that
happen to overlap today, and coupling them means a future state change silently
rearranges the UI.

---

## D4. Keep the read-after-write pattern; do **not** make the store reactive

**Decision**: `InteractionStore` stays a plain non-reactive service. Each view
reads on construction and re-reads after its own writes — the pattern 002
established in `deck.ts`'s `refreshRated()`.

**Rationale**: the engineering standards say one established pattern per
concern, and they say a new pattern must be proposed in a feature spec rather
than introduced ad hoc. A signal-based store would be a second pattern for the
same concern. It is also not needed: Angular destroys the deck component when
the visitor navigates to the watchlist, so the watchlist always constructs
against fresh storage, and vice versa.

**The honest caveat**, recorded because it is the condition this decision rests
on: the pattern breaks the moment two views are alive at once — a split view, a
modal that stays open, a bottom sheet previewing the deck. If 004 or later
introduces one, this decision must be revisited rather than worked around.

**Alternatives considered**: converting the store to a signal and having every
view read the signal — genuinely nicer, and rejected only because it is a
codebase-wide pattern change belonging in its own slice, not smuggled in under
a watchlist.

---

## D5. Bottom navigation lives in a layout component, not in `app.html`

**Decision**: a shell component owns the bottom nav and a `<router-outlet>`;
the deck, watchlist and history routes become its children. The quiz and the
entry hop stay outside it.

**Rationale**: FR-013 settles *that* the nav shows on every main screen,
including the deck. This decides *where it lives*. Putting it directly in
`app.html` — which currently holds nothing but a wrapper and the outlet — would
put the nav on the quiz too, where it is wrong twice over: onboarding is a
linear flow with no navigation to speak of, and offering "skip to my watchlist"
mid-quiz undercuts the quiz's purpose. A layout route scopes the chrome to the
routes that should have it, using the router rather than a condition.

**Consequence for 002**, and the reason this is worth a decision rather than an
edit: the deck's action bar is `sticky bottom-0`. With a nav pinned below it,
"bottom" is no longer the viewport bottom, and the deck's existing shell tests
assert exactly that class pairing. The deck's layout changes in this slice, and
its tests change with it.

**Alternatives considered**: nav in `app.html` with an `@if` on the URL —
rejected, a condition where the router already expresses the intent. Nav hidden
on the deck — rejected by the clarification of 2026-09-26.

---

## D6. The re-rate control offers the deck's five actions, from one shared table

**Decision**: re-rating offers exactly `RATING_ACTIONS` from
`core/models/interaction.ts` — Loved, Liked, Disliked, Want to Watch, Not
Interested — plus a separate Remove. `watchingNow` is not offered (FR-004).

**Rationale**: `RATING_ACTIONS` is already the deck's action vocabulary, and the
constitution names the rating vocabulary as shared ubiquitous language across
domain, API and UI. Reusing the table means the watchlist and the deck cannot
offer different words for the same state, and a rename lands in one file.

Remove is deliberately **not** folded into that list. It is not a state — it is
the absence of one — and rendering it as a sixth equal option would put "no
rating" in the same visual rank as five actual ratings, which is exactly the
confusion the Not Interested clarification of 2026-09-26 was about.

**Alternatives considered**: a bespoke watchlist action list — rejected as the
duplicate-vocabulary bug the shared table exists to prevent.

---

## D7. 500+ entries is proven on the logic, and measured in a browser

**Decision**: FR-011 / SC-005 is verified in two parts, and the plan does not
pretend they are one. The grouping, lookup and ordering logic is tested at 500+
entries against a synthesized document. The *rendering* is a manual browser
check, because jsdom has no layout engine.

**Rationale**: the catalog has 48 titles, so a visitor cannot produce 500
ratings through the UI — the criterion is unreachable by clicking, and a test
that claimed to cover it by simulating 500 taps would be simulating something
the product cannot do. Building the document directly is honest: it is the state
the requirement names. Two design choices make the logic side cheap to
guarantee — a `Map` from id to title built once per render rather than a linear
scan per entry, and `@for` with `track` so Angular reuses DOM nodes instead of
rebuilding the list.

**What this does not establish**: that 500 rows scroll smoothly on a real
device. That needs a browser and is recorded as a manual step, not as passing.

**Alternatives considered**: growing the mock catalog to 500 titles — rejected,
it inflates the bundle and the fixture to serve one test. Declaring the
requirement unverifiable in Milestone 1 — rejected, the logic half is genuinely
testable.

---

## D8. No new dependencies

**Decision**: grouping, ordering and lookup are plain TypeScript. The nav, tabs
and list are Tailwind utilities. Nothing is added to `package.json`.

**Rationale**: constitution II (YAGNI) and the engineering standard that new
dependencies must be justified in the feature spec. There is no candidate here
worth justifying: a tab component library for three tabs, or a virtual-scroll
library for a list whose logic is already fast, would both be more code to own
than the thing they replace. 002 reached the same conclusion (its D8) for the
same reasons.

**Alternatives considered**: a virtual scroller for FR-011 — the honest
candidate, and rejected because the requirement is "smooth", not "10,000 rows",
and a 500-element list is well within what the browser handles. If measurement
in a browser shows otherwise, this decision is the one to reopen, with the
measurement attached.

---

## D9. The title detail surface is shared by tab entries and history entries

**Decision**: tapping a watchlist entry and tapping a history entry open the
same detail view, which includes the re-rate control and the streaming links.

**Rationale**: this falls directly out of the 2026-09-26 clarification. A
`watchingNow` title lives only in the history (D3). If history entries opened a
view without re-rating, the visitor could never change that rating again — the
identical dead end, one state over, that the Not Interested decision closed.
FR-003 as amended says no recorded rating may be unreachable, so the plan must
provide the path, and one shared view is one implementation rather than two.

**Alternatives considered**: letting history entries link straight out to the
services, skipping a detail view — rejected (FR-008 wants the title's details
reachable, and US3 scenario 2 says "details and streaming links").

---

## D10. Streaming links resolve at render, never from storage

**Decision**: the history stores `{titleId, chosenAt}` and nothing more. Links
come from the catalog's current `availability` at render time.

**Rationale**: 002 already built it this way, deliberately — the comment on
`WatchHistoryEntry` says so, and notes that 003 is the feature that requires it.
A stored URL would be a snapshot of availability at the moment of choosing, and
availability changes; a dead deep link in the visitor's history is a worse
outcome than a link that reflects today's truth.

**The consequence to handle, not hide**: a title can leave the catalog between
being watched and being reopened — plausible in Milestone 2 when TMDB supplies
the data. The entry must then degrade to an "unavailable" row rather than a
crash or a blank screen. `match-found.ts` already resolves a title by id from
the URL and has a documented fallback for an unknown id; that behaviour is the
one to reuse rather than reinvent.

**Alternatives considered**: storing the links alongside the choice — rejected
above, and it is the alternative 002 explicitly wrote down and declined.

---

## D11. The poster fallback is extracted, not copied

**Decision**: pull the missing/failed-poster behaviour out of `card.html` into a
small shared component used by both the deck card and the watchlist entry.

**Rationale**: FR-002 needs a poster per watchlist entry, and the edge cases
require the same fallback as deck cards. The fallback is not trivial markup — it
is a CSS-only placeholder chosen specifically because it cannot fail the way the
image did, and it carries the same accessible name the image would have had.
That reasoning is worth having in one place. The engineering standards say the
same behaviour must not be implemented two different ways; copying 20 lines of
considered markup is exactly how the two versions start to diverge.

This is a refactor of shipped code inside a feature slice, which is normally
worth avoiding. It is justified here because the alternative is duplication, and
because `Card` keeps its own layout — only the poster element moves.

**Alternatives considered**: reusing `Card` wholesale for watchlist entries —
rejected; a full-bleed card with a synopsis disclosure is not a list row.

---

## D12. Re-rating while a deck loop is running changes the next loop, not this one

**Decision**: no invalidation, no rebuild, no cross-view notification. A rating
changed in the watchlist is simply present the next time the deck is
constructed.

**Rationale**: the spec already says this (Assumptions: "a rating change made
mid-loop affects the next loop only"; deck FR-010 still governs the running
loop). It is recorded as a decision because the tempting implementation is to
force the deck to re-rank, and that would be wrong: the visitor is mid-decision,
and having the current card vanish because they edited a different title's
rating elsewhere is worse than a one-loop delay. The deck re-reads on
construction (D4), which is sufficient and is the whole mechanism.

**Alternatives considered**: re-ranking the live deck on every interaction
write — rejected above; it is the behaviour D4's read-after-write pattern makes
tempting and unnecessary.
