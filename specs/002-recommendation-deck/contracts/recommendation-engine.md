# Contract: Recommendation Engine (pure ranking function)

**Owner**: feature 002 (recommendation deck) | **Consumers**: 002 (deck loop,
empty-state detection); the Milestone 2 backend reimplements it in the Domain
layer | **Date**: 2026-09-26

**Amended (2026-09-28, MVP ranking pass)**: the flat score became the tiered
order above (tier key + demotion term), after testing showed the weighted form
let a one-genre title outrank a two-genre one and let high-vote family
animation crowd out the genres the visitor actually picked. The stage-1 filter
table and G1–G5 are unchanged.

**Amended (2026-09-29, the reason line)**: the return type became `RankedTitle[]`
— every ranked title now carries the one-sentence reason the card shows
(stage 4, below). Ordering, the filter table and G1–G7 are unchanged; the
reason is derived from the same inputs the score was, and cannot influence it.

`rankTitles` is the product's core asset and the reason the deck is trustworthy.
It is specified as a **pure function** so that two constitution invariants can be
proven by tests rather than argued about, and so FR-011's reproducibility is a
property of the design instead of a hope.

It has no Angular, DOM, clock, or network dependency — it is testable with plain
TypeScript, exactly like spec 001's `quiz-rules.ts`.

## Signature

```ts
interface RankedTitle extends MediaTitle {
  reason: string | null;            // stage 4; `null` = nothing honest to say
}

function rankTitles(
  catalog: readonly MediaTitle[],
  preferences: Preference,          // spec 001's completed Preference
  interactions: Readonly<Record<string, Interaction>>,
  shownTitleIds: readonly string[], // the current loop's already-advanced-past ids
): RankedTitle[]
```

Returns the eligible titles, best first, each carrying its own reason. Never
mutates its inputs. Never throws on malformed input — a title that cannot be
scored is filtered out, not fatal.

`RankedTitle` extends `MediaTitle` rather than replacing it: `MediaTitle` stays
the storage-and-transport shape, and the reason is a statement about *this*
ranking that no API response makes. It is attached by the engine, not derived
by the card, because only the engine knows which signal actually placed the
title — a second derivation downstream would be a second opinion, and the two
would eventually disagree.

## Stage 1 — Hard filters (the Filter Enforcement invariant)

A title is dropped when **any** of these hold. Order is irrelevant; a drop is a
drop.

| # | Drop when | Requirement |
|---|---|---|
| 1 | `!preferences.mediaType.any` and `title.mediaType ∉ preferences.mediaType.values` | FR-005 |
| 2 | `!preferences.genre.any` and `title.genres ∩ preferences.genre.values = ∅` | FR-005 |
| 3 | `!preferences.provider.any` **and** `!preferences.includeUnownedProviders` **and** `title.availability ∩ preferences.provider.values = ∅` | FR-006 |
| 4 | `interactions[title.id]?.state ∈ { disliked, notInterested }` | FR-009, **Feedback Loop invariant** |
| 5 | `title.id ∈ shownTitleIds` | FR-010 |

Notes that matter:

- Filter 3 is the one the constitution singles out. `includeUnownedProviders`
  **disables** it entirely — that is the visitor's explicit opt-in (spec 001
  FR-006), not an exception to be quietly re-applied later.
- Filter 4 is the only place exclusion is decided. It reads the *current*
  state, so spec 003's re-rating un-excludes a title with no extra mechanism.
- A title with empty `availability` is dropped by filter 3 whenever the visitor
  has provider preferences and has not opted into other platforms — correct,
  since we cannot claim it is watchable for them.

## Stage 2 — Score (tiered, explainable)

The order is **two keys deep**: a match tier, then a within-tier score.

```
tier(title)   = matchedGenres(title)
within(title) =  6 × historyAffinity(title)
              − 10 × mismatchedGenres(title)
              +      weightedRating(title)
```

The tier is a sort key of its own rather than a weighted term, and that is the
whole point: a weighted `10 × matchedGenres` can be outvoted by the terms below
it, so "a rom-com before an animation" would be an arithmetic hope. As a key, it
is a property of the comparator — **no affinity total and no rating gap can
carry a title past the tier above it**, whatever the catalog holds.

**`matchedGenres`** = `|title.genres ∩ preferences.genre.values|`, or `0` when
the visitor chose Any. Plain overlap: more of what they asked for ranks higher.

**`mismatchedGenres`** = `|title.genres ∩ selectableGenres − preferences.genre.values|`,
or `0` when the visitor chose Any, where `selectableGenres` is the nine ids the
quiz offers (`GENRES`). A selection is also a statement about what the visitor
did *not* pick, and this is where it lands: a title wearing a genre they could
have chosen but didn't starts lower within its tier — the difference between "a
comedy" and a kids animation that the provider files under comedy. `Any` carries
no such statement (it is the absence of a selection, not a choice against
everything), so the term vanishes there. Only the selectable vocabulary counts:
a slug tag (`family`, `fantasy`…) is not a genre the visitor was ever offered,
so a title wearing one is never penalized for it.

**`historyAffinity(title)`** — the feedback loop's positive/negative signal,
derived from the visitor's own ratings:

```
lovedGenres    = ⋃ genres of titles rated loved | liked | wantToWatch
dislikedGenres = ⋃ genres of titles rated disliked | notInterested
historyAffinity(t) = |t.genres ∩ lovedGenres| − |t.genres ∩ dislikedGenres|
```

This may be negative — a title wearing genres the visitor has rejected sinks.
Disliked *titles* are already gone (filter 4); this is how the visitor's taste
generalizes past the specific titles they rejected. All title genres count here,
tags included (see the spec's assumption that scoring uses tags as well as
genres); the demotion term is the only place the selectable vocabulary is the
limit.

**`weightedRating(title)`** — quality, confidence-weighted so a lone 10.0 from
three votes cannot top the deck:

```
weightedRating(t) = (t.rating × t.voteCount + 6.5 × 500) / (t.voteCount + 500)
```

The prior (6.5 over 500 votes) pulls low-evidence titles toward the middle. The
formula is standard, explainable to a stakeholder, and computed identically
every time.

## Stage 3 — Total order (the determinism guarantee)

Sort by `tier` descending, then `within` descending; break ties by `title.id`
ascending.

The id tiebreak is what makes FR-011 real. Without it the sequence would depend
on `Array.prototype.sort` stability and on the order the catalog happened to
arrive in — so the same preferences could produce a different deck on a
different device or after a catalog reshuffle. **There is no randomness
anywhere in this function**, and that is a deliberate product decision
(constitution VI), not a limitation: a new loop feels fresh because the
visitor's own ratings have changed the scores, not because a dice roll did.

## Stage 4 — The reason (why this card is here)

One sentence per title, or `null`. The deck's promise is that a card can be
*justified*, not that every term of the score is itemized — the sentence names
the one signal a visitor would recognize their own decision in.

Precedence, first match wins:

| # | Condition | Sentence |
|---|---|---|
| 1 | `!preferences.genre.any` and the title wears a genre in `preferences.genre.values` that has a display name | `Because you picked {Genre}` |
| 2 | the title wears a genre in `lovedGenres` that has a display name | `Because you loved {Genre}` |
| 3 | the title has an availability entry on a selected service, directly or through `RETIRED_PROVIDER_SUCCESSORS` | `On {Provider}, one of your services` |
| 4 | none of the above | `null` |

Notes that matter:

- **Only one sentence, ever.** Terms 2 and 3 of the score still apply to a title
  ranked by branch 1; the reason reports the *first* thing the visitor would
  name, not a summary of the arithmetic.
- **Branch 2 is only reachable under `Any`.** With a real genre selection, filter
  2 has already guaranteed an overlap, so branch 1 matches — unless the stored
  id has no display name, in which case branch 2 gets its turn.
- **Branch 3 names the service that matched, not the one selected.** A visitor
  whose stored preference says `star-plus` is shown `On Disney+, one of your
  services`, because Disney+ is the catalog they can actually watch.
- **An unlabelled id falls through, never through to the card.** `a-defunct-service`
  in an availability entry and `family` in a genre list are both data the option
  lists do not know; neither reaches the visitor. This is the same rule the
  card's own id→name mapping follows, applied at the engine so the string is
  safe wherever it is shown.
- `null` is a normal value, not a failure. A title that ranked purely on its
  confidence-weighted rating gets silence, and the card renders nothing.

## Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| G1 | No returned title is unavailable on the selected services, unless `includeUnownedProviders` | FR-006, Principle V invariant |
| G2 | No returned title is currently `disliked` or `notInterested` | FR-009, Principle V invariant |
| G3 | Equal inputs ⇒ identical output array, element for element | FR-011, SC-005 |
| G4 | Inputs are never mutated; the caller's arrays are unchanged | — |
| G5 | An empty result is a normal value, never an error | FR-014 (empty state) |
| G6 | A title matching more selected genres always ranks above one matching fewer — unconditional, independent of the within-tier terms | FR-019, SC-009 |
| G7 | Within a tier, an unselected *selectable* genre demotes; slug tags never demote; no demotion when the visitor chose Any | FR-019 |
| G8 | Every `reason` is either `null` or a sentence naming a labelled genre or provider — never a raw id, never a fragment | FR-003 |

## Worked example

Preferences: `mediaType = [movie]`, `genre = [horror, thriller]`,
`provider = [netflix]`, `includeUnownedProviders = false`.
History: `se7en` is `disliked`.

| Title | Type | Genres | On Netflix | Tier / within | Outcome |
|---|---|---|---|---|---|
| A | movie | horror, thriller | yes | 2 / 0 + 7.9 = **7.9** | rank 1 |
| B | movie | horror | yes | 1 / 0 + 7.1 = **7.1** | rank 2 |
| C | tv | horror | yes | — | dropped (filter 1) |
| D | movie | horror | no | — | dropped (filter 3) |
| E (se7en) | movie | thriller | yes | — | dropped (filter 4) |

Returned: `[A, B]`. If A and B sat in the same tier and scored identically, the
lower `id` would come first — every time, on every device.

## Deliberate non-goals

- **No personalization beyond the visitor's own ratings.** No collaborative
  filtering, no ML pipeline (constitution VI). The engine is explainable: every
  ranking decomposes into a tier and three terms a person can read.
- **No randomization or "discovery" injection.** Variety comes from the quiz
  preferences and the rating history, both of which the visitor controls.
- **No popularity-only fallback ordering.** The fallback path (FR-013) reuses
  this same function over cached titles; it does not switch to a different
  algorithm, so behavior stays predictable when degraded.
