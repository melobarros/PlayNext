# 🎬 PlayNext

[![Deploy](https://github.com/melobarros/PlayNext/actions/workflows/deploy.yml/badge.svg)](https://github.com/melobarros/PlayNext/actions/workflows/deploy.yml)
![.NET](https://img.shields.io/badge/.NET-10-512BD4)
![Angular](https://img.shields.io/badge/Angular-22-DD0031)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1)
![PWA](https://img.shields.io/badge/PWA-offline--first-5A0FC8)

> **Stop scrolling, start watching.**

PlayNext turns "what do you want to watch?" into a decision. A three-step quiz
narrows movies, TV, and anime by genre and by the streaming services you
actually pay for; a swipeable deck then shows one title at a time — poster,
synopsis, rating, where to watch — and one swipe records your reaction.

**Live: [playnext-aefkapbbazh8gqe3.westus3-01.azurewebsites.net](https://playnext-aefkapbbazh8gqe3.westus3-01.azurewebsites.net)** — real deploy, installable PWA, no paid tier anywhere.

## At a glance

| | |
|---|---|
| **Stack** | .NET 10 minimal API · Angular 22 (standalone, signals, zoneless) · PostgreSQL + EF Core · Tailwind v4 |
| **Architecture** | Clean Architecture, enforced by project references rather than by convention — the domain assembly references nothing |
| **Tests** | **911 passing** — 102 domain, 87 application, 722 frontend |
| **Pipeline** | Every push to `main`: test → migrate → deploy → smoke-test the live URL |
| **Cost** | **$0/month** — Azure App Service F1 + Neon Postgres |
| **Process** | 5 features, each specified, planned, and broken into tasks before any code was written |

### The three things most worth asking about

1. **Guest-first, and the merge is the hard part.** The app is fully usable with
   no account; signing in *merges* what's already on the device instead of
   asking for it again. Guest is not a degraded mode — it's a user whose storage
   happens to be a browser. [→ more](#guest-first-and-the-merge-is-the-hard-part)
2. **One origin, chosen for a cookie.** Splitting the SPA and API across hosts
   would make the httpOnly refresh cookie third-party, which Safari and Firefox
   block — silent logouts every fifteen minutes. Azure's answer to that costs
   ~$80/month; one App Service costs $0. [→ more](#same-origin-deployment-chosen-for-a-cookie)
3. **A test suite that cannot lie.** Integration tests skip when no database is
   reachable, which is right on a laptop and a lie in CI. The pipeline fails if
   they skipped. [→ more](#a-gated-test-suite-that-cannot-lie)

Everything below is the detail behind those, ending with an honest
[list of what isn't finished](#where-this-is-honestly-incomplete).

---

## Table of contents

- [Architecture](#architecture)
- [Engineering decisions](#engineering-decisions)
- [Testing](#testing)
- [Spec-driven development with AI](#spec-driven-development-with-ai)
- [CI/CD](#cicd)
- [Running it locally](#running-it-locally)
- [Deployment](#deployment)
- [Repository layout](#repository-layout)
- [Where this is honestly incomplete](#where-this-is-honestly-incomplete)

---

## Architecture

```
                            one origin, one deploy
┌──────────────────────────────────────────────────────────────────────────┐
│  Azure App Service · Linux · F1 free tier                                │
│                                                                          │
│    GET /            GET /api/**                                          │
│      │                   │                                               │
│      ▼                   ▼                                               │
│  Angular 22 PWA      ASP.NET Core minimal API                            │
│  wwwroot + service         │                                             │
│  worker cache              │  depends inward only                        │
│                            ▼                                             │
│              ┌──────── Api ────────┐                                     │
│              │                     │                                     │
│              ▼                     ▼                                     │
│      Infrastructure ────────► Application ────────► Domain              │
│        (EF Core,                 (use cases,          (entities,         │
│         Postgres,                 port interfaces)     rules)            │
│         TMDB)                                                            │
│              │                                                           │
└──────────────┼───────────────────────────────────────────────────────────┘
               ▼
       Neon PostgreSQL (free tier)
```

| Layer | Project | Depends on | Contains |
|---|---|---|---|
| Domain | `PlayNext.Domain` | *nothing* | Entities, value objects, invariants |
| Application | `PlayNext.Application` | Domain | Use cases, the 8 port interfaces they need |
| Infrastructure | `PlayNext.Infrastructure` | Application | EF Core, Npgsql, the TMDB client |
| API | `PlayNext.Api` | Application, Infrastructure | Minimal-API endpoints, composition root |

The arrow direction is enforced by the **absence of project references**, not by
convention or a reviewer noticing: `PlayNext.Domain.csproj` references no
project, and `PlayNext.Application` references only Domain. If a use case ever
needs an HTTP client or a `DbContext`, it cannot — it has to declare a port and
let Infrastructure implement it. The compiler is the architecture test.

---

## Engineering decisions

The choices below are the ones worth defending in a review. Each is a trade
made against a specific constraint, and each one cost something.

### Guest-first, and the merge is the hard part

A visitor answers the quiz and starts swiping with **no account at all** — the
whole app runs from `localStorage` in that state. There is no sign-up wall and
no degraded mode. When they do sign in, the local quiz answers, ratings, and
watch history are **merged into the account rather than re-entered**, and the
interesting cases are the conflicts: the same title rated on two devices, a
local "liked" meeting a server-side "disliked".

This is why there is no "guest mode" flag anywhere in the domain. Guest is not a
degraded user — it is a user whose storage happens to be a browser. The
migration is a real use case with its own conflict rules and its own tests.

### Same-origin deployment, chosen for a cookie

The refresh token is an `httpOnly` cookie, which means serving the SPA and the
API from two different hosts would make it a **third-party cookie** — blocked by
default in Safari and Firefox, which would silently sign people out every
fifteen minutes in the browsers most likely to be used.

The obvious Azure answer is Static Web Apps with a *linked backend*. That needs
the SWA **Standard** plan and App Service **S1** together — about **$80/month**.
Instead, one App Service serves the Angular build from `wwwroot` and the API
from `/api` on the same origin.

The result costs **$0/month**, and it deletes an entire class of work: no CORS
policy, no preflight handling, no allow-list to keep in sync, no
`credentials: 'include'` debugging. **The constraint produced the simpler
system.** The client calls relative `/api/...` paths and always has.

### Fail fast at boot, not per-request

`Program.cs` refuses to start if `ConnectionStrings:Postgres`, `Jwt:SigningKey`,
or `Tmdb:ApiKey` is missing. The alternative — starting up and answering every
request as though the data were empty — is worse than a crash, because it looks
like it works. A dead app is loud; a misconfigured app is quiet.

### A gated test suite that cannot lie

Integration tests that need a live PostgreSQL **skip** when one is not
reachable, which is what makes `dotnet test` usable on a laptop with no
database. In CI that same behaviour is a hazard: a green pipeline that asserted
nothing about the account store looks identical to one that did.

CI therefore runs the suite with a `.trx` logger and **fails the job if the
Postgres-gated tests report as skipped**. The skip is a convenience locally and
an error in the pipeline, which is the distinction that makes the gate real.

### Offline-first, where failure is classified rather than caught

Changes made with no connection are queued on the device and flushed when the
connection returns or the app next opens. Two decisions make that queue safe:

**Failures are classified, because the two kinds want opposite responses.** A
`400` means the body is wrong and will be wrong the same way next time, so it is
surfaced to the user and deliberately **not** queued — a queue that accepts a
permanently-rejected operation retries it on every sync, forever. A network
failure or a `5xx` means nothing about the request was wrong, so it is
**deferred** and queued, and the decision survives the outage.

**The queue is cleared only on confirmation, and never re-enqueued on failure.**
It is already the record of what has not been sent, so re-adding operations
after a failed attempt would double them every time, and a queue that grows
while the network is down never drains.

The payload is a whole state document rather than a replayable log of events,
which is what makes applying it twice harmless. The service worker caches the
shell, so the app opens with no network at all.

---

## Testing

**911 tests, all passing** — measured on the current commit:

| Suite | Tests | Scope |
|---|---|---|
| `PlayNext.Domain.Tests` | 102 | Invariants, value objects, state transitions |
| `PlayNext.Application.Tests` | 87 | Use cases against hand-written fakes for the 8 ports |
| Frontend (Vitest, 40 files) | 722 | Components, services, and the pure functions behind the swipe |

The Application tests use hand-written fakes rather than a mocking framework,
which keeps the ports honest: if a port is awkward to fake, it is usually the
wrong shape, and that shows up as friction in a test rather than as pain in
production.

The frontend keeps gesture and quiz logic in **pure functions** under
`*-logic/` directories, separate from the components that call them. Swipe
thresholds, velocity, and direction are tested as arithmetic on numbers — no
`PointerEvent` construction, no fake timers against a rendering harness. The
components are then tested for wiring, not for math.

A handful of integration tests require live PostgreSQL or a real TMDB key and
skip without them; CI asserts the database ones actually ran (see above).

---

## Spec-driven development with AI

Every feature in this repo went through a written spec before any code existed
— five spec directories now, all five implemented. The process is
[Spec Kit](https://github.com/github/spec-kit), and the repo's
[constitution](.specify/memory/constitution.md) (**v1.4.0**, seven principles)
is the part that makes it more than ceremony.

The loop, per feature:

```
/speckit-specify   → spec.md          what and why, no technology
/speckit-clarify   →                  resolves ambiguity before any code exists
/speckit-checklist → checklists/      requirements quality, not test cases
/speckit-plan      → plan.md          technology, structure, decisions
/speckit-tasks     → tasks.md         dependency-ordered, independently testable
/speckit-implement →                  code, against the tasks
```

Each feature's `spec.md`, `plan.md`, and `tasks.md` live side by side under
[specs/](specs/), so the reasoning behind a slice of code is one directory away
from the code itself. The specs are written before the implementation and are
not rewritten afterwards to match it.

What the constitution actually constrains, in ways that changed the code:

- **Mobile-first is a requirement with numbers, not a preference.** Principle I
  sets a hard floor: fully usable at a **360 px viewport** with touch targets of
  at least **44 px**, dark by default. The onboarding quiz was checked at both
  390 px and at that 360 px floor — the media-type chips still fit one row with
  nothing clipped.
- **Decision speed.** Principle II is why there is no logo above the deck: the
  deck has one card and one decision on it, and a mark above that would be a
  third thing asking to be looked at. Branding went on onboarding, the one
  screen every visitor passes through exactly once.
- **Test-first for critical paths** — the reason the test count is a gate
  rather than a statistic.
- **Deterministic recommendations, explicitly not machine learning.** Principle
  VI requires weighted scoring over tags, genres, and history — reproducible
  from the same inputs, explainable, and testable in isolation. A rule that
  cannot be explained is not allowed to decide what you watch.
- **Amendments need a proposal and a version bump.** The constitution is
  versioned with MAJOR/MINOR/PATCH semantics, and the deployment deviation
  (one App Service instead of Static Web Apps) is recorded there rather than
  quietly diverging.

AI wrote a large share of this code. The value was not typing speed — it was
that a written spec plus a versioned constitution gave every generated change a
fixed target to be measured against, so review could ask "does this match the
spec?" instead of "does this look plausible?"

---

## CI/CD

Every push to `main` runs [deploy.yml](.github/workflows/deploy.yml), which
tests, migrates, deploys, and then **verifies the live URL** — in one job, so
the bits that were tested are the bits that ship:

```
push to main
   │
   ├─ test      postgres:17 service container
   │              ├─ dotnet test          Domain + Application + integration
   │              ├─ skip guard           fail if the DB tests did not run
   │              ├─ npx ng test          722 specs
   │              └─ npm run build        → dist/playnext/browser
   │
   ├─ migrate   dotnet ef database update ──► Neon, before new code is live
   │
   └─ deploy    publish + Angular → wwwroot, pre-zipped
                └─ smoke test            /  ·  deep link  ·  /api 404
```

Details that exist because the naive version failed:

- **Migrations run before the deploy**, never after. A rollback cannot undo a
  schema change, so a migration that fails must stop the deploy rather than
  meet a running app expecting different tables.
- **`concurrency: cancel-in-progress: false`** — two quick pushes must not race
  into the same database, and a deploy must never be cancelled mid-migration.
- **A missing `wwwroot` fails the build.** `dotnet publish` neither creates the
  folder nor complains about its absence; without an explicit assert the app
  deploys, starts, and answers every page with a 404 that only appears in
  production.
- **The smoke test checks that `/api/does-not-exist` returns 404, not
  `index.html`.** That is a regression test on the SPA fallback: if it ever
  starts swallowing API routes, this is what notices.
- **Framework-dependent publish, no RID** — App Service supplies the runtime
  from the configured stack, so shipping one would bundle what the platform
  already has.

---

## Running it locally

```bash
cd frontend
npm install
npm start          # http://localhost:4200
```

Requires Node.js `^22`, `^24`, or `^26`. That is enough to use the app as a
guest — the whole product works with no backend at all.

**Signed-in features need the API**, which needs the .NET 10 SDK, PostgreSQL,
and two secrets (a connection string and a JWT signing key) that live in
user-secrets and never in the repo:

```bash
cd backend
dotnet ef database update --project src/PlayNext.Infrastructure --startup-project src/PlayNext.Api
dotnet run --project src/PlayNext.Api
```

The full setup — creating the secrets, Google credentials, and the end-to-end
walkthrough — is in the
[004 quickstart](specs/004-guest-auth-migration/quickstart.md).

---

## Deployment

One Azure App Service (Linux, F1 free tier) serving both the Angular build and
the API from a single origin, with PostgreSQL on [Neon](https://neon.tech)'s
free tier. **Total cost: $0/month.** The reasoning is under
[same-origin deployment](#same-origin-deployment-chosen-for-a-cookie).

<details>
<summary><strong>One-time provisioning</strong> (click to expand)</summary>

1. **Neon** — create a project and convert the connection string to Npgsql's
   `keyword=value` form; Npgsql rejects the `postgresql://` URI Neon shows
   first. Add `Connection Idle Lifetime=60` so the pool discards connections
   before Neon's ~5-minute autosuspend kills them.

2. **App Service** —

   ```bash
   az group create --name playnext --location brazilsouth
   az appservice plan create --name playnext-plan --resource-group playnext --sku F1 --is-linux
   az webapp create --name <app-name> --resource-group playnext \
     --plan playnext-plan --runtime "DOTNETCORE|10.0"
   az webapp update --resource-group playnext --name <app-name> --https-only true
   ```

3. **Application settings** — the first three are required: the app refuses to
   start without them, deliberately. `ASPNETCORE_FORWARDEDHEADERS_ENABLED` is
   **not optional either** — App Service terminates TLS and forwards plain
   http, so without it the https-redirect sees an insecure request and loops
   forever.

   | Setting | Value |
   |---|---|
   | `ConnectionStrings__Postgres` | the Neon string from step 1 |
   | `Jwt__SigningKey` | 32+ bytes, e.g. `openssl rand -hex 32` — a fresh one, not the dev value |
   | `Tmdb__ApiKey` | your TMDB API read access token |
   | `ASPNETCORE_ENVIRONMENT` | `Production` |
   | `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true` |
   | `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` — the pipeline ships built output |

4. **Turn on basic auth publishing** — new App Service apps ship with it off,
   and while it is off there is no publish profile and *Get publish profile*
   does nothing. Configuration → General settings → **SCM Basic Auth Publishing
   Credentials** → On → Save. Then Overview → **Download publish profile**.

   OIDC would remove this credential rather than re-enable it, but it needs
   directory rights to create an app registration that a subscription alone
   does not grant.

5. **GitHub secrets** — `AZURE_WEBAPP_NAME`, `AZURE_WEBAPP_PUBLISH_PROFILE`,
   and `NEON_CONNECTION_STRING`. No CORS setting is needed.

</details>

**Operating it.** To roll back, redeploy an earlier commit (`git revert`, or
re-run an older workflow run) — the pipeline is the only deploy path.
Migrations are forward-only, so undoing a schema change needs a new migration.

F1 is genuinely free and genuinely limited: **165 MB outbound per day**, after
which Azure stops the app until midnight UTC, and no "always on", so the first
visit after ~20 idle minutes pays a cold start.

---

## Repository layout

| Path | Contents |
|------|----------|
| [frontend/](frontend/) | Angular 22 PWA — standalone components, signals, Tailwind v4 |
| [backend/](backend/) | .NET 10 API — `Domain` → `Application` → `Infrastructure` / `Api` |
| [specs/](specs/) | Five feature specs, each with its plan and task breakdown |
| [docs/](docs/) | Product requirements, design notes, images |
| [.specify/](.specify/) | Spec Kit configuration and the project constitution |

---

## Where this is honestly incomplete

Portfolio READMEs usually stop before this section. The gaps are real, and
knowing them is part of the work:

- **The catalog is TMDB-backed but narrow.** Spec 005 ships the live TMDB
  catalog, but per-service depth is not built: "Netflix + horror" is still 8 of
  916 titles in Brazil. Everything else described above is running.
- **Google sign-in is dormant** — it needs a Google Cloud client id this
  deployment does not have, so the button says so rather than pretending.
- **No coverage threshold is enforced.** There are 911 tests and CI fails on a
  skipped database suite, but nothing fails on a coverage drop.
- **Refresh-token rotation has no reuse detection.** A rotated token is
  invalidated, but a replayed one is not treated as a breach signal.
- **No rate limiting or security headers yet.** Both are known and neither has
  been added.
- **The offline walkthrough is not done on a device.** The sync behaviour is
  covered by tests; the end-to-end pass against a real browser is still open
  (`specs/004-guest-auth-migration/tasks.md`, T046).

The F1 tier is also a demo constraint rather than a design one — a per-service
catalog rebuild would not fit its bandwidth, and a B1 plan (~$13/month) is the
documented upgrade when that work lands.
