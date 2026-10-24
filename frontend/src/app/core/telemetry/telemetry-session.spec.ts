import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { TelemetrySession } from './telemetry-session';

const KEY = TelemetrySession.STORAGE_KEY;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The anonymous session id (009, FR-002, research D2).
 *
 * The privacy promise rides on two properties, and both are asserted here
 * rather than assumed: the id lives in **sessionStorage** — so it dies with the
 * tab and never becomes a device identifier — and it is random, so it cannot be
 * derived from the account, the device, or the network.
 */
describe('TelemetrySession', () => {
  let session: TelemetrySession;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({});
    session = TestBed.inject(TelemetrySession);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('is a random UUID v4', () => {
    const id = session.id();

    // The version nibble is `4` and the variant nibble is 8/9/a/b — what makes
    // this "a v4 UUID" rather than merely "something uuid-shaped".
    expect(id).toMatch(UUID_V4);
  });

  it('returns the same id for every call in one tab', () => {
    // Every event of a session must carry one id, or a session is not a
    // session — and an undo would stop finding the impression it answers.
    expect(session.id()).toBe(session.id());
  });

  it('keeps the id in sessionStorage under the contracted key', () => {
    const id = session.id();

    expect(sessionStorage.getItem(KEY)).toBe(id);
  });

  it('reuses an id that is already stored', () => {
    // A reload inside the same tab is the same session: the deck state
    // survives it, so the record must too.
    const stored = '3f1c0f1e-6a5b-4c8e-9f0a-1b2c3d4e5f60';
    sessionStorage.setItem(KEY, stored);

    expect(session.id()).toBe(stored);
  });

  it('discards a stored value that is not a UUID', () => {
    // Only something other than this service could have written it, and the
    // intake bounds the field at 64 characters — a foreign value must not be
    // forwarded on.
    sessionStorage.setItem(KEY, 'not-a-uuid');

    const id = session.id();

    expect(id).toMatch(UUID_V4);
    expect(sessionStorage.getItem(KEY)).toBe(id);
  });

  it('never writes to LocalStorage', () => {
    session.id();

    // A LocalStorage id would outlive the tab, which is exactly what turns an
    // anonymous session id into a durable device identifier (FR-020).
    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('ignores an id found in LocalStorage, even under the same key', () => {
    const foreign = '0b9e7a54-2f4d-4d0a-91c2-3b4c5d6e7f80';
    localStorage.setItem(KEY, foreign);

    const id = session.id();

    expect(id).not.toBe(foreign);
    expect(localStorage.getItem(KEY)).toBe(foreign);
    expect(sessionStorage.getItem(KEY)).toBe(id);
  });

  it('generates and reuses an in-memory id when storage throws', () => {
    // Private browsing and blocked origins make storage access throw. The tab
    // must still record; it simply cannot survive a reload.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage blocked');
    });

    const first = session.id();
    const second = session.id();

    expect(first).toMatch(UUID_V4);
    expect(second).toBe(first);
  });

  it('starts a new id in a new tab', () => {
    const first = session.id();

    // Closing the tab clears sessionStorage; a fresh tab therefore mints a
    // fresh id. That rotation is the reason the id does not need to be
    // deletable or rotatable by policy.
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const second = TestBed.inject(TelemetrySession).id();

    expect(second).toMatch(UUID_V4);
    expect(second).not.toBe(first);
  });
});
