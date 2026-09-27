import { Component, output } from '@angular/core';
import { InteractionState, RATING_ACTIONS } from '../../../core/models/interaction';

/**
 * The deck's action bar (FR-007, FR-008).
 *
 * Presentation only, like `ChoiceChips` and `Card`: it reports which action was
 * tapped and holds no state. Recording a rating needs the interaction store and
 * advancing needs the loop, and both belong to the shell — so the buttons stay
 * dumb and the shell's integration specs are what prove a tap is recorded
 * exactly once.
 *
 * The labels come from `RATING_ACTIONS` rather than being written here, so the
 * text on a button and the value it records are the same table.
 *
 * The bar itself is not rendered here. `sticky bottom-0` only works against a
 * tall scrolling ancestor, so the shell owns the `<footer>` and this component
 * fills it — an extra wrapper element would be the sticky element's containing
 * block and pin it in place.
 */
@Component({
  selector: 'app-actions',
  templateUrl: './actions.html',
})
export class Actions {
  /** One of the five ratings (FR-007). */
  readonly ratingChosen = output<InteractionState>();

  /** Stop the loop and show Match Found (FR-008). */
  readonly watchNow = output<void>();

  /** Advance without rating — the tap half of FR-004. */
  readonly skipped = output<void>();

  protected readonly ratings = RATING_ACTIONS;
}
