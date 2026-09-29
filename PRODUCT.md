# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Today: one user — the person who built it.** PlayNext exists to solve its
builder's own streaming paralysis and to practise spec-driven full-stack
engineering (.NET, Angular, Azure). Confirmed 2026-09-29: *personal now, public
later*. Nothing is optimized for growth — but nothing may assume a single
expert user either, because copy, empty states and error states must still be
legible to a stranger.

For the later public state the PRD's persona is on record: tech-literate
entertainment consumers, roughly 15–45, holding subscriptions across several
streaming services, who want a fast decision without a lengthy onboarding or a
native app download.

**Situation:** sitting down to watch something, phone in hand, having already
lost 15–30 minutes browsing catalogs.
**Job:** arrive at one title worth watching, on a service they already pay for,
in under two minutes.

## Product Purpose

PlayNext turns "what should I watch?" into a single decision. A ~30-second quiz
(media type, genre, the services they subscribe to) feeds a swipeable deck that
shows one title at a time — synopsis, rating, genres, where to watch. Ratings
(*Loved*, *Liked*, *Disliked*, *Want to Watch*, *Not Interested*) tune what
comes next, and a rejected title is never suggested again.

Success, from the PRD and the constitution: median time from landing to locking
in a choice under 2 minutes; over 80% of guests finish the quiz; a card renders
in under 300ms.

## Positioning

**One decision at a time, not catalog browsing** — the constitution names
catalog-style browsing as explicitly not the primary flow. **Deterministic and
explainable** — weighted scoring over genres, ratings and the visitor's own
history; no ML, identical inputs produce an identical deck, and any card can be
justified in words. **It hosts and streams nothing** — "Watch Now" links out to
official services through provider metadata.

A neighbouring product could copy the swipe deck. It could not truthfully copy
"no ML, no catalog, and here is exactly why this card is here."

## Operating Context

- **Guest-first.** The whole loop works with no account, state in LocalStorage.
  An account (email/password, or Google OAuth) is optional and migrates guest
  data rather than asking for it twice.
- **Phone first, desktop as enhancement.** 360px and thumb reach define the
  layout; up to 4K is progressive. Installable PWA, dark by default.
- **The catalog is real TMDB data** served through this project's own .NET API
  (spec 005), including "where to watch" availability scoped to the visitor's
  region. Region is a runtime input, not a build constant.
- **Ranking runs client-side** and is pure and deterministic; the backend holds
  accounts and the canonical copy of a signed-in visitor's quiz answers, ratings
  and history.
- **Infrastructure is free/low-cost Azure** — Static Web Apps, Container Apps or
  App Service, free-tier PostgreSQL. No service is added without a cost check.
- **Vocabulary is binding across domain, API and UI** (constitution): Loved,
  Liked, Disliked, Want to Watch, Not Interested, Watching Now.
- **Every feature goes through Spec Kit** — specify → plan → tasks → implement,
  governed by constitution v1.2.0.

## Capabilities and Constraints

**Shipped** (specs 001–005): the onboarding quiz; the swipeable deck; the rating
vocabulary; watchlist, history and title detail; guest browsing; accounts,
guest→account migration and session handling; the real TMDB catalog behind our
own API.

**Known gaps, on record:** the quiz has no language filter yet; Google sign-in
has no Google Cloud client id in this deployment and the button says so rather
than pretending; the 004 end-to-end browser walkthrough (T046) is outstanding —
that behaviour is covered by tests, not yet by a device.

**In scope for the MVP UI:** a **Settings screen** (subscriptions, default
content languages, credentials) — confirmed 2026-09-29.

**Deferred, and not to be given placeholder affordances:** cast lists and
trailer embeds on the deck and Match Found — confirmed 2026-09-29.

**Hard constraints:** no hosting or streaming media; no social features; no
native apps (PWA only); no ML. Provider credentials live server-side only — the
client talks to our API and nothing else.

**Open, not yet decided:** the interface language (all copy is English today
while region is a runtime input); whether anime is a first-class catalog
category and from where (TMDB has no anime genre, and the README names anime
alongside movies and TV).

## Brand Commitments

- **Name:** PlayNext. **Tagline:** "Stop scrolling, start watching."
- **Voice is draft.** Confirmed 2026-09-29: the existing copy was written to get
  the flows working and a design pass may rewrite it. It currently reads calm,
  sentence case, second person, em dashes — evidence of intent, not a binding
  constraint.
- **Theme colour** `#0b0b0f` for the PWA shell (near-black).
- **Assets:** an icon set at 72–512px (maskable) plus `favicon.ico` under
  `frontend/public/icons/`. No editable vector source for the mark is in the
  repo.
- **Legal, non-negotiable:** TMDB's API terms require the TMDB logo **and** the
  verbatim notice sentence, and require that attribution to be *less prominent*
  than the marks identifying this app. The shared `app-attribution` component
  renders it on every screen that shows TMDB titles or artwork, and
  `attribution.spec.ts` pins the wording because it is a term of the licence
  rather than copy. `frontend/public/tmdb-logo.svg` is bundled, not hotlinked. A
  redesign may restyle it; it may not drop, reword, enlarge or hide it.

## Evidence on Hand

- `docs/product-requirement-document.md` — the PRD: problem, persona, OKRs,
  non-goals, edge-case copy, milestones.
- `.specify/memory/constitution.md` v1.2.0 — the governing principles.
- `specs/001`–`specs/005` — each with `spec.md`, `plan.md` and `tasks.md`, plus
  the recommendation engine's contract in 002.
- Titles, posters and ratings are real TMDB data; availability is TMDB
  watch-provider data.

**Absent, and not to be invented:** testimonials, customer logos, press, download
counts, benchmarks, analytics, pricing or revenue claims. There are no users
other than the builder, and no traffic data exists.

## Product Principles

1. **One decision at a time.** The deck is the product; browsing is explicitly
   not the primary flow. A feature that slows *open → recommend → rate* must
   justify itself or be cut.
2. **Never a dead end.** An empty result gets an actionable reset; a TMDB outage
   serves cached titles behind a visible notice. The loop degrades, it does not
   stop.
3. **Explainable over clever.** Deterministic scoring, no ML — identical inputs
   produce an identical deck, and a visitor could be told why a card is there.
4. **Phone first, always.** 360px, 44px touch targets, thumb reach. Desktop is
   an enhancement, never the target.
5. **Guest-first, account-optional.** Nothing is gated behind registration, and
   converting to an account never loses what the guest already told us.

## Accessibility & Inclusion

Constitution I requires full usability at 360px, touch targets of at least 44px,
dark mode by default and high-contrast text. No formal standard (a WCAG level,
for instance) has been adopted — undecided. Target browsers: latest iOS Safari,
Android Chrome, desktop Chrome, Firefox and Edge.
