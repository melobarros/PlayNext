/**
 * The swipe gesture, as a pure function over pointer samples.
 *
 * All the judgement lives here so it can be tested without a DOM — which is
 * not merely convenient but necessary: jsdom 30 never synthesises pointer
 * events from mouse events and does not implement pointer capture, so the
 * component's binding (T022) is not something a test can drive directly
 * (research.md D11). The component collects samples and reports the verdict;
 * this file decides.
 *
 * Every threshold is a named constant below, in one place, so the feel of the
 * gesture is reviewable without reading the arithmetic.
 */

/** One pointer position, with the timestamp the event carried. */
export interface PointerSample {
  x: number;
  y: number;
  /** Milliseconds, from `event.timeStamp`. */
  t: number;
}

/** What the visitor's gesture meant. */
export type SwipeOutcome =
  /** A tap, or a scroll. The card does not move and the tap action may fire. */
  | 'none'
  /** Committed: the card leaves to the left. */
  | 'dismiss-left'
  /** Committed: the card leaves to the right. */
  | 'dismiss-right'
  /** A drag that fell short. The card returns to centre. */
  | 'reset';

/**
 * How far a finger must travel before this is a drag at all.
 *
 * Serves double duty on purpose: below this the gesture is a tap, and this is
 * also the distance at which a gesture declares its axis. Both questions are
 * really "has the finger committed to moving yet", and answering them with two
 * separate constants would let them drift apart.
 */
export const GESTURE_SLOP_PX = 8;

/** Fraction of the card's width a drag must cover to commit on distance. */
export const DISMISS_DISTANCE_RATIO = 0.35;

/**
 * Floor for the distance threshold, so a narrow card is not twitchy. On a
 * 360px card the ratio gives 126px, comfortably above this.
 */
export const DISMISS_MIN_DISTANCE_PX = 72;

/**
 * Release speed, in pixels per millisecond, that commits regardless of
 * distance — the flick. 0.6px/ms is 600px/s.
 */
export const DISMISS_VELOCITY_PX_PER_MS = 0.6;

/**
 * How far a drag must travel to commit on distance alone, for this card width.
 *
 * Exported because the drag hint has to know the same number to fade in as the
 * gesture approaches commitment. Recomputing it there would put the arithmetic
 * in two places and let the pill reach full opacity at a distance that no
 * longer dismisses anything — the sort of drift that is invisible in review and
 * obvious to a thumb.
 *
 * Guards the measurement rather than the gesture: a NaN width would make the
 * threshold NaN and commit every drag, so an unmeasurable card falls back to
 * the floor and is merely strict instead of wrong.
 */
export function dismissThreshold(cardWidth: number): number {
  const width = Number.isFinite(cardWidth) ? cardWidth : 0;
  return Math.max(DISMISS_MIN_DISTANCE_PX, width * DISMISS_DISTANCE_RATIO);
}

/**
 * Decides what a completed gesture meant.
 *
 * @param samples Every pointer position collected, oldest first.
 * @param cardWidth The card's rendered width, which sets the distance threshold.
 */
export function swipeDecision(samples: readonly PointerSample[], cardWidth: number): SwipeOutcome {
  // A tap arrives as a down and an up at the same place, so fewer than two
  // samples means there is no gesture to judge.
  if (samples.length < 2) return 'none';

  // A gesture that declared itself vertical is the visitor scrolling the card's
  // synopsis, and it stays vertical for its whole life even if it then wanders
  // sideways. Letting the browser have it is the only way `touch-action: pan-y`
  // feels right.
  const axis = lockedAxis(samples);
  if (axis !== 'horizontal') return 'none';

  const first = samples[0];
  const last = samples[samples.length - 1];
  const dx = last.x - first.x;
  const elapsed = last.t - first.t;

  const threshold = dismissThreshold(cardWidth);

  // Average speed across the gesture. Measuring the last two samples instead
  // would be closer to true release velocity, but a pointer that pauses before
  // lifting is finishing its gesture, not flicking, and the average says so.
  const velocity = elapsed > 0 ? Math.abs(dx) / elapsed : 0;

  if (Math.abs(dx) < threshold && velocity < DISMISS_VELOCITY_PX_PER_MS) return 'reset';

  return dx < 0 ? 'dismiss-left' : 'dismiss-right';
}

/**
 * The axis the gesture locked to, decided by the first movement past the slop
 * and held for the rest of the gesture.
 */
function lockedAxis(samples: readonly PointerSample[]): 'horizontal' | 'vertical' | 'undecided' {
  const origin = samples[0];

  for (const sample of samples) {
    const dx = sample.x - origin.x;
    const dy = sample.y - origin.y;

    if (Math.hypot(dx, dy) < GESTURE_SLOP_PX) continue;
    return Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
  }

  return 'undecided';
}
