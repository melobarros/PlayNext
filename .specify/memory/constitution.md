# PlayNext Constitution

## Core Principles

### I. Mobile-First Experience

Every user-facing feature is designed and verified for mobile screens first;
desktop layouts are progressive enhancements, never the primary target. UI
MUST remain fully usable at 360px viewport width with touch targets of at
least 44px, dark mode by default, and high-contrast text. The core flow —
from app open to a recommendation — MUST be reachable in the fewest taps
possible, with no mandatory intermediate steps beyond the initial onboarding
quiz.

PlayNext is delivered exclusively as a web app / Progressive Web App (PWA);
native mobile app builds (iOS/Android store apps) are out of scope.

*Rationale:* PlayNext is a mobile-first product. If a flow degrades on a
phone, the product fails its primary audience; PWA-only delivery keeps the
experience installable without the cost of native app development.

### II. Decision Speed & Simplicity

The product presents ONE decision at a time (the swipeable recommendation
deck); catalog-style browsing MUST NOT become the primary flow. Features that
slow down the "open → recommend → rate" loop are rejected unless shown to
improve decision quality. Follow YAGNI: the simplest implementation that
satisfies the spec is the correct one.

Binding budgets from the PRD:
- Median time from entering the site to locking in a choice MUST be under
  2 minutes.
- A recommendation card MUST render in under 300ms.
- Over 80% of guests MUST complete the onboarding quiz.

The loop MUST degrade gracefully: during a TMDB outage users get cached
fallback suggestions with a visible notice, never a dead end; an empty result
set gets an actionable empty state with a 1-click filter reset.

*Rationale:* The product's value is removing choice paralysis; scope that
adds friction attacks the core promise.

### III. Guest-First Access

Guest browsing MUST work end-to-end without an account, with guest state
persisted in browser LocalStorage. Creating an account is always optional
(Email/Password or Google OAuth via ASP.NET Core Identity), and guest data
(preferences, ratings, history) MUST migrate into the new user's permanent
account seamlessly and losslessly on registration or sign-in.

*Rationale:* Zero-friction guest browsing with seamless account migration is
a headline feature; forced sign-up walls or data loss on conversion directly
violate it.

### IV. API-First Architecture

The Angular frontend communicates exclusively with the .NET 8/9 REST API;
all persistent state lives server-side in PostgreSQL via EF Core. External
media integrations (TMDB, JustWatch) are accessed only by the backend — API
keys and provider credentials MUST NEVER be shipped in client code. Secrets
MUST live in Azure App Settings / Key Vault, and TMDB responses MUST be
cached server-side to protect rate limits and response time. The REST API is
the single source of truth for business rules; the client renders state, it
does not own it.

*Rationale:* A strict client/server split keeps secrets safe, centralizes
business logic, and makes recommendation behavior testable without a browser.

### V. Test-First for Critical Paths

Tests are written before implementation for the critical paths: onboarding
quiz filtering, recommendation/selection logic, rating persistence, and the
guest→account migration. Red-Green-Refactor is enforced for these paths; the
rest of the codebase MUST at least carry regression tests for fixed bugs.

Two invariants of the recommendation engine MUST be covered by automated
tests:
- Filter Enforcement: no title unavailable on the user's selected streaming
  services is ever suggested, unless "Show content on other platforms" is on.
- Feedback Loop: titles rated Disliked or Not Interested are never suggested
  again to the same user/session.

*Rationale:* These paths encode the product's core promises; a regression in
any of them silently breaks the core experience.

### VI. Deterministic Recommendations

The recommendation engine MUST use deterministic weighted scoring (tags,
genres, ratings, user history) — no machine-learning pipelines. Behavior
MUST be reproducible from the same inputs, explainable, and testable in
isolation. PlayNext hosts and streams no media content itself: "Watch Now"
links out to official streaming services via provider metadata.

*Rationale:* The PRD explicitly rules out ML for initial recommendations; a
deterministic engine keeps the MVP cheap, debuggable, and verifiable while
still solving the decision problem.

### VII. Clean Architecture & Domain Integrity

The backend MUST follow Clean Architecture layering — Web/API → Application
→ Domain — with dependencies pointing inward only. The Domain layer MUST be
free of framework references (no ASP.NET Core, EF Core, or external SDKs).
Persistence (EF Core), external integrations (TMDB, JustWatch), and caching
live in outer layers behind interfaces defined by the core. The
recommendation domain (quiz, scoring, matching, ratings) MUST be expressed
in the Domain layer using a ubiquitous language — entities, aggregates,
value objects, and domain services — so business rules are testable with no
database or HTTP stack.

*Rationale:* The scoring and matching rules are the product's core asset.
Isolating them from frameworks keeps them fast to test, cheap to change, and
independent of infrastructure choices. Complements Principle IV: IV draws
the client/server boundary, VII draws the boundaries inside the server.

## Engineering Standards

**Stack**
- **Frontend:** Angular (latest) with RxJS and Tailwind CSS.
- **Backend:** .NET 8/9 (C#) Web API — Minimal APIs or Controllers.
- **Database:** PostgreSQL accessed exclusively through EF Core migrations.
- **Integrations:** TMDB API for metadata/posters/cast/ratings and JustWatch
  for streaming availability per region; all calls MUST be server-side with
  secrets outside source control.
- New dependencies MUST be justified in the feature spec; prefer the
  existing stack over adding libraries.

**Architecture & Patterns**
- Backend solution layered per Clean Architecture: Domain (entities,
  aggregates, value objects, domain services), Application (use cases, DTOs,
  interfaces), Infrastructure (EF Core, TMDB/JustWatch clients, caching),
  Web API (controllers or Minimal APIs).
- DDD applied pragmatically: aggregate roots for User, UserPreference, and
  UserInteraction; the rating vocabulary (Loved, Liked, Disliked,
  WantToWatch, NotInterested, WatchingNow) MUST form a shared ubiquitous
  language across domain, API, and UI; no DDD ceremony where a simple
  service suffices.
- One established pattern per concern (e.g., repositories behind
  Application-layer interfaces); the same behavior MUST NOT be implemented
  two different ways. New patterns MUST be proposed in the feature spec,
  not introduced ad hoc.

**Code Quality**
- Readable over clever: descriptive naming, small focused methods and
  classes, SOLID applied where it clarifies; premature abstraction MUST be
  avoided (YAGNI, see Principle II).
- Merged code MUST be free of dead code, commented-out blocks, and
  TODO/FIXME comments lacking a tracked issue reference.
- Consistent formatting enforced by an .editorconfig at the solution root;
  PRs MUST NOT bundle formatting churn with behavior changes.

**Security**
- Authentication via ASP.NET Core Identity: passwords hashed with PBKDF2,
  JWTs signed with RSA/HMAC-SHA256 and short expiration times.
- Strict CORS policy (frontend domain only), CSRF protection, and SQL
  injection prevention via EF Core parameterized queries.
- Structured logging on the backend; no raw API keys or personal data in
  logs.

**Performance & Reliability**
- Initial recommendation MUST render in <300ms.
- Server-side caching (IMemoryCache) for TMDB and trending data; index on
  (UserId, TmdbMediaId) in the interaction table for instant lookup.
- TMDB outage MUST degrade to locally cached fallback suggestions with a
  visible notice.
- Target latest iOS Safari, Android Chrome, Desktop Chrome, Firefox, Edge;
  responsive from 360px up to 4K.

**Infrastructure**
- Frontend on Azure Static Web Apps; backend on Azure Container Apps
  (scale-to-zero) or App Service; PostgreSQL on a free/low-cost tier
  (Supabase, Neon, or Azure Flexible Server).
- All choices MUST stay within the low-cost Azure footprint; no service is
  added without a cost check.

## Development Workflow

- Every feature starts with the Spec Kit flow: `/speckit-specify` →
  `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`; no
  non-trivial feature is implemented without a spec.
- All changes merge via pull request and require code review.
- PR reviews MUST verify code quality and pattern adherence per Engineering
  Standards, not just correctness.
- Quality gates: the backend build and test suite MUST pass, and the
  frontend MUST build, before a PR is merged.
- Database schema changes MUST ship as EF Core migrations, reviewed in the
  PR alongside the code that uses them.
- CI/CD: GitHub Actions MUST build and deploy the Angular frontend (Azure
  Static Web Apps) and the .NET API (Azure Container Apps / App Service).

## Governance

This constitution supersedes all other development practices. Amendments
require a documented proposal, review, and a version bump per semantic
versioning: MAJOR for principle removals or redefinitions, MINOR for new or
materially expanded guidance, PATCH for clarifications. Every PR review MUST
verify compliance with the Core Principles; violations are blocking.
Complexity that contradicts a principle MUST be explicitly justified in the
feature spec.

**Version**: 1.2.0 | **Ratified**: 2026-09-25 | **Last Amended**: 2026-09-25
