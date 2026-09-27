/**
 * How a title's numbers read on screen, in one place.
 *
 * The deck's card and the watchlist's detail view both show a rating and a
 * runtime. These are presentation *rules*, not formatting utilities: "always one
 * decimal" exists so the numbers line up card to card instead of jittering in
 * width, and `formatRuntime`'s `null` is what lets a template leave the row out
 * rather than print `0 min`. Two independent copies of either would be two
 * answers to one question, and the difference would only show up in a
 * screenshot nobody compared (engineering standards — the same behaviour is not
 * implemented two different ways).
 *
 * Moved out of `features/deck/card/card.ts` when 003's detail view needed the
 * same two rules (research.md D11 — extracted, not copied).
 */

/**
 * A rating to exactly one decimal: `8` → `'8.0'`, `7.94` → `'7.9'`.
 *
 * No guard for a missing value: `MediaTitle.rating` is required, and the model
 * calls it a display value. A fallback here would be a branch no caller can
 * reach, which is a branch no test can cover either.
 */
export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

/**
 * Minutes as a visitor would say them: `166` → `'2h 46m'`, `45` → `'45 min'`.
 *
 * Returns `null` — not `'0 min'` or `'NaN'` — for an absent or nonsensical
 * value, which is what lets the template leave the row out cleanly. The guard
 * matters because this field arrives from the API in Milestone 2.
 */
export function formatRuntime(minutes: number | undefined): string | null {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return null;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
