# Contract: Offline Evaluation Harness

**Feature**: 009 | **Date**: 2026-10-24 | **Model**: [data-model.md](../data-model.md)

The harness is an engineering tool, not an endpoint. This contract fixes the
fixture shape, the ranker interface, the replay order, and the meaning of every
reported number, so two reports can be compared without reading the code that
produced them.

## Location and command

```text
frontend/src/app/features/deck/deck-logic/evaluation/
├── types.ts              # fixture, ranker, report types
├── metrics.ts            # the six measures
├── rankers.ts            # incumbent, popularity, candidate helpers
├── replay.ts             # temporal replay and evaluation
├── report.ts             # the printed table
├── fixtures/personas.ts  # frozen catalog + synthetic sessions
└── harness.spec.ts       # the CI entry point
```

| Purpose | Command |
|---|---|
| Full suite, as CI runs it | `npx ng test --watch=false` |
| Harness only, on demand | `npx ng test --watch=false --include='src/app/features/deck/deck-logic/evaluation/**/*.spec.ts'` |

The fixture is committed, so a fresh clone can run the harness with no capture
step. The full suite is the CI gate because it is a superset of "run whenever
ranking logic changes"; no path filter is involved, so renaming a ranking file
cannot silently stop the gate.

## Fixture

```ts
interface EvaluationFixture {
  fixtureId: string;
  catalogVersion: string;      // ISO timestamp, frozen
  region: string;
  catalog: readonly MediaTitle[];
  sessions: readonly FixtureSession[];
}

interface FixtureSession {
  sessionId: string;
  preference: Preference;
  initialInteractions: Record<string, Interaction>;
  events: readonly FixtureEvent[];
}

type FixtureEvent =
  | { type: 'impression'; titleId: string; shownAt: string }
  | { type: 'action'; titleId: string; kind: TelemetryActionKind; occurredAt: string };
```

Rules:

- Events are listed in the order they happened. `shownAt` and `occurredAt`
  increase within a session.
- A title may be impressed more than once (an undo restored it); each
  impression is a separate decision.
- The catalog contains only titles the rankers can score (a rating and a
  positive vote count). A title without genres is allowed; its genre set is
  empty for the diversity measure.
- The persona fixture is synthetic and contains no personal data. A captured
  fixture, if one is ever added, must meet the same rule.

The committed fixture is `personas-v1`: four personas (horror, prestige drama,
family animation, science fiction), each with a preference, 20–40 impressions,
and a mix of actions including at least one undo and one watch-now. A session
without a relevant action is included on purpose so coverage and diversity can
be shown to survive it.

## Ranker interface

```ts
interface RankerInput {
  catalog: readonly MediaTitle[];
  preference: Preference;
  interactions: Readonly<Record<string, Interaction>>;
  shownTitleIds: readonly string[];
}

interface Ranker {
  readonly name: string;
  readonly engineVersion: string;
  rank(input: RankerInput): readonly MediaTitle[];
}
```

- The incumbent wraps `rankTitles` and reports `recommend-v1`.
- The popularity baseline uses the same eligible candidates and orders them by
  `(v·R + 500·6.5) / (v + 500)` descending, ties by title id. It is
  personalized only by the eligibility rules, never by the visitor's ratings.
- A candidate is any implementation. The suite includes an inverted-order
  ranker as the deliberately worse candidate, so the report can be shown to
  separate a good ordering from a bad one.

`rank` must be pure: no clock, no network, no randomness, and a total
tie-breaker.

## Replay

For each session, process `events` in order. At each impression:

1. Build `interactions` from `initialInteractions` and every prior action:
   - `liked` → `{ state: 'liked', updatedAt: occurredAt }`
   - `disliked` → `{ state: 'disliked', updatedAt: occurredAt }`
   - `watch_now` → `{ state: 'watchingNow', updatedAt: occurredAt }`
   - `skip` → no entry
   - `undo` → remove the entry the answered action wrote, restoring any prior
     state for that title.
2. Build `shownTitleIds`: every title with a prior `liked`, `disliked`, or
   `skip` action, minus titles restored by an `undo`, in the order they left
   the deck. A `watch_now` ends the session and does not add to the walk.
3. Compute `labels`: titles with a `liked` or `watch_now` action later in the
   same session. `initialInteractions` are input state, not labels, because a
   rated title is excluded from the candidate pool and could never be
   retrieved.
4. Call `ranker.rank(...)` and take the first 10 titles.

A decision is **evaluated** when it has at least one label. A session with no
relevant action contributes no evaluated decisions but its top-10 lists still
count toward coverage and diversity.

## Measures

All averages are unweighted across evaluated decisions. Every measure is in
`[0, 1]`.

| Measure | Formula |
|---|---|
| NDCG@10 | `DCG / IDCG`, where `DCG = Σ_{i=1..10} rel_i / log2(i+1)` and `IDCG = Σ_{i=1..min(|labels|,10)} 1 / log2(i+1)`; binary relevance |
| MRR | mean of `1 / rank` of the first relevant title in the top 10, or `0` |
| Hit rate@10 | share of evaluated decisions with at least one relevant title in the top 10 |
| Precision@10 | mean of `(relevant titles in the top 10) / 10` |
| Coverage | distinct titles in any top-10 / distinct title ids in the fixture catalog |
| Intra-list diversity | `1 − mean pairwise Jaccard(genres_i, genres_j)` over each top-10 with ≥ 2 titles, averaged over those lists |

`rel_i` is 1 when the title at rank `i` is in the label set, otherwise 0. An
unordered pair has `Jaccard = |A ∩ B| / |A ∪ B|`, and two empty genre sets
count as `Jaccard = 1` (a list of genre-less titles is maximally similar).

## Report

```ts
interface RankerReport {
  name: string;
  engineVersion: string;
  ndcgAt10: number;
  mrr: number;
  hitRateAt10: number;
  precisionAt10: number;
  coverage: number;
  intraListDiversity: number;
  evaluatedDecisions: number;
  sessions: number;
}

interface EvaluationReport {
  fixtureId: string;
  catalogVersion: string;
  report: readonly RankerReport[]; // incumbent and popularity always present
}
```

The run prints a markdown table, one row per ranker, under a caption naming the
fixture and catalog version it describes:

```text
fixture personas-v1 · catalog 2026-09-30T00:00:00.000Z

| Ranker | NDCG@10 | MRR | Hit@10 | Precision@10 | Coverage | Diversity | Decisions |
|---|---|---|---|---|---|---|---|
| incumbent recommend-v1 | 0.812 | 0.744 | 0.930 | 0.221 | 0.315 | 0.684 | 86 |
| popularity popularity-v1 | 0.694 | 0.611 | 0.860 | 0.184 | 0.142 | 0.622 | 86 |
| candidate-inverted candidate-inverted-v1 | 0.201 | 0.180 | 0.410 | 0.041 | 0.310 | 0.690 | 86 |
```

The caption is not decoration: a pasted log that omits it invites comparing two
runs over different catalogs. The table itself is printed by
`npm run eval`, which passes `--reporters=verbose` — the builder's default
reporter swallows test console output.

`evaluate()` always adds the incumbent and the popularity baseline, even when
the caller only asked for a candidate. The report carries `fixtureId` and
`catalogVersion` so two runs can be shown to describe the same frozen data.

## Determinism

- The fixture is generated by code, not by a live capture, and committed.
- No ranker reads the clock or a random source.
- Every comparator ends with a title-id tie-break.
- Coverage and diversity iterate impressions in fixture order and title ids in
  sorted order.

The suite asserts that two evaluations of the same fixture produce deep-equal
reports, that the candidate report contains the incumbent and the popularity
rows, that all measures lie in `[0, 1]`, and that hand-computed metric examples
match exactly.
