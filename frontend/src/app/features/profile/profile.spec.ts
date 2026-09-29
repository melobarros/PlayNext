import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { sessionInterceptor } from '../../core/services/session.interceptor';
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
      // The interceptor is part of the app under test, not scaffolding: the
      // token on the change-password request is attached by it and by nothing
      // else, so a spec that left it out would be testing a client the app
      // does not have.
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([sessionInterceptor])),
        provideHttpClientTesting(),
      ],
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

  // --- the signed-in half (US4) -----------------------------------------

  const USER_ID = '0e7d2c41-9f3a-4b8e-a1c6-5d0f9e2b3a11';
  const ACCESS_TOKEN = 'test-access-token-not-a-credential';
  const NEW_PASSWORD = 'Battery-Staple-7!';

  const EARLIER = '2026-09-27T10:00:00.000Z';

  /** What the server says the account holds — nothing, in most of these tests. */
  const SIGNED_IN_STATE = { interactions: {}, history: [], preferences: null };

  /**
   * The four device documents sign-out must remove (SC-007), spelled as
   * `contracts/device-storage.md` freezes them.
   *
   * Literal rather than imported from the models: the key *names* are the
   * contract, and a test that read them from the constants would follow those
   * constants anywhere they were renamed to — including to a name no earlier
   * build's data lives under.
   */
  const ACCOUNT_DEVICE_KEYS = [
    'playnext:interactions',
    'playnext:quiz-state',
    'playnext:session',
    'playnext:sync-pending',
  ];

  /**
   * Puts the screen in front of a signed-in visitor the way a visitor gets
   * there: by signing in.
   *
   * Seeding the marker instead would be quicker and would leave the access
   * token unset — it lives in memory and in no storage key — so every
   * authenticated request in this block would go out without one and the tests
   * would be exercising a state the app cannot reach.
   */
  function signIn(state: unknown = SIGNED_IN_STATE): void {
    fill();
    submit();
    http.expectOne('/api/auth/register').flush({
      userId: USER_ID,
      email: EMAIL,
      accessToken: ACCESS_TOKEN,
      state,
    });
    fixture.detectChanges();
  }

  /**
   * One unsent change, under the contract's own key and document shape.
   *
   * Written before anything is injected, because `SyncService` reads the queue
   * in its constructor — seeding afterwards would produce a service that never
   * saw it, exactly as seeding the session marker late would.
   */
  function queueOfflineChange(): void {
    localStorage.setItem(
      'playnext:sync-pending',
      JSON.stringify({
        schemaVersion: 1,
        operations: [
          { kind: 'rate', titleId: 'arrival', state: 'loved', updatedAt: '2026-09-27T10:00:00.000Z' },
        ],
      }),
    );
  }

  /**
   * The control that ends the session, matched on wording because it is the
   * one control whose label is the whole of how a visitor finds it.
   *
   * `/sign out/i` accepts both the plain button and any "sign out anyway"
   * confirmation, so the flow can warn however it likes without this helper
   * losing track of it.
   */
  function signOutButton(): HTMLButtonElement {
    const button = buttons().find((candidate) => /sign out/i.test(candidate.textContent ?? ''));

    if (!button) throw new Error('No sign-out control on the signed-in Profile screen');

    return button;
  }

  /** A password field of the change form, by the `name` the API's body uses. */
  function passwordField(name: string): HTMLInputElement {
    const input = root.querySelector<HTMLInputElement>(`input[type="password"][name="${name}"]`);

    if (!input) throw new Error(`No "${name}" field on the Profile screen`);

    return input;
  }

  function fillChangeForm(): void {
    type(passwordField('currentPassword'), PASSWORD);
    type(passwordField('newPassword'), NEW_PASSWORD);
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

  describe('a visitor who is signed in (US4)', () => {
    it('is shown their account instead of the way in', () => {
      // The screen's two halves are exclusive. A visitor holding a session has
      // nothing to do with a sign-up form, and leaving it up invites them to
      // create a second account for the address they are already using.
      build();
      signIn();

      expect(modes()).toHaveLength(0);
      expect(text()).toContain(EMAIL);
      expect(signOutButton()).toBeTruthy();
    });

    /*
      The confirmation, and the order of this half, are one fix.

      MVP testing reported signing up as "it went into the reset password
      screen": submitting the form swapped the halves in place, with no
      navigation and no word about it, onto a screen whose first control was
      the change-password form. Nothing was broken — the visitor was simply
      never told what had happened, and the first thing they read described a
      different job.
    */
    describe('the confirmation (MVP signup fix)', () => {
      it('says the account was created, on the same screen', () => {
        build();
        fill();
        submit();
        http.expectOne('/api/auth/register').flush({
          userId: USER_ID,
          email: EMAIL,
          accessToken: ACCESS_TOKEN,
          state: SIGNED_IN_STATE,
        });
        fixture.detectChanges();

        expect(alert()?.textContent).toContain('Account created');
        expect(modes()).toHaveLength(0);
      });

      it('says who signed in after signing in', () => {
        build();
        openMode('Sign in');
        fill();
        submit();
        http.expectOne('/api/auth/login').flush({
          userId: USER_ID,
          email: EMAIL,
          accessToken: ACCESS_TOKEN,
          state: SIGNED_IN_STATE,
        });
        fixture.detectChanges();

        expect(alert()?.textContent).toContain('Signed in');
      });

      it('leads with the account summary, before the password form', () => {
        // The structural half of the fix, pinned as DOM order because that is
        // what the visitor reads top to bottom. A confirmation above a form
        // that still led the screen would leave the symptom in place.
        build();
        signIn();

        const form = root.querySelector('form');
        const summary = [...root.querySelectorAll('p')].find((element) =>
          element.textContent?.includes(EMAIL),
        );

        expect(summary).toBeTruthy();
        expect(form).toBeTruthy();
        expect(
          summary!.compareDocumentPosition(form!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
          signOutButton().compareDocumentPosition(form!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });

      it('clears the confirmation when signing out begins', () => {
        // A confirmation is about the door the visitor just came through. The
        // press of "Sign out" is them leaving it, and the message must go
        // before the request does — a failed sign-out writes its own warning
        // into the same region, and the stale one would be read as its cause.
        build();
        signIn();

        signOutButton().click();
        fixture.detectChanges();

        expect(alert()).toBeNull();
        http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      });
    });

    it('is offered the way in again once there is no session', () => {
      // The other direction, so the test above cannot pass because the screen
      // renders everything and hides nothing.
      build();

      expect(modes()).toHaveLength(2);
      expect(buttons().some((button) => /sign out/i.test(button.textContent ?? ''))).toBe(false);
    });

    describe('signing out (FR-013, SC-007)', () => {
      it('ends the session on the server', () => {
        build();
        signIn();

        signOutButton().click();
        fixture.detectChanges();

        http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
        fixture.detectChanges();

        expect(modes()).toHaveLength(2);
      });

      it('leaves none of the account on the device (SC-007)', () => {
        // SC-007 is "zero account data remains visible or recoverable", so all
        // four documents are present and all four are asserted gone. Asserting
        // only the marker would pass with every rating still on the device —
        // which on a shared phone is the whole of what the requirement is for.
        //
        // The queue is the one document sign-out is given rather than produces,
        // and it is seeded with a real empty document: `SyncService` reads it at
        // construction and discards one it cannot parse, so an invalid
        // placeholder would be gone before sign-out could be blamed for it.
        localStorage.setItem(
          'playnext:sync-pending',
          JSON.stringify({ schemaVersion: 1, operations: [] }),
        );

        build();

        // Signing in is what writes the other three — the marker, and the two
        // 001/002 documents the account's copy is cached into. Seeding them
        // would test this screen against a device state it did not create.
        signIn({
          interactions: { arrival: { state: 'loved', updatedAt: EARLIER } },
          history: [{ titleId: 'arrival', chosenAt: EARLIER }],
          preferences: {
            mediaType: { values: ['movie'], any: false },
            genre: { values: ['horror'], any: false },
            provider: { values: [], any: true },
            includeUnownedProviders: false,
            completedAt: EARLIER,
            updatedAt: EARLIER,
          },
        });

        // The precondition, asserted rather than assumed: a wipe test whose
        // setup silently left a key unwritten passes for the wrong reason.
        expect(ACCOUNT_DEVICE_KEYS.filter((key) => localStorage.getItem(key) !== null)).toEqual(
          ACCOUNT_DEVICE_KEYS,
        );

        signOutButton().click();
        fixture.detectChanges();
        http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
        fixture.detectChanges();

        for (const key of ACCOUNT_DEVICE_KEYS) expect(localStorage.getItem(key)).toBeNull();
      });

      it('warns before discarding changes that never reached the account', () => {
        // Spec edge case: "the app warns that unsynced changes will be lost
        // before completing the sign-out". Nothing is sent, so the replay is
        // refused by a connection that is not there — and the visitor is the
        // one who decides whether that matters.
        queueOfflineChange();
        build();
        signIn();

        signOutButton().click();
        fixture.detectChanges();

        http.expectOne('/api/me/sync').error(new ProgressEvent('error'), {
          status: 0,
          statusText: 'Unknown Error',
        });
        fixture.detectChanges();

        expect(alert()).toBeTruthy();

        // Warned, not done. A flow that signed out here would make the warning
        // a description of something that had already happened.
        http.expectNone('/api/auth/logout');
        expect(localStorage.getItem('playnext:sync-pending')).not.toBeNull();
      });

      it('signs out anyway when the visitor presses again', () => {
        // The other half of the warning, and the reason it needs a second
        // press rather than a re-try: the connection is still down, so a flow
        // that replayed again would warn again, and a visitor with no signal
        // could never sign out at all — the dead end Principle II forbids.
        queueOfflineChange();
        build();
        signIn();

        signOutButton().click();
        fixture.detectChanges();
        http.expectOne('/api/me/sync').error(new ProgressEvent('error'), {
          status: 0,
          statusText: 'Unknown Error',
        });
        fixture.detectChanges();

        signOutButton().click();
        fixture.detectChanges();

        http.expectNone('/api/me/sync');
        http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
        fixture.detectChanges();

        expect(localStorage.getItem('playnext:sync-pending')).toBeNull();
        expect(localStorage.getItem('playnext:session')).toBeNull();
      });

      it('saves what is still pending before letting the visitor leave', () => {
        // The same edge case's first clause: "the pending changes are saved to
        // the account first when a connection is available". A visitor who
        // signed out online should not be shown a warning about changes that
        // did reach the account.
        queueOfflineChange();
        build();
        signIn();

        signOutButton().click();
        fixture.detectChanges();

        http.expectOne('/api/me/sync').flush(SIGNED_IN_STATE);
        fixture.detectChanges();

        expect(alert()).toBeNull();
        http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      });

      it('does not warn when there is nothing pending', () => {
        // The guard on all of the above: the warning is conditional, so an
        // implementation that always showed it would fail here rather than
        // pass every warning test by showing one every time.
        build();
        signIn();

        signOutButton().click();
        fixture.detectChanges();

        http.expectNone('/api/me/sync');
        expect(alert()).toBeNull();
        http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      });
    });

    describe('changing the password (FR-014)', () => {
      it('asks for the current password as well as the new one', () => {
        // FR-014's "after confirming their current password". Two fields, both
        // masked: the current one is what makes the change a decision the
        // account holder made rather than one anyone holding the session made.
        build();
        signIn();

        expect(passwordField('currentPassword').type).toBe('password');
        expect(passwordField('newPassword').type).toBe('password');
      });

      it('sends the current password with the new one, and the session token', () => {
        build();
        signIn();
        fillChangeForm();

        submit();
        const request = http.expectOne('/api/auth/change-password');

        expect(request.request.body).toEqual({
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
        });

        // Bearer-authenticated, so the token has to travel — and the account it
        // changes comes from that token, never from the body (contracts/api.md).
        expect(request.request.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);

        request.flush(null, { status: 204, statusText: 'No Content' });
      });

      it('ends the session the server has already ended', () => {
        // FR-014 revokes every session including the one that asked
        // (contracts/api.md), so a screen that went on claiming to be signed in
        // would be describing a session that is already dead — and the visitor
        // would find out at the next silent refresh, with no idea why.
        build();
        signIn({
          interactions: { arrival: { state: 'loved', updatedAt: EARLIER } },
          history: [],
          preferences: null,
        });
        fillChangeForm();

        submit();
        http
          .expectOne('/api/auth/change-password')
          .flush(null, { status: 204, statusText: 'No Content' });
        fixture.detectChanges();

        expect(modes()).toHaveLength(2);
        expect(localStorage.getItem('playnext:session')).toBeNull();
        expect(alert()?.textContent?.toLowerCase()).toContain('sign in');

        // But not sign-out. The visitor asked to change a password, not to
        // leave, so the device keeps what it had — the same stance expiry
        // takes, and the opposite of SC-007. Asserted on the rating rather than
        // on the key existing: the key is written by every sign-in, so its
        // presence says nothing, while an emptied account would.
        const cached = JSON.parse(localStorage.getItem('playnext:interactions') ?? '{}');
        expect(cached.interactions?.arrival?.state).toBe('loved');
      });

      it('shows what the server said when the current password is wrong', () => {
        build();
        signIn();
        fillChangeForm();

        submit();
        refuse(http.expectOne('/api/auth/change-password'));

        expect(alert()?.textContent).toContain(GENERIC_REFUSAL.errors[0]);

        // Nothing happened, so nothing should look as though it did: the
        // session the server did not end is still the session this screen is
        // showing (FR-014's revocation is half of a *successful* change).
        expect(localStorage.getItem('playnext:session')).not.toBeNull();
        expect(modes()).toHaveLength(0);
      });

      it('shows the policy when the new password is refused (FR-010)', () => {
        // 400, its own answer rather than the generic credential refusal: the
        // two lead to different screens, and "your password was wrong" is a
        // confusing thing to say when the API never looked at it.
        build();
        signIn();
        fillChangeForm();

        submit();
        refuse(http.expectOne('/api/auth/change-password'), 400, {
          code: 'invalid-payload',
          errors: ['Passwords must have at least one non alphanumeric character.'],
        });

        expect(alert()?.textContent).toContain('non alphanumeric');
        expect(localStorage.getItem('playnext:session')).not.toBeNull();
      });
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

    it('holds for the signed-in half too (FR-018)', () => {
      // FR-018 says "all Profile and auth screens", and the change-password
      // form is one: it is the newest surface on this screen and the one a
      // visitor reaches on a phone when something has already gone wrong.
      build();
      signIn();

      const targets = controls();

      expect(targets.length).toBeGreaterThan(0);
      for (const control of targets) {
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
          provideHttpClient(withInterceptors([sessionInterceptor])),
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
