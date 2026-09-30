import { Component, computed, inject, input, output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PreferenceStore } from '../../../core/services/preference-store';
import { ICON_REFRESH, ICON_SLIDERS } from '../../../shared/icons';
import { startRetake } from '../../quiz/quiz-logic/quiz-rules';

/**
 * Why the deck has no card to show.
 *
 * Five different situations that all render as "nothing here", and the
 * difference decides what the visitor can do about it. Naming them is what
 * keeps the shell from encoding that distinction in template branches.
 *
 * `'load-failed'` is not the shell's `loading`: that one means the answer has
 * not arrived, and this one means it arrived empty. Only the second is
 * something a visitor can act on.
 *
 * `'all-rated'` and `'no-matches'` are both "the catalog had nothing for these
 * answers", split by which input is responsible — the ratings or the filters.
 * The split matters because it changes the only useful action. A loop that has
 * run dry is restarted, but a deck whose every title the visitor has already
 * judged cannot be restarted into anything: the new loop would be empty on its
 * first card. So that state offers the filters instead, and never the loop.
 */
export type DeckOutcome =
  | 'needs-quiz'
  | 'no-matches'
  | 'exhausted'
  | 'all-rated'
  | 'load-failed';

/** What each outcome says. Copy, deliberately, is not the shell's business. */
const OUTCOME_COPY: Record<DeckOutcome, { title: string; body: string }> = {
  'needs-quiz': {
    title: 'Your deck is empty',
    body: 'Finish the quiz to build your deck.',
  },
  'no-matches': {
    title: 'Nothing matches right now',
    body: 'Your filters are too narrow for the titles available today.',
  },
  exhausted: {
    title: "That's the whole deck",
    body: "You've seen everything that matches your answers.",
  },
  'all-rated': {
    title: "You've rated everything here",
    body: 'Nothing under these filters is left unjudged. Widen them for something new.',
  },
  'load-failed': {
    title: "Couldn't reach the catalog",
    body: 'Check your connection, then try again.',
  },
};

/**
 * The deck with nothing to show (FR-014).
 *
 * This is where "never a dead end" (constitution II) is either true or not:
 * the visitor is out of cards, so every state here must end in something they
 * can press. That is why there is no such thing as an outcome with copy and no
 * action.
 *
 * **It owns the reset, and only the reset.** The preferences action leaves for
 * `/quiz`, which destroys the deck shell — so writing the retake and navigating
 * is the whole job, and this component is the only thing that needs to know. Starting
 * a new loop is the opposite: it stays on `/deck`, and re-entering the same
 * route would not rebuild the shell, so the live loop signal it must replace
 * belongs to the shell. Retrying a failed catalog load has that same shape
 * again — the request belongs to the shell — so it is emitted upward too.
 *
 * That asymmetry is the boundary, not an oversight: a decision this component
 * can complete on its own it keeps, and one that lives in the shell's signals
 * it emits.
 */
@Component({
  selector: 'app-empty-state',
  imports: [RouterLink],
  templateUrl: './empty-state.html',
})
export class EmptyState {
  private readonly preferences = inject(PreferenceStore);
  private readonly router = inject(Router);

  readonly outcome = input.required<DeckOutcome>();

  /** The shell starts the loop: the running session lives in its signal. */
  readonly startNewLoop = output<void>();

  /** The shell reloads the catalog: the request lives in its signals. */
  readonly retry = output<void>();

  protected readonly copy = computed(() => OUTCOME_COPY[this.outcome()]);

  /** Sliders, on the button that reopens the quiz. See `empty-state.html`. */
  protected readonly preferencesIcon = ICON_SLIDERS;

  /** A circular arrow: from the top, on a deck the visitor has already walked. */
  protected readonly newLoopIcon = ICON_REFRESH;

  /**
   * A new loop only means something when there is a deck to walk again.
   *
   * Which is why `'all-rated'` does not get one, though it looks like it
   * should: the visitor is out of cards and a restart is the thing that
   * normally fixes that. But a new loop clears the walk, not the ratings, so
   * under these filters it would open on the same empty deck — a button whose
   * only effect is to prove it does nothing.
   */
  protected readonly canStartNewLoop = computed(() => this.outcome() === 'exhausted');

  /**
   * Only a failure to load is worth retrying.
   *
   * The other three are answers, not accidents: the quiz has not been taken,
   * the filters exclude everything, or the loop has finished. Pressing again
   * would return the same answer, which is the definition of a button that does
   * nothing.
   */
  protected readonly canRetry = computed(() => this.outcome() === 'load-failed');

  /**
   * Widening the filters is the answer to a deck that is too narrow, to a loop
   * with nothing left in it, and to a deck the visitor has already judged —
   * but not to a catalog that never answered. Offering it for a failed load is
   * the original bug in a different costume: it blames the visitor's answers
   * for the network.
   *
   * The identifier names the mechanism, which has not changed: this still
   * resets the filter set by reopening the quiz. The *label* is "Preferences",
   * because that names the visitor's errand rather than the engine's — the two
   * are allowed to differ, and here they should.
   */
  protected readonly canResetFilters = computed(
    () =>
      this.outcome() === 'no-matches' ||
      this.outcome() === 'exhausted' ||
      this.outcome() === 'all-rated',
  );

  /**
   * Reopens the quiz with the previous answers pre-filled (FR-014, US4
   * scenario 3).
   *
   * The transition is spec 001's `startRetake`, reused rather than restated —
   * it already knows that a retake means step 1, `in-progress`, every answer
   * kept, and `completedAt` gone. Re-deriving that here would be a second
   * definition of "completed", and the two would drift.
   *
   * Nothing is written to `playnext:interactions`. The visitor is widening
   * their *filters*; a title they rejected stays rejected (FR-009), and that
   * holds by construction because this path never touches the document that
   * records it (research.md D9).
   */
  protected resetFilters(): void {
    const state = this.preferences.read();
    if (state === null) return;

    this.preferences.write(startRetake(state));
    void this.router.navigate(['/quiz']);
  }
}
