# 🎬 PlayNext

> **Stop scrolling, start watching.**

PlayNext is a mobile-first, decision-making web app that helps you instantly find movies, TV shows, or anime to watch (or rewatch) based on your current vibe and available streaming platforms.

### 🚀 Key Features

| Feature | Status |
|---------|--------|
| **Quick Onboarding Quiz** — filter by media type, genre, and the services you actually have | ✅ 001 |
| **Swipeable Recommendation Deck** — one decision at a time, with synopsis, rating, and where to watch | ✅ 002 |
| **Instant Ratings** — *Loved*, *Liked*, *Disliked*, *Want to Watch*, *Not Interested*, recorded as you decide | ✅ recorded in 002; the screen to review them is 003 |
| **Guest browsing** — no account, nothing leaves the device | ✅ 001 |
| **Account migration** — sign up later without losing what you told us | ⏳ 004 |
| **Real catalog** — TMDB titles, JustWatch availability, cached server-side | ⏳ Milestone 2 |

Two gaps between this list and what runs today: the quiz has no **language**
filter yet (001 filters on media type, genre, and providers), and the catalog is
a small bundled sample rather than TMDB.

### 🛠️ Tech Stack
- **Frontend:** Angular 22, Tailwind CSS v4, Vitest — running today
- **Backend:** .NET 8 REST API (C#)
- **Database:** PostgreSQL (EF Core)
- **Integrations:** TMDB API (The Movie Database) & JustWatch

Only the frontend exists so far. Milestone 1 is the Angular prototype on mock
data and LocalStorage; the backend, database, and integrations arrive with
Milestone 2. TMDB keys are server-side by design — they never ship to the
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

### 📁 Repository Layout

| Path | Contents |
|------|----------|
| [frontend/](frontend/) | Angular PWA client |
| `backend/` | .NET API — not yet created (arrives in Milestone 2) |
| [specs/](specs/) | Feature specs, plans, and task breakdowns |
| [docs/](docs/) | Product requirements and design notes |
| [.specify/](.specify/) | Spec Kit configuration and project constitution |

### 📐 Development Process

Features are specified, planned, and broken into tasks before implementation —
one vertical slice at a time. Each feature's `spec.md`, `plan.md`, and
`tasks.md` live side by side under [specs/](specs/), and the non-negotiable
project principles are in [.specify/memory/constitution.md](.specify/memory/constitution.md).