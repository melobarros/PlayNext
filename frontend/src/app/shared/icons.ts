import { InteractionState } from '../core/models/interaction';

/**
 * Every glyph in the app, as a 24×24 stroke path (Feather-style geometry).
 *
 * One file, so "where does a new icon go?" has an answer. It is a plain object
 * of strings and not a component, a directive or a library: the repo has no
 * icon dependency, and nine paths are cheaper than one — a dependency would
 * arrive with its own module format, its own tree-shaking story and its own
 * upgrade cadence, to draw nine lines. Adding a tenth is a line here.
 *
 * The paths are drawn, never inlined as markup: Angular's sanitizer strips
 * `<svg>` from `[innerHTML]`, so every call site binds `d` as an attribute.
 * The glyphs are decoration on controls whose words already say what they do,
 * which is why every call site also marks its `<svg>` `aria-hidden` — a screen
 * reader that heard both would be told the control twice, once in a language it
 * cannot read.
 */

/**
 * The rating glyphs, keyed by the state each one records.
 *
 * A total `Record`, deliberately: adding a state to the vocabulary becomes a
 * compile error here rather than a button with a blank square in it. That is
 * also why this map is typed while the two below are not — it is a statement
 * about `InteractionState`, and they are just shapes with names.
 *
 * `watchingNow` has no cell in the deck's rating row — it is the loop's exit,
 * not a rating — but the record is total, so it carries the play glyph it would
 * use if it ever needed one.
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
 * A double chevron: the deck's **Skip**, and deliberately not a rating glyph.
 *
 * Skip shares a row with the verdicts, and the cell that records nothing must
 * not be drawn like the cells that do — the third cell of a verdict row is read
 * as a third verdict unless something says otherwise. The something here is the
 * *kind* of shape: every rating glyph is a closed object (a heart, a thumb, a
 * bookmark, a circled cross) and this is two open strokes pointing somewhere.
 * In a row of opinions, an arrow reads as navigation, which is exactly what
 * Skip is.
 */
export const ICON_NEXT = 'M13 17l5-5-5-5M6 17l5-5-5-5';

/** A circular arrow: "Start a new loop" — again, from the top. */
export const ICON_REFRESH = 'M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10';

/**
 * Three sliders, the conventional mark for "the things you set".
 *
 * For the empty state's **Preferences**, whose whole promise is that the
 * visitor's answers are still there and can be re-aimed rather than restarted.
 */
export const ICON_SLIDERS = 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6';
