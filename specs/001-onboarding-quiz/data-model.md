# Data Model: Onboarding Mood Quiz

**Feature**: 001 | **Source**: [spec.md](./spec.md) | **Date**: 2026-09-25

## Entities

### QuizState (persisted document)

The single persisted document that captures everything the quiz needs to
resume and hand off. Lives in browser LocalStorage (see
[contracts/preference-storage.md](./contracts/preference-storage.md)).

```ts
type MediaType = 'movie' | 'tv' | 'anime';

interface DimensionChoice<T extends string> {
  values: T[];   // selected option ids; empty when `any` is true
  any: boolean;  // "Any / No preference" chip chosen (exclusive, FR-005)
}

interface QuizState {
  schemaVersion: 1;
  status: 'in-progress' | 'completed';
  step: 1 | 2 | 3;               // current step while in-progress
  mediaType: DimensionChoice<MediaType>;
  genre: DimensionChoice<string>;   // genre ids
  provider: DimensionChoice<string>; // provider ids
  includeUnownedProviders: boolean; // "Show content on other platforms" (FR-006)
  completedAt?: string;          // ISO 8601, set when status becomes 'completed'
  updatedAt: string;             // ISO 8601, last write
}
```

### Preference (derived, completed form)

The quiz's output — what the deck (spec 002) consumes. Derived from a
`QuizState` with `status: 'completed'`: the three `DimensionChoice`s plus
`includeUnownedProviders` and `completedAt`. No separate storage; it is a
read view over the same document.

### QuizStep

Presentation-level: one of the three fixed steps in order —
1) media type, 2) genres/themes, 3) streaming services (FR-001). Steps are
not persisted separately; the current index is `QuizState.step`.

### QuizOptions (static configuration)

The selectable option lists, static in-app config for Milestone 1 (spec
Assumptions; served by the backend from Milestone 2).

```ts
interface StreamingProvider { id: string; displayName: string; regions: string[]; }
interface Genre { id: string; displayName: string; }
interface QuizOptions {
  mediaTypes: MediaType[];
  genres: Genre[];            // ~9 curated options (FR-003)
  providers: StreamingProvider[]; // region-relevant (FR-004)
  fallbackProviders: StreamingProvider[]; // FR-013 default list
}
```

## State Transitions

| From | Event | To | Rule |
|------|-------|----|------|
| (none) | first visit, no saved state | in-progress, step 1 | FR "quiz starts at step 1" |
| in-progress, step n | Next | in-progress, step n+1 | valid iff current step satisfies FR-005; n < 3 |
| in-progress, step n | Back | in-progress, step n-1 | n > 1; answers retained (FR-008) |
| in-progress, step 3 | final confirmation | completed | summary shown (FR-009); `completedAt`/`updatedAt` set |
| completed | Retake quiz | in-progress, step 1 | previous answers pre-filled (FR-012) |
| completed | complete retake | completed | new answers REPLACE the document (US3 scenario 3) |
| any | refresh / browser restart | unchanged | FR-010 persistence guarantee |

## Validation Rules (from spec FRs)

- A step is complete iff `values.length > 0 || any === true` (FR-005). The
  `any` chip is exclusive: choosing it clears `values` (spec edge case
  "selecting it alone counts as the one required selection").
- Exactly 3 steps, fixed order, no language question (FR-001).
- `includeUnownedProviders` defaults to `false` (FR-006).
- Completed visitors are never shown the quiz (FR-011) — app boot checks
  `status === 'completed'`.
- A `QuizState` whose stored `schemaVersion` is unknown, or whose JSON is
  unparseable, is discarded and treated as a first visit (graceful
  reset; see contract).
- Provider list load failure → Retry action → fallback list with notice
  (FR-013); the fallback list never blocks completion.

## Relationships

- `QuizState` —1:1— LocalStorage document (key `playnext:quiz-state`).
- `QuizState` (completed) → derives → `Preference` consumed by the deck
  (002). The deck reads, never writes.
- `QuizOptions` is read-only static config, swapped for the API in
  Milestone 2 without changing `QuizState`.

## Scale

Single document per visitor, well under 1 KB of JSON. No indexing, no
queries — LocalStorage read/write on boot and on each step change.
