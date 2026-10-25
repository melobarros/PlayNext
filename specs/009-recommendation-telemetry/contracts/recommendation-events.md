# Contract: Recommendation Event Intake

**Feature**: 009 | **Date**: 2026-10-24 | **Model**: [data-model.md](../data-model.md)

The only write path for recommendation events. It is public because guests are
the majority visitor, and it is deliberately unforgiving about shape so the
stored record stays free of free text.

## Endpoint

```text
POST /api/recommendations/events
Content-Type: application/json
Authorization: Bearer <access token>   (optional)
```

- **Authentication is optional.** Without a token the events are anonymous and
  carry only the session id. With a valid token the events also carry the
  account id. A missing, expired, or malformed token never fails the request;
  the events are stored anonymously instead (research D3).
- **No cookie is read.** The endpoint is not CSRF-sensitive because a bearer
  token is attached by script, never by the browser.
- **No parameters**, no query string. Everything is in the body.
- The response never echoes an event, a session id, or a token.

## Request body

```json
{
  "impressions": [
    {
      "clientEventId": "3f1c0f1e-6a5b-4c8e-9f0a-1b2c3d4e5f60",
      "sessionId": "0b9e7a54-2f4d-4d0a-91c2-3b4c5d6e7f80",
      "titleId": "tmdb:movie:27205",
      "surface": "deck",
      "position": 1,
      "engineVersion": "recommend-v1",
      "catalogVersion": "2026-10-24T17:07:32.000Z",
      "filterHash": "9f2c4a1b7e3d5068",
      "score": 12.34,
      "reasonCode": "genre-picked",
      "shownAt": "2026-10-24T18:00:00.000Z"
    }
  ],
  "actions": [
    {
      "clientEventId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      "impressionClientEventId": "3f1c0f1e-6a5b-4c8e-9f0a-1b2c3d4e5f60",
      "kind": "liked",
      "dwellMs": 3240,
      "occurredAt": "2026-10-24T18:00:03.240Z"
    }
  ]
}
```

| Field | Type | Rule |
|---|---|---|
| `impressions` | array | at most 100; may be empty |
| `actions` | array | at most 200; may be empty |
| `clientEventId` | UUID | created by the client at event creation; unique across both arrays |
| `sessionId` | string ≤ 64 | the per-tab anonymous session id |
| `titleId` | string ≤ 64 | the catalog title id, stored even if the title is later removed |
| `surface` | string ≤ 16 | only `deck` today; an unknown surface is a validation error |
| `position` | integer ≥ 1 | one-based position in the deck at display time |
| `engineVersion` | string ≤ 32 | `recommend-v1` |
| `catalogVersion` | RFC 3339 timestamp | the catalog payload's `fetchedAt` |
| `filterHash` | string ≤ 32 | hex digest; opaque to the server |
| `score` | number | finite; the ranker's own score |
| `reasonCode` | enum | `genre-picked`, `genre-affinity`, `era-affinity`¹, `service`, `none` |
| `shownAt` | RFC 3339 timestamp | the client's clock |
| `impressionClientEventId` | UUID | the impression this action answers |
| `kind` | enum | `liked`, `disliked`, `skip`, `watch_now`, `undo` |
| `dwellMs` | integer | 0–300 000 |
| `occurredAt` | RFC 3339 timestamp | the client's clock |

Unknown properties are ignored. A batch with both arrays empty is a valid no-op
and answers 202 with zero counts.

¹ `era-affinity` was added by feature 010 (deterministic engine v2). The set
stays closed — any value outside it is still a validation error.

## Response

### 202 Accepted

```json
{
  "accepted": { "impressions": 1, "actions": 1 },
  "duplicates": 0,
  "unlinked": 0
}
```

| Field | Meaning |
|---|---|
| `accepted.impressions` | impressions actually inserted by this request |
| `accepted.actions` | actions actually inserted by this request |
| `duplicates` | events already stored under the same `clientEventId`, ignored |
| `unlinked` | actions whose impression was neither in the batch nor stored |

`accepted + duplicates` for impressions equals the number of impression inputs
that were not unlinked (impressions are never unlinked). An unlinked action is
not an error: it is counted and skipped, and its impression is stored normally
when it arrives later (spec Edge Cases).

### 400 Bad Request — `invalid-payload`

```json
{
  "code": "invalid-payload",
  "errors": [
    "impressions[0].position must be at least 1.",
    "actions[0].kind 'loved' is not a recommendation action."
  ]
}
```

The whole batch is rejected and nothing is written (FR-009, SC-010). The
`errors` array is bounded to the first 10 failures; each entry names the field
and the rule, never the value of a personal field.

### 413 Payload Too Large — `payload-too-large`

Returned when the body exceeds 256 KB, or a batch exceeds 100 impressions or
200 actions. Nothing is written.

### 429 Too Many Requests — `rate-limited`

Returned when a session exceeds **20 requests per minute** or **600 events per
minute**. Includes `Retry-After` in seconds. Nothing is written.

The limiter is an in-memory fixed window keyed by `sessionId`. It is
best-effort, not a security control: the session id is client-generated, and a
client that rotates it starts a new window. The hard bounds are the per-request
limits and the 256 KB body ceiling.

## Idempotency

- A retried batch carries the same `clientEventId` values as the original.
- The second submission inserts nothing, counts the events as `duplicates`, and
  returns 202. It never returns an error for a duplicate.
- Duplicate detection is a unique index, so it holds across concurrent
  requests, not just sequential retries.

## Privacy

- The body has no name, email, address, device identifier, user agent, or free
  text field. The server does not add one.
- Request bodies are never logged.
- The rate limiter reads the session id transiently and stores no history
  beyond the current window.
- `titleId`, `surface`, `engineVersion`, `filterHash`, and `reasonCode` are
  bounded, and the two enums are checked, so a malicious client cannot turn an
  event into a free-text store.

## Failure behaviour on the client

The client never shows an error for this endpoint. A network failure, 429, or
5xx is retried twice, then the batch is dropped and counted. A 400 or 413 is
permanent and is dropped immediately. The deck's behaviour never depends on the
outcome (FR-006, FR-007, SC-002, SC-003).
