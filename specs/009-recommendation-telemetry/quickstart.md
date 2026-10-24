# Quickstart: Recommendation Telemetry & Offline Evaluation

**Feature**: 009 | **Date**: 2026-10-24

Runnable checks that prove the feature works end to end. Each scenario names
its expected outcome; the contracts hold the field-level detail.

- Event intake: [contracts/recommendation-events.md](contracts/recommendation-events.md)
- Tables and replay: [data-model.md](data-model.md)
- Harness: [contracts/evaluation-harness.md](contracts/evaluation-harness.md)

## Prerequisites

- .NET 10 SDK, Node 22+, and the local PostgreSQL used by the other features.
- The API's connection string and JWT signing key are already configured in
  user secrets or the environment — this guide never asks you to print them.
- `backend/` dependencies restored; `frontend/` dependencies installed.

## 1. Apply the migration and start the apps

From `backend/`:

```powershell
dotnet ef database update --project src/PlayNext.Infrastructure --startup-project src/PlayNext.Api
dotnet run --project src/PlayNext.Api
```

From `frontend/`, in a second terminal:

```powershell
npm start
```

Expected: the API starts, the frontend serves the deck, and the two new tables
exist. Check with:

```sql
\d "RecommendationImpressions"
\d "RecommendationActions"
```

## 2. A guest session is recorded

1. Open the app in a fresh tab, complete the quiz, and walk at least 20 cards
   using Liked It, Disliked, Skip, Watch Now, and at least one Undo.
2. Wait up to five seconds after the last action for the queue to flush (the
   page-hide flush also runs if you switch tabs).
3. Query the record:

```sql
SELECT count(*) AS impressions FROM "RecommendationImpressions";
SELECT count(*) AS actions FROM "RecommendationActions";
SELECT i."TitleId", i."Position", i."EngineVersion", i."ReasonCode", i."Score",
       a."Kind", a."DwellMs"
FROM "RecommendationImpressions" i
LEFT JOIN "RecommendationActions" a ON a."ImpressionId" = i."Id"
ORDER BY i."ReceivedAt" DESC
LIMIT 20;
```

Expected:

- One impression per card displayed; positions are one-based and increase
  within the walk (an undo restores a card at its earlier position and is
  recorded as a second impression).
- Every action has an `ImpressionId`; the undo's row points at the impression
  whose action it reversed, and that original action is still present.
- `EngineVersion` is `recommend-v1`, `CatalogVersion` matches the catalog's
  `fetchedAt`, `FilterHash` is a 16-character hex digest.
- `UserId` is null for the guest; `SessionId` is one value for the tab.

Disable the intake (stop the API), repeat a few swipes, and check the deck:
identical behaviour, no error, and the service's `lostEvents` counter (exposed
for tests, not shown) increased.

## 3. Idempotency, unlinked actions, and rejection

Post the same batch twice. The first returns `202` with counts; the second
returns `202` with `accepted` all zero and `duplicates` equal to the batch size.
The tables do not grow.

Post an action whose `impressionClientEventId` is not in the batch and not
stored: `202` with `unlinked: 1`, nothing written for that action.

Post an impression with `position: 0` or `kind: "loved"`: `400 invalid-payload`,
and a row count taken before and after is unchanged.

The backend integration suite covers all three:

```powershell
dotnet test backend/tests/PlayNext.Api.IntegrationTests --filter "FullyQualifiedName~Recommendation"
```

## 4. A signed-in visitor is associated, earlier events are not

1. Open the app, sign in, and swipe a few cards.
2. Query the newest impressions: `UserId` is set; `SessionId` is the same value
   the tab used before sign-in.
3. If the tab recorded events before signing in, those earlier rows still have
   `UserId` null. Signing in does not rewrite them.

## 5. Retention

The rule is pure and the purge is a service; the integration test drives both
boundaries (89 days kept, 91 days deleted, exactly 90 kept). To drill it
manually:

```sql
-- Age one impression and its action past the window.
UPDATE "RecommendationImpressions"
SET "ReceivedAt" = now() - interval '91 days'
WHERE "Id" = (SELECT max("Id") FROM "RecommendationImpressions");

-- Restart the API; the startup pass purges, then the 24-hour timer keeps it going.
```

After the restart:

```sql
SELECT count(*) FROM "RecommendationImpressions"
WHERE "ReceivedAt" < now() - interval '90 days';   -- expected: 0
```

Rows younger than 90 days are untouched, and no other table is affected
(FR-019). The daily pass is logged once per run; no manual step is needed.

## 6. Privacy audit

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('RecommendationImpressions', 'RecommendationActions')
ORDER BY table_name, ordinal_position;
```

Expected: no column for a name, email, IP address, device identifier, user
agent, location, or free text. The only visitor references are `SessionId`
(a random per-tab UUID) and the nullable `UserId`.

## 7. The offline harness

```powershell
cd frontend
npx ng test --watch=false --include="src/app/features/deck/deck-logic/evaluation/**/*.spec.ts"
```

Expected: the suite passes and prints the report table with rows for
`incumbent recommend-v1`, `popularity`, and the candidate, each carrying
NDCG@10, MRR, hit rate@10, precision@10, coverage, and intra-list diversity.
Run it twice: the tables are byte-identical.

The full suite is the CI gate:

```powershell
npx ng test --watch=false
```

`npx vitest run` is not the command for this repo.

## 8. Full validation

```powershell
dotnet test backend/PlayNext.sln
npx ng test --watch=false   # from frontend/
npx ng build                # from frontend/
```

Expected: all green. The harness's determinism test, the metric unit tests, the
validation tests, and the retention boundary tests are the evidence for
SC-004, SC-008, SC-009, and SC-010.
