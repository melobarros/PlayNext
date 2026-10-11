# 🎬 PlayNext

> **Stop scrolling, start watching.**

PlayNext is a mobile-first, decision-making web app that helps you instantly find movies, TV shows, or anime to watch (or rewatch) based on your current vibe and available streaming platforms.

### 🚀 Key Features

| Feature | Status |
|---------|--------|
| **Quick Onboarding Quiz** — filter by media type, genre, and the services you actually have | ✅ 001 |
| **Swipeable Recommendation Deck** — one decision at a time, with synopsis, rating, and where to watch | ✅ 002 |
| **Instant Ratings** — *Loved*, *Liked*, *Disliked*, *Want to Watch*, *Not Interested*, recorded as you decide | ✅ 002 |
| **Watchlist & history** — three tabs over your ratings, a title's details, re-rate or remove, and a log of everything you chose to watch | ✅ 003 |
| **Guest browsing** — no account, and nothing leaves the device | ✅ 001 |
| **Accounts & migration** — sign up (or sign in) later and keep everything you already told us, merged rather than re-entered | ✅ 004 |
| **Session handling** — an access token renewed silently, an expired session that keeps your cached data, and a password you can change | ✅ 004 |
| **Real catalog** — TMDB titles, JustWatch availability, cached server-side | ⏳ Milestone 2 |

Three gaps between this list and what runs today: the quiz has no **language**
filter yet (001 filters on media type, genre, and providers); the catalog is a
small bundled sample rather than TMDB; and Google sign-in needs a Google Cloud
client id this deployment does not have, so the button says as much instead of
pretending to work.

Offline sync is the part worth describing, because it is invisible when it
breaks: a change you make with no connection is queued on your device and sent
when the connection comes back, or when the app next opens — so it does not wait
for you to sign out. The
end-to-end walkthrough against a real browser is still outstanding
(`specs/004-guest-auth-migration/tasks.md`, T046) — the behaviour above is
covered by tests, not yet by a device.

### 🛠️ Tech Stack
- **Frontend:** Angular 22, Tailwind CSS v4, Vitest — running today
- **Backend:** .NET 10 REST API (C#), ASP.NET Core Identity + JWT — running today
- **Database:** PostgreSQL (EF Core)
- **Integrations:** TMDB API (The Movie Database) & JustWatch — Milestone 2

The client runs entirely from LocalStorage while nobody is signed in, and that
is the design rather than a stage: a guest has no account to sync to. The
backend (004) holds accounts and the canonical copy of a signed-in visitor's
data — quiz answers, ratings, and watch history — and TMDB and JustWatch arrive
with Milestone 2. API keys are server-side by design; they never ship to the
client, and the backend caches TMDB responses.

### 🏁 Getting Started

```bash
cd frontend
npm install
npm start          # http://localhost:4200
```

Requires Node.js `^22`, `^24`, or `^26`. See
[frontend/README.md](frontend/README.md) for tests, the production build, and
the project layout.

That is enough to use the app as a guest. **Signed-in features need the API**,
which needs .NET SDK 9, PostgreSQL, and two secrets (a connection string and a
JWT signing key) that live in user-secrets and never in the repo:

```bash
cd backend
dotnet ef database update --project src/PlayNext.Infrastructure --startup-project src/PlayNext.Api
dotnet run --project src/PlayNext.Api
```

The full setup — creating the secrets, Google credentials, and the walkthrough
that verifies the feature end to end — is in the
[004 quickstart](specs/004-guest-auth-migration/quickstart.md).

### ☁️ Deployment

The whole app runs on **one Azure App Service** (Linux, F1 free tier), which
serves the Angular build from its own `wwwroot` and the API from `/api` on the
same origin. PostgreSQL runs on [Neon](https://neon.tech)'s free tier. **Total
cost: $0/month.**

One origin is the point, not a convenience. The session refresh token is an
httpOnly cookie, so serving the frontend from a second host would make it a
third-party cookie — which Safari and Firefox block, signing people out every
fifteen minutes. Azure's own fix for that (Static Web Apps *linked backends*)
needs the SWA Standard and App Service S1 plans together, around $80/month.

Every push to `main` runs
[deploy.yml](.github/workflows/deploy.yml): tests (including the integration
suite against a throwaway Postgres) → migrations → deploy → smoke test of the
live URL. A red test never reaches production, and neither does a migration
that fails.

#### One-time setup

1. **Neon** — create a project and copy the connection string. It must be in
   Npgsql's `keyword=value` form, because Npgsql does not accept the
   `postgresql://` URI Neon shows first:
   `Host=<host>;Database=neondb;Username=…;Password=…;SSL Mode=Require;Trust Server Certificate=true`.
   Add `Connection Idle Lifetime=60` so the pool discards connections before
   Neon's ~5-minute autosuspend kills them.

2. **App Service** —

   ```bash
   az group create --name playnext --location brazilsouth
   az appservice plan create --name playnext-plan --resource-group playnext --sku F1 --is-linux
   az webapp create --name <app-name> --resource-group playnext \
     --plan playnext-plan --runtime "DOTNETCORE|10.0"
   az webapp update --resource-group playnext --name <app-name> --https-only true
   ```

3. **Application settings** — the first three are required: `Program.cs`
   refuses to start without them, deliberately, so a misconfigured environment
   fails at boot rather than answering every request as if the data were empty.
   `ASPNETCORE_FORWARDEDHEADERS_ENABLED` is **not optional either** — App
   Service terminates TLS and forwards plain http, so without it the
   https-redirect sees an insecure request and loops forever. Semicolons in
   the connection string are awkward to pass through `az` from PowerShell; the
   portal's Configuration blade is the easier route.

   | Setting | Value |
   |---|---|
   | `ConnectionStrings__Postgres` | the Neon string from step 1 |
   | `Jwt__SigningKey` | 32+ bytes, e.g. `openssl rand -hex 32` — generate a fresh one, not the dev value |
   | `Tmdb__ApiKey` | your TMDB API read access token |
   | `ASPNETCORE_ENVIRONMENT` | `Production` |
   | `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true` |
   | `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` — the pipeline ships built output |

4. **Turn on basic auth publishing** — App Service ships new apps with it
   disabled, and while it is off there is no publish profile to download and the
   *Get publish profile* button does nothing. App Service → *Configuration* →
   *General settings* → **SCM Basic Auth Publishing Credentials** → **On** →
   Save. Then **Overview** → **Download publish profile**.

   OIDC would remove this credential rather than re-enable it, but it needs
   directory rights to create an app registration. A subscription alone does not
   grant those — you can create an App Service without being able to read the
   Entra ID blade at all.

5. **GitHub secrets** — `AZURE_WEBAPP_NAME`, `AZURE_WEBAPP_PUBLISH_PROFILE`
   (`az webapp deployment list-publishing-profiles --resource-group playnext
   --name <app-name> --xml`), and `NEON_CONNECTION_STRING`. No CORS setting is
   needed: same-origin requests do not trigger CORS.

#### Operating it

To roll back, redeploy an earlier commit (`git revert` and push, or re-run an
older workflow run) — the pipeline is the only deploy path. Migrations are
forward-only, so a rollback that undoes a schema change needs a new migration.

The F1 tier is genuinely free and genuinely limited: **165 MB of outbound
traffic per day**, then Azure stops the app until midnight UTC, and no
"always on", so the first visit after ~20 idle minutes pays a cold start. Both
are fine for personal use; a rebuild of the per-service catalog in
[spec 007](specs/007-per-service-catalog/spec.md) would not be, and roughly
$13/month for a B1 plan is the upgrade when that lands.

### 📁 Repository Layout

| Path | Contents |
|------|----------|
| [frontend/](frontend/) | Angular PWA client |
| [backend/](backend/) | .NET 10 API — `Domain` → `Application` → `Infrastructure` / `Api`, dependencies pointing inward |
| [specs/](specs/) | Feature specs, plans, and task breakdowns |
| [docs/](docs/) | Product requirements and design notes |
| [.specify/](.specify/) | Spec Kit configuration and project constitution |

### 📐 Development Process

Features are specified, planned, and broken into tasks before implementation —
one vertical slice at a time. Each feature's `spec.md`, `plan.md`, and
`tasks.md` live side by side under [specs/](specs/), and the non-negotiable
project principles are in [.specify/memory/constitution.md](.specify/memory/constitution.md).