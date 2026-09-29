---
target: the deck card
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\usuar\\Documents\\GitHub\\PlayNext\\frontend\\src\\app\\features\\deck\\card\\card.html"
target_fingerprint: "sha256:7710e6ae4596bd14be74357496eae078cdcfce5c836793c8fc5b84ff0a2dfda6"
target_path: "C:\\Users\\usuar\\Documents\\GitHub\\PlayNext\\frontend\\src\\app\\features\\deck\\card\\card.html"
timestamp: 2026-09-29T15-06-09Z
slug: frontend-src-app-features-deck-card-card-html
---
Method: dual-agent (A: a123e73ea8d4d63a3 · B: a87a8f23c0e97bfd8)

Target: frontend/src/app/features/deck/card/card.html — the deck card as experienced (card + its action bar). No browser automation exists in this session, so both assessments worked from source; B attempted browser visualization and correctly reported no overlay and no warning tab.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No loading state — the deck renders a false empty state while the catalogue is in flight |
| 2 | Match System / Real World | 3 | Vocabulary is excellent and consistent; but "Not on your services" shows even when the visitor picked Any provider |
| 3 | User Control and Freedom | 1 | No undo after a rating. disliked/notInterested permanently exclude a title; recovery is 4+ taps on another screen |
| 4 | Consistency and Standards | 2 | The same five actions are two different components (deck vs. detail); nav sets no aria-current; chalk-600 generates no CSS in 2 places |
| 5 | Error Prevention | 1 | Opposite actions sit 6px apart ("Liked It"/"Disliked"), no selected state, no confirm, no undo |
| 6 | Recognition Rather Than Recall | 2 | Labels always visible (right call), but the swipe has zero affordance and "why this card" means recalling the quiz |
| 7 | Flexibility and Efficiency | 2 | Skip is a real one-tap bypass, next poster preloaded; no keyboard path, no swipe-to-rate |
| 8 | Aesthetic and Minimalist Design | 3 | The system is disciplined; the card is a flat dump of every field TMDB returned |
| 9 | Error Recovery | 2 | Poster failure is beautifully handled and tested; a failed catalogue load has no retry |
| 10 | Help and Documentation | 1 | Nothing explains what the five ratings do, or why a card is here — in a product whose stated differentiator is the why |
| **Total** | | **19/40** | **Below the Acceptable band (47.5%)** |

The visual system is the strongest asset on this surface; the score is dragged down by control, recovery and feedback — not by aesthetics.

## Design Specificity Verdict

**The system is authored. The card is not.**

Every token-level decision is genuinely PlayNext's: one accent hue, a five-step near-black ramp, hairlines instead of shadows, one type stack, a 24px radius reserved for exactly one surface, and a --spacing-nav token three consumers share so they agree by construction. That restraint is hard to bolt onto someone else's app.

Strip the tokens and read the card's anatomy — thumbnail, title, violet score badge, year/type/runtime, genre pills, synopsis, provider pills, then a five-way icon+label bar and a Skip/primary pair — and it is the universal streaming-app detail row. Netflix, IMDb, Letterboxd, a podcast app. The engine goes to real trouble to be explainable (matchedGenres, historyAffinity, MISMATCHED_GENRE_PENALTY) and not one word of it reaches the screen. The most prominent element on the card, the only saturated pixel in the viewport, is TMDB's aggregate score — while DESIGN.md's own One Violet Rule says violet belongs to "the thing you chose, not the thing you are being sold."

**Category-interchangeable:** the whole card anatomy; the flat 24px card on near-black; the five-glyph rating bar; the scroll-then-sticky-footer page shape; the diagonal-gradient poster placeholder (the system's one gradient, and it's decoration); "Watch Now" as the label for a button that opens an outbound link; and the swipe, which is imported from dating apps and stripped of meaning — deck.ts:232 routes both directions to skip(), an invisible alias for a button already on screen.

**Could only be PlayNext:** the insistence on keeping the five rating words visible rather than glyph-only (the code comment defending this is the most product-specific thinking in the surface); the provider strip as the last thing above the action bar, on the reasoning that availability is the decision; "Not on your services" instead of a silently missing row; the synopsis shown outright rather than behind a <details>; and the self-clearing per-URL poster placeholder.

**Deterministic scan:** detect on frontend/src/app/features/deck returned 0 findings, 0 advisories, exit 0. Suppression ruled out three ways (no ignore rules, no ignore files, no in-file waivers; also clean with --no-config --no-inline-ignores --no-design-system). The tool is demonstrably reaching this codebase — scanning frontend/src returns 1 finding.

Do not read that clean run as "the card is fine." The detector's rules cover markup defects; it has no rule for a missing loading state, an absent undo, a contrast ratio, or cognitive load. Every problem below was found by the design review, not the scanner — that gap is the honest headline of this run.

One cross-scope finding is worth naming: poster.html is flagged broken-image ("<img> with no src attribute"), and card.ts imports it. That is a false positive — the template opens @if (artworkUrl(); as url), so the <img> only renders when there is a URL, and Angular's [src] binding is invisible to a static-attribute rule.

**Visual overlays:** none. Browser automation is not exposed in this session, so no overlay exists and none was claimed.

## Overall Impression

A disciplined, genuinely well-built card that has not yet decided what it is for. The craft is real — degradation paths are designed rather than patched, the rating vocabulary has one source of truth, and the token layer is unusually restrained. But the card currently answers "what is this title and how do people rate it," which is TMDB's question, not PlayNext's. The single biggest opportunity is to make the card answer why this card is here, and to make the two highest-frequency moments — the first load and every rating — say something back.

## What's Working

1. The rating vocabulary and its single source of truth. RATING_ACTIONS drives both button text and recorded value; RATING_ICONS is a total Record so a new state is a compile error rather than a blank square. The words themselves ("Disliked" vs "Not Interested") are humane, and the code comment defending visible words over glyph-only is exactly right.

2. Degradation as designed behaviour. The synopsis is shown outright so it needs no interaction; the poster placeholder is CSS-only so it cannot fail for the reason the image did, and remembers which URL failed so it self-clears in a recycled @for; an unknown provider id is dropped rather than printed as a-defunct-service. Almost every one pairs a "shows the right thing" test with "and the card is still readable."

3. The restraint is real, not aspirational. Zero shadows verified across the codebase. One accent, one type stack, no webfont, a single shared touch-target utility. --spacing-nav with three consumers is the kind of thing that usually rots into three magic numbers.

## Priority Issues

### [P0] The deck has no loading state, and its false empty state offers to destroy the quiz

**What:** titles starts as [] (deck.ts:75) and is set only when the HTTP load resolves (deck.ts:139). outcome() (deck.ts:133) reads only needsQuiz and eligible().length === 0 — there is no loading branch. So for the entire in-flight window the deck renders <app-empty-state>: "Nothing matches right now — Your filters are too narrow for the titles available today" with a violet Reset Filters button that writes a retake and navigates to /quiz.

**Why it matters:** on a slow connection this is the visitor's first sight of the product: it tells them they failed, then offers to erase their answers. Worse when the load fails with a cold cache — catalog.service.ts:97-99 sets fellBack and returns [] even when nothing was cached (its own comment at line 65 admits this), so the deck shows "Couldn't reach the catalog. Showing saved results." directly above "Your filters are too narrow" — two notices, both false, contradicting each other. Untested: every spec's HTTP double resolves synchronously, so no test ever sees this window.

**Fix:** give CatalogService a tri-state (it already owns fellBack), add a 'loading' outcome, and render a card-shaped skeleton with the action bar absent. Suppress the cached-titles notice when the fallback was empty, and give it a "Try again."

**Suggested command:** /impeccable harden (state coverage) then /impeccable polish

### [P1] Every primary CTA in the app fails WCAG AA — including Watch Now

**What:** white on accent-500 #7c5cff is 4.35:1. Watch Now's label is 16px semibold — not large text (needs >=18.66px bold), so the 4.5:1 threshold applies. It fails. This is not a deck bug: bg-accent-500 appears 13 times across the templates (deck, empty state, Match Found, watchlist, history, detail, profile x2, quiz x2, summary, ways-to-watch). The constitution's Principle I says "high-contrast text"; the app ships 13 buttons missing AA by 0.15.

**Why it matters:** this is the accessibility floor, and it is one token away from passing.

**Fix:** use the declared-but-unused accent-600 #6a46f5 as the button fill — white on it is 5.52:1, verified — which also supplies the pressed state DESIGN.md notes is missing. (Contrast elsewhere is comfortably fine: chalk-300 on ink-900 is 11.06:1, the violet score pill is 5.53:1.)

**Suggested command:** /impeccable audit

### [P1] Rating is silent and irreversible — the app has zero aria-live regions

**What:** pressing a rating writes immediately (interaction-store.ts:138) and swaps the card with no animation, no acknowledgement, and no announcement. Verified 0 aria-live in the entire frontend. Focus correctly stays on the tile, so a screen-reader user hears "Loved It, button" again while the whole card has changed underneath them. A mis-tap on "Disliked" — 6px from "Liked It" — permanently excludes the title and shifts the ranking, recoverable only via Watchlist -> Disliked -> title -> Remove rating.

**Why it matters:** this is the most frequent action in the product and it is both inaudible and, per title, permanent. It is also the moment the product learns — silence here is the difference between "it worked" and "did anything happen?"

**Fix:** (a) one polite live region in the deck announcing "Loved It. 12 rated."; (b) a 4-second "Rated Loved / Undo" strip replacing the action bar, one tap restoring the previous card; (c) a short slide/fade on the card swap — the drag is animated (duration-200) and the far more frequent rating is not.

**Suggested command:** /impeccable animate then /impeccable harden

### [P1] The five-tile rating bar is the smallest type in the system at the highest-frequency decision

**What:** at 360px the footer has 320px; five columns with 6px gaps give ~59px per cell, ~55px of text width. "Not Interested" (~77px at 10px) and "Want to Watch" (~71px) wrap to two lines; the other three don't — so the row is ragged and rows 2 and 4 are the wrapped ones. The tiles have no selected state, no hover, no active, no pressed, and no transition — a tap gives nothing back before the card vanishes. actions.spec.ts:271 only checks they carry touch-target.

**Why it matters:** 10px is below any comfortable mobile reading size, and it is the label that records the judgement. A question with no feedback and a ragged layout reads as something to get past rather than a decision to make.

**Fix:** at 360px go to two rows (3+2) with 12px labels; add a committed state on the tapped tile with a ~120ms hold before advancing. Then reconsider whether "Disliked" and "Not Interested" both need a permanent slot — they behave identically in the ranking (EXCLUDING_STATES) and are undefined anywhere in the UI, so the interface currently asks a five-way question with four real answers.

**Suggested command:** /impeccable layout

### [P2] The product's differentiator is invisible on the card

**What:** PRODUCT.md's positioning is "here is exactly why this card is here." The card shows a third-party score instead. The explainability the engine was built for is computed and thrown away at the last step. The signature gesture compounds this: the swipe is undiscoverable (no hint, no chevron, no peek of the next card) and means nothing (both directions call skip()), so it is either never found or found and pointless.

**Why it matters:** this is the one change on this list that makes the card PlayNext's rather than any streaming app's.

**Fix:** rankTitles already computes matches, historyAffinity and mismatchedGenres — return a short reason with the title and render one line under the facts: "Because you picked Sci-Fi" / "Because you loved Arrival" / "On Netflix, one of your services." Give that line the violet, and demote TMDB's 8.4 to grey 12px where a catalogue fact belongs. Then either make the swipe mean something (right = Want to Watch, left = Not Interested) or make it visible.

**Suggested command:** /impeccable clarify then /impeccable colorize

## Persona Red Flags

**Casey (Distracted Mobile User)**
- Cold load on a slow connection shows "Nothing matches right now" and a big violet Reset Filters — the obvious target, and tapping it wipes the quiz and exits the deck. Interrupt-and-return is her normal mode.
- The 64px nav plus the sticky footer consume roughly the bottom third of a 360px screen; with a three-sentence synopsis the provider badges — the info FR-006 says the card exists to deliver — sit below the fold, and she will not scroll to them.
- Passes: mid-flow refresh genuinely preserves position (the card is derived from the deterministic ranking plus the persisted loop document — there's no cursor to desync). That's a real strength.

**Sam (Accessibility-Dependent)**
- Tapping a rating announces nothing — zero live regions. The card changes entirely and the screen reader says nothing.
- Deck tiles are plain buttons with no aria-pressed; the detail page's near-identical tiles are toggles with aria-pressed. Same five words, two different widgets — no single mental model is possible.
- The score reads "8.4 out of 10" with no hint that it is a third-party audience score rather than PlayNext's own judgement.
- The TMDB attribution link is ~22px tall — under the 44px minimum — and the footer's touch-target test only queries button, so no test sees it.
- Passes: focus order is clean (inert card -> five tiles -> Skip -> Watch Now -> attribution); all text colours except primary-button labels clear AA comfortably.

**Jordan (Confused First-Timer)**
- The five buttons have no heading — nothing establishes that they record a judgement about the card above.
- "Watch Now" promises the one thing the product explicitly cannot do (it hosts nothing). It reads as "play here"; it actually ends the loop and navigates away.
- No confirmation of any action, and no progress signal ("3 of 24") — nothing says whether the deck is 5 cards or 500.

**Marina, 34 — the PRD persona, at 22:40 with 40 minutes left.** The Late-Night Couch describes her exactly, and the card fails her on three things: she never learns the swipe exists; she can't tell whether 8.4 is TMDB's opinion or PlayNext's match, so the determinism that would earn her trust over Netflix's carousel is invisible; and when she taps Watch Now the payoff is a list of link buttons.

## Minor Observations

- Cards swap with no transition; the drag animates and the rating doesn't.
- placeholderText is deliberately omitted — correct for a 112px thumbnail, but it also leaves the full-width md placeholder as an empty gradient slab, the largest element on the card.
- No prefers-reduced-motion handling for the drag transform or its 200ms snap-back (verified: 0 occurrences).
- A title with rating: 0 (TMDB returns 0 for unreleased titles) renders a violet "0.0" — reading as "terrible" rather than "unrated".
- Watch Now is not covered by the rapid-tap tests. recordWatch pushes a history entry unconditionally, so a double-tap appends two entries and calls navigate twice.
- The empty state's "Start a new loop" is a bare underlined ghost link next to a violet CTA — the lower-effort action looks weaker than the one that destroys data.
- accent-600 is declared and used zero times — the fix for the P1 contrast issue is already sitting in the token file.
- Genre/provider pill rows are unbounded; a genre-heavy TMDB title becomes mostly chips.
- Riley's stress pass: long titles, missing posters, no synopsis and 0 providers are all handled and tested. RTL titles render LTR (no dir handling anywhere).

## Questions to Consider

1. If the score pill is the loudest thing on the card, what is the card for? What would have to change for the violet to mark the reason this card is here?
2. Why does this card exist at three sizes and one shape? The poster is a 112px thumbnail on a phone and a hero at md — the two callers disagree about what the card is. If the couch is the north star, shouldn't the artwork be the room?
3. Is it five ratings, or three? If "Disliked" and "Not Interested" behave identically, does giving each a permanent 59px cell earn its space — and would the 10px-label problem simply disappear?
4. What is the reward? Thirty flat taps pay out nothing until the exit. Would "12 rated · 3 want to watch" turn the loop into something a person wants to finish, or just add database to a product whose value is removing it?
