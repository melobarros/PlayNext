# Feature Specification: Recommendation Telemetry & Offline Evaluation

**Feature Branch**: `009-recommendation-telemetry`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "Record every recommendation card shown and every action on it, and add an offline evaluation harness that compares candidate rankers against the incumbent and a popularity baseline. Impressions record title, one-based position, surface, engine version, catalog version, filter hash, score and reason, with no PII; guests are logged anonymously under their rotating guest id. Actions (like, dislike, skip, watch-now, undo) link to the impression they answer and include dwell time. Logging is batched and fire-and-forget: it never blocks a swipe, and failures are counted, not shown. A frozen-fixture harness replays sessions in temporal order and computes NDCG@10, MRR, hit rate@10, precision@10, catalog coverage and intra-list diversity, always including the incumbent and a popularity baseline, and runs in CI on every ranking change. Raw events are purged after 90 days; account deletion is out of scope and will be handled by the later account-lifecycle feature."

## Clarifications

### Session 2026-10-24

- Q: What counts as a card being "displayed" for an impression? → A: The moment a card becomes the current, actionable card on screen. Prefetched or pre-rendered cards the visitor cannot act on are not impressions.
- Q: How is dwell time measured? → A: The time from the impression being shown to the action's occurrence, capped at five minutes so a backgrounded tab cannot produce a meaningless value.
- Q: Should queued events survive a reload? → A: No. Events are held in memory only; the queue does not use local storage, and a lost tail on page close is counted rather than persisted.
- Q: Which catalog snapshot feeds the popularity baseline? → A: The frozen catalog in the fixture at capture time, so replays are deterministic; no live catalog data is consulted.
- Q: When must the harness run in continuous integration? → A: Whenever ranking logic, its inputs (preferences and filters), or the evaluation fixture changes, and on demand. Those changes require the run; unrelated changes do not.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every card shown is on the record (Priority: P1)

A visitor swipes through the deck. For each card that appears, PlayNext records
which title was shown, where in the sequence it appeared, which version of the
ranking produced it, which catalog snapshot and filters were active, the score
and reason the ranking gave it, and when it was shown. When the visitor likes,
dislikes, skips, chooses Watch Now, or undoes an action, that response is
recorded against the card it answers, with how long the visitor considered it.
Guests are recorded under a random anonymous session identifier created for the
visit; nothing about who they are is stored. None of this changes what the visitor
sees: recording happens in the background, and a recording failure is invisible
to them.

**Why this priority**: Without this record nothing that follows can be measured.
The ranking work planned next has no way to prove it is better than today's
deck, and the product has no feedback signal beyond the ratings a visitor
explicitly saves. Logging is also the riskiest privacy surface in the product,
so it has to be built deliberately rather than bolted on later. It is P1
because every other part of this feature — the harness, the baselines, the
retention rule — reads the record this story creates.

**Independent Test**: With a known catalog version, walk a scripted session of
at least 20 cards using a mix of actions. Confirm every card displayed has
exactly one impression, and every action links to the impression it answers.
Disable the event intake and repeat: the deck behaves identically, no error is
shown, and the failed events are counted. Submit the same batch twice and
confirm no duplicates are stored.

**Acceptance Scenarios**:

1. **Given** a completed quiz and a loaded deck, **When** a card is displayed,
   **Then** one impression is recorded with the title, its one-based position,
   the surface, the engine version, the catalog version, the filter digest, the
   score, the reason, and the time it was shown.
2. **Given** a displayed card, **When** the visitor likes, dislikes, skips, or
   chooses Watch Now, **Then** an action is recorded against that impression
   with its kind, the dwell time, and when it happened.
3. **Given** a recorded action, **When** the visitor undoes it, **Then** the
   undo is recorded against the same impression and the original action
   remains in the record.
4. **Given** a guest session, **When** impressions and actions are stored,
   **Then** they carry only the random anonymous session identifier — no name,
   email, address, device identifier, or free text.
5. **Given** a signed-in visitor, **When** events are stored, **Then** they are
   associated with the account identifier and nothing beyond it.
6. **Given** the event intake is unavailable, **When** the visitor swipes,
   **Then** the deck behaves exactly as it does with intake available, no error
   is shown, and the failed events are counted.
7. **Given** the same batch is submitted twice, **When** the second submission
   arrives, **Then** no duplicate impression or action is stored.

---

### User Story 2 - Any ranking change can be compared offline (Priority: P2)

A maintainer takes a frozen catalog and a frozen log of sessions, replays the
sessions in the order they happened, and scores a candidate ranker against the
deck that is live today and against a simple popularity baseline. Every run
reports the same six measures: ranking quality at the top of the deck
(NDCG@10, MRR, hit rate@10, precision@10), how much of the catalog the deck
can reach (coverage), and how varied a single deck is (intra-list diversity).
The comparison runs on every change to ranking logic, so a change that improves
one measure at the cost of another is visible before it ships.

**Why this priority**: This is what turns the record from US1 into decisions.
The popularity baseline is included because a ranker that cannot beat "most
popular title first" is not adding value; the incumbent is included because a
candidate that loses to today's deck must not ship. It is P2 because the
product still works without it, but without it the P1 record is collected and
never used — and the ranking work that follows would be judged on impressions
rather than evidence.

**Independent Test**: Run the harness on a frozen fixture. It reports all six
measures for the incumbent, the popularity baseline, and a candidate ranker.
Re-run it and get identical numbers. Change the candidate's weights and confirm
the reported numbers change only in the expected direction.

**Acceptance Scenarios**:

1. **Given** a frozen catalog and a frozen event log, **When** the harness runs,
   **Then** it replays sessions in temporal order and reports NDCG@10, MRR, hit
   rate@10, precision@10, catalog coverage, and intra-list diversity for each
   ranker evaluated.
2. **Given** the same fixture, **When** the harness runs repeatedly, **Then**
   every reported measure is identical.
3. **Given** a candidate ranker, **When** it is evaluated, **Then** the
   incumbent and the popularity baseline are reported in the same run.
4. **Given** a change to ranking logic, **When** continuous integration runs,
   **Then** the harness runs and its report is recorded with the run.
5. **Given** a fixture with no recorded visitor actions — the period before
   real traffic exists — **When** the harness runs, **Then** synthetic persona
   sessions exercise the incumbent and the baselines rather than producing an
   empty report.

---

### User Story 3 - The record is anonymous, minimal, and temporary (Priority: P3)

Behavioral data is kept only as long as it is useful. Raw impressions and
actions older than 90 days are deleted on a schedule, and nothing else is
retained in their place. There is no third-party analytics; the record lives
with the rest of the product's data. Deleting a visitor's account is not part
of this feature — accounts cannot be deleted yet — and this retention window is
the deletion guarantee until an account-lifecycle feature covers it.

**Why this priority**: The record is not needed for the product to work, so it
must not create an obligation the product cannot honor. Ninety days is enough
to compare ranking changes across a quarter; keeping behavioral data longer
than the product can justify is a liability, not an asset. It is P3 because a
miss here does not break the deck — it breaks a promise, quietly, which is
exactly why it is written down as a requirement rather than left to habit.

**Independent Test**: Seed impressions and actions at 91 and 89 days of age.
Run the purge. Confirm only the older rows are removed and the younger ones
remain. Inspect stored event fields for the prohibited personal data. Confirm
the purge runs unattended at least once a day.

**Acceptance Scenarios**:

1. **Given** events older than 90 days, **When** the purge runs, **Then** those
   events are deleted.
2. **Given** events younger than 90 days, **When** the purge runs, **Then**
   they remain.
3. **Given** a stored event, **When** its fields are inspected, **Then** it
   contains no name, email, IP address, device identifier, user agent, or free
   text.
4. **Given** the service restarts or a day passes, **When** the purge is due,
   **Then** it runs without a manual step.
5. **Given** an account or guest session with no events, **When** the purge
   runs, **Then** nothing else is deleted.

---

### Edge Cases

- **The event intake is slow or unavailable** → events wait in a small bounded
  queue, are retried a bounded number of times, then dropped and counted. The
  deck never waits and never shows an error.
- **The visitor closes the tab before the queue drains** → a best-effort flush
  runs as the page is hidden; queued events are never written to local storage,
  and a lost tail is counted, never reconstructed from guesses.
- **An action arrives before its impression** (batches can arrive out of
  order) → the action is rejected as unlinked and counted; the visitor is
  unaffected and the impression, when it arrives, is stored normally.
- **A batch is submitted twice** (retry, flaky network) → the second copy is
  recognised and ignored; no duplicate impression or action is stored.
- **The visitor signs in mid-session** → new events carry the account
  identifier; earlier anonymous events stay anonymous and are not retroactively
  linked. A visitor's identity is not rewritten by a later sign-in.
- **An undo arrives after the visitor has moved on** → it still links to the
  impression it answers; the original action is not deleted.
- **The title is later removed from the catalog** → the event remains; reads
  and replays tolerate a title that no longer resolves, exactly as the
  watchlist already does.
- **A session produces hundreds of events** → transmission is bounded by batch
  size and request rate; the excess is rejected and counted rather than
  growing the queue without limit.
- **The client clock is wrong** → both the client's time and the server's
  receipt time are stored, and replays order by receipt time so one bad clock
  cannot reorder history.
- **A batch is malformed or oversized** → the whole batch is rejected with a
  validation outcome and nothing is partially written.
- **A frozen fixture contains no events yet** → synthetic persona sessions
  stand in, so the harness is useful from the first day.
- **The retention boundary falls exactly on an event's age** → an event is
  deleted only when it is older than 90 days; an event exactly at the boundary
  is kept.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST record exactly one impression for every
  recommendation card displayed, carrying the title, the surface, the
  one-based position in the deck, the engine version, the catalog version, the
  filter digest, the score, the reason, and the time shown. A card counts as
  displayed when it becomes the current, actionable card on screen; prefetched
  or pre-rendered cards are not impressions.
- **FR-002**: Impressions and actions MUST be anonymous by default. For a
  guest, the only visitor reference stored is a random anonymous session
  identifier created for the visit. It MUST NOT be a persistent device
  identifier, a fingerprint, or derived from the visitor's network or device.
- **FR-003**: When the visitor is signed in, events MAY be associated with the
  account identifier; no other account data may be stored with them.
- **FR-004**: The system MUST record actions of kind like, dislike, skip,
  watch-now, and undo, each linked to the impression it answers, with the
  action's kind, dwell time, and occurrence time. Dwell time is measured from
  the impression being shown to the action's occurrence and is capped at five
  minutes.
- **FR-005**: An undo MUST be recorded as its own action against the same
  impression; the action it reverses MUST remain in the record.
- **FR-006**: Transmission of events MUST be batched and asynchronous. It MUST
  NOT block or delay card rendering, a swipe, an action, or navigation.
- **FR-007**: A failed transmission MUST be retried a bounded number of times,
  then counted as lost. The visitor MUST NOT be shown an error for telemetry
  failure, and no telemetry failure may alter deck behavior. Queued and failed
  events MUST be held in memory only; they MUST NOT be persisted to durable
  browser storage.
- **FR-008**: Event submission MUST be idempotent: a retried or duplicated
  batch MUST NOT create duplicate impressions or actions.
- **FR-009**: The system MUST reject a malformed or oversized batch as a whole,
  with a validation outcome, and MUST NOT partially store it.
- **FR-010**: The intake MUST bound the number of events per request and the
  request rate per session. Events beyond those bounds MUST be rejected and
  counted; they MUST NOT grow an unbounded queue.
- **FR-011**: Engine version, catalog version, and filter digest MUST identify
  the ranking context. The filter digest MUST be derived from the normalized
  filter and preference state without exposing that state, and MUST NOT contain
  personal data.
- **FR-012**: The offline harness MUST replay a frozen catalog and a frozen
  event log in temporal order, using only what was known before each decision
  point.
- **FR-013**: The harness MUST report NDCG@10, MRR, hit rate@10, precision@10,
  catalog coverage, and intra-list diversity for each ranker it evaluates.
- **FR-014**: Every harness run that evaluates a candidate MUST also report the
  incumbent ranker and the popularity baseline.
- **FR-015**: The harness MUST be deterministic: the same fixture MUST produce
  identical measures on every run.
- **FR-016**: The harness MUST run in continuous integration whenever ranking
  logic, its inputs (preferences and filters), or the evaluation fixture
  changes, and MUST be runnable on demand. Its report MUST be recorded with
  the run.
- **FR-017**: Synthetic persona sessions MUST exist so the harness can exercise
  every ranker before real visitor events exist.
- **FR-018**: Raw impressions and actions MUST be retained for 90 days, then
  deleted. The purge MUST run at least once a day and on service start.
- **FR-019**: The purge MUST delete only events; it MUST NOT delete or alter a
  visitor's saved ratings, history, preferences, watchlist, or account data.
- **FR-020**: Stored events MUST NOT contain a name, email address, IP address,
  device identifier, user agent, precise location, or free text.
- **FR-021**: The system MUST NOT use a third-party analytics service or
  tracking script; events MUST travel only through PlayNext's own API.
- **FR-022**: Account deletion is out of scope for this feature. No account
  deletion path is added, and the 90-day retention window is the sole deletion
  guarantee until an account-lifecycle feature covers it; that future feature
  MUST include these events when it lands.
- **FR-023**: Events whose title is later removed from the catalog MUST remain
  readable and replayable; a missing title MUST NOT fail a read or a replay.

### Measurement Definitions

These definitions keep the harness's numbers comparable between runs and
between rankers.

- **Session**: one anonymous session identifier, plus the account identifier
  when the visitor is signed in, from first event to last, ordered by the
  server's receipt time.
- **Displayed**: the moment a card becomes the current, actionable card on
  screen. A prefetched or pre-rendered card the visitor cannot act on yet is
  not displayed.
- **Dwell time**: the time between the impression being shown and the action's
  occurrence, capped at five minutes.
- **Relevant action**: a like or a watch-now, or a pre-existing Loved, Liked,
  Want-to-Watch, or Watching-Now rating on a title that is still a candidate
  for the deck (an already-rated title is excluded from the deck, so it cannot
  be a retrievable label). A dislike is an explicit rejection; a skip is
  exposure without a verdict and is neither relevant nor an explicit rejection.
- **Temporal replay**: at each impression in a session, the ranker orders the
  eligible catalog using only that session's actions before that impression.
  The visitor's later relevant actions in the same session are the ground
  truth the ordering is scored against.
- **Ranking-quality measures** are computed only for sessions that contain at
  least one relevant action; sessions without a positive signal still count
  toward coverage and diversity.
- **Coverage**: the share of distinct titles in the frozen catalog that appear
  in at least one top-10 across all evaluated sessions.
- **Intra-list diversity**: one minus the average pairwise genre overlap of the
  titles in a top-10, averaged across sessions.
- **Popularity baseline**: titles ordered by the frozen catalog's weighted
  rating and vote count at fixture time, with no personalization and no live
  catalog data, so every replay sees the same baseline.
- **Incumbent**: the ranking implementation serving the live deck when the
  fixture was captured, identified by its engine version.

### Key Entities *(include if feature involves data)*

- **Impression**: one recommendation card displayed in one session. Key
  attributes: title, surface, one-based position, engine version, catalog
  version, filter digest, score, reason, client shown time, server receipt
  time, visitor reference (anonymous session, plus account when signed in), and
  a client-generated event identifier for idempotency.
- **Action**: one visitor response to an impression. Key attributes: kind
  (like, dislike, skip, watch-now, undo), the impression it answers, dwell
  time, client occurrence time, server receipt time, and a client-generated
  event identifier.
- **Evaluation fixture**: a frozen catalog version plus an ordered event log
  and synthetic persona definitions, sufficient to replay sessions without
  live data.
- **Evaluation report**: the six measures per ranker for one fixture, with the
  engine version and fixture identity recorded so two reports can be compared.
- **Ranker**: a named, versioned scoring implementation. The incumbent, the
  popularity baseline, and any candidate are rankers evaluated the same way.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a scripted 20-card session using every action kind, 100% of
  impressions and 100% of actions are stored within one minute of the session
  ending, and every action is linked to its impression.
- **SC-002**: Logging adds no more than 10 ms at the 95th percentile to a card
  interaction, and produces zero visitor-visible errors while the intake is
  unavailable.
- **SC-003**: A full deck session with the intake unavailable serves exactly the
  same cards in the same order as the same session with intake available.
- **SC-004**: Replaying the same frozen fixture twice produces identical values
  for all six measures, for every ranker evaluated.
- **SC-005**: One harness run reports all six measures for the incumbent, the
  popularity baseline, and the candidate together.
- **SC-006**: The standard fixture completes in under 60 seconds in continuous
  integration, and the harness runs on every ranking-logic change.
- **SC-007**: An audit of stored events finds zero prohibited personal fields
  and zero free-text values.
- **SC-008**: After a purge, zero events older than 90 days remain and 100% of
  events younger than 90 days remain.
- **SC-009**: Submitting the same batch twice produces zero duplicate events.
- **SC-010**: A malformed or oversized batch produces zero stored events and
  one validation outcome.

## Assumptions

- **Retention**: 90 days, chosen by the product owner on 2026-10-24. The
  catalog's separate six-month provider-retention rule is unaffected; this
  window covers only behavioral events.
- **Account deletion**: deferred by decision on 2026-10-24. The account cannot
  be deleted today; when a later account-lifecycle feature adds deletion, it
  will include these events, and the spec must say so at that time.
- **Guest identity**: the app has no anonymous visitor identifier today —
  guest state lives only in browser storage. This feature introduces a random,
  per-tab session identifier for telemetry, held for the tab's lifetime and
  not persisted as a durable device identity. It is not a fingerprint, and
  signing in does not link it retroactively to the account.
- **Ranking location**: the ranker continues to run where it runs today. This
  feature observes ranking decisions; it does not move or rewrite the scoring
  logic. The engine version exists so that a future move or rewrite can be
  measured against today's behavior.
- **Source of truth**: the visitor's saved ratings, history, preferences, and
  watchlist remain authoritative. Events are an observational record, not a
  replacement for account state, and deleting events never deletes a rating.
- **Sign-in**: a guest who signs in gets new events associated with the
  account; earlier anonymous events are not retroactively linked. A future
  privacy review may revisit this, but the default is to leave history as it
  was recorded.
- **Surface**: the deck is the only surface producing impressions in this
  feature. The impression records a surface so that the watchlist and detail
  views can be added later without reshaping the record.
- **Volume**: expected volume is thousands of events per day, not millions.
  The design does not need a distributed pipeline or an external event store.
- **Popularity data**: the popularity baseline uses catalog metadata already
  present — weighted rating and vote count. No new provider call is introduced.
- **Fixtures**: synthetic persona sessions are committed with the harness; they
  contain no real visitor data. A captured real fixture is optional and must
  still contain no personal data.
- **Reporting**: the harness is an engineering tool. Its report is attached to
  the change that triggered it; no visitor-facing analytics screen is part of
  this feature.
- **Third parties**: no analytics vendor, tag manager, or tracking pixel is
  introduced. The constitution's credential and privacy rules apply unchanged.
