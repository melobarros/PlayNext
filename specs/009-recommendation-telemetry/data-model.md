# Data Model: Recommendation Telemetry & Offline Evaluation

**Feature**: 009 | **Date**: 2026-10-24 | **Plan**: [plan.md](plan.md)

The persistent model is two append-only tables. The client-side model is a
bounded in-memory queue plus the identifiers needed to link an action to the
impression it answers. Nothing here is account state; nothing here is served
back to a visitor.

## Persistent model

### RecommendationImpression

One card displayed in one session. Table `RecommendationImpressions`.

| Column | CLR type | Postgres type | Constraints |
|---|---|---|---|
| `Id` | `long` | `bigint` | primary key, identity |
| `ClientEventId` | `Guid` | `uuid` | not null, unique |
| `SessionId` | `string` | `text` | not null, max 64 |
| `UserId` | `Guid?` | `uuid` | null when anonymous; no foreign key (see D4) |
| `TitleId` | `string` | `text` | not null, max 64 |
| `Surface` | `string` | `text` | not null, max 16; `deck` is the only value today |
| `Position` | `int` | `integer` | one-based; must be ≥ 1 |
| `EngineVersion` | `string` | `text` | not null, max 32; `recommend-v1` today |
| `CatalogVersion` | `DateTimeOffset` | `timestamptz` | the catalog payload's `fetchedAt` |
| `FilterHash` | `string` | `text` | not null, max 32; hex FNV-1a digest |
| `Score` | `double` | `double precision` | finite; the ranker's within-tier score |
| `ReasonCode` | `string` | `text` | not null, max 32; one of the four codes |
| `ShownAt` | `DateTimeOffset` | `timestamptz` | the client's clock |
| `ReceivedAt` | `DateTimeOffset` | `timestamptz` | the server's clock, set on insert |

Indexes:

- `IX_RecommendationImpressions_ClientEventId` — unique, the idempotency key.
- `IX_RecommendationImpressions_SessionId_ReceivedAt` — one session's history.
- `IX_RecommendationImpressions_UserId_ReceivedAt` — filtered
  `"UserId" IS NOT NULL`; one account's history.
- `IX_RecommendationImpressions_ReceivedAt` — the purge's scan.
- `IX_RecommendationImpressions_TitleId_ReceivedAt` — "what happened to this
  title", for analysis and for title-removal checks.

`UserId` is deliberately **not** a foreign key to the account table. Events are
an observation log, not account state: they must outlive a catalog purge, and a
future account-deletion feature must be able to decide between deleting and
anonymizing them without a cascade written today (research D4, spec FR-022).

### RecommendationAction

One visitor response to an impression. Table `RecommendationActions`.

| Column | CLR type | Postgres type | Constraints |
|---|---|---|---|
| `Id` | `long` | `bigint` | primary key, identity |
| `ClientEventId` | `Guid` | `uuid` | not null, unique |
| `ImpressionId` | `long` | `bigint` | not null, FK → `RecommendationImpressions.Id`, `ON DELETE CASCADE` |
| `Kind` | `string` | `text` | not null, max 16; see the vocabulary below |
| `DwellMs` | `int` | `integer` | 0–300 000 |
| `OccurredAt` | `DateTimeOffset` | `timestamptz` | the client's clock |
| `ReceivedAt` | `DateTimeOffset` | `timestamptz` | the server's clock |

Indexes:

- `IX_RecommendationActions_ClientEventId` — unique, the idempotency key.
- `IX_RecommendationActions_ImpressionId` — the FK's lookup, which is also the
  cascade's path.
- `IX_RecommendationActions_Kind_ReceivedAt` — aggregate analysis by kind.

### Action vocabulary

| Wire value | Deck trigger | Meaning |
|---|---|---|
| `liked` | rate **Liked It**, or swipe right | a positive verdict |
| `disliked` | rate **Disliked**, or swipe left | an explicit rejection |
| `skip` | **Skip** button | exposure without a verdict |
| `watch_now` | **Watch Now** | the loop stopped; a positive verdict |
| `undo` | **Undo** strip | reverses the last rating; the reversed action is kept |

The kind is stored as its wire value, converted through
`RecommendationActionKinds`, in the same way `InteractionState` is stored. The
intake rejects a value outside this set, so the "no free text" rule (FR-020) is
enforced by the schema's writer, not only by the client.

### Verification rules enforced at intake

The whole request is validated before anything is written (FR-009). A failure
returns 400 and writes nothing.

| Rule | Applies to |
|---|---|
| `ClientEventId` and `SessionId` non-empty ids | impressions and actions |
| `TitleId` non-empty, ≤ 64 | impressions |
| `Surface` ∈ `{deck}` | impressions |
| `Position` ≥ 1 | impressions |
| `EngineVersion` non-empty, ≤ 32 | impressions |
| `CatalogVersion` parses as an RFC 3339 timestamp | impressions |
| `FilterHash` non-empty, ≤ 32 | impressions |
| `Score` finite (`NaN`/∞ rejected) | impressions |
| `ReasonCode` ∈ `{genre-picked, genre-affinity, service, none}` | impressions |
| `Kind` ∈ the action vocabulary | actions |
| `DwellMs` 0–300 000 | actions |
| `OccurredAt` parses as an RFC 3339 timestamp | actions |
| No duplicate `ClientEventId` within the request, across both arrays | impressions and actions |
| At most 100 impressions and 200 actions | request |

An action whose `ImpressionClientEventId` matches neither an impression in the
batch nor one already stored is **not** a validation failure: it is skipped and
counted as unlinked (spec Edge Cases). The rest of the batch is stored.

### Idempotency and linking

- `ClientEventId` is generated by the client when the event is created, not
  when it is sent, so a retry carries the same id.
- The unique indexes make `INSERT … ON CONFLICT DO NOTHING` (or an equivalent
  conflict-tolerant insert) a no-op for a duplicate.
- Impressions are written before actions. An action's impression may be in the
  same batch or already stored; either resolves to the same `Id`.
- A second submission of the same batch stores zero new rows and returns the
  same counts with `duplicates` reflecting what was already present.

### Retention lifecycle

`RecommendationRetention` (Domain) owns the rule:

```text
Limit          = 90 days
Cutoff(now)    = now − Limit
IsExpired(at)  = at < Cutoff(now)      // exactly at the cutoff is kept
```

The purge selects expired impressions by `ReceivedAt` in batches of 5 000,
deletes them, and lets the cascade remove their actions. It repeats until a
batch deletes nothing. Only `RecommendationImpressions` and
`RecommendationActions` are touched; ratings, history, preferences, and
accounts are separate tables and are never referenced by this delete (FR-019).

### Privacy audit

The schema has no column for a name, email, IP address, device identifier, user
agent, precise location, or free text. The fields that could carry text
(`SessionId`, `TitleId`, `Surface`, `EngineVersion`, `FilterHash`,
`ReasonCode`, `Kind`) are bounded and, for the two enumerations, validated
against a closed vocabulary. The session id is a random UUID generated per tab;
the account id is the same `Guid` the API already uses, never an email or name.

## Client-side model

### TelemetrySession

- A random UUID v4 created when the tab starts, held under
  `playnext:telemetry-session` in **sessionStorage**, with an in-memory fallback
  when storage throws.
- Rotates when the tab closes. Never written to LocalStorage. Not derived from
  the account, device, or network.
- The same value is used for every event in the tab, including events recorded
  after sign-in.

### QueuedEvent

The service holds two ordered lists (impressions and actions) in memory, never
in browser storage:

```ts
interface QueuedImpression {
  clientEventId: string;      // random UUID, created here
  sessionId: string;
  titleId: string;
  surface: 'deck';
  position: number;
  engineVersion: string;
  catalogVersion: string;     // the catalog's fetchedAt
  filterHash: string;
  score: number;
  reasonCode: ReasonCode;
  shownAt: string;            // ISO
  shownAtMs: number;          // performance.now(), for dwell only
  anonymous: boolean;         // auth state at record time
}

interface QueuedAction {
  clientEventId: string;
  impressionClientEventId: string;
  kind: TelemetryActionKind;
  dwellMs: number;
  occurredAt: string;
  anonymous: boolean;
}
```

`anonymous` is captured at record time so a sign-in before the flush cannot
retroactively link earlier events (spec Edge Cases, Assumptions). A batch is
built only from consecutive events with the same `anonymous` value; anonymous
batches are sent without an `Authorization` header, signed-in batches with the
current access token when one is still available.

### Impression index

`Map<titleId, { clientEventId, shownAtMs }>` — the most recent impression of
each title in this tab. It is what lets an action (including an undo that
happens one card later) name the impression it answers without the deck
handling event ids. It is bounded by the number of distinct titles shown in the
tab and is cleared only when the tab ends.

### Flush policy

| Trigger | Behaviour |
|---|---|
| 20 events queued | flush immediately |
| 5 seconds since the first queued event | flush |
| Page becomes hidden | flush with `keepalive` |
| Sign-in | the existing anonymous run is flushed first; no token is attached to it |

- A failed flush (network error, 429, 5xx) is retried twice with backoff, then
  the batch is dropped and `lostBatches`/`lostEvents` are incremented.
- A 400 (validation) is permanent: the batch is dropped and counted, never
  retried.
- `inFlight` guards against two flushes racing; the next event after a flush
  schedules the next timer.
- The queue is capped at 500 events; beyond that the oldest are dropped and
  counted, so a broken intake cannot grow memory without bound (FR-010).

## Harness model

These types live beside the ranker, not in the application's runtime model.

### EvaluationFixture

```ts
interface EvaluationFixture {
  fixtureId: string;           // e.g. "personas-v1"
  catalogVersion: string;      // ISO timestamp matching the frozen catalog
  region: string;
  catalog: readonly MediaTitle[];
  sessions: readonly FixtureSession[];
}

interface FixtureSession {
  sessionId: string;
  preference: Preference;
  initialInteractions: Record<string, Interaction>;  // pre-existing ratings
  events: readonly FixtureEvent[];                    // temporal order
}

type FixtureEvent =
  | { type: 'impression'; titleId: string; shownAt: string }
  | { type: 'action'; titleId: string; kind: TelemetryActionKind; occurredAt: string };
```

### Replay state

Before each impression event the harness reconstructs:

- `interactions` — `initialInteractions` plus every prior action's effect:
  `liked`/`disliked` write that state, `watch_now` writes `watchingNow`,
  `skip` writes nothing, `undo` removes the state the action it answers wrote.
- `shownTitleIds` — titles the visitor has advanced past: every title with a
  prior `liked`, `disliked`, or `skip` action, minus titles restored by `undo`.
  A `watch_now` stops the session and does not add to the walk.
- `labels` — titles with a relevant action (like or watch-now) **after** the
  current impression in the same session.

`initialInteractions` are input state, not labels: a rated title is excluded
from the candidate pool by the deck's own eligibility rule, so counting it as a
label would make it unretrievable. The relevance definition in the spec is read
that way in the harness contract.

### Rankers

| Ranker | Definition |
|---|---|
| Incumbent | `rankTitles(catalog, preference, interactions, shownTitleIds)`, engine version `recommend-v1` |
| Popularity | The same eligible candidates ordered by the confidence-weighted rating `(v·R + 500·6.5) / (v + 500)`, ties by title id |
| Candidate | Any object implementing `Ranker`; the suite evaluates an inverted-order ranker as the deliberately worse candidate |

### Report

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
  report: readonly RankerReport[];   // incumbent and popularity always present
}
```

Coverage and diversity are computed over every impression's top-10, including
sessions with no relevant action. The four ranking-quality measures are computed
only over decisions with at least one label. All measures are in `[0, 1]`, and
every ordering has a title-id tie-breaker, so a fixture always produces the
same report.
