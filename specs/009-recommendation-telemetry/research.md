# Research: Recommendation Telemetry & Offline Evaluation

**Feature**: 009 | **Date**: 2026-10-24

Phase 0 decisions for the spec in [spec.md](spec.md). Each decision names the
alternatives it beat and the reason, so a later reader can tell a considered
choice from an accident.

## D1 — Events travel browser → PlayNext API → PostgreSQL

**Decision**: The deck records impressions and actions in the browser, batches
them, and posts them to PlayNext's own API. The server stores them in
PostgreSQL through EF Core. No third-party analytics service, tag manager, or
tracking script is introduced.

**Rationale**: Constitution IV makes the API the only path to persistent state,
and FR-021 repeats it for telemetry. A third party would also put visitor
behavior outside the retention rule this feature is built to honor, which is
the one thing a 90-day promise cannot survive.

**Alternatives considered**:

- A hosted analytics product — rejected: its retention and PII handling would
  not be ours to guarantee, and the product is explicitly non-commercial today.
- Server-side logging inferred from catalog requests — rejected: the catalog
  request does not say which card was shown, and ranking is client-side.

## D2 — Anonymous identity is a random per-tab session id

**Decision**: Introduce a random UUID v4 session identifier when the app starts
in a tab, held in `sessionStorage` under `playnext:telemetry-session` with an
in-memory fallback. It rotates when the tab closes and is never written to
LocalStorage or derived from the device, network, or account. Signed-in events
carry the account id **in addition**; the session id is never rewritten on
sign-in.

**Rationale**: The codebase has no guest identifier today — guest state is
LocalStorage documents with no owner. The spec assumed a rotating guest id
existed; planning found it does not. A per-tab random id satisfies the spec's
"random anonymous session identifier" without creating a persistent device
identifier, which FR-002 forbids. A tab is also the natural boundary for the
harness: one session is one deck visit, and two visits are two sessions.

**Alternatives considered**:

- A persistent UUID in LocalStorage — rejected: that is a device identifier by
  another name, and it would let the product recognize a visitor across days,
  which the spec rules out.
- Reusing `DeckSession.startedAt` — rejected: it is a timestamp shared by every
  visitor who started a loop in the same millisecond, and it identifies a loop,
  not a visit.
- A fingerprint (canvas, fonts, user agent) — rejected: prohibited by FR-002.

## D3 — One public batch endpoint with optional authentication

**Decision**: `POST /api/recommendations/events` accepts a batch of impressions
and actions. It is mapped without `RequireAuthorization`, so a guest can post;
when a valid bearer token is present, the events also carry the account id. A
missing or invalid token does not fail the request — the events are stored
anonymously.

**Rationale**: Constitutions III and IV require guest-first access and the
API as the write path. Optional authentication is how the endpoint joins the
account when there is one without turning telemetry into an account feature.
Rejecting an expired-token batch would lose the events for a signed-in visitor
whose token happened to lapse, which is exactly the fire-and-forget failure
mode FR-007 forbids.

**Alternatives considered**:

- `POST /api/me/sync` — rejected: it requires authentication, and telemetry is
  not account state. Mixing the two would make a guest's swipes depend on a
  session.
- One request per event — rejected: multiplies requests, wakes the server for
  every swipe, and makes the queue harder to bound.

## D4 — Two tables, client event ids, server receipt time

**Decision**: Store `RecommendationImpressions` and `RecommendationActions`,
each with a bigint identity key, a unique client-generated `ClientEventId`
(UUID), and both the client's time and the server's `ReceivedAt`. Actions
reference their impression; unlinked actions are rejected. Title ids and user
ids are stored as plain values, without foreign keys to the catalog or account
tables.

**Rationale**: The unique client event id is what makes a retried batch
idempotent (FR-008). Two times are needed because a phone with a wrong clock
must not be able to reorder history; replay uses `ReceivedAt` (D16). No
foreign keys because events are an observation log, not account state: a
catalog purge must not delete the record that a card was shown, and a future
account deletion can decide whether to delete or anonymize events (spec
FR-022). Referential integrity for the action→impression link is kept.

**Alternatives considered**:

- One table with a nullable action type — rejected: impressions outnumber
  actions, and the linked-action integrity would move into application code.
- An external event store — rejected: thousands of events a day do not justify
  the operational cost, and the constitution's stack is PostgreSQL.

## D5 — `catalogVersion` is the catalog payload's existing `fetchedAt`

**Decision**: Surface `fetchedAt` from the catalog response through the
`CatalogSource` seam and keep the last successful value on `CatalogService`.
Impressions record it as `catalogVersion`. No new server identifier is added to
the public contract.

**Rationale**: `fetchedAt` is already on the wire, immutable for a snapshot, and
identifies the exact catalog a deck was ranked from. The harness fixture is
frozen at a known `fetchedAt`, so a replay can select the matching catalog. A
new GUID field would duplicate an identifier that already exists.

**Alternatives considered**:

- A content hash of the title list — rejected: metadata changes (rating,
  availability) would not change the hash, so two different catalogs could
  share a version.
- A new `versionId` field — rejected: more contract surface for the same
  answer, and the normalized version id is an internal persistence detail.

## D6 — `engineVersion`, `score`, and `reasonCode` come from the ranker

**Decision**: Export `RECOMMEND_ENGINE_VERSION = 'recommend-v1'` beside
`rankTitles`. Extend `RankedTitle` with `score` (the within-tier score already
computed) and `reasonCode` (a small enum: `genre-picked`, `genre-affinity`,
`service`, `none`) while keeping the existing `reason` sentence. Ordering is
unchanged.

**Rationale**: The score and the reason are the ranker's own facts; deriving
them later in the deck would duplicate the engine and drift from it. The
reason code is needed because events must not carry free text (FR-020) — the
display sentence stays on the card, the code goes on the wire. Bumping the
constant is how a future ranker (feature 010) is distinguished from today's.

**Alternatives considered**:

- Parse the display sentence into a code — rejected: wording is a UI concern
  and would silently change the stored data.
- Store no score — rejected: the harness and position-bias analysis need the
  ranking's own numeric value, and it is free to expose.

## D7 — `filterHash` is a synchronous FNV-1a digest of the filter state

**Decision**: Compute a 64-bit FNV-1a hex digest over canonical JSON of the
region plus the normalized preference dimensions (media type, genre, provider,
`includeUnownedProviders`), with values sorted. Compute it once per deck load.

**Rationale**: The digest groups impressions taken under the same conditions
without sending the preference values themselves. A synchronous hash avoids
`crypto.subtle` (async, absent in some test environments) and keeps the flush
queue simple. It is a grouping key, not a security control, so a non-crypto
hash is sufficient and is documented as such.

**Alternatives considered**:

- SHA-256 via `crypto.subtle` — rejected: async hashing on every load adds a
  promise to a path that must never delay a card, for no security benefit.
- Send the raw filter state — rejected: duplicates account data in the event
  log and makes the retention surface larger than necessary.

## D8 — The client queue is in memory, bounded, and best-effort

**Decision**: Queue impressions and actions in memory; flush when 20 events
accumulate or 5 seconds pass. Retry a failed flush twice with backoff, then
drop and increment a failure counter. Flush on `visibilitychange` with a
`keepalive` fetch. Never write queued events to LocalStorage or sessionStorage.
Use the current access token when signed in.

**Rationale**: FR-006 forbids blocking a swipe, and FR-007 requires a bounded,
invisible failure. A memory-only queue means the 90-day retention rule has one
storage surface to govern, not two. `keepalive` gives the page-hide flush a
chance without a persistence layer. Dropping after the retry budget keeps a
broken endpoint from growing memory without limit.

**Alternatives considered**:

- Persist the queue in LocalStorage and drain on next visit — rejected: it
  creates a second copy of behavioral data with no retention job, and the spec
  explicitly chose "a lost tail is counted, not persisted".
- `navigator.sendBeacon` for every flush — rejected: it cannot carry the
  bearer header, so signed-in events would lose their account link; it is only
  a candidate for the anonymous page-hide case, and `fetch keepalive` covers
  both.

## D9 — The harness lives in TypeScript beside the ranker

**Decision**: Put the evaluation harness under
`frontend/src/app/features/deck/deck-logic/evaluation/`, importing the same
`rankTitles` the deck uses. Its fixture and metric functions run in the
existing frontend test suite. A small `npm run eval` script filters the suite
to the harness for on-demand runs if the Angular test builder supports
`--include`; otherwise the whole suite is the command.

**Rationale**: Ranking is client-side today and the constitution forbids a
second implementation of the same behavior. A backend harness would have to
port `rankTitles` to C#, creating the exact drift the parity harness exists to
prevent. The frontend suite already runs in CI on every push.

**Alternatives considered**:

- A .NET harness over server-side ranking — rejected until ranking moves
  server-side (a later feature); today it would measure a function the deck
  does not use.
- A standalone Python notebook — rejected: not part of the CI gate, and a
  second language to maintain.

## D10 — Temporal replay uses only the session's past

**Decision**: For each session, process its impressions in `ReceivedAt` order.
At each impression, rank the frozen catalog with the preference stored in the
fixture and the actions that occurred before that impression; `shownTitleIds`
is the titles of prior impressions in that loop. The session's later relevant
actions are the labels. Sessions with no relevant action contribute to
coverage and diversity but not to ranking-quality measures.

**Rationale**: This is the only protocol that does not let the ranker see the
future it is being scored on. Excluding positive-less sessions from NDCG/MRR
prevents a hundred unjudged sessions from diluting the mean toward zero while
still letting them count where they can be measured.

**Alternatives considered**:

- One ranking per session against all positives — rejected: a ranking made
  before the visitor's first decision would be scored against decisions made
  much later, which rewards luck over adaptation.
- Random train/test split — rejected: there is no model to train in this
  feature; the harness compares deterministic rankers.

## D11 — Metric definitions

**Decision**:

| Measure | Definition |
|---|---|
| NDCG@10 | Binary relevance (relevant = 1, otherwise 0), DCG over the top 10 divided by the ideal DCG for the session's relevant set, averaged over evaluated decisions. |
| MRR | Mean over evaluated decisions of `1 / rank` of the first relevant title in the top 10, or 0 when none appears. |
| Hit rate@10 | Share of evaluated decisions whose top 10 contains at least one relevant title. |
| Precision@10 | Mean over evaluated decisions of relevant titles in the top 10 divided by 10. |
| Coverage | Distinct titles appearing in any top 10, divided by distinct scorable titles in the frozen catalog. |
| Intra-list diversity | `1 − mean pairwise Jaccard similarity of genre sets` within each top 10, averaged over lists with at least two titles. |

**Rationale**: Binary relevance keeps the labels honest — the deck's positives
are likes and watch-nows, and a skip is not a negative. The six measures answer
different questions (ordering quality, first-hit quality, hit rate, precision,
reach, variety), which is why one number cannot stand in for them.

**Alternatives considered**:

- Graded NDCG using rating strength — rejected for v1: it would need a weight
  per action that the product has not defined; binary is auditable.
- Diversity via embedding distance — rejected: no embeddings in this feature.

## D12 — Fixtures are synthetic and committed

**Decision**: Commit a small frozen catalog and persona sessions under
`frontend/src/app/features/deck/deck-logic/evaluation/fixtures/`. The fixture
schema records the catalog `fetchedAt`, titles with genres and ratings, and per
session: a preference, an ordered event log, and the actions. A real captured
fixture may be added later only if it contains no personal data; it is not
required for CI.

**Rationale**: CI cannot depend on production traffic, and the synthetic
personas from the research (horror fan, prestige drama, family animation,
sci-fi explorer) exercise gross errors before real data exists. Committing them
makes the harness reproducible on a fresh clone.

**Alternatives considered**:

- Gitignored real fixtures, like the parity harness — rejected here: the
  harness is a required CI gate, and a gate that skips when fixtures are absent
  is not a gate.

## D13 — CI runs the harness with the existing frontend suite

**Decision**: The harness is a spec in the frontend test suite, which
`.github/workflows/deploy.yml` already runs with `npx ng test --watch=false` on
every push to `main`. The spec prints a compact report table. Local on-demand
runs use the same command, narrowed with the builder's include option if
available.

**Rationale**: FR-016 asks for a run whenever ranking logic changes; running on
every push is a strict superset and needs no new workflow or path filter that
could silently stop matching after a rename. The report lands in the Actions
log with the run.

**Alternatives considered**:

- A path-filtered job — rejected: a renamed file silently stops triggering it,
  which is a gate that quietly stops gating.
- Nightly only — rejected: a regression would be found a day late.

## D14 — Retention is a hosted purge, batched, 90 days

**Decision**: A `RecommendationRetentionService` background service runs at
startup and every 24 hours. It deletes impressions whose `ReceivedAt` is older
than 90 days in batches (5,000 rows), with actions removed by cascade. The
cutoff comes from a domain constant, `RecommendationRetention.Days = 90`.

**Rationale**: The deck must not depend on the catalog refresh schedule, and a
daily hosted timer runs on F1 without extra infrastructure. Batching keeps a
purge from holding a long lock on a free-tier database.

**Alternatives considered**:

- Piggyback on the catalog refresh — rejected: it couples two unrelated
  lifecycles, and a paused catalog refresh would silently pause retention.
- `pg_cron` — rejected: extra database configuration the app cannot ship as a
  migration.

## D15 — Privacy boundaries

**Decision**: The tables contain no name, email, IP address, user agent, device
identifier, or free text. Request bodies are never logged. The rate limiter may
partition on the connection's remote address transiently, but stores nothing
about it. Unknown JSON fields are ignored rather than stored.

**Rationale**: FR-020 and SC-007 make "no PII" an auditable property, and the
strongest enforcement is a schema that has nowhere to put it. Rate limiting is
the one place an address is read; it is not persisted, and the alternatives
(a session id in the body) are spoofable and would make the limiter useless.

**Alternatives considered**:

- Hash the IP for rate limiting — rejected: a hash is still a device-adjacent
  identifier, and the in-memory limiter does not need one.

## D16 — Time semantics

**Decision**: Impressions carry the client's `shownAt`; actions carry
`occurredAt` and a client-computed `dwellMs` capped at 300,000 ms; the server
sets `ReceivedAt` on insert. Replay and purging order by `ReceivedAt`.

**Rationale**: Client time is the only time that knows when the card appeared,
and server time is the only time that is comparable across devices. Keeping
both lets analysis choose. The cap keeps a tab left open overnight from
recording a dwell that means nothing.

**Alternatives considered**:

- Server-computed dwell — rejected: the server never sees the impression and
  the action in the same request, so it would need per-session state.
- Client time only — rejected: one wrong clock would reorder a session.
