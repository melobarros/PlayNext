# Feature Specification: Deterministic Engine v2

**Feature Branch**: `010-deterministic-engine-v2`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "Replace the genre-only scorer with a richer, calibrated, diverse deterministic ranker, measured against the incumbent. The first cards should reflect taste more accurately (genres, era, runtime, quality), the deck should not repeat five near-identical cards in a row, and every card's reason should correspond to a feature that actually contributed to its score. The engine stays a pure, clock-free, randomness-free function; the incumbent remains available as a baseline behind a flag until the new one wins, and the offline harness from 009 judges both. No machine learning, no new dependency, and no new catalog data."

## Clarifications

### Session 2026-10-24

- Q: What evidence must the new engine show before it becomes the deck's default? → A: On the standard fixture, NDCG@10 must be at least 10% higher than the incumbent's, with MRR and hit rate@10 not lower. If it cannot, it does not become the default.
- Q: Which new taste features may the engine use? → A: Only what the catalog already carries on the wire: genre, release year (era), runtime, and quality. Keywords, people, cast, and language are out of scope until a later catalog feature carries them.
- Q: How is the incumbent kept available? → A: The deck can be asked for engine v1 through a documented query override while the rollout is being evaluated; v2 is the default. Both implementations remain in the evaluation harness as rankers regardless.
- Q: How much of the deck does the diversity re-rank cover? → A: A bounded top window of 50 titles; beyond it, the deck continues in score order. Fifty covers a long session and keeps the work bounded.
- Q: May the reason vocabulary grow? → A: Yes, by one code for era affinity. A feature that cannot be said as a sentence to the visitor — runtime — may contribute to the score without ever speaking.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Better ranking (Priority: P1)

A visitor finishes the quiz and starts a deck. The first cards reflect their
taste more accurately than today: not only which genres they picked, but which
genres their own ratings point at, which era of films and shows they respond
to, how long they like their titles to run, and how good a title is given how
much the voting base actually supports it. A strong title that matches one
picked genre can now outrank a weak title that happens to carry two, which the
current tiered rule forbids outright. When the visitor has rated nothing yet,
the deck falls back to their quiz selections and quality alone, exactly as it
should for a cold start.

**Why this priority**: This is the feature's reason to exist — the deck's
ordering is the product. It is P1 because it is the visible win: the ranking
work of 008 and 009 exists to make this measurable, and nothing downstream
(011's filters, any later re-ranker) matters if the base ordering cannot be
improved and proven improved.

**Independent Test**: Run the offline harness on the standard fixture with the
incumbent, the popularity baseline, and the new engine. The new engine reports
the required improvement in NDCG@10 without lowering MRR or hit rate. Then
walk a scripted deck session and confirm the hard filters still hold for every
card: nothing unavailable, nothing already rated, nothing already shown.

**Acceptance Scenarios**:

1. **Given** a completed quiz and a deck, **When** the new engine ranks the
   catalog, **Then** the order is a pure function of catalog, preferences,
   interactions, shown titles, and engine version — the same inputs produce the
   same order on every run and every device.
2. **Given** the visitor has rated titles, **When** the deck is ranked, **Then**
   genres, era, runtime, and quality from those ratings influence the order,
   and the influence of each is documented.
3. **Given** a visitor with no ratings, **When** the deck is ranked, **Then**
   the order depends on quiz selections and quality only, with era and runtime
   neutral, and the deck is neither empty nor an error.
4. **Given** any deck produced by the new engine, **When** each card is
   checked against the visitor's filters and history, **Then** no card is
   unavailable on their services (unless other platforms are allowed), already
   rated, or already shown in this loop.
5. **Given** the same fixture, **When** the harness evaluates the incumbent and
   the new engine, **Then** the new engine's NDCG@10 exceeds the incumbent's by
   at least the agreed margin, and its MRR and hit rate@10 are not lower.

---

### User Story 2 - A deck that does not repeat itself (Priority: P2)

A visitor swipes through a genre they love, and instead of five near-identical
titles in a row, the deck alternates between adjacent interests: a horror, then
a thriller, then a comedy that fits, then back to horror. The order is still
the visitor's best matches — the variety comes from trading a little relevance
among the strongest candidates for cards that feel different from one another,
never from injecting unrelated titles.

**Why this priority**: Repetition is the most common complaint about
content-based decks and the current engine has no defence against it. It is P2
because the P1 improvement is the product win, while diversity is the polish
that makes the win feel good; it is also the riskier change, so it ships with
its own measurable acceptance rather than folded into P1.

**Independent Test**: Replay the standard fixture and compare intra-list
diversity between the incumbent and the new engine: diversity must rise while
NDCG@10 stays above the incumbent's and coverage does not collapse. Re-run to
confirm the re-ranking is deterministic.

**Acceptance Scenarios**:

1. **Given** a set of candidates ranked by score, **When** the diversity
   re-rank is applied, **Then** the deck's intra-list diversity is higher than
   the incumbent's on the standard fixture, and its NDCG@10 is still above the
   incumbent's.
2. **Given** the same candidates and inputs, **When** the deck is ranked twice,
   **Then** the order is identical.
3. **Given** fewer candidates than the re-rank window, **When** the deck is
   ranked, **Then** the re-rank still runs over what exists and produces a
   valid order.
4. **Given** a deck produced under the diversity rule, **When** its catalog
   coverage is measured, **Then** it is at least 90% of the incumbent's.

---

### User Story 3 - Reasons that stay honest (Priority: P3)

Every card's reason names a feature that actually helped place it: a picked
genre, a genre the visitor's ratings point at, an era they respond to, or the
service they already pay for. A card that ranked on nothing but its quality
says nothing, as it does today. No card ever claims a reason the engine did not
use to rank it.

**Why this priority**: The card's reason is the product's explainability
promise, and a richer engine makes it easier to lie by accident — a reason that
no longer maps to a scoring term is a small deception the visitor cannot
detect. It is P3 because the ranking works without it, but shipping P1 without
it would weaken a promise the product has already made.

**Independent Test**: Walk a deck and, for every card carrying a reason,
confirm the named feature contributed positively to its score; confirm every
card without a positive contribution shows no reason. Confirm the new era
reason appears only for visitors whose ratings support it.

**Acceptance Scenarios**:

1. **Given** a card showing "Because you picked …" or "Because you loved …",
   **When** its score is inspected, **Then** the picked-genre or history term
   contributed positively.
2. **Given** a card showing an era reason, **When** its score is inspected,
   **Then** the era term contributed positively.
3. **Given** a card whose only positive contribution is quality, **When** it is
   displayed, **Then** it shows no reason.
4. **Given** a card whose reason names a service, **When** its score is
   inspected, **Then** the availability term contributed positively.
5. **Given** the new era reason code, **When** an impression carrying it is
   submitted, **Then** the intake accepts it, and every previously valid code
   remains valid.

---

### Edge Cases

- **The visitor has rated nothing** → era and runtime are neutral; the deck is
  ordered by quiz selections and quality, exactly as UX expects from a cold
  start.
- **The visitor has rated only rejections** → the negative genre signal sinks
  what they rejected; era and runtime stay neutral, because there is no
  positive history to centre them on.
- **Every liked title lacks a runtime** → the runtime term is neutral instead of
  defaulting to a guess.
- **Every title in the catalog shares a release year** → the era term becomes
  constant and cannot reorder anything.
- **A title lists the same genre twice** → it counts once; duplicates in
  catalog data are not evidence of stronger taste.
- **Two titles score identically** → the title-id tiebreak decides, byte-for-
  byte, on every device.
- **Genres are left as "Any"** → the genre term is absent; history, era,
  runtime, and quality carry the order.
- **The diversity window contains near-identical titles** → the re-rank may
  raise a lower-scoring card; acceptance is governed by the measured NDCG@10
  floor, not by preserving every pairwise order.
- **Fewer than fifty candidates** → the re-rank runs over the smaller set and
  returns a valid order.
- **The deck request asks for an unknown engine** → v2 is served; an invalid
  override is not an error.
- **The visitor changes a rating mid-session** → the next ranking reflects it;
  there is no cached profile to invalidate.
- **A title's provider is retired** → its service reason still resolves through
  the successor map, or no reason is shown; an unknown id never reaches the
  card.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Ranking MUST remain a pure function of the catalog, the
  visitor's preferences, their recorded interactions, the titles already shown
  in the loop, and the engine version. Identical inputs MUST produce identical
  orders.
- **FR-002**: Ranking MUST NOT consult a clock, the network, randomness, or any
  state outside FR-001. A rating made a year ago and one made a minute ago MUST
  count the same.
- **FR-003**: The hard eligibility filters MUST be unchanged: unscorable titles
  dropped; media-type filter; at least one selected-genre match when genres are
  selected; availability on a selected service unless other platforms are
  allowed; already-rated titles excluded; already-shown titles excluded. The
  constitution's Filter Enforcement and Feedback Loop invariants MUST hold for
  every card.
- **FR-004**: Genre match MUST contribute as a weighted scoring term rather
  than as a lexicographic tier, so a title strong on other features can
  outrank a weaker title with one more genre match. The hard at-least-one-match
  filter (FR-003) still guarantees every card matches a selected genre when
  genres are selected.
- **FR-005**: The visitor's rating history MUST contribute a taste profile
  covering genres, era, and runtime. Positive and rejection states MUST weigh
  in opposite directions, and a title's own tags MUST NOT be weighted more
  merely because it carries many of them.
- **FR-006**: Era affinity MUST derive from the release years of the titles the
  visitor responded to positively, expressed as a distance that decays with the
  gap in years, and MUST be neutral when there is not enough evidence.
- **FR-007**: Runtime affinity MUST derive from the runtimes of positively rated
  titles, MUST be neutral when too few of them carry a runtime, and MUST NOT
  speak as a reason (it cannot be phrased honestly in one sentence).
- **FR-008**: Quality MUST use a confidence-weighted rating whose prior is
  calibrated to the catalog being ranked rather than to fixed constants, so a
  tiny catalog's mean does not distort scores and a lone high rating cannot top
  the deck.
- **FR-009**: The deck MUST apply a deterministic diversity re-rank over the
  top 50 candidates by score, trading relevance for intra-list variety with a
  documented trade-off parameter; candidates beyond the window keep score
  order.
- **FR-010**: Every reason shown MUST correspond to a feature that contributed
  positively to that card's score. A card with no positive contribution MUST
  show no reason, and its stored reason code MUST be `none`.
- **FR-011**: The reason vocabulary MAY gain one code for era affinity; the
  vocabulary stays closed, and the intake MUST accept every code in it and
  reject anything else.
- **FR-012**: The engine MUST expose a version identifier that changes
  whenever a rule change could reorder the deck. Every impression MUST record
  the version of the engine that produced the card, including when the
  incumbent is served through the override.
- **FR-013**: The incumbent engine MUST remain available: the harness MUST
  evaluate it and the popularity baseline alongside any candidate on every
  run, and the deck MUST be able to serve it through a documented query
  override while the rollout is evaluated.
- **FR-014**: With no positive rating history, era and runtime MUST be neutral
  and the deck MUST be ordered by preferences and quality alone. Ranking MUST
  NOT throw, empty the deck, or alter eligibility because history is missing.
- **FR-015**: Ranking MUST stay within the card budget: the time from inputs
  changing to a dealt card MUST remain under the 300ms target at the 95th
  percentile on the standard fixture's catalog.
- **FR-016**: This feature MUST NOT add a dependency, change the catalog schema,
  add a provider call, or move scoring off the client.
- **FR-017**: The rollout MUST be comparable after the fact: because impressions
  carry the engine version, the like rate of v2 MUST be comparable with v1's
  over a comparable sample before the override is removed.

### Measurement Definitions

- **Incumbent**: `recommend-v1`, the engine serving the deck when this feature
  starts. It keeps working, unchanged, and is what the candidate must beat.
- **Candidate**: `recommend-v2`, the engine this feature ships.
- **Standard fixture**: `personas-v1`, the frozen catalog and persona sessions
  committed with feature 009. All success criteria that speak of "the standard
  fixture" use it.
- **The six measures**: NDCG@10, MRR, hit rate@10, precision@10, catalog
  coverage, and intra-list diversity, as defined in feature 009's
  specification. This feature adds no measure.
- **Feature contribution**: the positive part of one scoring term for one
  title. A reason may only name a feature whose contribution is positive.

### Key Entities *(include if feature involves data)*

- **Ranker**: a named, versioned implementation that orders eligible titles.
  `recommend-v1` (incumbent), `recommend-v2` (candidate), and the popularity
  baseline are all rankers and are evaluated the same way.
- **Taste profile**: the derived view of a visitor's ratings — genre weights,
  era centre, runtime centre, and their evidence counts. Derived on every call;
  never stored and never cached.
- **Reason code**: the closed vocabulary stored on impressions. It gains one
  member in this feature and otherwise stays as feature 009 defined it.
- **Engine version**: the identifier that travels on every impression and in
  every harness report, so two rankings can never be confused.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the standard fixture, the candidate's NDCG@10 is at least 10%
  higher than the incumbent's, and its MRR and hit rate@10 are not lower.
- **SC-002**: On the standard fixture, the candidate's intra-list diversity is
  higher than the incumbent's and its catalog coverage is at least 90% of the
  incumbent's.
- **SC-003**: Two consecutive harness runs produce identical measures for every
  ranker, and two consecutive deck rankings of the same inputs are identical.
- **SC-004**: Across every card in a replayed fixture, 100% of cards showing a
  reason have a positive contribution from the named feature, and 0% of cards
  without one show a reason.
- **SC-005**: Across every replayed session, zero cards violate the hard
  filters — the constitution's two invariants hold for the new engine exactly
  as they did for the old one.
- **SC-006**: Ranking a full deck stays within the 300ms card-render budget at
  the 95th percentile.
- **SC-007**: The same inputs produce the same card order across browsers and
  locales, with the title-id tiebreak deciding every tie.
- **SC-008**: After rollout, the like rate of impressions produced by v2 is not
  below that of v1 over a comparable sample, measured from stored impressions
  and actions.

## Assumptions

- **Scoring location**: decided 2026-10-24 — scoring stays on the client, as a
  pure function beside the deck. No server ranking endpoint is added.
- **No machine learning**: decided 2026-10-24 — the product stays deterministic
  through this feature and the next one; the constitution is not amended.
- **Available features**: only what the catalog carries today — genres, release
  year, runtime, rating, and vote count. Keywords, cast, people, and original
  language are not on the wire; adding them is a catalog feature, not this one.
- **Evaluation basis**: the frozen synthetic fixture from 009 is the basis for
  every acceptance number. A fixture captured from real events is a later,
  optional addition; it must contain no personal data.
- **Rollout**: the query override is a temporary lever for staged comparison.
  Removing it after the comparison is a small follow-up change, not part of
  this feature's scope.
- **Weights**: the feature weights are engineering-owned constants, documented
  in one place and covered by tests. Changing them is a code change that bumps
  the engine version and requires a harness run; they are not a runtime
  setting.
- **Catalog size**: the standard catalog is in the low thousands of titles.
  Ranking and re-ranking remain client-side computations over that size; no
  approximation is needed.
