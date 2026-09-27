import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { Profile } from './profile';

/**
 * The Profile screen (US1, FR-001/002/008/010/011/018).
 *
 * Driven through the DOM against the **real** `AuthService` and a real HTTP
 * backend double, rather than against a stub. What this screen does with a
 * refusal — which of the six reasons it distinguishes, what it says, what it
 * keeps hidden — is the whole of its behaviour, and it is behaviour the service
 * produces from an actual response. A fake service would let the two disagree
 * about what a 409 means and no test here would notice.
 *
 * Two things this file deliberately does not claim:
 *
 * - **The nav's link to `/profile`** is asserted in `shell.spec.ts`, where the
 *   other nav facts are and where that file's own header says they belong. What
 *   is asserted here is the other half: that the path the nav points at arrives
 *   at this screen.
 * - **Pixels at 360px.** jsdom has no layout engine, so FR-018 is checked here
 *   the way the shell already checks it — the `touch-target` class, which is
 *   `min-height: 2.75rem` (44px) in `styles.css`. The real 360px pass is T046's,
 *   on a real browser.
 */

/** The refusal the API sends for a wrong password or an unknown address (FR-011). */
const GENERIC_REFUSAL = {
  code: 'invalid-credentials',
  errors: ['Those details did not match an account.'],
};

describe('profile', () => {
  let fixture: ComponentFixture<Profile>;
  let root: HTMLElement;
  let http: HttpTestingController;

  const EMAIL = 'visitor@example.com';
  const PASSWORD = 'Correct-Horse-9!';

  function build(): void {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });

    fixture = TestBed.createComponent(Profile);
    root = fixture.nativeElement as HTMLElement;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  function buttons(): HTMLButtonElement[] {
    return [...root.querySelectorAll('button')] as HTMLButtonElement[];
  }

  function controls(): HTMLElement[] {
    return [...root.querySelectorAll('button, input, a')] as HTMLElement[];
  }

  /**
   * Whether a control has a 44px tap area: on itself, or on the label wrapping
   * it.
   *
   * Both are in use already — the shell puts `touch-target` on the anchor, the
   * quiz puts it on the label around its checkbox — and either is a real hit
   * area, because a tap on the label reaches the control inside it. Accepting
   * both keeps the assertion about the size rather than about which element
   * happens to carry the class.
   */
  function hasTapArea(control: Element): boolean {
    return (
      control.classList.contains('touch-target') ||
      (control.closest('label')?.classList.contains('touch-target') ?? false)
    );
  }

  /** The sign-up / sign-in switch, as the tabs it announces itself to be. */
  function modes(): HTMLButtonElement[] {
    return [...root.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
  }

  function openMode(label: string): void {
    const tab = modes().find((candidate) => (candidate.textContent ?? '').includes(label));

    if (!tab) throw new Error(`No "${label}" mode — the screen offers ${modes().length}`);

    tab.click();
    fixture.detectChanges();
  }

  /**
   * The control that submits, found by `type` rather than by its wording.
   *
   * "Sign in" is both a mode and the thing the button does in that mode, so a
   * label search would be ambiguous exactly where it matters. `type="submit"` is
   * also what makes Enter in a field submit the form, so requiring it is
   * requiring the keyboard path.
   */
  function submitButton(): HTMLButtonElement {
    const button = root.querySelector<HTMLButtonElement>('button[type="submit"]');

    if (!button) throw new Error('No submit button on the Profile screen');

    return button;
  }

  function field(type: string): HTMLInputElement {
    const input = root.querySelector<HTMLInputElement>(`input[type="${type}"]`);

    if (!input) throw new Error(`No ${type} field on the Profile screen`);

    return input;
  }

  function googleButton(): HTMLButtonElement {
    const button = buttons().find((candidate) => /google/i.test(candidate.textContent ?? ''));

    if (!button) throw new Error('No Google button on the Profile screen');

    return button;
  }

  /** Fills a field the way the browser does: set the value, then fire `input`. */
  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function fill(email = EMAIL, password = PASSWORD): void {
    type(field('email'), email);
    type(field('password'), password);
  }

  /**
   * Submits the form and hands back the event.
   *
   * Returning it lets a test assert `defaultPrevented`: a submit handler that
   * forgets to prevent the default leaves the app entirely in a real browser,
   * and the failure is invisible to every other assertion here.
   */
  function submit(): Event {
    const form = root.querySelector('form');

    if (!form) throw new Error('No form on the Profile screen');

    const event = new Event('submit', { bubbles: true, cancelable: true });

    form.dispatchEvent(event);
    fixture.detectChanges();

    return event;
  }

  /** Answers a request with a failure, so the outcome path can be asserted. */
  function refuse(
    request: TestRequest,
    status = 401,
    body: Record<string, unknown> = GENERIC_REFUSAL,
  ): void {
    request.flush(body, { status, statusText: 'Error' });
    fixture.detectChanges();
  }

  /** Whatever the screen is saying about the last attempt, if anything. */
  function alert(): HTMLElement | null {
    return root.querySelector('[role="alert"]');
  }

  afterEach(() => {
    http.verify();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  describe('the two ways in (FR-002)', () => {
    it('opens on creating an account, with an email field and a password field', () => {
      build();

      expect(field('email')).toBeTruthy();
      expect(field('password')).toBeTruthy();
    });

    it('offers both modes, sign-up first', () => {
      build();

      expect(modes().map((tab) => tab.textContent?.trim())).toEqual([
        expect.stringContaining('Sign up'),
        expect.stringContaining('Sign in'),
      ]);
    });

    it('opens on sign-up', () => {
      build();

      expect(modes()[0]?.getAttribute('aria-selected')).toBe('true');
      expect(modes()[1]?.getAttribute('aria-selected')).toBe('false');
    });

    it('switches to sign-in when sign-in is chosen', () => {
      build();

      openMode('Sign in');

      expect(modes()[1]?.getAttribute('aria-selected')).toBe('true');
      expect(modes()[0]?.getAttribute('aria-selected')).toBe('false');
    });

    it('sends the visitor to the endpoint for the mode that is open', () => {
      // The mode switch has to change something a test can see, and what a
      // visitor sees is which door they went through. A switch that only
      // restyled itself would pass every other test in this block.
      build();
      fill();
      submit();
      refuse(http.expectOne('/api/auth/register'));

      openMode('Sign in');
      fill();
      submit();
      refuse(http.expectOne('/api/auth/login'));
    });

    it('stays on the screen instead of navigating away on submit', () => {
      build();
      fill();

      const event = submit();
      refuse(http.expectOne('/api/auth/register'));

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('the password field (FR-010)', () => {
    it('hides what is typed', () => {
      build();

      expect(field('password').type).toBe('password');
    });

    it('is the only field carrying the password', () => {
      build();
      fill();

      const inputs = [...root.querySelectorAll('input')] as HTMLInputElement[];

      expect(inputs.filter((input) => input.type === 'password')).toHaveLength(1);
      expect(field('email').type).toBe('email');
    });

    it('has no control that reveals it', () => {
      // FR-010 says the password MUST be hidden while entered. A reveal toggle
      // is the usual way that quietly stops being true, so the absence is
      // asserted by pressing every control on the screen and checking the field
      // is still masked — an assertion that fails the day one is added, rather
      // than one that passes because it never looked.
      build();
      type(field('password'), PASSWORD);

      for (const button of buttons()) {
        button.click();
        fixture.detectChanges();
      }

      expect(field('password').type).toBe('password');

      // Those clicks may have started requests. Drained rather than asserted on:
      // this test is about the field, and what the buttons do is every other
      // test's business.
      for (const request of http.match(() => true)) {
        refuse(request);
      }
    });

    it('never renders the password back into the page', () => {
      // The stored copies are `auth.service.spec.ts`'s business. This is the
      // other half of FR-010 — "displayed in readable form" — and it is checked
      // against the markup rather than the text, because an attribute is as
      // readable as a paragraph.
      build();
      fill();
      submit();
      refuse(http.expectOne('/api/auth/register'));

      expect(root.innerHTML).not.toContain(PASSWORD);
    });
  });

  describe('continuing with Google (FR-002)', () => {
    it('is offered while creating an account', () => {
      build();

      expect(googleButton()).toBeTruthy();
    });

    it('is offered while signing in too', () => {
      build();

      openMode('Sign in');

      expect(googleButton()).toBeTruthy();
    });

    it('does not ask for a password', () => {
      // The whole point of the Google path is that there is no password to
      // invent. It is asserted through the button's own form scope: a button
      // that submits the credential form would make "Continue with Google"
      // attempt an email-and-password sign-in with whatever is in the fields.
      build();

      expect(googleButton().type).not.toBe('submit');
    });
  });

  describe('when the details are refused (FR-008, FR-011)', () => {
    it('shows what the server said, so the screen and the API cannot disagree', () => {
      build();
      fill();
      submit();
      refuse(http.expectOne('/api/auth/register'));

      expect(alert()?.textContent).toContain('Those details did not match an account.');
    });

    it('still says something when the server sends no message of its own', () => {
      build();
      fill();
      submit();
      refuse(http.expectOne('/api/auth/register'), 401, { code: 'invalid-credentials' });

      expect(alert()?.textContent?.trim()).toBeTruthy();
    });

    it('adds no diagnosis of its own to a refusal (FR-011)', () => {
      // FR-011 wants a generic message because the difference between "no such
      // address" and "wrong password" is what an attacker enumerates accounts
      // with. The API is tested for byte-identical bodies; this is the client
      // half — it must pass that message through rather than sharpen it.
      build();
      fill();
      submit();
      refuse(http.expectOne('/api/auth/register'));

      const message = alert()?.textContent?.toLowerCase() ?? '';

      expect(message).not.toContain('password');
      expect(message).not.toContain(EMAIL.toLowerCase());
    });

    it('offers signing in when the email already has an account (FR-008)', () => {
      build();
      fill();
      submit();
      refuse(http.expectOne('/api/auth/register'), 409, {
        code: 'email-taken',
        errors: ['That email already has an account. Sign in instead.'],
      });

      expect(alert()?.textContent).toContain('Sign in instead');

      // An offer the visitor cannot act on is an apology. The switch has to be
      // on the screen they are already looking at.
      expect(modes().length).toBeGreaterThanOrEqual(2);
    });

    it('switches to sign-in when the visitor takes that offer', () => {
      build();
      fill();
      submit();
      refuse(http.expectOne('/api/auth/register'), 409, {
        code: 'email-taken',
        errors: ['That email already has an account. Sign in instead.'],
      });

      openMode('Sign in');
      fill();
      submit();

      refuse(http.expectOne('/api/auth/login'));
    });

    it('says how long a locked-out visitor has to wait (FR-011)', () => {
      // The one credential failure that is actionable, so the number travels
      // with it: "try again in 15 minutes" is a different screen from "try
      // again".
      build();
      fill();
      submit();
      refuse(http.expectOne('/api/auth/register'), 401, {
        code: 'locked',
        errors: ['Too many attempts.'],
        retryAfterSeconds: 900,
      });

      expect(alert()?.textContent).toContain('15');
    });

    it('says the connection is the problem when nothing was reached (FR-016)', () => {
      build();
      fill();
      submit();

      // Status 0 is what the browser reports for a request that never arrived.
      // Told apart from a 5xx on purpose: sending the visitor to look for a
      // fault on our side when the fault is their signal is a wrong answer.
      http
        .expectOne('/api/auth/register')
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
      fixture.detectChanges();

      expect(alert()?.textContent?.toLowerCase()).toContain('offline');
    });
  });

  describe('every control as a touch target (FR-018, constitution I)', () => {
    it('gives every control a 44px tap area', () => {
      build();

      const targets = controls();

      expect(targets.length).toBeGreaterThan(0);
      for (const control of targets) {
        expect(hasTapArea(control)).toBe(true);
      }
    });

    it('holds for the sign-in mode as well, not only the one it opens on', () => {
      // A screen tested only in its default state is a screen whose second
      // state nobody has measured.
      build();

      openMode('Sign in');

      for (const control of controls()) {
        expect(hasTapArea(control)).toBe(true);
      }
    });

    it('submits from the button, not only from the keyboard', () => {
      // FR-018 is about a phone. The button has to be the thing that submits,
      // and it has to be reachable at thumb height rather than buried in a
      // paragraph.
      build();
      fill();

      submitButton().click();
      fixture.detectChanges();

      refuse(http.expectOne('/api/auth/register'));
    });
  });

  describe('reaching it from the route table', () => {
    // The nav's link to `/profile` is asserted in `shell.spec.ts`, with the
    // other nav facts. What is asserted here is that the path it points at
    // arrives at this screen — a nav entry pointing at a path with no route is
    // a tap that silently lands somewhere else, which is the dead end
    // constitution II forbids wearing a working link.
    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes, withComponentInputBinding()),
          provideHttpClient(),
          provideHttpClientTesting(),
        ],
      });

      // A controller for *this* module: the outer `afterEach` verifies whatever
      // `http` holds, and the one left over from the previous test belongs to an
      // injector that no longer exists.
      http = TestBed.inject(HttpTestingController);
    });

    it('is what /profile resolves to, inside the shell', async () => {
      const harness = await RouterTestingHarness.create('/profile');
      const screen = harness.fixture.nativeElement as HTMLElement;

      expect(screen.querySelector('app-profile')).not.toBeNull();
      expect(screen.querySelector('nav')).not.toBeNull();
    });

    it('is still reachable as a guest, which is who the screen is for (FR-001)', async () => {
      // No account, no session marker, no ratings: the visitor the whole of
      // US1 starts from. A Profile screen that only opened for signed-in users
      // would make account creation unreachable from the only place that
      // offers it.
      const harness = await RouterTestingHarness.create('/profile');
      const screen = harness.fixture.nativeElement as HTMLElement;

      expect(screen.querySelector<HTMLInputElement>('input[type="email"]')).not.toBeNull();
      expect(screen.querySelector<HTMLInputElement>('input[type="password"]')).not.toBeNull();
    });
  });
});
