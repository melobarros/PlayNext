import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';

/**
 * The navigation shell (FR-013, SC-006).
 *
 * These navigate the **real route table** rather than mounting `Shell` directly,
 * because what is being asserted is a fact about where the nav is *not*: the nav
 * exists once, in the shell, and every "absent" case below is really the claim
 * that a route sits outside it. A component-level test could not tell the
 * difference between "the quiz has no nav" and "the quiz route forgot to use
 * the shell".
 *
 * Both of those are the same defect to a visitor and different ones to a
 * developer, which is why the route table carries tests of its own.
 */

describe('app shell', () => {
  beforeEach(() => {
    // Deck and Match Found read real root services; an empty document is the
    // returning visitor with no ratings, which renders without a catalog.
    localStorage.clear();
    sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        // Match Found reads the session to decide whether to offer the account
        // nudge, which means it reaches `AuthService` and therefore
        // `HttpClient`. Injection is not lazy, so the provider is needed even
        // though no test here sends anything.
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => localStorage.clear());

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  /** The bottom nav, or null when this screen has none. */
  async function navAt(url: string): Promise<HTMLElement | null> {
    const harness = await RouterTestingHarness.create(url);
    return rootOf(harness).querySelector('nav');
  }

  /** The nav's links, as hrefs. */
  function navTargets(nav: HTMLElement): (string | null)[] {
    return [...nav.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));
  }

  describe('where the nav appears (FR-013)', () => {
    it('is on the deck', async () => {
      expect(await navAt('/deck')).not.toBeNull();
    });

    it('is on Match Found, so a locked-in decision is not a one-way door', async () => {
      expect(await navAt('/deck/match/alpha')).not.toBeNull();
    });

    it('is not on the quiz', async () => {
      // Onboarding is a linear flow (research.md D5). A nav here would offer
      // "skip to my watchlist" to a visitor who has rated nothing yet, which
      // undercuts the quiz and leads to an empty screen.
      expect(await navAt('/quiz')).toBeNull();
    });

    it('is not on the entry hop, nor on the screen it forwards to', async () => {
      // `''` renders nothing and navigates on. With no saved quiz state it lands
      // on the quiz, which is outside the shell — so the visitor sees no nav
      // flash during the hand-off.
      const harness = await RouterTestingHarness.create('/');

      expect(harness.routeNativeElement?.tagName.toLowerCase()).not.toBe('app-shell');
      expect(rootOf(harness).querySelector('nav')).toBeNull();
    });
  });

  describe('what the nav offers (SC-006)', () => {
    it('reaches the watchlist in one tap from the deck', async () => {
      const nav = await navAt('/deck');

      expect(navTargets(nav as HTMLElement)).toContain('/watchlist');
    });

    it('reaches the watchlist in one tap from Match Found too', async () => {
      // Every main screen, not just the first one. A visitor who has just
      // locked in a decision is exactly the visitor most likely to want it.
      const nav = await navAt('/deck/match/alpha');

      expect(navTargets(nav as HTMLElement)).toContain('/watchlist');
    });

    it('offers the deck as well, so the nav is a way back and not a way out', async () => {
      const nav = await navAt('/deck');

      expect(navTargets(nav as HTMLElement)).toContain('/deck');
    });

    it('offers Profile, which is the only always-available way to an account (FR-001)', async () => {
      // The spec calls the Profile area "always-available" and the nudge on
      // Match Found dismissible, so this is the one route to account creation
      // that cannot be closed. A nav destination is also the fewest taps on a
      // phone, which is the placement Principle I asks for.
      const nav = await navAt('/deck');

      expect(navTargets(nav as HTMLElement)).toContain('/profile');
    });

    it('is labelled for a screen reader', async () => {
      const nav = await navAt('/deck');

      expect(nav?.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('the nav as a touch target (constitution I)', () => {
    it('gives every destination a 44px target', async () => {
      const nav = await navAt('/deck');
      const anchors = [...(nav?.querySelectorAll('a') ?? [])];

      expect(anchors.length).toBeGreaterThanOrEqual(2);
      for (const anchor of anchors) {
        expect(anchor.classList.contains('touch-target')).toBe(true);
      }
    });

    it('reserves the space it occupies, so no screen ends behind it', async () => {
      // The nav is fixed. Without clearance the last row of a long watchlist —
      // or the deck's action bar — would sit underneath it, which is the failure
      // mode a floating nav invites.
      const harness = await RouterTestingHarness.create('/deck');
      const nav = rootOf(harness).querySelector('nav');

      expect(nav?.classList.contains('fixed')).toBe(true);
      expect(nav?.classList.contains('bottom-0')).toBe(true);
      expect(rootOf(harness).querySelector('[data-nav-clearance]')).not.toBeNull();
    });
  });
});
