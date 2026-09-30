import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { DeckSession } from '../../core/models/deck-session';
import { INTERACTION_STATE_LABELS, Interaction, InteractionState } from '../../core/models/interaction';
import { MediaTitle } from '../../core/models/media-title';
import { Preference } from '../../core/models/quiz';
import { currentRegion } from '../../core/region';
import { CatalogService } from '../../core/services/catalog.service';
import { Connectivity } from '../../core/services/connectivity';
import { DeckSessionStore } from '../../core/services/deck-session-store';
import { InteractionStore } from '../../core/services/interaction-store';
import { PreferenceStore } from '../../core/services/preference-store';
import { Attribution } from '../../shared/attribution/attribution';
import { toPreference } from '../quiz/quiz-logic/quiz-rules';
import { Actions } from './actions/actions';
import { Card } from './card/card';
import { advance, currentCard, loopFor, rewind, startNewLoop } from './deck-logic/deck-session';
import { RankedTitle, rankTitles } from './deck-logic/recommend';
import { dismissThreshold, PointerSample, SwipeOutcome, swipeDecision } from './deck-logic/swipe';
import { DeckOutcome, EmptyState } from './empty-state/empty-state';

/**
 * How long the offer to undo a rating stands before it withdraws itself.
 *
 * Five seconds, and the number is argued rather than picked. Three is the
 * reflex — it is what a toast usually gets — and it is wrong here, because the
 * visitor is not reading the strip, they are *reaching past it*. Their thumb is
 * on `Disliked`, the tile they meant is `Liked It` one column over, and the
 * whole manoeuvre is: notice, aim, press. Three seconds does not cover the
 * middle step for anyone who has to look down first, and a strip that vanishes
 * mid-reach is worse than one that never appeared — it teaches the visitor that
 * the offer is not reliable, so they stop counting on it.
 *
 * The cost of erring long is one row of card height, and only until the next
 * tap. The cost of erring short is the mistake becoming permanent. Those are
 * not symmetric, so this errs long.
 *
 * Exported for the test that pins the number rather than the behaviour: the
 * boundary is worth checking either side of, but a test that reads the constant
 * to compute its own expectation would pass just as happily at three seconds.
 */
export const UNDO_WINDOW_MS = 5000;

/**
 * The recommendation loop.
 *
 * The shell holds state and wires events; every decision it makes is delegated
 * to `deck-logic/`, which is why those modules can be tested without a DOM. This
 * file's job is to be the only place that knows about Angular, storage, and the
 * visitor's gestures at once.
 *
 * **No verdict before the catalog has answered.** The deck has three states, not
 * two: loading, loaded, and could-not-load. Two is what produced the original
 * bug — a cold start rendered "Nothing matches right now" with a **Reset
 * Filters** button while the request was still in flight, telling the visitor
 * their answers were wrong when nothing had been asked yet. `showsSkeleton()` is
 * that third state's branch, and `loadFailed` is the fourth thing that can go
 * wrong: a load that finished with nothing, cached or otherwise.
 *
 * **Every rating goes through one door.** `onRating` is the only method that
 * writes a rating, and the buttons, the swipe, the acknowledgement strip and
 * Undo are all built on top of it. That is what makes the four agree without
 * any of them knowing about the others: a swipe is announced and undoable
 * because it *is* a rating, not because the gesture path remembered to be.
 *
 * **The swipe means the two things a swipe means.** Left records
 * `notInterested`, right records `wantToWatch`, and the hint that fades in
 * mid-drag is derived from the same verdict function that decides the rating —
 * so what the pill promises is what gets written. `Skip` is the only advance
 * that records nothing (FR-004), which keeps the neutral path exactly one
 * action wide instead of two that behave differently.
 *
 * The current card is *derived*, never stored (research.md D5). That is what
 * makes "refresh mid-deck retains the current position" fall out for free:
 * ranking is deterministic (FR-011), so recomputing after a reload lands on the
 * same card without a cursor to persist and desynchronise.
 */
@Component({
  selector: 'app-deck',
  imports: [Actions, Attribution, Card, EmptyState],
  templateUrl: './deck.html',
})
export class Deck {
  private readonly catalog = inject(CatalogService);
  private readonly connectivity = inject(Connectivity);
  private readonly preferences = inject(PreferenceStore);
  private readonly interactions = inject(InteractionStore);
  private readonly sessions = inject(DeckSessionStore);
  private readonly router = inject(Router);

  /** The device's region (FR-005): scopes availability, never the title list (CatalogService). */
  private readonly region = currentRegion();

  /**
   * The answers in force. Declared before `session` on purpose: that
   * initialiser reads this one, and field initialisers run in source order.
   */
  private readonly preference = signal<Preference | null>(this.readPreference());

  /**
   * The running loop. Persisted on every advance, so a refresh resumes it.
   *
   * Resumed only when it belongs to the answers above — see `loopFor`. A loop
   * recorded under different answers is a walk through a list that no longer
   * exists, which is how a visitor who reset their filters would come back to
   * the same empty deck they reset to escape.
   */
  protected readonly session = signal<DeckSession>(
    loopFor(this.sessions.read(), this.preference()),
  );

  private readonly titles = signal<MediaTitle[]>([]);

  /**
   * Whether the catalog is still in flight. The template's first branch.
   *
   * A signal of this shell's own rather than a property of the service, because
   * "loading" is a fact about *this* load: the service can be holding cached
   * titles and still be fetching. It starts `true` so the first render is a
   * skeleton — the deck cannot know there are no matches until it has looked,
   * and saying so before looking is the bug this exists to prevent.
   */
  protected readonly loading = signal(true);

  private readonly rated = signal<Readonly<Record<string, Interaction>>>(
    this.interactions.read().interactions,
  );

  /**
   * The rating vocabulary, for the strip's wording.
   *
   * Re-exported to the template rather than duplicated as a `switch`, so the
   * strip and the tile that produced it read from the same table — a rename
   * cannot leave the button saying one thing and its acknowledgement another.
   */
  protected readonly stateLabels = INTERACTION_STATE_LABELS;

  /** The card surface, for its width (the swipe threshold) and pointer capture. */
  private readonly cardSurface = viewChild<ElementRef<HTMLElement>>('cardSurface');

  /**
   * The rating the visitor just gave, while it can still be taken back.
   *
   * A rating closes its card and moves on immediately, which is the point — a
   * confirmation step between a tap and the next card would make the deck
   * slower than scrolling, which is the thing it exists to replace. But the
   * five tiles sit under a thumb and `Disliked` is one tile away from `Liked
   * It`, so the mistake is not hypothetical, and until now the only way to fix
   * one was to reload and hope the title came back.
   *
   * So the acknowledgement is an *offer to undo* rather than a prompt. It holds
   * the last rating and nothing else: no stack and no history. The next action
   * overwrites it, `Skip` and Watch Now clear it, Undo consumes it, and after
   * `UNDO_WINDOW_MS` it withdraws itself — which means the strip can only ever
   * describe a state that is still true.
   */
  protected readonly lastAction = signal<{ titleId: string; state: InteractionState } | null>(
    null,
  );

  /**
   * Whether the visitor is currently *at* the strip, which suspends its
   * withdrawal.
   *
   * A countdown on a control is a promise with an expiry date, and the one
   * visitor who cannot race it is the one who needs it most: a keyboard user
   * tabs toward Undo through every control before it, and a pointer user has to
   * travel there. Taking the button away underneath either of them would fail
   * WCAG 2.2.1 outright — the mechanism exists, the visitor is using it, and
   * the clock removes it anyway.
   *
   * So the window measures *idle* time, not wall-clock time. Hovering or
   * focusing the strip stops the count; leaving it starts a fresh full window
   * rather than resuming a partial one, because a visitor who has come back to
   * the strip is deciding, and a decision should not inherit a deadline they
   * did not know they were running against.
   */
  protected readonly undoHeld = signal(false);

  /**
   * What a screen reader hears after a rating, since the strip cannot be read
   * by everyone.
   *
   * The count is not decoration: it is the only confirmation that the rating
   * *landed* rather than the card merely sliding away, and it is read from the
   * store rather than counted here so it cannot drift from what was written.
   * Empty before the first rating, and empty again after Undo — an announcement
   * is a change, and re-announcing a state that has been retracted would leave
   * the visitor hearing a rating they just took back.
   */
  protected readonly announcement = computed(() => {
    const action = this.lastAction();
    if (action === null) return '';

    const { state } = action;
    return `${INTERACTION_STATE_LABELS[state]}. ${Object.keys(this.rated()).length} rated.`;
  });

  /** How far the card has been dragged, in pixels. 0 when it is centred. */
  protected readonly dragX = signal(0);

  /**
   * What the gesture in progress is heading toward, or `null` when there is no
   * horizontal gesture to describe.
   *
   * A swipe used to be a neutral skip (FR-004), which made it the one gesture
   * on this screen that did something the visitor could not name afterwards.
   * Now it means the two things a swipe is universally taken to mean — left is
   * *no*, right is *yes* — and this signal is how that gets said *before* the
   * finger lifts, because a gesture whose consequence is only discoverable
   * after the fact is a gesture nobody dares use.
   *
   * Keyed to the drag rather than to the verdict on purpose. Waiting for
   * `swipeDecision` to commit would show the label at the exact instant it
   * stops being a hint — the pill would blink into full opacity at the point
   * of no return, which is the one moment the visitor no longer needs telling.
   * Drawn from the displacement instead, it forms while they are deciding, and
   * a drag that springs back takes the label with it.
   *
   * It carries the state rather than the wording so the pill and the strip
   * below read from one vocabulary (`INTERACTION_STATE_LABELS`).
   */
  protected readonly swipeHint = signal<InteractionState | null>(null);

  /**
   * The hint's opacity: the drag's progress toward dismissal.
   *
   * Full exactly when the drag would commit on distance, so opacity *is* the
   * gesture's progress bar — and a visitor can feel the threshold before they
   * have to learn it by mistaking one card for another.
   *
   * A flick reaches the same full opacity at a shorter distance, because it
   * commits on speed instead; that is deliberate rather than a hole in the
   * mapping. `DISMISS_MIN_DISTANCE_PX` is the floor of the threshold, so this
   * never promises full commitment further out than the gesture can commit.
   */
  protected readonly swipeHintOpacity = computed(() =>
    Math.min(1, Math.abs(this.dragX()) / dismissThreshold(this.cardWidthPx())),
  );

  protected readonly isDragging = signal(false);

  /**
   * The card's width, measured once per gesture.
   *
   * Read from the DOM at `pointerdown` and kept in a signal rather than queried
   * on every pointermove: the layout does not change mid-drag, and a computed
   * that read `getBoundingClientRect()` directly would be a non-reactive read
   * inside a reactive graph — it would cache the first answer forever, which
   * happens to be right here and is exactly the kind of accident that stops
   * being right later.
   */
  private readonly cardWidthPx = signal(0);

  /** The gesture in progress. Empty between gestures. */
  private samples: PointerSample[] = [];

  /** The poster to warm, or `null` when there is nothing after this card. */
  private readonly nextPosterUrl = computed<string | null>(() => {
    const current = this.card();
    if (current === null) return null;

    const upcoming = this.ranked().find((title) => title.id !== current.id);
    return upcoming?.posterUrl ?? null;
  });

  /** Every eligible title, ignoring what this loop has already shown. */
  private readonly eligible = computed(() => this.rankNow([]));

  /** What is left to show: the ranking minus this loop's shown ids (FR-010). */
  private readonly ranked = computed(() => this.rankNow(this.session().shownTitleIds));

  protected readonly card = computed(() => currentCard(this.session(), this.ranked()));

  protected readonly needsQuiz = computed(() => this.preference() === null);

  /**
   * FR-013: the provider could not be reached and the results are cached.
   *
   * Read straight off the service rather than copied into a local signal: the
   * fallback is the catalog's own state, and a copy would be one more thing to
   * keep in step with a load that can happen again at any time.
   */
  protected readonly usingCachedTitles = this.catalog.usingCachedTitles;

  /** FR-015: the device has no connection. Loaded cards keep working. */
  protected readonly isOffline = this.connectivity.isOffline;

  protected readonly hasNoMatches = computed(
    () => !this.needsQuiz() && this.eligible().length === 0,
  );

  /**
   * What the catalog offers under these answers, ignoring history entirely.
   *
   * This exists to tell two empty decks apart, which `eligible()` above cannot:
   * it applies the rating filter as well, so it is empty both when nothing in
   * the catalog matches the quiz answers and when the visitor has rated
   * everything that does. Those are different sentences and different advice —
   * widening the filters is the fix for the first, and it is also the fix for
   * the second, but only because a new loop would be futile there.
   *
   * Ranking with an empty document is the cheapest way to ask the narrower
   * question, and it costs nothing to keep: it does not read the ratings, so it
   * recomputes when the answers or the catalog change and not once per rating.
   */
  private readonly matchesFilters = computed(() => this.rankWithoutHistory().length);

  /**
   * Whether the skeleton belongs on screen.
   *
   * `loading()` alone is not enough, and the difference is the whole point of
   * the state: a visitor who has not taken the quiz is not *waiting* for
   * titles. No load is going to change their answer, so a skeleton would be a
   * delay they cannot end by waiting while the prompt that actually moves them
   * forward sits behind it. The empty state gets them immediately, and only a
   * visitor who has asked for a deck is shown one being built.
   */
  protected readonly showsSkeleton = computed(() => this.loading() && !this.needsQuiz());

  /**
   * FR-013's other half: the load came back with nothing to show.
   *
   * Read as a pair, because neither half is a failure on its own. A fallback
   * cache with titles in it is the degraded-but-working state the cached notice
   * covers; an *empty* fallback is the one that means we could not reach the
   * catalog and had nothing stored to fall back on.
   *
   * Derived rather than read off the service, because there is no error to
   * subscribe to: `loadTitles` is contractually total — it completes with `[]`
   * when the request fails *and* the cache is empty, rather than erroring, so
   * that a network blip is never an unhandled rejection. The absence of titles
   * under a fallback is therefore the failure, and it is the only signal there
   * is.
   */
  protected readonly loadFailed = computed(
    () => this.catalog.usingCachedTitles() && this.titles().length === 0,
  );

  /**
   * Why there is no card, for the empty state to explain and act on (FR-014).
   *
   * Read only from the template's final branch — the one that runs when the
   * deck is *ready* and `card()` is null by definition. That is what makes the
   * cases sound: `'load-failed'` means the catalog gave us nothing,
   * `'exhausted'` means it gave us titles and the loop has walked past all of
   * them, and the other two split the same emptiness by *which* input caused
   * it — the answers (`'no-matches'`) or the visitor's own ratings
   * (`'all-rated'`).
   *
   * That last distinction only exists because rating a title now removes it
   * for good: the visitor who has judged everything the catalog offers under
   * their filters lands on an empty deck they cannot walk out of. Offering
   * them a new loop would be a button that does nothing, which is why
   * `EmptyState` reads this value rather than the emptiness alone.
   */
  protected readonly outcome = computed<DeckOutcome>(() => {
    if (this.needsQuiz()) return 'needs-quiz';
    if (this.loadFailed()) return 'load-failed';
    if (!this.hasNoMatches()) return 'exhausted';
    return this.matchesFilters() > 0 ? 'all-rated' : 'no-matches';
  });

  constructor() {
    this.load();

    // Warm the browser cache for the card *after* this one, and only that one
    // (research.md D6). A single card is on screen (FR-002), so preloading the
    // deck would spend the visitor's data on cards they may never reach.
    effect(() => {
      const upcoming = this.nextPosterUrl();
      if (upcoming !== null) void preloadPoster(upcoming);
    });

    // The undo window. Read both signals *before* deciding, so the effect
    // depends on the pair: a new rating restarts the count, and reaching for
    // the strip during it stops the count.
    effect((onCleanup) => {
      const action = this.lastAction();
      if (action === null || this.undoHeld()) return;

      // Owned by the effect rather than by a field and `ngOnDestroy`, which is
      // what makes it correct by construction: `onCleanup` runs on every
      // re-run as well as on destroy, so the old timer cannot outlive the state
      // it belonged to. Without that, rating twice in quick succession would
      // leave the first rating's timer to fire against the second rating's
      // strip — dismissing an offer the visitor never got a window for.
      const timer = setTimeout(() => this.lastAction.set(null), UNDO_WINDOW_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  /**
   * FR-013's retry, from the empty state's button.
   *
   * Deliberately the same call the constructor makes, so a retry cannot end up
   * on a different path than the first attempt: the only difference between the
   * two is what the service answers this time.
   */
  protected reload(): void {
    this.load();
  }

  /**
   * Ask the catalog for titles, and be loading until it answers.
   *
   * The completion handler is total by contract (see `loadFailed`), which is
   * what lets it be the only place `loading` is cleared — there is no error
   * branch to forget, because there is no error branch.
   */
  private load(): void {
    this.loading.set(true);
    this.catalog.loadTitles(this.region).subscribe((titles) => {
      this.titles.set(titles);
      this.loading.set(false);
    });
  }

  /** Advance without rating — the explicit half of FR-004. */
  protected skip(): void {
    const current = this.card();
    if (current === null) return;

    // Skipping is the visitor saying nothing about this title, so it retracts
    // the offer to undo the *previous* one. Leaving a stale strip up would
    // offer to un-rate a card that is no longer the last thing they did.
    this.lastAction.set(null);
    this.advancePast(current.id);
  }

  /**
   * Record a rating and move on (FR-007, US2 scenario 1).
   *
   * The card is read *before* the store is written, and the advance names that
   * card explicitly. It has to: `disliked` and `notInterested` remove their
   * title from the ranking, so the moment the write lands, `card()` is already
   * pointing at the next title — and asking it which card to close would close
   * the wrong one. The visitor rated the card they could see.
   */
  protected onRating(state: InteractionState): void {
    const current = this.card();
    if (current === null) return;

    this.interactions.record(current.id, state);
    this.refreshRated();

    // Cleared before the offer is replaced, so the new strip always gets the
    // full window. Left standing, a rating given while the pointer happened to
    // rest over the previous strip's footprint would open its own offer already
    // suspended — held by a visitor who is not there.
    this.undoHeld.set(false);
    this.lastAction.set({ titleId: current.id, state });
    this.advancePast(current.id);
  }

  /**
   * The visitor has decided what to watch (FR-008, US2 scenario 2).
   *
   * The loop stops rather than advances — nothing is marked as shown — so a
   * back-navigation from Match Found returns to the decision that was made
   * instead of to the next thing in the deck. What the visitor finds there is
   * the card *after* the one they chose, because the chosen title left the
   * deck the moment it was rated, exactly as it would have for Loved It. That
   * is not the loop moving on underneath them: it is the title's own decision
   * taking effect, and it is why they are never offered it again.
   */
  protected onWatchNow(): void {
    const current = this.card();
    if (current === null) return;

    this.interactions.recordWatch(current.id);
    this.refreshRated();

    // The loop is over and the visitor is leaving this screen: an offer to
    // undo the rating before last is not something they can act on from Match
    // Found, and the strip would still be sitting there if they came back.
    this.lastAction.set(null);

    void this.router.navigate(['/deck/match', current.id]);
  }

  /**
   * Takes back the last rating: un-rates the title and returns its card.
   *
   * Two writes, and both are needed. The interaction document is cleared so the
   * title stops being excluded (FR-009) and stops voting on affinity; the loop
   * document is rewound so the card that was closed to make room comes back.
   * Undo one without the other and the visitor gets a title that is eligible
   * again but still marked as seen — an empty-looking deck with a card missing
   * from it, which is exactly the bug they just tried to correct.
   *
   * The pair cannot half-apply in a way they would see: both signals are set
   * before the next render, and the card is *derived* from them, so there is no
   * intermediate state where the rank has been recomputed against only one.
   *
   * `rewind` returns the session by reference when the id is not in the walk,
   * so an Undo that arrives twice — a double tap on a strip that has already
   * been consumed — writes the document it already has instead of a new one.
   */
  protected undo(): void {
    const action = this.lastAction();
    if (action === null) return;

    this.interactions.remove(action.titleId);
    this.refreshRated();
    this.goTo(rewind(this.session(), action.titleId));
    this.lastAction.set(null);
  }

  protected startLoop(): void {
    this.goTo(startNewLoop());
  }

  protected onPointerDown(event: PointerEvent): void {
    this.samples = [sampleOf(event)];
    this.cardWidthPx.set(this.cardWidth());
    this.isDragging.set(true);

    // A gesture starts with nothing to say. Left over from a previous drag, the
    // pill would be claiming a direction before this finger has moved.
    this.swipeHint.set(null);

    // jsdom does not implement pointer capture, and it is a nicety rather than
    // a requirement — without it the gesture still works, it just stops if the
    // finger leaves the card (research.md D11).
    this.cardSurface()?.nativeElement.setPointerCapture?.(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.isDragging()) return;

    this.samples.push(sampleOf(event));

    // Asking the decision function mid-gesture answers a narrower question —
    // "has this gesture committed to horizontal yet?" — and `'none'` is the
    // answer for both a tap and a scroll, which are exactly the cases where the
    // card must hold still. Reusing the verdict keeps the axis rule in one
    // place instead of duplicating it here.
    const moving = swipeDecision(this.samples, this.cardWidthPx()) !== 'none';
    const drag = moving ? event.clientX - this.samples[0].x : 0;

    this.dragX.set(drag);
    this.swipeHint.set(moving ? hintFor(drag < 0 ? 'dismiss-left' : 'dismiss-right') : null);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.isDragging()) return;

    this.samples.push(sampleOf(event));
    this.isDragging.set(false);
    this.cardSurface()?.nativeElement.releasePointerCapture?.(event.pointerId);

    const outcome = swipeDecision(this.samples, this.cardWidthPx());
    this.samples = [];
    this.dragX.set(0);
    this.swipeHint.set(null);

    // The gesture routes into the *rating* path, not the skip path — which is
    // what makes a swipe undoable, announced, and counted without any of those
    // three having to know a gesture exists. `skip()` is now reached only from
    // the button, so FR-004's neutral advance stays exactly one action wide.
    const state = hintFor(outcome);
    if (state !== null) this.onRating(state);
  }

  private rankNow(shownTitleIds: readonly string[]): RankedTitle[] {
    return this.rank(this.rated(), shownTitleIds);
  }

  /**
   * The same ranking with the visitor's history withheld — the counterfactual
   * "what would the deck hold if they had rated nothing?".
   *
   * Only `matchesFilters` reads it, and only to name the reason an empty deck
   * is empty. Kept as its own method rather than a flag on `rankNow` so the
   * two questions stay visibly different at every call site.
   */
  private rankWithoutHistory(): RankedTitle[] {
    return this.rank({}, []);
  }

  private rank(
    rated: Readonly<Record<string, Interaction>>,
    shownTitleIds: readonly string[],
  ): RankedTitle[] {
    const preference = this.preference();
    if (preference === null) return [];

    return rankTitles(this.titles(), preference, rated, shownTitleIds);
  }

  private readPreference(): Preference | null {
    const state = this.preferences.read();
    return state === null ? null : toPreference(state);
  }

  /**
   * Pulls the store back in after a write.
   *
   * `InteractionStore` is not reactive, so ranking would otherwise keep reading
   * the map it was handed at construction — and a freshly disliked title would
   * stay in the deck until the next reload. `read()` parses a fresh copy each
   * time, so this cannot alias anything the store still owns.
   */
  private refreshRated(): void {
    this.rated.set(this.interactions.read().interactions);
  }

  /** Closes the loop on the card the visitor was looking at. */
  private advancePast(titleId: string): void {
    this.goTo(advance(this.session(), titleId));
  }

  /** The loop document is the only thing an advance writes. */
  private goTo(session: DeckSession): void {
    this.session.set(session);
    this.sessions.write(session);
  }

  private cardWidth(): number {
    return this.cardSurface()?.nativeElement.getBoundingClientRect().width ?? 0;
  }
}

function sampleOf(event: PointerEvent): PointerSample {
  return { x: event.clientX, y: event.clientY, t: event.timeStamp };
}

/**
 * What a swipe verdict means in the rating vocabulary.
 *
 * One table, used twice: the hint shown mid-gesture and the rating recorded on
 * release. Deriving the second from the first is the point — a pill that
 * promised "Want to Watch" while the release recorded `notInterested` would be
 * worse than no pill at all, and this makes that impossible rather than
 * unlikely.
 *
 * The two directions are asymmetric on purpose. Left is `notInterested` and not
 * `disliked`: a swipe is a reflex, and `disliked` is a judgement about the
 * title that also weighs against its genre in the affinity score. Right is
 * `wantToWatch` and not `loved`, for the same reason in reverse — the strong
 * claims stay on the buttons, where they are deliberate.
 */
function hintFor(outcome: SwipeOutcome): InteractionState | null {
  if (outcome === 'dismiss-left') return 'notInterested';
  if (outcome === 'dismiss-right') return 'wantToWatch';
  return null;
}

/**
 * Warms the cache for one poster.
 *
 * Best-effort on purpose: `decode()` is absent in jsdom (it is called with `?.`
 * for the same reason pointer capture is) and rejects on a URL that will not
 * load. Neither is worth surfacing — a poster that never arrives falls back to
 * the placeholder (FR-016), so a failed preload costs a cold request later and
 * nothing more.
 */
async function preloadPoster(url: string): Promise<void> {
  try {
    const image = new Image();
    image.src = url;
    await image.decode?.();
  } catch {
    // The card handles a poster that never arrives.
  }
}
