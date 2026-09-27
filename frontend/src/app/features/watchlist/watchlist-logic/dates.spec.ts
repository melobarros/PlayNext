import { formatChosenAt } from './dates';

/**
 * Tests for the history's date rule.
 *
 * The format is asserted through the DOM by `history.spec.ts` as well, which is
 * where it matters. What is here instead is the part a single rendered row
 * cannot reach: the month table's edges, the day of the month without padding,
 * and the UTC reading that keeps two phones from disagreeing about the same
 * document.
 */
describe('formatChosenAt', () => {
  it('reads as day, abbreviated month, year', () => {
    expect(formatChosenAt('2026-09-25T20:00:00.000Z')).toBe('25 Sep 2026');
  });

  it('does not pad the day of the month', () => {
    // "05 Sep" reads as a serial number; "5 Sep" reads as a date.
    expect(formatChosenAt('2026-09-05T12:00:00.000Z')).toBe('5 Sep 2026');
  });

  it('covers both ends of the month table', () => {
    expect(formatChosenAt('2026-01-01T00:00:00.000Z')).toBe('1 Jan 2026');
    expect(formatChosenAt('2026-12-31T23:59:59.000Z')).toBe('31 Dec 2026');
  });

  it('reads the stored instant in UTC, so the same document says the same day everywhere', () => {
    // 23:30 UTC is the previous day in the Americas and the next morning in
    // Asia. The stored value names one instant; this pins which day it is read
    // as, so the answer does not depend on where the phone is (and so the test
    // does not depend on where the test runner is).
    expect(formatChosenAt('2026-09-25T23:30:00.000Z')).toBe('25 Sep 2026');
    expect(formatChosenAt('2026-09-25T00:30:00.000Z')).toBe('25 Sep 2026');
  });
});
