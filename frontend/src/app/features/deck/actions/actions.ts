import { Component, output } from '@angular/core';
import { InteractionState, RATING_ACTIONS } from '../../../core/models/interaction';

/**
 * The glyph for each rating, as a 24×24 stroke path (Feather-style geometry).
 *
 * Presentation, not vocabulary: `interaction.ts` owns the states and the words
 * for them, and an icon is neither. It lives beside the bar that draws it, and
 * a `Record` over `InteractionState` means adding a state is a compile error
 * here rather than a button with a blank square in it.
 *
 * `watchingNow` has no cell in this bar — it is the loop's exit, not a rating —
 * but the record is total, so it carries the play glyph it would use.
 *
 * The repo has no icon library and this is the only icon in it; six paths are
 * cheaper than a dependency, and `d` is bound as an attribute rather than
 * sanitized HTML because Angular's sanitizer strips `<svg>` outright.
 */
export const RATING_ICONS: Record<InteractionState, string> = {
  loved:
    'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  liked:
    'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
  disliked:
    'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17',
  wantToWatch: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  notInterested: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM15 9l-6 6M9 9l6 6',
  watchingNow: 'M5 3l14 9-14 9V3z',
};

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

  protected readonly icons = RATING_ICONS;
}
