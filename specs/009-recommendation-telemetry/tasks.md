# Tasks: Recommendation Telemetry & Offline Evaluation

**Input**: Design documents from `specs/009-recommendation-telemetry/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included. The constitution makes tests first-class for the
recommendation path, and every acceptance scenario in the spec is testable.
Write the test task first in each phase and confirm it fails before implementing.

**Organization**: Tasks are grouped by user story. US1 (recording), US2
(harness), and US3 (retention) each deliver an independently testable
increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, or US3 for story phases only
- Every task names the exact file path it touches

## Path Conventions

Web application: `backend/` and `frontend/` at the repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the green baseline before touching anything.

- [X] T001 [P] From `backend/`, run `dotnet test PlayNext.sln` and record the passing baseline (test count and any pre-existing skips). Do not change code.
- [X] T002 [P] From `frontend/`, run `npx ng test --watch=false` and record the passing baseline. Do not change code.

**Checkpoint**: Both suites are green and the baseline is recorded.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Entities, vocabulary, migration, contracts, validator, and the
client-side seams every story needs.

**⚠️ CRITICAL**: No user story work starts until this phase is complete.

### Backend domain and persistence

- [X] T003 [P] Write failing tests in `backend/tests/PlayNext.Domain.Tests/RecommendationRetentionTests.cs`: `Limit` is `TimeSpan.FromDays(90)`; `Cutoff(now)` is `now - Limit`; `IsExpired` is true at 91 days, false at 89 days, and **false exactly at the cutoff (kept)**; `RecommendationActionKinds.TryParse` accepts `liked`, `disliked`, `skip`, `watch_now`, `undo` and rejects `loved`, `Liked`, `watch-now`, and the empty string.
- [X] T004 [P] Create `backend/src/PlayNext.Domain/RecommendationActionKinds.cs`: the closed wire vocabulary (`liked`, `disliked`, `skip`, `watch_now`, `undo`), `ToWire`, and `TryParse`, mirroring `InteractionState.cs`'s style. No framework references.
- [X] T005 [P] Create `backend/src/PlayNext.Domain/RecommendationImpression.cs` and `backend/src/PlayNext.Domain/RecommendationAction.cs` with the fields in data-model.md §Persistent model: `Id`, `ClientEventId` (Guid), `SessionId`, `UserId` (Guid?), `TitleId`, `Surface`, `Position`, `EngineVersion`, `CatalogVersion` (DateTimeOffset), `FilterHash`, `Score` (double), `ReasonCode`, `ShownAt`, `ReceivedAt`, and the `Actions` navigation; `RecommendationAction` has `Id`, `ClientEventId`, `ImpressionId`, `Impression`, `Kind`, `DwellMs`, `OccurredAt`, `ReceivedAt`. Plain classes, no attributes.
- [X] T006 Create `backend/src/PlayNext.Domain/RecommendationRetention.cs` with `Limit = TimeSpan.FromDays(90)`, `Cutoff(DateTimeOffset now)`, and `IsExpired(DateTimeOffset at, DateTimeOffset now)`; make T003 pass.
- [X] T007 Add `DbSet<RecommendationImpression> RecommendationImpressions` and `DbSet<RecommendationAction> RecommendationActions` to `backend/src/PlayNext.Infrastructure/Persistence/AppDbContext.cs`, plus a `ConfigureRecommendationTelemetry(builder)` method: keys; `ClientEventId` unique; `SessionId` max 64; `TitleId` max 64; `Surface` max 16 required; `EngineVersion` max 32; `FilterHash` max 32; `ReasonCode` max 32; `Kind` max 16; indexes `(SessionId, ReceivedAt)`, `(UserId, ReceivedAt)` filtered `"UserId" IS NOT NULL`, `(ReceivedAt)`, `(TitleId, ReceivedAt)`; action FK → impression with `DeleteBehavior.Cascade`; **no** FK for `UserId` or `TitleId`.
- [X] T008 Generate the EF migration `RecommendationTelemetry` in `backend/src/PlayNext.Infrastructure/Persistence/Migrations/` with `dotnet ef migrations add RecommendationTelemetry --project src/PlayNext.Infrastructure --startup-project src/PlayNext.Api` (run from `backend/`); inspect it for both tables, the unique `ClientEventId` indexes, the filtered user index, and the cascade FK.
- [X] T009 [P] Write failing validator tests in `backend/tests/PlayNext.Application.Tests/RecommendationEventValidatorTests.cs` for every row of data-model.md §Verification rules: empty `ClientEventId`/`SessionId`/`TitleId`; `Position = 0`; unknown `Surface`; unparseable `CatalogVersion`; `NaN`/infinite `Score`; `ReasonCode = "free text"`; `Kind = "loved"`; `DwellMs = -1` and `300001` rejected while `0` and `300000` pass; duplicate `ClientEventId` across the two arrays; 101 impressions; 201 actions; an empty batch passes; and more than 10 failures yields exactly 10 error strings.
- [X] T010 Create `backend/src/PlayNext.Application/Contracts/RecommendationEventsContracts.cs`: `RecommendationEventBatch(Impressions, Actions)`, `RecommendationImpressionInput`, `RecommendationActionInput`, and `RecommendationEventOutcome` with `AcceptedImpressions`, `AcceptedActions`, `Duplicates`, `Unlinked` (response shape in contracts/recommendation-events.md).
- [X] T011 Create `backend/src/PlayNext.Application/Validation/RecommendationEventValidator.cs`; return an ordered `IReadOnlyList<string>` of field-level errors (max 10), each naming the field and the rule but never echoing a value; make T009 pass.
- [X] T012 [P] Create `backend/src/PlayNext.Application/Interfaces/IRecommendationEventStore.cs` (`Task<RecommendationEventOutcome> RecordAsync(RecommendationEventBatch batch, Guid? userId, DateTimeOffset receivedAt, CancellationToken ct)`) and `IRecommendationIntakeLimiter.cs` (`bool TryAcquire(string sessionId, int eventCount, DateTimeOffset now, out int retryAfterSeconds)`).

### Frontend seams

- [X] T013 [P] Extend `frontend/src/app/features/deck/deck-logic/recommend.spec.ts` with failing tests: `RECOMMEND_ENGINE_VERSION === 'recommend-v1'`; every result has a finite `score`; `reasonCode` is one of `genre-picked`/`genre-affinity`/`service`/`none` and is `none` exactly when `reason` is null; the ranked id order is unchanged from a captured baseline array; `eligibleTitles(...)` returns exactly the ids `rankTitles(...)` returns.
- [X] T014 Modify `frontend/src/app/features/deck/deck-logic/recommend.ts`: export `RECOMMEND_ENGINE_VERSION = 'recommend-v1'`, the `ReasonCode` type, and `eligibleTitles(catalog, preferences, interactions, shownTitleIds)`; add `score` (the existing `within` value) and `reasonCode` (the branch that produced `reason`) to `RankedTitle`; keep the comparator, the inputs, and the ordering byte-identical. Make T013 pass.
- [X] T015 [P] Write failing tests for the catalog version seam (`frontend/src/app/core/services/catalog.service.spec.ts` or the existing source spec): a successful load exposes `fetchedAt` as `catalogVersion()`; a cache hit keeps the same value; the value is `null` before the first successful load; a failed load does not overwrite the last value.
- [X] T016 Modify `frontend/src/app/core/services/http-catalog-source.ts` and `frontend/src/app/core/services/catalog.service.ts` so the wire `fetchedAt` survives the mapping to `MediaTitle[]` and is exposed as a `catalogVersion` signal, cached alongside the titles per query. Make T015 pass.
- [X] T017 [P] Write failing tests in `frontend/src/app/core/telemetry/telemetry-session.spec.ts`: the id is a UUID v4; repeated calls in one tab return the same value; the value is read from and written to `sessionStorage` under `playnext:telemetry-session`; LocalStorage is never touched; when `sessionStorage` throws the id is generated and reused in memory.
- [X] T018 Create `frontend/src/app/core/telemetry/telemetry-session.ts`; make T017 pass.
- [X] T019 [P] Write failing tests in `frontend/src/app/core/telemetry/filter-digest.spec.ts`: identical preferences in different array order produce the same 16-hex-char digest; changing region, media type, genre, provider, or `includeUnownedProviders` changes it; `any: true` differs from `any: false`; the digest contains no raw preference value.
- [X] T020 Create `frontend/src/app/core/telemetry/filter-digest.ts`: 64-bit FNV-1a over canonical JSON of `{region, mediaType, genre, provider, includeUnownedProviders}` with sorted values; make T019 pass.
- [X] T021 Create `frontend/src/app/core/models/telemetry.ts` with the wire types from contracts/recommendation-events.md: `TelemetryActionKind`, `ReasonCode`, `TelemetrySurface`, `ImpressionEvent`, `ActionEvent`, `TelemetryBatch`, and the response type.

**Checkpoint**: Domain, migration, validation, contracts, ranker fields, catalog
version, session id, and digest all exist and their tests pass.

---

## Phase 3: User Story 1 — Every card shown is on the record (Priority: P1) 🎯 MVP

**Goal**: A guest or signed-in visitor's displayed cards and actions are
recorded, linked, idempotent, anonymous by default, and never affect the deck.

**Independent Test**: Walk a scripted 20-card session with every action kind;
every card has one impression, every action links to its impression, the undo
keeps the original action, a duplicate batch stores nothing new, an unlinked
action is counted, and stopping the API changes neither the cards nor the
visible UI.

### Tests for US1

- [X] T022 [P] [US1] Write failing integration tests in `backend/tests/PlayNext.Api.IntegrationTests/RecommendationEventTests.cs` using `IClassFixture<AuthApiFactory>`: a guest batch returns 202 and stores one impression and one action linked by `ImpressionId`; an action whose impression is absent returns `unlinked: 1` and stores no action; submitting the same batch twice returns 202 with `accepted` zero and does not grow either table; `position: 0`, `kind: "loved"`, `reasonCode: "free"`, and `surface: "watchlist"` each return 400 with zero rows; 101 impressions returns 413 with zero rows; a valid bearer stores `UserId`; an invalid bearer returns 202 with `UserId` null; the response never contains a token or session id; the tables have no column named like a name/email/ip/user-agent field.
- [X] T023 [P] [US1] Write failing tests in `frontend/src/app/core/telemetry/recommendation-telemetry.spec.ts` with a fake transport: 20 events flush as one batch; 5 seconds flushes a smaller queue; a network failure retries twice then drops and increments `lostBatches`/`lostEvents`; a 400 is not retried; the queue is capped at 500 and the oldest are dropped and counted; dwell is measured from the impression and capped at 300 000 ms; an undo links to the earlier impression's `clientEventId`; an anonymous run is sent without `Authorization` even after a sign-in, and a later signed-in run sends the bearer; `sessionStorage`/LocalStorage contain no queued event.
- [X] T024 [P] [US1] Extend `frontend/src/app/features/deck/deck.spec.ts`: a scripted 20-card walk records exactly one impression per displayed card with the right title, one-based position, `recommend-v1`, catalog version, digest, score, and reason code; a card restored by undo is recorded again at its original position; each like/dislike/skip/watch-now/undo links to the card it answers; with the transport set to fail, the rendered card sequence and order are identical, no error is rendered, and the failure counter grows.
- [X] T025 [P] [US1] Write failing tests in `backend/tests/PlayNext.Application.Tests/RecordRecommendationEventsUseCaseTests.cs` and `backend/tests/PlayNext.Application.Tests/RecommendationIntakeLimiterTests.cs`: an invalid batch never calls the store; a rejected limit returns a retry-after and never calls the store; a valid batch passes the account id and a single `receivedAt`; an empty batch is a no-op; the limiter allows 20 requests and 600 events per minute per session and resets after the window with a fake `TimeProvider`.

### Implementation for US1

- [X] T026 [US1] Create `backend/src/PlayNext.Infrastructure/Persistence/RecommendationEventStore.cs`: one transaction; read existing impression ids by `ClientEventId`; insert missing impressions; resolve action targets from the batch or the store; insert non-duplicate actions; skip and count unlinked; count duplicates; tolerate a unique-index race by retrying the batch once. Make T022's storage cases pass.
- [X] T027 [US1] Create `backend/src/PlayNext.Application/UseCases/RecommendationIntakeLimiter.cs` (singleton, `ConcurrentDictionary` of fixed windows, 20 requests and 600 events per minute per session, prunes expired windows); make T025's limiter cases pass.
- [X] T028 [US1] Create `backend/src/PlayNext.Application/UseCases/RecordRecommendationEventsUseCase.cs`: validate → limit → store; empty batch short-circuits with zero counts; pass `userId` and `receivedAt`; return the outcome. Make T025's use-case cases pass.
- [X] T029 [US1] Create `backend/src/PlayNext.Api/Endpoints/RecommendationEndpoints.cs`: `POST /api/recommendations/events` mapped **without** `RequireAuthorization`; read `CurrentUser.Id(http)` for the optional account; 202 on success; 400 `invalid-payload` with the validator's errors; 413 `payload-too-large` over 100/200 or 256 KB; 429 `rate-limited` with `Retry-After`; never log the body. Use the existing `ErrorResponse`.
- [X] T030 [US1] Wire the feature in `backend/src/PlayNext.Api/Program.cs`: register `IRecommendationEventStore`, `IRecommendationIntakeLimiter` (singleton), `RecordRecommendationEventsUseCase`, and `MapRecommendationEndpoints()` before the `/api/{**rest}` fallback; confirm `UseAuthentication()` already precedes it so a valid bearer arrives as `CurrentUser`.
- [X] T031 [US1] Create `frontend/src/app/core/telemetry/telemetry-transport.ts`: a `TelemetryTransport` interface (`send(batch, accessToken, keepalive)`), and `HttpTelemetryTransport` using `fetch('/api/recommendations/events', { method: 'POST', keepalive, headers })`; attach `Authorization: Bearer` only when a token is supplied; swallow nothing (the service decides retries).
- [X] T032 [US1] Create `frontend/src/app/core/telemetry/recommendation-telemetry.ts`: the in-memory queue, `recordImpression`, `recordAction`, impression index, dwell calculation, flush at 20/5 s/visibility, retry twice with backoff, permanent-drop on 400/413, 500-event cap, counters (`lostBatches`, `lostEvents`, `unlinkedActions`), per-event `anonymous` partitioning, and token lookup from `AuthService.accessToken()`. Make T023 pass.
- [X] T033 [US1] Wire the deck in `frontend/src/app/features/deck/deck.ts`: inject the telemetry service; add an effect that reads `session()` and `card()` and records one impression whenever the session object identity changes and a card is present (this records the initial card, each advance, and a re-shown card after undo, but not a re-render caused by a catalog refresh); compute `filterHash` once per load from the region and preference; pass `catalogVersion()`; skip and count an impression when the version is null; call `recordAction` from `skip` (`skip`), `onRating` (`liked`/`disliked`), `onWatchNow` (`watch_now`), and `undo` (`undo` against the undone title). Make T024 pass.
- [X] T034 [US1] Add the action-kind mapping helper in `frontend/src/app/features/deck/deck.ts` or `deck-logic/recommend.ts` so `InteractionState.liked/disliked` map to the wire kinds and no other state can be recorded from the deck.
- [X] T035 [US1] Run the US1 tests: `dotnet test backend/tests/PlayNext.Api.IntegrationTests --filter "FullyQualifiedName~Recommendation"`, `dotnet test backend/tests/PlayNext.Application.Tests`, and `npx ng test --watch=false` from `frontend/`. Fix until green.
- [X] T036 [US1] Update `specs/009-recommendation-telemetry/spec.md` or plan.md if implementation revealed a mismatch (as the guest-id and label-definition corrections did); keep the documents truthful.
  - Reviewed FR-001–FR-011 and US1 scenarios 1–7 against the shipped code and tests: no mismatch, so no document changed. Every scenario has a test that asserts it — positions and the re-shown card (deck.spec), the action→impression link, the surviving original action, and `UserId` null for a guest (RecommendationEventTests), the digest and `recommend-v1` (deck.spec), the counters and the invisible failure (recommendation-telemetry.spec + deck.spec).
  - The one divergence is inventory, not behaviour: the domain vocabularies landed as `RecommendationReasonCodes.cs` and `RecommendationActionKinds.cs`, which plan.md's file list did not name. Recorded here; folded into plan.md in the T064 truth pass rather than as a late US1 edit.
- [X] T037 [US1] Validate quickstart scenarios 2, 3, and 4 manually where the environment allows; record the outcome in the task notes.
  - **Scenario 3 — proved end to end over real HTTP.** API run with `dotnet run --project src/PlayNext.Api --launch-profile http` on `http://localhost:5003`; four batches POSTed to `/api/recommendations/events`:
    1. A valid 1-impression + 1-action batch → `202 {"accepted":{"impressions":1,"actions":1},"duplicates":0,"unlinked":0}`.
    2. The same batch again → `202 {"accepted":{"impressions":0,"actions":0},"duplicates":2,"unlinked":0}` — the unique index, not client bookkeeping.
    3. `position: 0`, `surface: "watchlist"`, `reasonCode: "free"`, `kind: "loved"` → `400 invalid-payload` with four errors, each naming a field and a rule and echoing no submitted value.
    4. An action naming an unknown impression → `202 {"impressions":0,"actions":0}.unlinked: 1`, nothing written.
  - **Scenarios 2 and 4 — covered by the integration suite instead of a manual SQL walk.** `psql` is not installed on this machine and the connection string is in user secrets, so the browser walk plus `SELECT` was not performed. Every row-level fact those scenarios list is asserted against the same local PostgreSQL by `RecommendationEventTests` (15 gated tests, all passing): guest row with `UserId` null and one `SessionId`; a valid bearer setting `UserId`; an invalid bearer ignored; title, position, `recommend-v1`, catalog version, 16-char filter hash, score and reason code on the row; the action's server-assigned `ImpressionId`; and both tables' rows counted before and after a rejected or duplicate batch. The one-impression-per-card, one-based position, and undo re-record claims are asserted in `deck.spec.ts`.
  - Scenario 5 (retention) is not yet reachable — it is US3 and lands at T062.

**Checkpoint**: US1 is fully functional and testable on its own; the harness and
purge are not required to record events.

---

## Phase 4: User Story 2 — Any ranking change can be compared offline (Priority: P2)

**Goal**: A deterministic harness reports the six measures for the incumbent,
the popularity baseline, and a candidate on a frozen fixture, in CI.

**Independent Test**: Run the harness twice on the committed fixture; the two
reports are deep-equal, contain all three rankers, and every measure is in
`[0, 1]`. Hand-computed metric examples match exactly.

### Tests for US2

- [X] T038 [P] [US2] Write failing tests in `frontend/src/app/features/deck/deck-logic/evaluation/metrics.spec.ts`: NDCG@10 for a known relevance vector; IDCG for 1 and 12 labels; NDCG = 0 when the top 10 has no relevant title; MRR of 1, 1/3, and 0; hit and precision on a mixed list; coverage with a 60-title catalog and a small top-10 union; diversity for disjoint genres (1), identical genres (0), overlapping sets (computed value), two empty sets (1), and a one-title list (excluded); averaging over decisions excludes unlabeled decisions from the four ranking measures.
  - Expectations are written as arithmetic on `Math.log2`, never as decimal literals: a literal would be a second, silently rounded statement of the rule, so a transposed digit in the test could agree with a wrong constant in the implementation and with nobody else.
  - One expectation was wrong and was corrected against the contract, not the code: "a label ranked outside the top ten" was asserted as 1. `IDCG@10` counts every label (only the `DCG` truncates), so a label ranked eleventh still raises the ideal and the honest value is `1 / (1 + 1/log₂3)`.
- [X] T039 [P] [US2] Write failing tests in `frontend/src/app/features/deck/deck-logic/evaluation/replay.spec.ts` on a tiny inline fixture: interactions and shown ids at each impression are exactly the prior actions' effects; an undo restores the state before the answered action; `watch_now` ends the session's walk; labels are later likes/watch-nows only; two replays of the same fixture are deep-equal.
  - The tests assert on a recording ranker's *inputs*, not on scores: the replay's job is to hand each ranker the state a real deck would have, and the only way to see it without exporting the replay's internals is to capture it.
  - Two of my own expectations were wrong and were fixed in the tests: the like that answers an impression *is* a label for that impression (it is a later event), and an `inputs` index was one off — `inputs[1]` holds the state before the second impression, not after the undo.
- [X] T040 [P] [US2] Write failing fixture-invariant tests in `frontend/src/app/features/deck/deck-logic/evaluation/fixtures/personas.spec.ts`: exactly four personas; each has at least 20 impressions; at least one undo and one watch-now overall; at least one session with no relevant action; every event's `titleId` resolves in the frozen catalog; timestamps increase within a session; the catalog has at least 40 distinct titles and at least 6 genres.
  - One invariant beyond the list: every impression in a persona's walk is a card its *own* preference admits, checked against `eligibleTitles` on the arrival state. A fixture whose deck could not have been drawn silently stops measuring the ranker and starts measuring an invented deck.
- [X] T041 [P] [US2] Write failing report tests in `frontend/src/app/features/deck/deck-logic/evaluation/harness.spec.ts`: `evaluate(fixture, candidate)` includes rows named `incumbent`, `popularity`, and the candidate; all six measures are in `[0, 1]`; the report carries `fixtureId` and `catalogVersion`; `formatReport` prints one row per ranker; two evaluations are deep-equal; the inverted candidate's NDCG@10 is lower than the incumbent's on `personas-v1`.
  - Two cases added: evaluating the incumbent as the candidate still yields exactly two rows (deduplicated by name), and a fixture of only the label-free session reports `evaluatedDecisions: 0` with a non-zero coverage — the contract's "no evaluated decisions, but the lists still count".

### Implementation for US2

- [X] T042 [P] [US2] Create `frontend/src/app/features/deck/deck-logic/evaluation/types.ts` with the fixture, ranker, and report types from contracts/evaluation-harness.md.
- [X] T043 [P] [US2] Create `frontend/src/app/features/deck/deck-logic/evaluation/metrics.ts` with `ndcgAt10`, `reciprocalRank`, `hitAt10`, `precisionAt10`, `coverage`, and `intraListDiversity`; make T038 pass.
- [X] T044 [P] [US2] Create `frontend/src/app/features/deck/deck-logic/evaluation/rankers.ts`: `incumbentRanker` (wraps `rankTitles`, version `recommend-v1`), `popularityRanker` (eligible candidates by `(v·R + 500·6.5)/(v + 500)`, ties by id), and `invertedRanker` for tests; make T041's ranker cases pass.
  - The baseline asks the shipped `eligibleTitles` for its pool instead of restating the filters, and calls the shipped `weightedRating` instead of restating the confidence term, so a report always compares orderings and never filters, and neither rule can drift from the one the deck runs.
- [X] T045 [US2] Create `frontend/src/app/features/deck/deck-logic/evaluation/replay.ts`: rebuild interactions/shown/labels per contract, call each ranker, collect top-10 lists and decisions, and return the reports with coverage/diversity over all lists; make T039 pass.
  - Undo needed one thing the contract states but does not spell out. "Restoring any prior state" is reachable only when the visitor arrived with a rating and the session re-rated and undid it — so each title carries a stack of the states its actions replaced (`null` when there was none), and a `skip` pushes onto it too, so undoing a skip can never pop a rating's entry.
  - The walk stops just past the first `watch_now` while that event still counts as a label for every impression before it, which is the literal reading of "a `watch_now` ends the session".
- [X] T046 [P] [US2] Create `frontend/src/app/features/deck/deck-logic/evaluation/report.ts` with `formatReport(report): string` (markdown table; fixed column order and three-decimal formatting); make T041's format case pass.
  - The first cell is `name engineVersion`, as the contract's example already showed: `incumbent` will be `recommend-v2` one day, and two tables must not look alike across that line.
  - A caption line above the table names the fixture and catalog version, so a pasted log says which frozen data produced it. The contract's example was updated in T052.
- [X] T047 [US2] Create `frontend/src/app/features/deck/deck-logic/evaluation/fixtures/personas.ts`: `personas-v1`, a deterministic 40–60-title catalog built from fixed arrays in the nine quiz genres and the quiz providers, with ratings and vote counts; four synthetic sessions (horror, prestige drama, family animation, science fiction) of 20–40 impressions each, with likes, dislikes, skips, at least one undo, at least one watch-now, and one session with no relevant action; all ids resolve; no real visitor data. Make T040 pass.
  - 54 titles: six per quiz genre, each carrying a second genre so a persona selecting four genres has one-match and two-match titles to be right and wrong about. Availability rotates four of the eleven quiz providers per title; all links are `example.invalid`.
  - Each persona selects four genres with `mediaType: any` and either `provider: any` or "include other platforms": at 54 titles, a narrower preference leaves less than a twenty-card walk needs, and a report that mostly measured an emptying pool would say nothing about ordering. The availability and media-type filters are covered exhaustively by `recommend.spec.ts`.
  - The four walks are built through a tiny `Walk` builder that advances a fixed clock, so the events read as `card`/`shown`/`acted` rather than as twenty hand-written ISO timestamps. Every persona has exactly 20 impressions; three end in a like or a Watch Now; `persona-science-fiction` has none, on purpose.
- [X] T048 [US2] Create the remaining harness test in `frontend/src/app/features/deck/deck-logic/evaluation/harness.spec.ts`: run `evaluate` on `personas-v1` with the inverted candidate, assert determinism and all three rankers, and print `formatReport` to the console; make T041 pass.
  - Printing needed one discovery: the Angular unit-test builder's default reporter swallows `console.log`, so the table is invisible under a plain `ng test` even though the test passes. T049's script passes `--reporters=verbose`, which is what puts the numbers in the log.
- [X] T049 [P] [US2] Add `"eval": "ng test --watch=false --include=src/app/features/deck/deck-logic/evaluation/**/*.spec.ts"` to `frontend/package.json` scripts; confirm the path matches what the builder accepts.
  - Added as `ng test --watch=false --reporters=verbose --include=src/app/...` (see T048), with no quotes around the glob: npm runs scripts through `cmd.exe` on Windows, where single quotes would become part of the pattern. The builder's own include handling expands `**/*.spec.ts`.
- [X] T050 [US2] Run `npm run eval` from `frontend/`; confirm the report table prints and the run is under 60 seconds.
  - 49 tests in 2.6 s. Printed: `incumbent recommend-v1` NDCG@10 0.675 / MRR 0.625 / hit 1.000 / precision 0.380 / coverage 0.667 / diversity 0.691; `popularity popularity-v1` 0.285 / 0.388 / 0.917 / 0.140 / 0.333 / 0.849; `candidate-inverted` 0.000 across the ranking measures with 0.852 coverage — the last row is why coverage alone is never a quality signal, and why the six measures are read together.
- [X] T051 [US2] Run the full `npx ng test --watch=false`; confirm the harness runs inside it (this is the CI gate; `.github/workflows/deploy.yml` already runs this command on every push, so no workflow change is needed).
  - 870 passed, 299 skipped, 47 files passed and 1 skipped, 6.3 s. The skips are the pre-existing parity-fixture suites, which skip when the local-only fixtures are absent; the harness's 49 tests all ran. CI needed no change: the full suite is a superset of "run whenever ranking logic changes", so renaming a ranking file cannot slip past the gate.
- [X] T052 [US2] If the printed report or fixture shape differs from contracts/evaluation-harness.md, update the contract so the documentation matches the shipped harness.
  - Two differences, both mine to reconcile. The printed table gained a caption line naming `fixtureId` and `catalogVersion` — the contract kept those fields in the report but never showed them being read, and a pasted log without them invites comparing two different catalogs. The example rows now spell out `popularity popularity-v1` and `candidate-inverted candidate-inverted-v1` as the shipped format prints them, and the section records that the table is printed by `npm run eval` with `--reporters=verbose`. No fixture or metric shape changed.

**Checkpoint**: The harness is deterministic, reports all six measures for all
three rankers, and is part of the suite CI already runs.

---

## Phase 5: User Story 3 — The record is anonymous, minimal, and temporary (Priority: P3)

**Goal**: Raw events older than 90 days are purged at startup and daily,
without touching any other table, and the schema proves no PII.

**Independent Test**: Seed impressions and actions at 91, 90, and 89 days of
age, run the purge, and confirm only the 91-day rows are gone; seed a user
rating and preference and confirm they survive; inspect the schema for
prohibited fields.

### Tests for US3

- [X] T053 [P] [US3] Write failing integration tests in `backend/tests/PlayNext.Api.IntegrationTests/RecommendationRetentionTests.cs`: with two impressions 91 days old and 89 days old (plus actions), running the purge deletes the older impression and its action by cascade, keeps the younger pair, and deletes nothing else; an impression exactly at the cutoff is kept; a user interaction and a preference seeded alongside are unchanged; a second purge deletes nothing; the two tables expose no name/email/ip/user-agent/location/free-text column.
      - Five gated tests, all against the real test database. The cascade is asserted by row id, not assumed from the model: the expired action is gone after only the impression's delete ran.
      - `A_second_purge_deletes_nothing` first failed (`Assert.True(PurgeAsync(cutoff) >= 1)`): xUnit runs classes in parallel, and every started `WebApplicationFactory` host now launches the retention service, whose startup pass deleted the seeded 92-day-old row before the explicit purge ran. Fixed by asserting the row's fate instead of the count — the count is a race between two purges and both are the product working.
      - The boundary test uses a synthetic future cutoff so no concurrent host's startup pass (cutoff ≈ now − 90 days) can reach the row being kept.
      - `The_startup_pass_purges_without_being_asked` starts its own `AuthApiFactory` and polls for up to 30 s: it is the one test that proves the hosted service is registered *and* runs its pass at start, not merely that a purge method works when called.
      - The forbidden-column list in `RecommendationEventTests` was extended to `name, email, password, phone, address, agent, ip, location, country` to match quickstart scenario 6.
- [X] T054 [P] [US3] Write failing unit tests in `backend/tests/PlayNext.Application.Tests/PurgeRecommendationEventsUseCaseTests.cs`: the use case passes `ReceivedAt < now - 90 days` as the cutoff to the store; it uses `TimeProvider.GetUtcNow`; a store failure propagates (the hosted service, not the use case, decides to log and continue).
      - A `FixedTime : TimeProvider` pins the clock; a `RecordingStore` captures cutoff, token and calls. Four tests: the cutoff is `Now - 90 days`, the count reaches the caller, the caller's token is passed through, and a store exception propagates (the use case does not swallow it).

### Implementation for US3

- [X] T055 [US3] Create `backend/src/PlayNext.Application/Interfaces/IRecommendationRetentionStore.cs` (`Task<int> PurgeAsync(DateTimeOffset cutoff, CancellationToken ct)` returning the number of impressions deleted).
- [X] T056 [US3] Create `backend/src/PlayNext.Infrastructure/Persistence/RecommendationRetentionStore.cs`: select up to 5 000 expired impression ids ordered by `ReceivedAt`, `ExecuteDeleteAsync` on those ids, repeat until zero; the cascade removes actions; the only tables touched are the two telemetry tables.
      - `BatchSize = 5_000`, ids ordered by `ReceivedAt` then `Id`; the loop ends on `ids.Count == 0` or a short batch. No cross-batch transaction: a pass that dies midway leaves the rest for the next one, which is the same promise the service makes about failures.
- [X] T057 [US3] Create `backend/src/PlayNext.Application/UseCases/PurgeRecommendationEventsUseCase.cs`: compute `RecommendationRetention.Cutoff(time.GetUtcNow())` and call the store; make T054 pass.
- [X] T058 [US3] Create `backend/src/PlayNext.Infrastructure/Telemetry/RecommendationRetentionService.cs`: a `BackgroundService` that runs one purge immediately, then every 24 hours with `PeriodicTimer`; catches per-pass exceptions and logs only the exception type/message (no session ids, titles, or bodies); stops cleanly on cancellation.
      - `Interval` is `public static readonly` so a later test can reason about it; the catch is inside the pass, so one bad night does not stop the loop; cancellation rethrows to end it. Only `exception.GetType().Name` and `exception.Message` reach the logger — the exception object itself is never passed, because its SQL carries parameter values.
- [X] T059 [US3] Register `IRecommendationRetentionStore`, `PurgeRecommendationEventsUseCase`, and `AddHostedService<RecommendationRetentionService>()` in `backend/src/PlayNext.Api/Program.cs`.
- [X] T060 [US3] Run `dotnet test backend/tests/PlayNext.Api.IntegrationTests --filter "FullyQualifiedName~Recommendation"` and the Application tests; make T053 pass.
      - Recommendation-filtered integration suite: **20 passed, 0 failed**. Application suite: **171 passed**. Full integration suite: **128 passed, 0 failed, 0 skipped**.
- [X] T061 [US3] Validate quickstart scenarios 5 and 6 (retention drill and privacy audit); record the outcome.
      - **Scenario 5 (retention drill)** — evidence is the five gated tests, which exercise the same SQL the drill runs: 91 days deleted (impression *and* action by cascade), 89 days kept, exactly 90 days kept, a second pass finds nothing, and interactions/preferences survive. The manual `psql` variant was not run because `psql` is not installed on this machine; the assertions go through the same Npgsql server, which is the stronger check anyway.
      - **Scenario 6 (privacy audit)** — `The_tables_hold_no_field_that_could_identify_a_person` runs the quickstart's `information_schema.columns` query against the real schema and rejects any column whose name contains `name`, `email`, `password`, `phone`, `address`, `agent`, `ip`, `location` or `country`. The only visitor references are `SessionId` and the nullable `UserId`, as the scenario expects.
- [X] T062 [US3] Confirm the purge is registered before the app starts serving and that a purge failure cannot fail startup (the service logs and the app remains available).
      - `The_startup_pass_purges_without_being_asked` proves the registration and the start pass. `ExecuteAsync` catches per pass, so an exception never reaches the host's startup path; `BackgroundService` does not block readiness, and all 128 integration tests start hosts with the service registered and none of them waits on a purge.

**Checkpoint**: All three stories are independently functional and the 90-day
promise is enforced by code and test.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T063 Run `dotnet test backend/PlayNext.sln`; all green, no skipped tests introduced.
      - Domain **211 passed**, Application **171 passed**, API integration **129 passed** — 511 tests, 0 failed, 0 skipped. The five retention tests and the strengthened schema test are inside the 129.
- [X] T064 Run `npx ng test --watch=false` from `frontend/`; all green, including the harness.
      - **47 files passed, 1 skipped; 870 tests passed, 299 skipped, 0 failed.** The skipped items are the suites that were already platform-gated before this feature; the count is unchanged from T051.
- [X] T065 Run `npx ng build` from `frontend/`; the production build succeeds with no new warnings.
      - Build completes; no warnings, no budget errors. Initial total 298.72 kB raw / 79.48 kB transfer.
- [X] T066 Run quickstart scenarios 7 and 8; record the harness table and the final suite results.
      - **Scenario 7** — `npm run eval` prints, on every run and byte-identically:
        ```
        fixture personas-v1 · catalog 2026-09-30T00:00:00.000Z

        | Ranker | NDCG@10 | MRR | Hit@10 | Precision@10 | Coverage | Diversity | Decisions |
        |---|---|---|---|---|---|---|---|
        | incumbent recommend-v1 | 0.675 | 0.625 | 1.000 | 0.380 | 0.667 | 0.691 | 60 |
        | popularity popularity-v1 | 0.285 | 0.388 | 0.917 | 0.140 | 0.333 | 0.849 | 60 |
        | candidate-inverted candidate-inverted-v1 | 0.000 | 0.000 | 0.000 | 0.000 | 0.852 | 0.742 | 60 |
        ```
        The third row is the point of the harness: it scores 0 on every relevance measure while *leading* on coverage — a deliberate demonstration that coverage alone is not quality.
      - **Scenario 8** — the three commands in T063–T065 are exactly this scenario's checklist, and all three are green.
- [X] T067 Review the new intake and retention logging: no request body, session id, title id, token, or account id is logged; confirm the existing credential rules are untouched.
      - The intake path logs nothing at all: the endpoint, validator, limiter, use case and store contain no logger. A refused or failed batch is visible only as counters in the 202 body.
      - The retention service is the feature's only logger, and it records the deleted count or `exception.GetType().Name` plus `exception.Message`; the exception object is never passed, so its SQL and parameter values cannot ride along.
      - The client telemetry service writes nothing to `console`; failures are counted in the service's counters, not shown.
      - `Program.cs` changes are additive (usings, service registrations, one `Map…Endpoints` call); no authentication, authorization, or credential-reading code was modified.
- [X] T068 Review the diff for dead code, commented-out blocks, TODO/FIXME without an issue reference, and pattern drift (one repository pattern, one use-case pattern, no new package). Confirm no new NuGet/npm dependency was added.
      - No TODO/FIXME/HACK/XXX in any new file, and no commented-out code. Every new type is referenced from production or test code.
      - No `.csproj`/`.props`/`.targets` changed; `package.json` gains only the `eval` script. No new NuGet or npm dependency.
      - The new slice follows the existing shapes: interface in `Application/Interfaces`, EF implementation in `Infrastructure/Persistence`, orchestrating use case in `Application/UseCases`, thin endpoint in `Api/Endpoints`.
- [X] T069 Update the spec/plan/contracts if any implementation detail diverged; mark every task in this file `[X]` and produce the completion summary.
      - `plan.md`'s file tree was reconciled with what shipped: `RecommendationReasonCodes.cs` and `IRecommendationRetentionStore.cs` added, the four Application test files listed, and the frontend harness specs and fixtures named.
      - Both vocabularies and the four reason codes match `data-model.md` and `contracts/recommendation-events.md`; the evaluation contract was already reconciled in T052.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; blocks all stories.
- **US1 (Phase 3)**: depends on Foundational; delivers the MVP.
- **US2 (Phase 4)**: depends on Foundational (not on US1); can run in parallel with US1 if staffed.
- **US3 (Phase 5)**: depends on Foundational; can run in parallel with US1 once the entities and migration exist.
- **Polish (Phase 6)**: depends on all three stories.

### Story dependencies

- **US1**: none beyond Foundational.
- **US2**: needs T014 (ranker fields) but not the intake or the queue.
- **US3**: needs T005/T007/T008 (entities and migration) but not the intake.

### Within each story

Tests first and failing; models before services; services before endpoints;
core before integration. A later story never edits a file the earlier story is
still using without re-running that story's tests.

### Parallel opportunities

- T001/T002, T003/T004/T005, T009, T012, T013/T015/T017/T019.
- US2's T038–T042 and T043/T044/T046 are independent files once types exist.
- US3's T053/T054 are independent test files.

---

## Parallel Example: US2

```text
# After T042 (types):
Task: "Create metrics.ts with the six measures"
Task: "Create rankers.ts with incumbent and popularity"
Task: "Create report.ts with formatReport"
# After those:
Task: "Create replay.ts and make the replay tests pass"
Task: "Create fixtures/personas.ts and make the invariant tests pass"
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Complete Setup and Foundational.
2. Complete US1: the intake, queue, and deck hooks.
3. Stop and validate: 20-card session recorded, duplicate batch idempotent,
   intake down changes nothing.

### Incremental delivery

1. US1 → record is live.
2. US2 → the record becomes decisions; the harness joins CI.
3. US3 → the retention promise is enforced and audited.
4. Polish → full suites, build, quickstart.

### Notes

- `[P]` means different files and no dependency on an incomplete task.
- The harness lives in the frontend because the ranker does; porting it to C#
  would create a second implementation of the same scoring (research D9).
- No task changes the ranker's ordering. If a task appears to require it, the
  task is wrong; stop and re-read Constitution VI.
