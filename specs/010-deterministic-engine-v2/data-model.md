# Data Model: Deterministic Engine v2

**Feature**: 010-deterministic-engine-v2 | **Date**: 2026-10-24

This feature adds **no stored entity and no migration**. Everything it needs is
derived at ranking time, and the only persisted vocabulary that changes is the
closed set of reason codes (one new member). The record written by 009 — its
tables, columns, validation, and retention — is untouched.

## Derived: Taste profile

A view of the visitor's ratings, recomputed on every ranking call and never
stored or cached.

| Field | Type | Derivation | On no evidence |
|---|---|---|---|
| `genreWeights` | `Map<string, number>` | For every rated title in the catalog: each genre gains `+1` for a positive state (`loved`, `liked`, `wantToWatch`) or `−1` for a rejection (`disliked`, `notInterested`), summed across titles | Empty map |
| `positiveCount` | `number` | Number of positively rated titles | `0` |
| `eraCentre` | `number` (year) or `null` | Unweighted mean `releaseYear` of positively rated titles | `null` |
| `runtimeCentre` | `number` (minutes) or `null` | Unweighted mean `runtimeMinutes` of positively rated titles **that have one** | `null` |
| `runtimeEvidence` | `number` | How many of those titles carried a runtime | `0` |

Rules:

- `watchingNow` is neither positive nor a rejection (002's decision, D11).
- A rated title the catalog does not know contributes nothing — its genres and
  year cannot be inferred from an id.
- Duplicate genre tags on one title count once, per genre.

## Derived: Engine choice

| Value | Meaning | Engine version stamped on impressions |
|---|---|---|
| `v1` (default) | The incumbent, which kept the deck after the T013 fallback | `recommend-v1` |
| `v2` | The candidate, reachable through `?engine=v2` | `recommend-v2` |
| anything else | Treated as `v1`; an invalid override is not an error | `recommend-v1` |

## Vocabulary: Reason codes

The closed set stored in `RecommendationImpressions.ReasonCode` and validated by
the intake. One member is added; none are removed or renamed.

| Code | Meaning | Added |
|---|---|---|
| `genre-picked` | A genre the visitor picked in the quiz | 009 |
| `genre-affinity` | A genre the visitor's ratings point at | 009 |
| `service` | Available on a service they selected | 009 |
| `none` | No positive contribution; the card shows no reason | 009 |
| `era-affinity` | An era the visitor's ratings point at | **010** |

Rules:

- `none` exactly when no reason is shown (the correspondence 009 established).
- A code is emitted only when its feature contributed positively to that card.
- Runtime affinity has no code: it cannot be phrased honestly in one sentence,
  so it contributes silently.

## Vocabulary: Engine versions

| Version | Ranker | Role |
|---|---|---|
| `recommend-v1` | Incumbent | Serves the deck (the T013 fallback); the harness baseline forever |
| `recommend-v2` | Candidate | Measured by the harness, reachable on the deck through `?engine=v2` |
| `popularity-v1` | Baseline | Unchanged; still uses the fixed quality prior (D5) |

The version changes with any rule change that could reorder the deck (FR-012).
`RECOMMEND_ENGINE_VERSION` in `recommend.ts` names the default, which is v1
after the T013 fallback.

## Report shape: unchanged

009's `EvaluationReport`/`RankerReport` carry `name` and `engineVersion` per
row; this feature adds a row (`candidate-v2` / `recommend-v2`) and changes no
column and no measure. Two reports remain comparable exactly as 009 promised.
