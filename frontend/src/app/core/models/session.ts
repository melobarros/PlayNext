/**
 * Who is signed in — the `playnext:session` marker (feature 004), per
 * `specs/004-guest-auth-migration/contracts/device-storage.md`.
 *
 * This is a **marker, not a credential store**. It answers "is there a session
 * to try?" at boot; the access token lives in memory and the refresh token in
 * an httpOnly cookie. There is deliberately no field here that could hold
 * either, and `auth.service.spec.ts` walks the whole of LocalStorage to keep
 * it that way — a token in here would be readable by any script on the origin,
 * which turns one XSS into a full account takeover.
 */

/** LocalStorage key for the marker. */
export const SESSION_STORAGE_KEY = 'playnext:session';

/** The only schema version this build understands. */
export const SESSION_SCHEMA_VERSION = 1;

export interface SessionDocument {
  schemaVersion: 1;
  /** The server's account GUID. */
  userId: string;
  /** Display only; the server's copy is authoritative. */
  email: string;
  /** ISO 8601. */
  signedInAt: string;
}

/**
 * Shape check against the frozen contract.
 *
 * An unknown `schemaVersion` or unparseable JSON is treated as **signed out**
 * rather than as an error (the 001/002 fail-safe rule). That direction matters:
 * the worst case is a visitor who has to sign in again, whereas trusting a
 * document we cannot read would mean attempting to refresh a session that may
 * not exist — and on a shared device, treating a stale marker as live is the
 * difference between a signed-out browser and a signed-in one.
 */
export function isValidSessionDocument(value: unknown): value is SessionDocument {
  if (typeof value !== 'object' || value === null) return false;

  const document = value as Record<string, unknown>;

  return (
    document['schemaVersion'] === SESSION_SCHEMA_VERSION &&
    typeof document['userId'] === 'string' &&
    document['userId'].length > 0 &&
    typeof document['email'] === 'string' &&
    typeof document['signedInAt'] === 'string' &&
    !Number.isNaN(Date.parse(document['signedInAt']))
  );
}

/** The marker as it will be stored. */
export function createSessionDocument(
  userId: string,
  email: string,
  now: Date | string = new Date(),
): SessionDocument {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    userId,
    email,
    signedInAt: typeof now === 'string' ? now : now.toISOString(),
  };
}
