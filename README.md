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
the next time the app opens, so it does not wait for you to sign out. The
end-to-end walkthrough against a real browser is still outstanding
(`specs/004-guest-auth-migration/tasks.md`, T046) — the behaviour above is
covered by tests, not yet by a device.

### 🛠️ Tech Stack
- **Frontend:** Angular 22, Tailwind CSS v4, Vitest — running today
- **Backend:** .NET 9 REST API (C#), ASP.NET Core Identity + JWT — running today
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

### 📁 Repository Layout

| Path | Contents |
|------|----------|
| [frontend/](frontend/) | Angular PWA client |
| [backend/](backend/) | .NET 9 API — `Domain` → `Application` → `Infrastructure` / `Api`, dependencies pointing inward |
| [specs/](specs/) | Feature specs, plans, and task breakdowns |
| [docs/](docs/) | Product requirements and design notes |
| [.specify/](.specify/) | Spec Kit configuration and project constitution |

### 📐 Development Process

Features are specified, planned, and broken into tasks before implementation —
one vertical slice at a time. Each feature's `spec.md`, `plan.md`, and
`tasks.md` live side by side under [specs/](specs/), and the non-negotiable
project principles are in [.specify/memory/constitution.md](.specify/memory/constitution.md).