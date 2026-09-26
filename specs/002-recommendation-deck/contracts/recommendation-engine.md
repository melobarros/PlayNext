# Contract: Recommendation Engine (pure ranking function)

**Owner**: feature 002 (recommendation deck) | **Consumers**: 002 (deck loop,
empty-state detection); the Milestone 2 backend reimplements it in the Domain
layer | **Date**: 2026-09-26

`rankTitles` is the product's core asset and the reason the deck is trustworthy.
It is specified as a **pure function** so that two constitution invariants can be
proven by tests rather than argued about, and so FR-011's reproducibility is a
property of the design instead of a hope.

It has no Angular, DOM, clock, or network dependency — it is testable with plain
TypeScript, exactly like spec 001's `quiz-rules.ts`.

## Signature

```ts
function rankTitles(
  catalog: readonly MediaTitle[],
  preferences: Preference,          // spec 001's completed Preference
  interactions: Readonly<Record<string, Interaction>>,
  shownTitleIds: readonly string[], // the current loop's already-advanced-past ids
): MediaTitle[]
```

Returns the eligible titles, best first. Never mutates its inputs. Never throws
on malformed input — a title that cannot be scored is filtered out, not fatal.

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

## Stage 2 — Score (weighted, explainable)

```
score(title) = 10 × matchedGenres
             +  6 × historyAffinity(title)
             +      weightedRating(title)
```

**`matchedGenres`** = `|title.genres ∩ preferences.genre.values|`, or `0` when
the visitor chose Any. Plain overlap: more of what they asked for ranks higher.

**`historyAffinity(title)`** — the feedback loop's positive/negative signal,
derived from the visitor's own ratings:

```
lovedGenres    = ⋃ genres of titles rated loved | liked | wantToWatch
dislikedGenres = ⋃ genres of titles rated disliked | notInterested
historyAffinity(t) = |t.genres ∩ lovedGenres| − |t.genres ∩ dislikedGenres|
```

This may be negative — a title wearing genres the visitor has rejected sinks.
Disliked *titles* are already gone (filter 4); this is how the visitor's taste
generalizes past the specific titles they rejected.

**`weightedRating(title)`** — quality, confidence-weighted so a lone 10.0 from
three votes cannot top the deck:

```
weightedRating(t) = (t.rating × t.voteCount + 6.5 × 500) / (t.voteCount + 500)
```

The prior (6.5 over 500 votes) pulls low-evidence titles toward the middle. The
formula is standard, explainable to a stakeholder, and computed identically
every time.

## Stage 3 — Total order (the determinism guarantee)

Sort by `score` descending; break ties by `title.id` ascending.

The id tiebreak is what makes FR-011 real. Without it the sequence would depend
on `Array.prototype.sort` stability and on the order the catalog happened to
arrive in — so the same preferences could produce a different deck on a
different device or after a catalog reshuffle. **There is no randomness
anywhere in this function**, and that is a deliberate product decision
(constitution VI), not a limitation: a new loop feels fresh because the
visitor's own ratings have changed the scores, not because a dice roll did.

## Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| G1 | No returned title is unavailable on the selected services, unless `includeUnownedProviders` | FR-006, Principle V invariant |
| G2 | No returned title is currently `disliked` or `notInterested` | FR-009, Principle V invariant |
| G3 | Equal inputs ⇒ identical output array, element for element | FR-011, SC-005 |
| G4 | Inputs are never mutated; the caller's arrays are unchanged | — |
| G5 | An empty result is a normal value, never an error | FR-014 (empty state) |

## Worked example

Preferences: `mediaType = [movie]`, `genre = [horror, thriller]`,
`provider = [netflix]`, `includeUnownedProviders = false`.
History: `se7en` is `disliked`.

| Title | Type | Genres | On Netflix | Score | Outcome |
|---|---|---|---|---|---|
| A | movie | horror, thriller | yes | 10×2 + 6×0 + 7.9 = **27.9** | rank 1 |
| B | movie | horror | yes | 10×1 + 6×0 + 7.1 = **17.1** | rank 2 |
| C | tv | horror | yes | — | dropped (filter 1) |
| D | movie | horror | no | — | dropped (filter 3) |
| E (se7en) | movie | thriller | yes | — | dropped (filter 4) |

Returned: `[A, B]`. If A and B scored identically, the lower `id` would come
first — every time, on every device.

## Deliberate non-goals

- **No personalization beyond the visitor's own ratings.** No collaborative
  filtering, no ML pipeline (constitution VI). The engine is explainable: every
  score decomposes into three terms a person can read.
- **No randomization or "discovery" injection.** Variety comes from the quiz
  preferences and the rating history, both of which the visitor controls.
- **No popularity-only fallback ordering.** The fallback path (FR-013) reuses
  this same function over cached titles; it does not switch to a different
  algorithm, so behavior stays predictable when degraded.
