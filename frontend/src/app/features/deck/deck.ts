import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { DeckSession } from '../../core/models/deck-session';
import { Interaction, InteractionState } from '../../core/models/interaction';
import { MediaTitle } from '../../core/models/media-title';
import { Preference } from '../../core/models/quiz';
import { DEFAULT_REGION } from '../../core/models/quiz-options.data';
import { CatalogService } from '../../core/services/catalog.service';
import { Connectivity } from '../../core/services/connectivity';
import { DeckSessionStore } from '../../core/services/deck-session-store';
import { InteractionStore } from '../../core/services/interaction-store';
import { PreferenceStore } from '../../core/services/preference-store';
import { toPreference } from '../quiz/quiz-logic/quiz-rules';
import { Actions } from './actions/actions';
import { Card } from './card/card';
import { advance, currentCard, loopFor, startNewLoop } from './deck-logic/deck-session';
import { rankTitles } from './deck-logic/recommend';
import { PointerSample, swipeDecision } from './deck-logic/swipe';
import { DeckOutcome, EmptyState } from './empty-state/empty-state';

/**
 * The recommendation loop.
 *
 * The shell holds state and wires events; every decision it makes is delegated
 * to `deck-logic/`, which is why those modules can be tested without a DOM. This
 * file's job is to be the only place that knows about Angular, storage, and the
 * visitor's gestures at once.
 *
 * **Only the action bar records a rating.** A swipe is a neutral skip (FR-004),
 * so the gesture path writes the loop document and nothing else; the interaction
 * document is written from `onRating` and `onWatchNow`, which are reachable only
 * from a button. That separation is what makes "a swipe records nothing" true by
 * construction rather than by remembering not to.
 *
 * The current card is *derived*, never stored (research.md D5). That is what
 * makes "refresh mid-deck retains the current position" fall out for free:
 * ranking is deterministic (FR-011), so recomputing after a reload lands on the
 * same card without a cursor to persist and desynchronise.
 */
@Component({
  selector: 'app-deck',
  imports: [Actions, Card, EmptyState],
  templateUrl: './deck.html',
})
export class Deck {
  private readonly catalog = inject(CatalogService);
  private readonly connectivity = inject(Connectivity);
  private readonly preferences = inject(PreferenceStore);
  private readonly interactions = inject(InteractionStore);
  private readonly sessions = inject(DeckSessionStore);
  private readonly router = inject(Router);

  /** Region scopes provider availability, never the title list (see CatalogService). */
  private readonly region = DEFAULT_REGION;

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
  private readonly rated = signal<Readonly<Record<string, Interaction>>>(
    this.interactions.read().interactions,
  );

  /** The card surface, for its width (the swipe threshold) and pointer capture. */
  private readonly cardSurface = viewChild<ElementRef<HTMLElement>>('cardSurface');

  /** How far the card has been dragged, in pixels. 0 when it is centred. */
  protected readonly dragX = signal(0);

  protected readonly isDragging = signal(false);

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
   * Why there is no card, for the empty state to explain and act on (FR-014).
   *
   * Read only from the `@else` branch of the template, where `card()` is null
   * by definition — which is what makes the final `'exhausted'` branch sound:
   * there were titles, and the loop has walked past all of them.
   */
  protected readonly outcome = computed<DeckOutcome>(() => {
    if (this.needsQuiz()) return 'needs-quiz';
    return this.hasNoMatches() ? 'no-matches' : 'exhausted';
  });

  constructor() {
    this.catalog.loadTitles(this.region).subscribe((titles) => this.titles.set(titles));

    // Warm the browser cache for the card *after* this one, and only that one
    // (research.md D6). A single card is on screen (FR-002), so preloading the
    // deck would spend the visitor's data on cards they may never reach.
    effect(() => {
      const upcoming = this.nextPosterUrl();
      if (upcoming !== null) void preloadPoster(upcoming);
    });
  }

  /** Advance without rating — the explicit half of FR-004. */
  protected skip(): void {
    const current = this.card();
    if (current === null) return;

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
    this.advancePast(current.id);
  }

  /**
   * The visitor has decided what to watch (FR-008, US2 scenario 2).
   *
   * The loop stops rather than advances: the chosen card stays on screen, so a
   * back-navigation from Match Found returns to the decision that was made
   * instead of the next thing in the deck.
   */
  protected onWatchNow(): void {
    const current = this.card();
    if (current === null) return;

    this.interactions.recordWatch(current.id);
    this.refreshRated();

    void this.router.navigate(['/deck/match', current.id]);
  }

  protected startLoop(): void {
    this.goTo(startNewLoop());
  }

  protected onPointerDown(event: PointerEvent): void {
    this.samples = [sampleOf(event)];
    this.isDragging.set(true);

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
    const moving = swipeDecision(this.samples, this.cardWidth()) !== 'none';
    this.dragX.set(moving ? event.clientX - this.samples[0].x : 0);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.isDragging()) return;

    this.samples.push(sampleOf(event));
    this.isDragging.set(false);
    this.cardSurface()?.nativeElement.releasePointerCapture?.(event.pointerId);

    const outcome = swipeDecision(this.samples, this.cardWidth());
    this.samples = [];
    this.dragX.set(0);

    if (outcome === 'dismiss-left' || outcome === 'dismiss-right') this.skip();
  }

  private rankNow(shownTitleIds: readonly string[]): MediaTitle[] {
    const preference = this.preference();
    if (preference === null) return [];

    return rankTitles(this.titles(), preference, this.rated(), shownTitleIds);
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
