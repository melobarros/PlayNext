import { Injectable } from '@angular/core';

/**
 * The per-tab anonymous session id (009, FR-002, research D2).
 *
 * The app has no guest identifier, so this feature introduces one: a random
 * UUID created when the tab starts, kept in **sessionStorage**, and reused for
 * every event in that tab — including events recorded after a sign-in, so the
 * session stays one session. Closing the tab ends it.
 *
 * SessionStorage rather than LocalStorage is the whole point: a value in
 * LocalStorage would survive the tab, quietly become a device identifier the
 * visitor never agreed to, and outlive the ninety-day retention promise
 * (FR-020). The same reasoning is why it is never written to a cookie, derived
 * from the account, or computed from anything about the device or network.
 *
 * When storage is unavailable — private browsing, a blocked origin, a browser
 * that throws on access — the id falls back to memory. Recording still works
 * for the tab; it just cannot survive a reload, which is the correct
 * degradation: analytics must never be the reason a card does not appear.
 */
@Injectable({ providedIn: 'root' })
export class TelemetrySession {
  /** The key the id lives under in sessionStorage. */
  static readonly STORAGE_KEY = 'playnext:telemetry-session';

  /** This tab's id once it is known; also the fallback when storage throws. */
  private cached: string | null = null;

  /**
   * This tab's id, creating it on first use.
   *
   * A stored value that is not a UUID is discarded rather than repaired: it can
   * only have come from something else writing our key, and sending it on would
   * put arbitrary text into a field the intake bounds at 64 characters.
   */
  id(): string {
    if (this.cached !== null) return this.cached;

    const stored = this.read();
    if (stored !== null) {
      this.cached = stored;
      return stored;
    }

    const created = createId();
    this.cached = created;
    this.write(created);
    return created;
  }

  private read(): string | null {
    try {
      const stored = storage()?.getItem(TelemetrySession.STORAGE_KEY);
      return stored !== undefined && stored !== null && UUID_V4.test(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  private write(id: string): void {
    try {
      storage()?.setItem(TelemetrySession.STORAGE_KEY, id);
    } catch {
      // Non-fatal: the in-memory id above is already in use for this tab.
    }
  }
}

/** A UUID v4, exactly — the shape `crypto.randomUUID()` produces. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A fresh random id.
 *
 * `crypto.randomUUID` is available in every browser this app targets (it
 * requires a secure context, which the deployed app is), and it is the
 * platform's own v4 generator rather than a hand-rolled one.
 */
function createId(): string {
  return crypto.randomUUID();
}

/** Returns SessionStorage, or null when the browser refuses to provide it. */
function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
