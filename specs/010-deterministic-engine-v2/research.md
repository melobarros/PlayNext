# Research: Deterministic Engine v2

**Feature**: 010-deterministic-engine-v2 | **Date**: 2026-10-24

Every decision below resolves something the specification left to planning.
The numbers (weights, windows) are starting points that the harness tunes; the
rules are what the plan commits to.

## D1 — Two engines side by side, one shared eligibility rule

**Decision**: `recommend-v1` moves into its own module verbatim; `recommend-v2`
is a second module beside it. Both import the same eligibility function. The
public `recommend.ts` keeps `eligibleTitles`, the engine registry, and the
default.

**Rationale**: FR-013 and SC-005 both require the incumbent to keep working —
the harness must report it on every run, and the deck must be able to serve it
through the override. Re-implementing eligibility in v2 would let the two drift
and would make every harness comparison part filter, part ranking. Moving v1
verbatim (not rewriting it) is what makes the incumbent row mean the same thing
tomorrow as it did in 009's report.

**Alternatives considered**: keeping v1 inside `recommend.ts` and branching on a
parameter (a single function with two engines inside becomes unreadable and
untestable); copying eligibility into v2 (drift risk, and the harness's
popularity baseline already taught this lesson in 009).

## D2 — Only features the catalog already carries

**Decision**: v2 scores with genres, release year, runtime, rating, and vote
count. No keyword, cast, person, or language term.

**Rationale**: those are the only taste features on the wire (`TitleDto` and
`MediaTitle`). The research's aspirational feature list includes keywords,
people, and language, but adding them is a catalog-pipeline feature (TMDB
discover fields, storage, slices, wire shape) with its own migration and
contract — out of this feature's scope by the clarification of 2026-10-24.

**Consequence**: the standard fixture's catalog has no `runtimeMinutes`, so the
runtime term is neutral on every acceptance number; it is exercised by its own
unit tests instead.

## D3 — Pure IEEE-754 arithmetic only

**Decision**: the engine uses `+`, `-`, `*`, `/`, `Math.max`, and comparisons.
No `Math.log`, `Math.sqrt`, `Math.exp`, or `Math.pow`, and no locale-sensitive
comparison.

**Rationale**: `Math.log`/`Math.sqrt` are implementation-approximated in
ECMAScript and may differ in the last bit between browser engines; addition and
multiplication of doubles are exactly specified. FR-001/SC-007 require the same
inputs to produce the same order on every device, and a last-bit difference in a
tiebreak-adjacent score is enough to reorder two cards. This rules out IDF-style
weighting and exponential decay kernels; the linear kernels below keep the same
intent without the hazard.

**Alternatives considered**: `log`-based IDF and `exp`-based recency (rejected
for cross-engine determinism); integer-only scoring (rejected — ratings and
weights are fractional by nature, and IEEE doubles are deterministic).

## D4 — Genre affinity normalized by the title's genre count

**Decision**: a title's history-affinity contribution is the signed sum of its
genres' profile weights divided by the number of distinct genres it wears.

**Rationale**: the audit's limitation #2 — a title with many genre tags
accumulates more affinity than a tightly tagged one. Dividing by the count is
the cheapest normalization that removes the length bias without logs. Distinct
genres only, so a duplicated tag is not evidence.

**Alternatives considered**: IDF (needs `log`, vetoed by D3); no normalization
(keeps the bias).

## D5 — Quality prior calibrated to the catalog

**Decision**: the prior rating is the mean rating of the scorable titles in the
catalog being ranked, and the prior weight is the mean vote count of those
titles (floored at 1). The confidence-weighted rating formula itself is
unchanged in shape.

**Rationale**: FR-008 and the audit's limitation #9. A fixed 6.5/500 prior
means the same thing on a catalog of obscure shorts and a catalog of blockbusters
where it should mean different things. Computing it from the catalog argument
keeps the engine a pure function of its inputs, so the harness replays see the
fixture's own means — which is also what makes a hero title on a small fixture
behave the same as on a large catalog.

**Note**: the popularity baseline keeps 009's fixed prior deliberately. The
baseline is the yardstick; changing it would move the row the candidate is
compared against and make two reports incomparable.

## D6 — MMR over the top 50, λ = 0.75, Jaccard genre similarity

**Decision**: after scoring and sorting, the first 50 candidates are re-ranked
with Maximal Marginal Relevance: `λ · relevance − (1 − λ) · max similarity to
already picked`, relevance min-max normalized over the window, similarity the
Jaccard overlap of genre sets. λ starts at 0.75 and is tuned on the fixture.
Everything beyond the window keeps score order.

**Rationale**: the research's §12.1 recommends MMR with λ 0.7–0.8 and genre
similarity for this product. The window bounds the work at 50×50×50 similarity
computations worst case (no cubic blow-up on a catalog of thousands) and covers
far more cards than a session shows. Min-max normalization is required for λ to
mean anything: raw scores are not in [0,1] and their spread varies with the
catalog.

**Alternatives considered**: diversity quota per genre run (coarser, harder to
tune); MMR over the whole catalog (wasted work on cards no session reaches).

## D7 — Engine selection through a query override, version travels on events

**Decision**: the deck reads `?engine=` once at construction. `v1` selects the
incumbent; anything else (including no parameter and unknown values) selects v2.
The chosen engine's version string is what the deck stamps on every impression.

**Rationale**: FR-012/FR-013. A query parameter is shareable (a reviewer can
send the link), needs no storage, and cannot leak between visitors the way a
server-side flag would. Reading it once matches how the deck already treats its
preferences: fixed for the component's lifetime.

**Alternatives considered**: localStorage (invisible and sticky across
sessions — wrong for a staged comparison); a server setting (the engine is
client-side; there is no server endpoint to read it from).

## D8 — Reasons: precedence plus proof, and one new code

**Decision**: the reason branches, in order: picked genre, loved genre, era,
selected service, none. Each branch fires only when that feature's contribution
to this card is positive. The vocabulary gains `era-affinity`. Runtime never
speaks. The service reason requires the availability term to be positive, so
v2 gives the availability term a small weight.

**Rationale**: FR-010/FR-011. Today's engine shows "on one of your services"
with no score term behind it — an honest-looking claim the score never made.
Giving availability a small weight is the smallest change that makes the
sentence true, and it only reorders under "show other platforms", where it is
the one differentiator between otherwise equal titles.

**Consequence**: the stored vocabulary grows by one, so the intake validator,
its vocabulary class, and its tests change; the wire `ReasonCode` type grows by
one. Nothing else in 009's contract moves.

## D9 — The harness gains a v2 row; the incumbent row switches to v1 explicitly

**Decision**: `rankers.ts` exports `incumbentRanker` (wrapping v1),
`popularityRanker` (unchanged), `v2Ranker` (wrapping v2), and keeps
`invertedRanker` (wrapping v1, reversed). The standard report gains the v2 row.
The fixture `personas-v1` is unchanged — the fixture is the yardstick, and a
fixture edited while a new engine is tuned would measure the edit.

**Rationale**: 009's harness contract says every run reports the incumbent and
the popularity baseline alongside any candidate. After this feature, the
incumbent is still v1: the fixture was captured under it, and that is what the
candidate must beat.

## D10 — Performance bound and measurement

**Decision**: ranking is `O(n log n)` for scoring and sorting plus `O(50²·50)`
for the re-rank. A Vitest guard ranks a generated 2 000-title catalog 20 times
and asserts a generous wall-clock ceiling, so a quadratic regression in scoring
or an accidental whole-catalog MMR fails loudly without making CI flaky.

**Rationale**: SC-006's 300ms is a render budget, not a ranking benchmark; a
tight timing assertion in shared CI hardware would fail for reasons unrelated to
the change. The guard catches complexity regressions, and the real budget is
verified by the fixture and by the build.

## D11 — No recency, and `watchingNow` stays inert

**Decision**: interaction timestamps are ignored by scoring, and `watchingNow`
— deliberately set outside the deck by Watch Now — contributes no affinity.

**Rationale**: FR-002 forbids clock-dependent behavior, and 002's own comment
reasons that having watched something says nothing yet about wanting more. Both
are stated in the spec as constraints, not omissions.

## D12 — The rollout comparison reads engine version off impressions

**Decision**: nothing new is recorded; SC-008's like-rate comparison groups
stored impressions by their `EngineVersion` and joins actions. The 009 record
already carries both.

**Rationale**: 009 exists so that this rollout can be judged on evidence; adding
another field would duplicate what is already there.
