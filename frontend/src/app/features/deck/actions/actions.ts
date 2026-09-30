import { Component, output } from '@angular/core';
import { InteractionState, RATING_ACTIONS } from '../../../core/models/interaction';
import { ICON_NEXT, RATING_ICONS } from '../../../shared/icons';

/**
 * **Provisional — a trial run, 2026-09-29. Not the design.**
 *
 * The bar is specified to offer all five ratings (FR-007), and it still
 * *records* all five: the swipe writes `notInterested` and `wantToWatch`
 * exactly as it did, and a rating already stored under any state is untouched.
 * What is being tried is only what the bar *shows* — three fewer tiles, and a
 * Skip that has moved up into the row the verdicts are in.
 *
 * The question being felt out is whether five equal answers is really the right
 * question. Two of them are not judgements of the title at all — "Want to
 * Watch" and "Not Interested" are about the visitor's plans and attention, not
 * about whether the film is any good — and putting them in the same row as
 * Liked and Disliked invites the reading that all five are equally strong
 * opinions. What is left is the verdict, and the one answer that is explicitly
 * not one.
 *
 * **`loved` is the third state off the bar, and it is the one to think about.**
 * Nothing on this screen will write it any more — the swipe writes the two
 * weaker claims and no button writes this one. That is *not* a capability the
 * deck loses, because the engine does not currently tell the two apart:
 * `POSITIVE_STATES` in `recommend.ts` reads `loved` and `liked` as the same
 * "more like this", so a Liked It tap already votes for the title's genres and
 * already produces the "Because you loved …" reason line. What ends is the
 * visitor's ability to say it *more strongly*, and with it the only input a
 * future "a love outranks a like" rule could have. Put the tile back if that
 * gradation is worth a fourth control; the state, its label and its glyph all
 * stay live either way, and a title already rated `loved` still votes.
 *
 * **To revert**: delete this list and the `.filter` below it, restoring
 * `protected readonly ratings = RATING_ACTIONS`, and put the five-tile grid
 * back in `actions.html` with Skip and Watch Now sharing a row beneath it. The
 * spec's `RATINGS` constant marks the same boundary.
 */
const TRIAL_HIDDEN_STATES: readonly InteractionState[] = [
  'loved',
  'wantToWatch',
  'notInterested',
];

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

  protected readonly ratings = RATING_ACTIONS.filter(
    (action) => !TRIAL_HIDDEN_STATES.includes(action.state),
  );

  protected readonly icons = RATING_ICONS;

  /** Skip's glyph — an arrow, not a verdict. See `ICON_NEXT` for why. */
  protected readonly nextIcon = ICON_NEXT;
}
