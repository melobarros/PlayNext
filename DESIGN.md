---
name: PlayNext
description: Stop scrolling, start watching — a dark, quiet deck for one decision at a time.
colors:
  projector-black: "#0b0b0f"
  projector-black-surface: "#15151c"
  projector-black-raised: "#1e1e28"
  projector-black-line: "#2a2a36"
  projector-black-line-strong: "#3a3a4a"
  screen-grey-bright: "#f5f5f7"
  screen-grey: "#c9c9d4"
  screen-grey-muted: "#a1a1ad"
  neon-violet-bright: "#9b82ff"
  neon-violet: "#7c5cff"
  neon-violet-deep: "#6a46f5"
typography:
  display:
    fontFamily: "system-ui, ui-sans-serif, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
  headline:
    fontFamily: "system-ui, ui-sans-serif, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.33
  title:
    fontFamily: "system-ui, ui-sans-serif, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, ui-sans-serif, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  action:
    fontFamily: "system-ui, ui-sans-serif, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, ui-sans-serif, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.2em"
rounded:
  lg: "8px"
  xl: "12px"
  "2xl": "16px"
  "3xl": "24px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  nav: "64px"
components:
  button-primary:
    backgroundColor: "{colors.neon-violet}"
    textColor: "#ffffff"
    typography: "{typography.action}"
    rounded: "{rounded.full}"
    padding: "0 24px"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.screen-grey}"
    typography: "{typography.action}"
    rounded: "{rounded.full}"
    padding: "0 20px"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.screen-grey-muted}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "44px"
  chip:
    backgroundColor: "{colors.projector-black-raised}"
    textColor: "{colors.screen-grey}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.neon-violet}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "44px"
  card:
    backgroundColor: "{colors.projector-black-surface}"
    textColor: "{colors.screen-grey-bright}"
    rounded: "{rounded.3xl}"
    padding: "16px"
  input:
    backgroundColor: "{colors.projector-black-surface}"
    textColor: "{colors.screen-grey-bright}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "0 16px"
    height: "44px"
  rating-pill:
    backgroundColor: "{colors.projector-black-raised}"
    textColor: "{colors.neon-violet-bright}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
---

# Design System: PlayNext

## Overview

**Creative North Star: "The Late-Night Couch"**

One person, phone in hand, lights off. Not a theater and not a cinema lobby — a
couch at midnight, where the only thing competing for attention is the title on
screen. The interface should read as *editorial, quiet, sharp*: a well-set page
rather than app chrome, where typographic hierarchy carries the layout and
colour is nearly absent.

What is built today already has the right bones for that. There are no shadows
anywhere in the application — depth comes entirely from a five-step near-black
ramp and 1px hairlines, which is an unusually disciplined foundation. Contrast
does the heavy lifting: bright chalk text on projector black, with one violet
accent.

Where the incumbent and the North Star diverge is *how much* that violet is
asked to do. Today it marks primary buttons, selected chips, the rating score on
every card, the active navigation item, focus rings and eyebrow labels. That is
chrome doing the talking. The direction this record commits to is to let type,
spacing and the ramp carry more, and to reserve violet for genuine state — the
thing you chose, not the thing you are being sold.

**Key Characteristics:**

- Dark only, by product constraint rather than fashion — the PRD's own words are
  that dark "fits movie/theater aesthetics", and the constitution makes it the
  default.
- Flat by construction: zero shadows in the entire codebase (verified by scan),
  depth expressed as tonal steps and hairlines.
- One accent hue, no second colour, and **no error/destructive colour at all** —
  a real gap, recorded under Do's and Don'ts.
- A single 448px column on every screen, phone-first from a 360px floor.
- All type from the system font stack; no webfont is loaded, and nothing in the
  design depends on one.
- Every interactive target is at least 44px, enforced by one shared utility
  (`touch-target`) rather than by discipline.

## Colors

A near-black room, a grey text ramp, and one violet. Almost all of the surface
area in the product is the two darkest steps.

### Primary

- **Neon Violet Deep** (#6a46f5): the resting fill for every primary button and
  selected chip, and the alpha-400 sibling on the swipe hint pill. Chosen over
  the core violet because white on #7c5cff measures 4.35:1 — under AA for body
  text — while white on #6a46f5 measures **5.52:1**. The fill is where the
  contrast is spent.
- **Neon Violet** (#7c5cff): the accent, and the only saturated colour in the
  system. Now the *hover* state on the same fills, where it can be lighter
  because it is momentary and paired with the pointer — plus the native checkbox
  `accent-color`.
- **Neon Violet Bright** (#9b82ff): the readable violet. Used for text and thin
  strokes where the fill violet would sit too close to the background — the
  card's reason line, the active navigation item, the selected rating tile's
  border and label, the swipe hint's border and label, eyebrow labels, and the
  global focus ring.

Press states are `active:brightness-90` rather than a fourth violet: a fill that
darkens needs no new token and cannot drift from the fill it belongs to.

### Neutral

**Projector Black** — the surfaces, darkest first:

- **Projector Black** (#0b0b0f): the app background and the PWA theme colour.
  Every screen sits on it.
- **Projector Black Surface** (#15151c): the raised surface — deck card,
  watchlist and history rows, panels, text inputs, rating tiles.
- **Projector Black Raised** (#1e1e28): the badge fill — rating pill, provider
  pills, notice banners.
- **Projector Black Line** (#2a2a36): the hairline. Card borders, input borders,
  row borders, genre pills, and the rating tile's resting border.
- **Projector Black Line Strong** (#3a3a4a): the heavier border, used for
  secondary buttons and unselected chips. The step between this and the hairline
  carries no rule today — see the critique.

**Screen Grey** — the text, darkest last:

- **Screen Grey Bright** (#f5f5f7): body text and headings, the default text
  colour.
- **Screen Grey** (#c9c9d4): content one step down — secondary button labels,
  card facts, synopses, unselected chip labels, row metadata.
- **Screen Grey Muted** (#a1a1ad): the quiet register — inactive navigation,
  ghost links, captions, status notices.

### Named Rules

**The One Violet Rule.** Violet is a state, not a mood. It may mark what the
visitor has chosen or where they are, and it may mark a primary action — never
decoration, never a heading, never a background wash. Its rarity is what makes
"selected" legible without a checkmark.

**The Hairline Rule.** Depth is a 1px border or a tonal step, never a shadow. If
a surface needs to feel raised, move it one step up the Projector Black ramp.
There is no shadow vocabulary in this system to reach for.

## Typography

**Display Font:** system-ui (with ui-sans-serif, sans-serif)
**Body Font:** system-ui — the same stack; there is no second family.

**Character:** one system stack, no webfont, no typographic flourish. The
hierarchy is carried entirely by size, weight and colour, which is exactly what
"editorial, quiet, sharp" asks for — the page is set, not styled. Only two
weights exist in the whole application: medium (500) for interactive things and
semibold (600) for headings and scores. There is no bold.

### Hierarchy

- **Display** (600, 30px, 1.2): the Match Found title, and the poster
  placeholder's wordmark. One screen only — it is the payoff moment.
- **Headline** (600, 24px, 1.33): screen titles — Profile, Watchlist, History,
  and a title's detail page.
- **Title** (600, 20px, 1.4): the deck card's title and the quiz step questions.
  `text-balance` on the card title, so a long name breaks evenly.
- **Body** (400, 16px, 1.5): running copy and row titles. Row titles take
  semibold and `truncate`; synopses take 14px with `leading-relaxed` and
  `text-pretty`.
- **Action** (500–600, 16px): every button and chip label. The weight split
  between 500 and 600 is inconsistent today — see the critique.
- **Label** (600, 12px, uppercase, 0.2em tracking): eyebrows and pill text.
  `tracking-wide` (0.025em) appears on quiz and summary labels as a lighter
  variant of the same idea.

One size sits outside that scale and is deliberate: the TMDB attribution sentence
at **9px** — it is required to be less prominent than the app's own marks. The
deck's rating tile labels were the other, at 10px, until the bar was rebuilt:
five labels in one phone-width row left each about fourteen characters of room,
and an unreadable label is not a compact one. They are **12px** on a 3×2 grid at
phone width and a single row of five from `md`.

### Named Rules

**The Two Weights Rule.** 500 or 600, nothing else. A third weight would need to
justify itself against a hierarchy that is already working without one.

## Layout

A single centred column, `max-w-md` (448px), on every screen including the
navigation's inner list. At 360px the column simply fills the viewport; on a
desktop it stays a centred phone-shaped strip rather than stretching — which is
the constitution's "desktop is a progressive enhancement" made literal.

- **Page frame:** `px-5` gutter (20px), `pt-6` top, `pb-8` bottom. The two
  screens outside the navigation shell (quiz, Match Found) use the same gutter
  with a larger top offset and no bottom clearance.
- **Navigation clearance:** the fixed bottom nav is exactly `--spacing-nav`
  (64px) tall, and the shell pads content by the same token so nothing can end
  up underneath it. The deck's action bar sticks *above* the nav using the same
  value as its `bottom` offset — one token, three consumers, so they agree by
  construction.
- **Density:** generous. Cards are `p-4`, panels `p-4` to `p-6`, rows `p-3`, and
  the vertical rhythm steps `mt-1` → `mt-8` by flow weight. There is no compact
  mode and no data-dense surface.
- **Rhythm steps in real use:** 4, 8, 12, 16, 20, 24px — Tailwind's default
  scale, plus the `nav` token at 64px.
- **Breakpoints:** exactly one is in use — `md` (768px), which turns the deck
  card from a poster-beside-facts row into a poster-above-facts column. The
  system is otherwise single-layout.

## Elevation & Depth

**This system has no shadows at all.** A full-codebase scan found zero
`shadow-*`, `drop-shadow`, or `box-shadow` declarations: there is no elevation
vocabulary to inherit, and adding one would be inventing a system rather than
extending this one.

Depth is conveyed three ways instead:

1. **Tonal steps.** Projector Black (#0b0b0f) → Surface (#15151c) → Raised
   (#1e1e28). A card is one step above the page; a badge is one step above the
   card. This is the primary depth mechanism and it is enough.
2. **Hairlines.** 1px borders separate a surface from its background, and a 1px
   `border-t` divides a card from its own footer strip.
3. **Frosted bars.** The bottom navigation and the deck's action bar share one
   recipe — 95% opaque Projector Black plus an 8px backdrop blur — so content
   scrolling underneath stays faintly visible. This is the only translucency in
   the system and it is reserved for the two bars that float over content.

**The Two Frosted Bars Rule.** `bg-ink-950/95 backdrop-blur` belongs to the
navigation and the deck's action bar. A third one would make the app feel like
it is hovering rather than sitting still.

## Motion

Two animations exist in the whole product, and both are declared **inside
`@media (prefers-reduced-motion: no-preference)`** rather than being switched off
at the call site. The default is that nothing moves, and a visitor who has asked
their system for less movement never receives the animation — not one that starts
and is cancelled, which is what a `motion-reduce:animate-none` class would give
them.

- **`card-in`** (200ms, `cubic-bezier(0.4, 0, 0.2, 1)`) — the deck card fading
  and rising 8px as it arrives. It plays once per card id, because the card
  surface re-mounts through a single-item `@for` tracked by id. The motion is
  doing a job, not decorating: the deck shows one card at a time, so without it
  an advance reads as the *same* card changing its text rather than a new one
  taking its place.
- **`.deck-spring`** (same duration and curve, `transform` only) — the card
  returning to centre when a drag falls short. Applied only while the finger is
  up: a transition during the drag would put a 200ms lag between the thumb and
  the card, which is the one thing that makes a swipe feel broken.

Both are plain CSS, not Angular's animation DSL. `provideAnimations` would add a
runtime and a bundle for two one-shot rules the browser already does.

**The Two Elements Rule.** The arrival animation and the drag transform live on
*different* elements — a running CSS animation's `transform` beats an inline
style, so on one element a drag begun during those 200ms would leave the card
stuck under the finger, and swiping quickly, one card after another, is exactly
when that happens.

## Shapes

Pills dominate. `rounded-full` appears 38 times and covers every button, chip,
tab, badge, progress bar and count — the system's default gesture is the capsule,
which reads as touchable and keeps the 44px height from looking like a slab.

The rest is a short, deliberate ramp:

- **24px** (`rounded-3xl`) — the deck card, and only the deck card. It is the
  one hero surface in the product, and its radius is what says so.
- **16px** (`rounded-2xl`) — list rows, panels, the summary block, the checkbox
  panel. Everything that groups content.
- **12px** (`rounded-xl`) — text inputs and the five rating tiles.
- **8px** (`rounded-lg`) — inline notice banners, and nothing else.
- **Square** — the poster, the nav, the two bars, and the attribution. The
  poster has no radius of its own; it is rounded only where a card clips it with
  `overflow-hidden`, which is why the detail page's poster renders square.

## Components

### Buttons

- **Shape:** fully rounded (9999px), 44px minimum height via `touch-target`.
- **Primary:** Neon Violet Deep fill, white text, no border. `padding: 0 24px`.
  Four headline CTAs carry semibold; everything else is medium — an unresolved
  split.
- **Secondary:** transparent fill, 1px border, Screen Grey label. The border is
  Projector Black Line Strong in five places and the softer Line in three, with
  no rule distinguishing them.
- **Ghost:** text only, no fill or border. Three sub-forms exist (hover-only
  underline, permanent underline, accent-coloured with no underline).
- **Hover / Focus:** every primary fill lightens to Neon Violet on hover and
  darkens with `active:brightness-90` on press. Secondary buttons still have no
  hover state. Focus is handled globally by a 2px Neon Violet Bright outline at
  2px offset, which is the one consistent interactive affordance in the system.
- **Disabled:** two recipes — the quiz swaps the fill to Raised with Muted text;
  the profile buttons drop to 60% opacity.
- **There is no destructive variant.** Sign out and Remove rating are styled as
  ordinary secondary and ghost controls, because no error colour exists.

### Chips (quiz)

- **Style:** capsule, 44px tall, 16px horizontal padding, 14px medium label. The
  unselected state is a Raised fill behind a Line Strong border.
- **Selected:** filled Neon Violet Deep with white text and an accent border — a
  colour swap only, with `transition-colors` animating it. **No checkmark glyph
  is used anywhere**; selection is colour and `aria-pressed`.
- **The "Any" chip:** a distinct, quieter form — dashed border and transparent
  fill when unselected, and when selected an outlined treatment (Raised fill,
  Neon Violet Bright border and text) rather than the solid fill other chips
  take. It reads as the absence of a choice, which is correct.

### Cards / Containers

- **Corner Style:** 24px for the deck card, 16px for rows and panels.
- **Background:** Projector Black Surface, one step above the page.
- **Shadow Strategy:** none — see Elevation & Depth.
- **Border:** 1px Projector Black Line, always.
- **Internal Padding:** 16px for the card's facts column, 12px for rows, 16–24px
  for panels. Empty states use a dashed border with no fill.

### Inputs / Fields

- **Style:** Raised-height (44px) field on a Surface fill with a 12px radius and
  a 1px Line border. Labels sit above in 14px medium Screen Grey, with a 6px
  gap.
- **Focus:** nothing per-field; the global focus ring is the treatment.
- **Placeholder:** intended to be Screen Grey Muted, but the class used
  (`text-chalk-600`) references a token that does not exist, so **no CSS is
  generated and the placeholder falls back to the browser default** — a real
  defect, confirmed in the scan, not a design decision.
- **Checkbox:** native, tinted with `accent-color`, inside a full-width panel
  that is itself the label — a good pattern worth reusing.

### Navigation

- **Style:** fixed to the bottom, 64px tall, frosted, with a single hairline on
  its top edge and no icons — three text labels, 14px medium.
- **States:** inactive is Screen Grey Muted, hover is Screen Grey, active is Neon
  Violet Bright, animated with `transition-colors`. **The active item sets no
  `aria-current`**, so the state is visual only.
- **Mobile treatment:** it *is* the mobile treatment; there is no desktop
  variant and no sidebar.

### Rating tiles (signature component)

The five-way rating control is the product's most-used element.

- **Deck variant:** capsules in a **3×2 grid at phone width, a single row of five
  from `md`**, each a Surface fill with a Line border, an icon above a 12px
  label. The ragged last row is the point: two short rows of words read as words,
  five slivers read as decoration.
- **Detail variant:** the same grid, but transparent rather than filled and with
  no icons — the same five actions presented as two different components.
- **Selected (detail):** Raised fill, Neon Violet Bright border and label, with
  `aria-pressed`. The deck variant has no selected state at all.
- **Hover / active (deck):** Raised fill on hover; on press the border goes Neon
  Violet Bright over a Raised fill. Both, not one — a rating tile is a decision,
  and the press is where the visitor commits to it.
- Every tile keeps its 44px minimum at both widths.

### Reason line (deck card)

The one sentence saying *why this card is here* — the product's stated
differentiation, and the reason the card is not just a poster with a title.

- **Style:** 14px medium, Neon Violet Bright, sitting directly under the title in
  the facts column.
- **Precedence:** a picked genre, then a loved genre, then a selected service; if
  none applies the line is **absent**, not defaulted. A placeholder would be the
  one claim the engine cannot support, on the card of a product whose selling
  point is that every claim is supported.
- It took the violet the TMDB score pill used to hold. The score demoted to
  Screen Grey Muted — a fact about the title, not a reason for its presence.

### Undo strip (deck)

The acknowledgement of a rating, and the only way back from a mis-tap. The five
tiles sit under a thumb and Disliked is one tile from Liked It.

- **Style:** a Raised fill with a 12px radius, sitting inside the footer directly
  above the action bar, with a Screen Grey "Rated Loved It" and a bordered
  capsule **Undo** at 44px.
- **It is an offer, not a prompt.** Nothing blocks the next card, and the strip
  holds the last rating and nothing else — no stack. It is cleared by the next
  action, never by a clock, so there is no window in which it describes a rating
  that is no longer the last one.
- **Not persisted.** It answers "what did you just do", which a reload cannot
  know.

### Loading skeleton (deck)

The first render of a deck that is still being fetched, shaped like the card it
will become — same 24px radius, same border, same 2:3 poster block — so nothing
jumps when the answer arrives.

- **Never a progressbar.** There is no progress to report: one request, no
  increments, and a bar that animates forever without advancing is a worse lie
  than silence. Two specs pin `[role="progressbar"]`'s absence.
- **Never a verdict.** It may not say anything about what the answer will be; an
  empty state here is the bug it replaced. The bars are `aria-hidden` and the
  announcement is a separate `sr-only` status line.
- Pulses, and stops pulsing under `motion-reduce`.

### Swipe hint pill (deck)

What a gesture is *about* to record, shown while the finger is still down.

- **Style:** a capsule outlined in Neon Violet Bright with a translucent
  Projector Black fill and an accent label, at the vertical middle of the card,
  on the side the card is leaving.
- **Opacity is the gesture's progress**, reaching full at the distance a drag
  commits. It is keyed to the drag rather than to the verdict on purpose: waiting
  for commitment would blink the label into full opacity at the exact moment the
  visitor stops needing to be told.
- `aria-hidden` — a picture of a decision being made with a hand. The rating it
  becomes is announced by the live region once it is actually written.

### Poster

- **Shape:** 2:3 (`--aspect-poster`), `object-cover`, no radius of its own —
  square unless a parent clips it.
- **Width is the caller's decision**, which is the whole contract: 112px in the
  deck card on a phone (full width at `md`), 56px in list rows, 160px on the
  detail page.
- **Placeholder:** a diagonal gradient across the two mid Projector Black steps
  with an optional 30px semibold wordmark — the one gradient in the system. It
  keeps the failed URL so it can retry when the source changes.

## Do's and Don'ts

### Do:

- **Do** reserve Neon Violet for state and primary action. If a violet element
  is neither chosen, current, scored, or actionable, it is decoration — the One
  Violet Rule.
- **Do** express depth as a step on the Projector Black ramp or a 1px hairline.
  There is no shadow in this system; adding one means inventing a second depth
  language.
- **Do** keep every interactive target at 44px by applying `touch-target`, which
  is the single mechanism the constitution's touch requirement is enforced
  through.
- **Do** keep the frame: `max-w-md`, `px-5`, phone-first from 360px. Desktop
  gets a taller card, not a wider page.
- **Do** use 12px uppercase with wide tracking for eyebrows and pill labels, and
  set headings semibold against medium interactive text.
- **Do** keep the TMDB attribution present, legible, and less prominent than the
  app's own marks on any screen showing TMDB titles or artwork. It is a licence
  term, not a design choice, and `attribution.spec.ts` pins its wording.
- **Do** let long titles break with `text-balance`/`truncate` and `min-w-0`
  rather than widening a container.
- **Do** give every primary fill the same three states: Neon Violet Deep at
  rest, Neon Violet on hover, `active:brightness-90` on press. White on the
  resting fill is 5.52:1; white on the hover fill is 4.35:1 and is only
  acceptable because it is momentary and paired with a pointer.
- **Do** put any new animation inside the `prefers-reduced-motion:
  no-preference` block in `styles.css`, so that not animating is the default
  rather than something each call site remembers to opt out of.

### Don't:

- **Don't** add a shadow, a glow, or a gradient — except the poster
  placeholder's, which exists to signal "no artwork" rather than to decorate.
- **Don't** introduce a second accent hue. The palette has exactly one, and its
  scarcity is what makes selection legible.
- **Don't** style a destructive action in colour until the palette actually has
  an error token. Today's neutral treatment of Sign out and Remove rating is the
  honest consequence of that gap, not an oversight to quietly patch with a red.
- **Don't** put a 10px label anywhere. That size belonged to the deck's rating
  tiles, where five labels shared 360px, and that was the problem: fourteen
  characters of room is an unreadable label, not a compact one. The scale now
  starts at 12px.
- **Don't** give a gesture a consequence that is only discoverable afterwards.
  A swipe records the rating its direction names, a hint names it before the
  finger lifts, and the strip offers to undo it. A gesture that silently does
  nothing has to be documented, and nobody reads the documentation.
- **Don't** rely on colour alone to communicate selection: every selectable
  control carries `aria-pressed` or `aria-selected`, and new ones must too.
- **Don't** add a third frosted bar or a sticky header. Two floating bars is the
  system; three makes the page feel unmoored.
