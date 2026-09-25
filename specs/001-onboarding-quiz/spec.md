# Feature Specification: Onboarding Mood Quiz

**Feature Branch**: `001-onboarding-quiz`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "Onboarding mood quiz — the 3-step preference quiz (media
type, genres/themes, streaming services) that captures the visitor's mood and
streaming context before entering the recommendation deck. Scoped per-feature
from the PlayNext PRD (Milestone 1); specs are written one feature at a time
and developed as vertical slices."

## Clarifications

### Session 2026-09-25

- Q: Should the onboarding quiz include a question about content language?
  → A: Keep 3 steps; content language is configured later in Settings and is
  out of scope for this spec.
- Q: Should each quiz step require at least one selection, or allow an
  explicit "Any / No preference"? → A: Add an "Any / No preference" chip to
  each step; selecting it alone satisfies the step and records "no
  preference" for that dimension.
- Q: If the streaming-provider list keeps failing to load, should the
  visitor still be able to complete the quiz? → A: Fall back to a default
  popular-provider list with a small notice; the visitor can continue
  immediately.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-time visitor completes the quiz (Priority: P1)

A new visitor opens PlayNext and is guided through a 3-step quiz: choose what
kind of content they want (Movie, TV Show, Anime), pick the genres/themes
that fit their current mood, and select the streaming services they have.
Each step is a quick tap of pill/chip options, a progress indicator shows
which step they are on, and going Back keeps their answers. Finishing shows a
summary of their choices and a single primary action that starts the
recommendation flow with those choices applied.

**Why this priority**: The quiz is the entry point of the entire product
loop — without it the recommendation deck has no input. It is the PRD's
Milestone 1 and delivers the "30-second quiz" promise that underpins the
2-minute time-to-decision goal.

**Independent Test**: A new visitor in a private browsing window completes
all three steps and reaches the summary screen showing their selections.
Delivers value: preferences are captured and ready to drive recommendations.

**Acceptance Scenarios**:

1. **Given** a new visitor with no saved preferences, **When** they open the
   app, **Then** the quiz starts at step 1.
2. **Given** the visitor has answered steps 1 and 2, **When** they tap
   Next, **Then** step 3 opens and the previous selections remain intact.
3. **Given** the visitor selects fewer than one option on the current step,
   **When** they look at the Next action, **Then** it is unavailable.
4. **Given** all three steps are completed, **When** the visitor taps the
   final confirmation, **Then** a summary of all answers appears with a
   single primary action to start recommendations.

---

### User Story 2 - Guest leaves mid-quiz without losing progress (Priority: P2)

A guest refreshes the page or closes the browser partway through the quiz.
When they return, the quiz resumes at the same step with all previous answers
intact. A guest who already completed the quiz is not shown it again — their
saved preferences apply immediately.

**Why this priority**: The product targets over 80% quiz completion; losing
typed-in selections is the main reason visitors bounce and never return.

**Independent Test**: Complete steps 1 and 2, refresh the page, and confirm
the quiz reopens on step 3 with steps 1-2 answers intact.

**Acceptance Scenarios**:

1. **Given** a guest partway through the quiz, **When** they refresh the
   page, **Then** the quiz resumes at the same step with all prior answers
   intact.
2. **Given** a guest who completed the quiz in an earlier session, **When**
   they return, **Then** the quiz is skipped and their saved preferences are
   used.

---

### User Story 3 - Visitor edits answers or retakes the quiz (Priority: P3)

Visitors change their mind: they go Back during the quiz to fix an answer, or
they retake a finished quiz later (new subscription, different mood). The
quiz reopens with previous answers pre-filled so editing is fast, and
completing a retake replaces the saved preferences.

**Why this priority**: Preferences drift over time (new streaming
subscriptions, mood changes). Keeping the quiz as the single, cheap control
point for preferences avoids building a separate settings editor in v1.

**Independent Test**: From the summary, go Back through the steps, change one
genre, and complete again — the summary reflects the change and the new
answers replace the old ones.

**Acceptance Scenarios**:

1. **Given** a visitor on step 2, **When** they tap Back, **Then** step 1
   shows their original selections still selected.
2. **Given** a returning visitor, **When** they choose to retake the quiz,
   **Then** the quiz opens with their previous answers pre-filled.
3. **Given** changed answers, **When** the visitor completes the retake,
   **Then** the new answers replace the saved preferences.

---

### Edge Cases

- What happens when the visitor taps Next with nothing selected? The Next
  action stays unavailable, so the visitor can never reach a dead end.
- What happens when an options list (e.g., streaming providers) cannot be
  loaded? A friendly message with a Retry action is shown; if the retry
  fails, a default option list appears with a small notice, so the visitor
  is never stranded on a broken step.
- What happens when the visitor's region is unknown? A sensible default
  provider list is shown (see Assumptions).
- What happens when the visitor closes the browser mid-step? In-progress
  state is restored on their return (covered by User Story 2).
- What happens on rapid taps of Next/Back? Answers are neither duplicated
  nor lost; the shown step always matches the navigation.
- What happens if the visitor selects every option, or only one? Both are
  valid; selecting "Any / No preference" alone counts as the one required
  selection.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST present the quiz as exactly 3 steps in order:
  (1) media type, (2) genres/themes, (3) streaming services. Content
  language is NOT part of the quiz; it is configured later in Settings.
- **FR-002**: Step 1 MUST offer Movie, TV Show, and Anime as options, with
  more than one selectable at the same time.
- **FR-003**: Step 2 MUST offer a curated multi-select list of genres and
  themes (e.g., Action, Comedy, Drama, Horror, Romance, Sci-Fi, Thriller,
  Animation, Documentary).
- **FR-004**: Step 3 MUST offer a multi-select list of streaming providers
  relevant to the visitor's region.
- **FR-005**: Each step MUST require at least one selection before the
  visitor can continue. Every step MUST offer an explicit "Any / No
  preference" chip that alone satisfies the step and records "no
  preference" for that dimension.
- **FR-006**: Step 3 MUST include an optional "Show content on other
  platforms" toggle, off by default.
- **FR-007**: System MUST display a progress indicator (step X of 3)
  throughout the quiz.
- **FR-008**: Back navigation MUST retain all previously entered answers.
- **FR-009**: On completion, the system MUST show a summary of all quiz
  answers with a single primary action to start recommendations.
- **FR-010**: Guest quiz answers MUST be saved on the visitor's device and
  survive page refreshes and browser restarts.
- **FR-011**: A returning visitor who completed the quiz MUST NOT be forced
  through it again; their saved answers apply immediately.
- **FR-012**: Returning visitors MUST be able to retake the quiz with
  previous answers pre-filled.
- **FR-013**: If an options list cannot be loaded, the system MUST show a
  clear message with a Retry action; if the retry also fails, the system
  MUST fall back to a default option list with a small notice so the
  visitor can always continue — never a dead end.
- **FR-014**: All interactive elements MUST have touch targets of at least
  44px and remain fully usable at 360px viewport width, in dark,
  high-contrast styling by default.

### Key Entities *(include if feature involves data)*

- **Preference**: the visitor's quiz answers — media types, genres,
  streaming providers, the show-other-platforms flag, completion state, and
  last-updated time. Each dimension MAY be recorded as "no preference" when
  the visitor selects the "Any" chip.
- **Streaming Provider**: a selectable option with a display name and the
  regions where it is relevant.
- **Genre**: a selectable option with a display name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 80% of guests who start the quiz complete it.
- **SC-002**: Median quiz completion time is 30 seconds or less.
- **SC-003**: A new visitor completes the quiz and reaches the first
  recommendation within 2 minutes of opening the app.
- **SC-004**: 100% of quiz answers are retained across page refreshes and
  browser restarts for the same visitor.
- **SC-005**: The quiz is fully completable on a 360px-wide mobile screen
  using touch input only, with no horizontal scrolling.
- **SC-006**: At least 90% of first-time visitors complete the quiz without
  abandoning any step.

## Assumptions

- The quiz has exactly 3 questions as the PRD specifies; content language
  preference is configured later via Settings (PRD §4) and is out of scope
  for this spec.
- The provider list shown on step 3 is based on the visitor's detected
  region; when detection or loading fails, a popular default list is shown
  with a small notice.
- For Milestone 1, quiz options come from static app configuration (mock
  data); live provider/genre data feeds are out of scope.
- The quiz is mandatory for first-time visitors; it is the only mandatory
  step before recommendations.
- Guest persistence happens on the visitor's device; syncing preferences to
  a registered account is covered by the auth & migration feature spec.
- The recommendation deck that consumes these preferences is a separate
  feature spec; this spec ends at the summary / start-recommendations
  hand-off.
