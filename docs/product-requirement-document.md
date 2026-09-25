PlayNext
Product Requirements Document (PRD)

1. Problem Statement & Vision
Core Problem: Users waste 15–30 minutes browsing streaming catalogs trying to decide what movie, TV show, or anime to watch next (or rewatch) that matches their current mood, available time, language, and streaming platforms in my country that I have an active subscription to.
Why Now? Practice modern full-stack software engineering using Spec-Driven Development, .NET REST APIs, Angular, and cloud deployment on Azure, while building a real-world tool to solve personal streaming paralysis.
Product Vision: An instant, low-friction recommendation engine that takes a 30-second preference quiz and presents tailored watch suggestions one at a time, allowing users to find content in under 2 minutes.
Target Audience / Persona: Tech-literate entertainment consumers (ages 15–45) who hold subscriptions across multiple streaming platforms and want rapid decision-making without lengthy onboarding or downloading native apps.
2. Core Objectives & Key Results (OKRs)
Primary Goal: Build a fully functional, mobile-first Web Application using .NET and Angular hosted on low-cost Azure infrastructure.
Success Metrics:
Time to Decision: Median time from entering the site to clicking "Watching This!" is under 2 minutes.
Quiz Completion: >80% of guests complete the onboarding quiz without bouncing.
Performance: Sub-300ms response time for recommendation fetching.
Non-Goals (Scope Boundaries for MVP):
❌ No Video Streaming: The app will not host or stream media content (it only links out to official streaming services via provider metadata).
❌ No Social Network/Feed: No friend lists, public comment sections, or social feeds in v1.
❌ No Native Mobile Apps: Web app/Progressive Web App (PWA) only; no iOS App Store or Google Play Store builds.
❌ No Complex Machine Learning Models: Initial recommendations will use deterministic weighted scoring based on tags, genres, ratings, and user history rather than expensive AI/ML pipelines.
3. Core Features & User Stories
User Authentication & Profiles
Guest Mode: Guests can use the full quiz and recommendation loop without registering. State is persisted in browser LocalStorage.
Registered Users: Email/Password or Google OAuth login using ASP.NET Core Identity and JWT (JSON Web Tokens).
Guest-to-User Migration: Upon registering, guest interaction history and saved preferences seamlessly transfer to the user's permanent database account.
User Stories
As a Guest/User, I want to complete a 3-question mood quiz (Type: Movie/Show/Anime, Genre/Theme, Streaming Services I have) so that I only see available content matching my vibe.
As a User, I want to see a single recommendation card at a time with rich metadata (synopsis, cast, ratings, streaming provider logos) so that I am not overwhelmed by options.
As a User, I want to rate suggestions with 1 click (Loved It, Liked It, Disliked, Want to Watch, Not Interested) so that the app learns my preferences and stops showing irrelevant titles.
As a User, I want to click "Watch Now" to lock in my choice, stop the loop, and see direct links to where it is streaming.
As a Registered User, I want my streaming provider selections and watch history saved automatically across sessions.
Feature Acceptance Criteria
Filter Enforcement: The engine must never suggest titles unavailable on the user's selected streaming services, unless the user toggles "Show content on other platforms".
Feedback Loop: Items marked as Disliked or Not Interested must never be suggested again to the same user/session.
4. User Interface (UI) & User Experience (UX)
Design Guidelines
Mobile-First & Minimalist: Dark mode by default (fits movie/theater aesthetics), high-contrast text, large touch targets for thumb navigation.
Recommended Component System
Angular + Tailwind CSS (or Angular Material with custom dark theme). Tailwind allows for rapid styling of sleek, Tinder-like recommendation cards and clean modal overlays.
Screen Inventories
Quick Onboarding / Mood Quiz View: Stepper UI with pills/chips for multi-select (e.g., Genres, Anime vs. Movie vs. Series, Streaming Providers).
Recommendation Stack View (Main View): Large hero poster art, title, release year, IMDb/TMDB ratings, streaming provider badges, collapse/expand synopsis, and bottom sticky action buttons.
"Match Found" / Victory View: Displayed when user clicks "Watch This!". Shows direct deep link to stream, trailer video embed (YouTube API/TMDB), and option to start a new recommendation loop.
Watchlist & History View (Registered Users): Tabbed list showing Want to Watch, Loved, and Disliked media.
Settings View: Manage streaming subscriptions, default content languages, and account credentials.
Navigation & Layout
Mobile Layout: Fixed bottom navigation bar ([Quiz / Discover], [My Watchlist], [Profile]).
Desktop Layout: Centered mobile card frame or wide dashboard with persistent sidebar.
5. Technical Architecture & Data Models
Technology Stack
Frontend: Angular (latest version) with RxJS and Tailwind CSS.
Backend: .NET 8 / .NET 9 Web API (Minimal APIs or Controllers) written in C#.
API Style: REST API (REST is ideal here due to predictable endpoint structures, standard HTTP caching, and simple client-side integration with Angular HttpClient).
Database: PostgreSQL with Entity Framework Core (EF Core).
External Integration: TMDB API (The Movie Database) for metadata, poster images, cast lists, ratings, and JustWatch streaming availability per region.
Low-Cost Azure Infrastructure Architecture
Frontend: Azure Static Web Apps (Free Tier).
Backend API: Azure Container Apps (Scale-to-zero free tier) OR Azure App Service (F1 Free Tier).
Database: Supabase / Neon (Free Tier PostgreSQL) or Azure Database for PostgreSQL (Flexible Server - Burstable/Serverless).
Caching: In-Memory Cache (IMemoryCache in .NET) to cache TMDB API requests locally and avoid rate limits.
+-------------------------------------------------------------------+
|                        Client Layer                               |
|       Angular PWA / Mobile Browser (Azure Static Web Apps)        |
+---------------------------------+---------------------------------+
                                  |
                           REST / JSON (HTTPS)
                                  v
+-------------------------------------------------------------------+
|                        Backend API                                |
|        .NET Web API / EF Core (Azure Container Apps / App Service)|
+----------------+--------------------------------+-----------------+
                 |                                |
        SQL Read/Write                   External REST API
                 v                                v
+---------------------------------+  +------------------------------+
|     PostgreSQL Database         |  |        TMDB API              |
|  (Users, Ratings, Preferences)  |  |  (Movie/Show Data & Providers|
+---------------------------------+  +------------------------------+

Key Data Entities (ERD Overview)
User: Id, Email, PasswordHash, CreatedAt, RegionCode (e.g., 'US', 'BR').
UserPreference: UserId, SelectedProviders[], PreferredLanguages[], IncludeUnownedProviders.
UserInteraction: Id, UserId (or GuestSessionId), TmdbMediaId, MediaType (Movie/TV), InteractionState (Loved, Liked, Disliked, WantToWatch, NotInterested, WatchingNow), Timestamp.
6. Non-Functional Requirements (NFRs)
Performance
Card Render Time: Initial recommendation card must render in <300ms.
External API Latency: External TMDB API calls must be cached aggressively server-side to guarantee rapid card swipes.
Security & Compliance
API Key Security: TMDB API keys must remain strictly on the .NET server-side (stored in Azure App Settings / Key Vault). Never expose keys in the Angular bundle.
Authentication: Passwords hashed with ASP.NET Core Identity (PBKDF2 with HMAC-SHA256). JWTs signed with RSA/HMAC SHA256 and short expiration times.
Web Protections: Enforce strict CORS policy (allow requests only from the frontend domain), protection against SQL Injection via EF Core parameterized queries, and CSRF protection.
Scalability & Reliability
Cache Strategy: Use .NET IMemoryCache for trending movies/genres by provider to drastically lower DB and external API overhead.
Database Optimization: Indexes on (UserId, TmdbMediaId) in the UserInteraction table for instant lookup during filtering.
Browser & Device Support
Target latest versions of iOS Safari, Android Chrome, Desktop Chrome, Firefox, and Edge. Responsive design break points targeted at 360px up to 4K displays.
7. Edge Cases & Error Handling
Scenario / Edge Case
Expected System Behavior
No Matches Found (e.g., User filtered for Icelandic Horror on an unused provider).
Show an empty state card: "No titles match all filters! Try enabling more streaming services or expanding genres." with a 1-click "Reset Filters" button.
External API Outage (TMDB is down).
Fail gracefully; serve fallback recommendations stored in local database cache with a notification banner "Showing offline cached suggestions".
Guest Registers Mid-Session
Merge LocalStorage interaction history into the newly created Postgres user profile automatically without losing rating history.
Network Loss / Offline
Show a offline toast banner; allow users to browse already-loaded recommendation cards.

8. Development Roadmap & Release Plan

Milestone 1: Angular Prototype & Wireframe (Mock Data)
- Build mobile-first Angular layout (Quiz + Card View + Buttons)
- LocalStorage integration for state management


Milestone 2: .NET API & TMDB Service Integration
- Build .NET Web API with TMDB Client Wrapper
- Implement deterministic recommendation filtering endpoint


Milestone 3: Postgres DB, Auth & User State Persistence
- Setup EF Core & PostgreSQL schema
- Implement ASP.NET Identity, JWT Auth, and Guest Data Migration


Milestone 4: Azure Deployment & CI/CD Pipeline
- Setup GitHub Actions workflows for Angular & .NET
- Deploy to Azure Static Web Apps + Azure Container Apps / Database

