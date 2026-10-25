# Contract: Ranking Engine v2

**Feature**: 010-deterministic-engine-v2 | **Date**: 2026-10-24

The contract between the deck and the ranker. It supersedes nothing in
`specs/002-recommendation-deck/contracts/recommendation-engine.md` except the
scoring rule — eligibility, determinism, and the reason's role stay as they
were — and it extends
`specs/009-recommendation-telemetry/contracts/evaluation-harness.md` with one
more ranker.

## Inputs

```ts
rankTitles(
  catalog: readonly MediaTitle[],
  preferences: Preference,
  interactions: Readonly<Record<string, Interaction>>,
  shownTitleIds: readonly string[],
  engine: EngineChoice = DEFAULT_ENGINE,   // 'v1'
): RankedTitle[]
```

`RankedTitle` is unchanged from 009: `MediaTitle` plus `score`, `reason`
(nullable sentence), and `reasonCode` (the closed vocabulary).

The inputs are the same five the incumbent uses. No clock, no network, no
randomness, no cached profile (FR-001, FR-002).

## Eligibility (unchanged, shared by both engines)

A title is a candidate only when all six hold:

1. It is scorable (string id, finite rating/votes, votes ≥ 0).
2. Media type matches the preference, unless `mediaType.any`.
3. At least one selected genre matches, unless `genre.any`.
4. It is on a selected service (through the retired-provider successor map),
   unless `provider.any` or `includeUnownedProviders`.
5. It has no recorded interaction — presence excludes (Feedback Loop).
6. It is not in `shownTitleIds` (this loop).

Both engines call the same function. A harness comparison therefore measures
ordering, never eligibility (D1), and the constitution's two invariants hold for
v2 exactly as for v1 (SC-005).

## Scoring — v2

Each candidate receives one number; the deck is sorted by it, descending, with
the title-id tiebreak last.

```
score = GENRE_MATCH_WEIGHT      × matchedGenres
      + HISTORY_WEIGHT          × normalizedAffinity
      − MISMATCH_PENALTY        × mismatchedGenres
      + SERVICE_WEIGHT          × onSelectedService
      + ERA_WEIGHT              × eraFit
      + RUNTIME_WEIGHT          × runtimeFit
      + calibratedQuality
```

| Term | Rule | Starting value |
|---|---|---|
| `GENRE_MATCH_WEIGHT` | Count of the visitor's selected genres the title matches; `0` under `genre.any` | `4` |
| `HISTORY_WEIGHT` | Profile genre weights summed over the title's distinct genres, divided by its distinct-genre count | `6` |
| `MISMATCH_PENALTY` | Count of the quiz's selectable genres the title wears that the visitor did not pick; `0` under `genre.any` | `10` |
| `SERVICE_WEIGHT` | `1` when the title is on a selected service (successor-aware), else `0` | `1` |
| `ERA_WEIGHT` | `max(0, 1 − |releaseYear − eraCentre| / 20)`; `0` when `positiveCount < 3` | `2.5` |
| `RUNTIME_WEIGHT` | `max(0, 1 − |runtimeMinutes − runtimeCentre| / 45)`; `0` when fewer than 3 positives carry a runtime | `1.5` |
| `calibratedQuality` | `(rating·votes + μ·m) / (votes + m)`, where `μ` = mean rating and `m` = mean vote count of the scorable catalog | — |

All arithmetic is `+ − × ÷` and `Math.max` over doubles — no `log`, `sqrt`,
`exp`, or `pow` (D3). Weights are named constants in one module; changing one
is a code change that bumps the engine version and requires a harness run.

### Cold start

With `positiveCount = 0`, `normalizedAffinity = 0`, `eraFit = 0`, and
`runtimeFit = 0`. The order is then genre match (or none under `any`), mismatch,
service, and quality — never an error, never an empty deck (FR-014).

## Diversity re-rank (MMR)

After sorting:

1. Take the top `MMR_WINDOW = 50` candidates. If fewer exist, take all.
2. `r_i = (score_i − min) / (max − min)` over the window; all `1` when
   `max = min`.
3. `sim(i, j) = |G_i ∩ G_j| / |G_i ∪ G_j|` over genre sets; `0` when both are
   empty.
4. Pick greedily: first the highest `r` (tie → original order); then
   `argmax(λ·r_i − (1 − λ)·max_{j∈picked} sim(i, j))` with `λ = MMR_LAMBDA`
   (0.75), ties broken by original order.
5. Append the candidates beyond the window in score order.

Deterministic by construction: no floating-point special cases, ties always
fall back to a total order (SC-003).

## Reasons

Precedence, first whose contribution is **positive**:

| Order | Code | Sentence | Requires |
|---|---|---|---|
| 1 | `genre-picked` | "Because you picked {genre}" | `matchedGenres > 0` under a real selection, and a label exists |
| 2 | `genre-affinity` | "Because you loved {genre}" | `normalizedAffinity > 0`, and a label exists |
| 3 | `era-affinity` | "Because you loved {decade}s titles" | `eraFit > 0` |
| 4 | `service` | "On {service}, one of your services" | `SERVICE_WEIGHT` term is `1`, and a label exists |
| 5 | `none` | (no reason shown) | — |

Rules: every branch needs a positive contribution (FR-010); an unknown id never
reaches the card (label lookups guard every branch); `none` exactly when no
reason is shown. Runtime never speaks (FR-007).

The era sentence names the decade (`Math.floor(year / 10) * 10`) of the card's
own release year, not of the centre — the card explains itself.

## Engine selection

`EngineChoice = 'v1' | 'v2'`. The deck resolves it once from `?engine=`:

| Query value | Engine | `engineVersion` recorded |
|---|---|---|
| absent | `v1` | `recommend-v1` |
| `v1` | `v1` | `recommend-v1` |
| `v2` | `v2` | `recommend-v2` |
| anything else | `v1` | `recommend-v1` |

The absence of `v2` from the default row is the T013 fallback: the measured
candidate did not clear SC-001, and the spec clarification of 2026-10-24 says a
candidate that cannot does not become the default. `v2` stays selectable by name
and reported by the harness.

The version recorded on an impression is the engine that produced the card
(FR-012), so the rollout's like-rate comparison (SC-008) reads stored rows.

## Harness integration

`rankers.ts` after this feature:

| Name | Version | Wraps |
|---|---|---|
| `incumbent` | `recommend-v1` | v1 |
| `popularity` | `popularity-v1` | fixed-prior quality order over the shared pool |
| `candidate-v2` | `recommend-v2` | v2 |
| `candidate-inverted` | `candidate-inverted-v1` | v1 reversed (a deliberately bad control) |

The fixture is not edited (D9). The report shows one more row and no new
column.
