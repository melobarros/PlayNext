# Data Model: Recommendation Deck

**Feature**: 002 | **Date**: 2026-09-26

Entities for the deck loop and the visitor's recorded decisions. The two
LocalStorage documents are specified in
[contracts/interaction-storage.md](./contracts/interaction-storage.md); this
file defines the shapes and the rules that govern them.

Vocabulary is shared with the constitution's ubiquitous language: the rating
states are **Loved, Liked, Disliked, WantToWatch, NotInterested, WatchingNow**
and carry those meanings across the deck (002), the watchlist (003), and the
API (Milestone 2). Genre ids and provider ids are reused verbatim from spec
001's catalog (`GENRES`, `STREAMING_PROVIDERS`) so a preference and a title are
directly comparable — no mapping table.

## MediaTitle

A watchable title. Read-only in this slice: it comes from the catalog, never
from the visitor.

| Field | Type | Rules |
|---|---|---|
| `id` | `string` | Stable, unique, non-empty. The key every other entity references. |
| `title` | `string` | Non-empty display name. |
| `releaseYear` | `number` | 4-digit year; `0` is not valid. |
| `mediaType` | `MediaType` | `'movie' \| 'tv' \| 'anime'` — reused from spec 001. |
| `genres` | `string[]` | Genre ids from spec 001's `GENRES`. May be empty. |
| `synopsis` | `string` | May be empty; the card degrades to title + metadata. |
| `rating` | `number` | 0–10, one decimal. Display only — never the sole ranking input (see below). |
| `voteCount` | `number` | ≥ 0. Confidence weight, so a lone 10.0 cannot outrank a well-established 8.5. |
| `runtimeMinutes` | `number \| undefined` | Optional. |
| `trailerUrl` | `string \| undefined` | Optional. **Absent is a normal state**, not an error (FR-008, spec US2 scenario 4). |
| `posterUrl` | `string \| undefined` | Optional. Absent or failing → the generated placeholder (FR-016). |
| `availability` | `StreamingAvailability[]` | Where the title can be watched. May be empty → the card degrades, it does not hide. |

### StreamingAvailability

| Field | Type | Rules |
|---|---|---|
| `providerId` | `string` | A spec 001 provider id. Unknown ids are ignored by filters rather than crashing. |
| `deepLinkUrl` | `string` | Absolute URL to the **official** service. PlayNext hosts nothing (constitution VI). |

Region is deliberately **not** a field here: `CatalogService.loadTitles(region)`
returns titles already scoped to the visitor's region, mirroring how
`QuizOptionsService.loadProviders(region)` handles it in spec 001. Region stays
a service concern so no component ever filters by it.

## Interaction (a rating)

One per visitor per title — re-rating replaces, never appends (spec 003
FR-006). Keyed by `titleId`.

| Field | Type | Rules |
|---|---|---|
| `titleId` | `string` | The map key. |
| `state` | `InteractionState` | One of the six vocabulary values. |
| `updatedAt` | `string` | ISO-8601. Replaced on every re-rating. |

`InteractionState = 'loved' | 'liked' | 'disliked' | 'wantToWatch' | 'notInterested' | 'watchingNow'`

**`disliked` and `notInterested` are the only exclusionary states.** Every
other state — including `loved` and `wantToWatch` — leaves the title eligible
to be suggested again, which is what makes spec 003's "un-dislike" work with no
extra bookkeeping.

The record deliberately stores **no copy of the title's display data**. The
catalog is the single source of truth for names, posters and links, so a title
whose availability changes shows current data when spec 003 reopens it. A
`titleId` the catalog no longer knows renders as an unavailable entry rather
than a broken one.

## WatchHistoryEntry

The log of Watch Now decisions. **Append-only**: re-rating a title later does
not remove its entry (spec 003's clarification). The same title may legitimately
appear more than once — a visitor can decide to watch something twice.

| Field | Type | Rules |
|---|---|---|
| `titleId` | `string` | The chosen title. |
| `chosenAt` | `string` | ISO-8601, set when Watch Now is tapped. |

Streaming links are **not** stored: spec 003 requires them to be refreshed from
current availability when an entry is reopened, so the entry holds the decision
and the catalog holds the links.

## DeckSession (ephemeral)

The running loop. Separate from the documents above because it is throwaway —
"start a new loop" resets it, and spec 004 has no reason to migrate it.

| Field | Type | Rules |
|---|---|---|
| `schemaVersion` | `1` | Literal. |
| `startedAt` | `string` | ISO-8601; identifies the loop. |
| `shownTitleIds` | `string[]` | Titles the visitor has **advanced past** in this loop. |

### Why `shownTitleIds` is enough

The current card is not stored. It is *derived*:

```
currentCard = rankTitles(catalog, preferences, interactions)
                .filter(t => !session.shownTitleIds.includes(t.id))[0]
```

Because ranking is deterministic (FR-011), recomputing after a page refresh
yields **the same card the visitor was looking at**, with no cursor to persist
and no risk of a stored cursor disagreeing with the ranked list. This is what
satisfies the spec's "refresh mid-deck retains the current position" edge case
for free.

Advancing pushes the current title onto `shownTitleIds`; the next card is
whatever now ranks first among the remainder (FR-010 — a shown title cannot
return until the loop is restarted).

## Match

Not a stored entity — a **view** over a title the visitor locked in.

| Field | Source |
|---|---|
| the chosen title | the catalog, by `titleId` |
| streaming links | the title's `availability` |
| trailer link | the title's `trailerUrl`, when present |

Tapping Watch Now records a `WatchHistoryEntry` and a `watchingNow` interaction,
then opens the Match Found view for that title id.

## State Transitions

| From | Action | To |
|---|---|---|
| quiz `completed` | open `/deck` | loop starts; `shownTitleIds: []` |
| card shown | swipe / tap advance | current id appended to `shownTitleIds`; **no interaction recorded** (FR-004) |
| card shown | any of the five rating buttons | `interactions[titleId]` written; advance |
| card shown | Watch Now | `watchingNow` interaction + history entry; loop stops → Match Found |
| Match Found | start a new loop | `shownTitleIds: []`, new `startedAt`; exclusions keep applying |
| filtered set empty | Reset Filters | hand off to spec 001's quiz via `startRetake` |
| any | refresh | current card recomputed and identical |

## Validation Rules

Enforced on read, matching spec 001's fail-safe posture — a document that
fails any rule is treated as absent and rewritten from scratch rather than
partially trusted:

1. `schemaVersion` must be exactly `1`. Anything else → discard.
2. Unparseable JSON → discard.
3. `interactions` states must be one of the six values. An unknown state
   invalidates the document (it would silently change exclusion behavior).
4. `shownTitleIds` must be an array of strings; unknown ids are harmless and
   simply never match.
5. `updatedAt` / `chosenAt` / `startedAt` must be ISO-8601 strings.
6. Reading never mutates: readers get copies, so a component cannot corrupt a
   document by editing what it was handed.

## Scale

| Document | Expected size | Bound |
|---|---|---|
| `playnext:interactions` | one entry per rated title | ~30 bytes/entry; spec 003 commits to 500+ entries (~20KB) — well inside the LocalStorage budget |
| `playnext:deck-session` | titles advanced past in one loop | catalog-bounded (~48 in M1) |
