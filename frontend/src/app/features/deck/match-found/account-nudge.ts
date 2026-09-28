/**
 * The account nudge's dismissal (US1 scenario 5, FR-001).
 *
 * **`sessionStorage`, not LocalStorage** (research.md D11). The spec scopes the
 * dismissal to "the rest of the session", which is what `sessionStorage` means
 * exactly: a reload keeps it, tomorrow does not. LocalStorage would turn one
 * tap into a permanent setting, and the nudge would never be offered again on
 * that device.
 *
 * There is no `schemaVersion` here and no document — a single flag, and nothing
 * that could ever need migrating — which is why it is deliberately not one of
 * `contracts/device-storage.md`'s keys. It is also the only state in the app
 * that lives in this storage area, so the two can never be confused.
 *
 * Both functions swallow storage errors. Private browsing and blocked storage
 * both throw on access, and neither is a reason to fail to render a screen: the
 * worst case is that the nudge comes back after a reload.
 */

/** Marks that the visitor has turned this nudge down for the session. */
export const ACCOUNT_NUDGE_STORAGE_KEY = 'playnext:account-nudge-dismissed';

/** Whether the visitor has already turned this nudge down. */
export function isNudgeDismissed(): boolean {
  try {
    return sessionStorage.getItem(ACCOUNT_NUDGE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Remembers the dismissal for the rest of the session. */
export function rememberNudgeDismissal(): void {
  try {
    sessionStorage.setItem(ACCOUNT_NUDGE_STORAGE_KEY, '1');
  } catch {
    // Non-fatal: the nudge is gone for this page view either way.
  }
}
