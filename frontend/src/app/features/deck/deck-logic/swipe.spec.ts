import {
  DISMISS_MIN_DISTANCE_PX,
  dismissThreshold,
  PointerSample,
  swipeDecision,
} from './swipe';

/**
 * Tests for the swipe gesture, as a pure function over pointer samples.
 *
 * No DOM and no `TestBed`: the component's only job is to collect samples and
 * report what this function said (T022). Keeping the judgement here means the
 * gesture is testable without synthesising events, which matters because jsdom
 * never converts mouse events into pointer events and does not implement
 * pointer capture at all (research.md D11).
 */

const CARD_WIDTH = 360;

/** A gesture from the origin: `[x, y, t]` triples, in order. */
function gesture(...points: [number, number, number][]): PointerSample[] {
  return points.map(([x, y, t]) => ({ x, y, t }));
}

/** Straight horizontal travel over `duration` ms, starting at the origin. */
function drag(dx: number, duration = 600): PointerSample[] {
  return gesture([0, 0, 0], [dx / 2, 0, duration / 2], [dx, 0, duration]);
}

describe('swipeDecision', () => {
  describe('a tap is not a swipe', () => {
    it('returns none for no samples', () => {
      expect(swipeDecision([], CARD_WIDTH)).toBe('none');
    });

    it('returns none for a single sample', () => {
      expect(swipeDecision(gesture([10, 10, 0]), CARD_WIDTH)).toBe('none');
    });

    it('returns none when the finger does not meaningfully travel', () => {
      // A touch that wobbles a couple of pixels is a tap (FR-004's tap action
      // must still fire), not a dismissal.
      expect(swipeDecision(gesture([10, 10, 0], [12, 11, 120]), CARD_WIDTH)).toBe('none');
    });
  });

  describe('travel past the distance threshold', () => {
    it('dismisses right on a long rightward drag', () => {
      expect(swipeDecision(drag(200), CARD_WIDTH)).toBe('dismiss-right');
    });

    it('dismisses left on a long leftward drag', () => {
      expect(swipeDecision(drag(-200), CARD_WIDTH)).toBe('dismiss-left');
    });

    it('commits exactly at the threshold, not one pixel later', () => {
      // 360 x 0.35 = 126.
      expect(swipeDecision(drag(126), CARD_WIDTH)).toBe('dismiss-right');
      expect(swipeDecision(drag(125), CARD_WIDTH)).toBe('reset');
    });

    it('scales the threshold with the card, so a wide card needs a longer drag', () => {
      expect(swipeDecision(drag(200), 360)).toBe('dismiss-right');
      expect(swipeDecision(drag(200), 900)).toBe('reset');
    });
  });

  describe('a fast flick commits even when short', () => {
    it('dismisses right on a short fast rightward flick', () => {
      // 60px in 50ms is 1.2px/ms — well past the velocity threshold, and well
      // short of the 126px distance threshold.
      expect(swipeDecision(drag(60, 50), CARD_WIDTH)).toBe('dismiss-right');
    });

    it('dismisses left on a short fast leftward flick', () => {
      expect(swipeDecision(drag(-60, 50), CARD_WIDTH)).toBe('dismiss-left');
    });

    it('snaps back on a short slow drag', () => {
      // Same distance, twelve times the duration: 0.1px/ms.
      expect(swipeDecision(drag(60, 600), CARD_WIDTH)).toBe('reset');
    });

    it('does not treat a flick below the slop as a swipe', () => {
      expect(swipeDecision(drag(6, 20), CARD_WIDTH)).toBe('none');
    });
  });

  describe('direction lock', () => {
    it('ignores a vertical drag — the page scrolls, the card stays', () => {
      expect(swipeDecision(gesture([0, 0, 0], [4, 120, 300]), CARD_WIDTH)).toBe('none');
    });

    it('stays locked to vertical once the gesture has declared itself', () => {
      // Starts clearly vertical, then drifts far to the right. The lock is the
      // point: a scroll that wanders sideways must not dismiss the card.
      expect(swipeDecision(gesture([0, 0, 0], [5, 30, 50], [200, 40, 400]), CARD_WIDTH)).toBe(
        'none',
      );
    });

    it('stays locked to horizontal once the gesture has declared itself', () => {
      // The mirror case: a horizontal swipe that drifts downward still commits.
      expect(swipeDecision(gesture([0, 0, 0], [30, 5, 50], [200, 60, 400]), CARD_WIDTH)).toBe(
        'dismiss-right',
      );
    });
  });
});

describe('dismissThreshold', () => {
  it('takes the ratio of a card wide enough for it to matter', () => {
    // 360px × 0.35 = 126px, comfortably past the floor.
    expect(dismissThreshold(360)).toBeCloseTo(126);
  });

  it('never drops below the floor, however narrow the card', () => {
    // A short card would otherwise be dismissed by a twitch.
    expect(dismissThreshold(100)).toBe(DISMISS_MIN_DISTANCE_PX);
  });

  it('falls back to the floor when the card cannot be measured', () => {
    // jsdom reports every element as 0px wide, and a real card can be measured
    // before layout. A NaN here would make the threshold NaN and commit *every*
    // drag, so an unmeasurable card has to be stricter, not looser.
    expect(dismissThreshold(0)).toBe(DISMISS_MIN_DISTANCE_PX);
    expect(dismissThreshold(Number.NaN)).toBe(DISMISS_MIN_DISTANCE_PX);
  });

  it('is the same number the decision commits on', () => {
    // The two are separate functions by necessity — one answers "how far", the
    // other "did it get there" — and this is the pin that keeps the drag hint
    // reaching full opacity at the distance a drag actually dismisses.
    const threshold = dismissThreshold(CARD_WIDTH);
    const justUnder = drag(-(threshold - 1), 100000);
    const justOver = drag(-(threshold + 1), 100000);

    // Slow enough that velocity cannot commit either one on its own.
    expect(swipeDecision(justUnder, CARD_WIDTH)).toBe('reset');
    expect(swipeDecision(justOver, CARD_WIDTH)).toBe('dismiss-left');
  });
});
