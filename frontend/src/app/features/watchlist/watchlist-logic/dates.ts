/**
 * How the history says *when* a choice was made (003 US3).
 *
 * Framework-free and in `watchlist-logic/`, beside `entries.ts`, for the same
 * reason the grouping lives there: it is a rule about the data, not a detail of
 * the component that shows it.
 */

/**
 * Month abbreviations, indexed by `Date.getUTCMonth()`.
 *
 * A table rather than `Intl`, and that is the decision worth recording. The
 * history row is compared in tests and read on a phone; `Intl` would render
 * `25 Sep 2026` on one machine and `25 de set. de 2026` on another, and — worse
 * for confidence — the exact output depends on which ICU data the runtime was
 * built with. The same reasoning `entries.ts` gives for `byCodepoint` over
 * `localeCompare` applies here: two machines must not disagree about what the
 * same document says. Localizing this is a real future change, and it should be
 * made deliberately, with the locale threaded in, rather than by accident.
 */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * A history entry's choice time, as `25 Sep 2026`.
 *
 * **Read from UTC**, deliberately. `chosenAt` is written by `toISOString()` and
 * validated as `Date`-parseable by `InteractionStore`, so the stored value
 * already names an instant unambiguously; rendering it in the device's zone
 * would make the same document say a different day on two phones, and a
 * decision log does not need that precision at the cost of that disagreement.
 *
 * The `chosenAt` is taken on trust: the store's validator rejects a document
 * whose `history` holds anything but parseable timestamps, so a guard here
 * would be a branch no caller can reach.
 */
export function formatChosenAt(chosenAt: string): string {
  const at = new Date(chosenAt);

  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}
