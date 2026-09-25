# 🎬 PlayNext

> **Stop scrolling, start watching.**

PlayNext is a mobile-first, decision-making web app that helps you instantly find movies, TV shows, or anime to watch (or rewatch) based on your current vibe and available streaming platforms.

### 🚀 Key Features
- **Quick Onboarding Quiz:** Filter by media type, genres, language, and accessible streaming services.
- **Swipeable Recommendation Deck:** One decision at a time with rich details, ratings, and streaming availability.
- **Instant Ratings:** Track what you've *Loved*, *Liked*, *Disliked*, or *Want to Watch*.
- **Guest & User Persistence:** Zero-friction guest browsing with seamless account migration.

### 🛠️ Tech Stack
- **Frontend:** Angular 22, Tailwind CSS v4, Vitest
- **Backend:** .NET 8 REST API (C#)
- **Database:** PostgreSQL (EF Core)
- **Integrations:** TMDB API (The Movie Database) & JustWatch

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