import { Component, computed, inject, input, output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PreferenceStore } from '../../../core/services/preference-store';
import { startRetake } from '../../quiz/quiz-logic/quiz-rules';

/**
 * Why the deck has no card to show.
 *
 * Three different situations that all render as "nothing here", and the
 * difference decides what the visitor can do about it. Naming them is what
 * keeps the shell from encoding that distinction in template branches.
 */
export type DeckOutcome = 'needs-quiz' | 'no-matches' | 'exhausted';

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
};

/**
 * The deck with nothing to show (FR-014).
 *
 * This is where "never a dead end" (constitution II) is either true or not:
 * the visitor is out of cards, so every state here must end in something they
 * can press. That is why there is no such thing as an outcome with copy and no
 * action.
 *
 * **It owns the reset, and only the reset.** Reset Filters leaves for `/quiz`,
 * which destroys the deck shell — so writing the retake and navigating is the
 * whole job, and this component is the only thing that needs to know. Starting
 * a new loop is the opposite: it stays on `/deck`, and re-entering the same
 * route would not rebuild the shell, so the live loop signal it must replace
 * belongs to the shell. That asymmetry is the boundary, not an oversight; the
 * loop itself is emitted upward.
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

  protected readonly copy = computed(() => OUTCOME_COPY[this.outcome()]);

  /** A new loop only means something when there is a deck to walk again. */
  protected readonly canStartNewLoop = computed(() => this.outcome() === 'exhausted');

  /** Only a taken quiz has an answer to widen, so only then can it be reset. */
  protected readonly canResetFilters = computed(() => this.outcome() !== 'needs-quiz');

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
