import { Component, computed, inject, signal } from '@angular/core';
import { AuthOutcome, AuthService } from '../../core/services/auth.service';

/**
 * The Profile area: the always-available way to an account (US1, FR-001/002).
 *
 * **One screen with two modes**, not two screens. The spec asks for account
 * creation with email and password *and* sign-in with Google (FR-002), and the
 * visitor who opens this screen is usually a guest who has not decided which of
 * those they are yet — signing up and signing in are the same decision seen from
 * two sides, and splitting them would ask the visitor to know which one applies
 * before they can start (research.md D11).
 *
 * Three things this screen deliberately does not do:
 *
 * - **No confirm-password field.** The spec requires none, and a second field
 *   that can only disagree with the first is a way to fail at signing up that
 *   buys nothing (Principle II).
 * - **No client-side password policy.** The API's rules live in one place and
 *   its refusals are written for people, so they are passed through rather than
 *   restated here where they would drift (the same reasoning as `AuthService`'s
 *   message handling).
 * - **No credential storage.** Nothing on this screen writes the password
 *   anywhere, and the field is a `type="password"` that nothing toggles
 *   (FR-010).
 *
 * The failures are values rather than exceptions — `AuthService` reports an
 * outcome for every one of them — so the message path is this screen's ordinary
 * path, not a `catchError` it has to remember.
 */
@Component({
  selector: 'app-profile',
  templateUrl: './profile.html',
})
export class Profile {
  private readonly auth = inject(AuthService);

  /** The two ways in, in the order the switch shows them. */
  protected readonly modes = [
    { id: 'signup' as const, label: 'Sign up' },
    { id: 'signin' as const, label: 'Sign in' },
  ];

  protected readonly mode = signal<'signup' | 'signin'>('signup');

  protected readonly email = signal('');

  protected readonly password = signal('');

  /**
   * What the screen is saying about the last attempt, or `null`.
   *
   * One message, not a list: an attempt fails for one reason, and a visitor
   * reading three is being shown the machinery.
   */
  protected readonly notice = signal<string | null>(null);

  /** True while a request is in flight, so the form cannot be sent twice. */
  protected readonly busy = signal(false);

  protected readonly isSignUp = computed(() => this.mode() === 'signup');

  protected select(mode: 'signup' | 'signin'): void {
    this.mode.set(mode);

    // The message was about the other door. Leaving it up would explain a
    // failure the visitor is no longer making.
    this.notice.set(null);
  }

  protected onEmail(value: string): void {
    this.email.set(value);
  }

  protected onPassword(value: string): void {
    this.password.set(value);
  }

  protected submit(event: Event): void {
    // Without this the browser navigates away from the app on submit — in an
    // installed PWA, out of it entirely, with the form's state gone.
    event.preventDefault();

    if (this.busy()) return;

    this.busy.set(true);
    this.notice.set(null);

    const attempt = this.isSignUp()
      ? this.auth.register(this.email(), this.password())
      : this.auth.signIn(this.email(), this.password());

    attempt.subscribe((outcome) => this.settle(outcome));
  }

  /**
   * The Google path (FR-002), which needs a Google client id this deployment
   * does not have yet — T045 supplies one and completes the hand-off.
   *
   * Until then the button says so. A button that appeared to work and did
   * nothing would be the dead end Principle II forbids, and loading Google's
   * script to find out would put a third-party origin on a page that has no
   * use for it.
   */
  protected signInWithGoogle(): void {
    this.notice.set('Google sign-in is not available here yet. Use your email and password.');
  }

  private settle(outcome: AuthOutcome): void {
    this.busy.set(false);

    if (!outcome.ok) this.notice.set(this.explain(outcome));
  }

  /**
   * The failure as one sentence the visitor can act on.
   *
   * The server's own words whenever it sent any, so the screen and the API
   * cannot end up describing the same refusal two ways. Only the lockout is
   * added to, because "try again in 15 minutes" is the one refusal with a next
   * step and the number arrives as seconds (FR-011).
   */
  private explain(failure: Extract<AuthOutcome, { ok: false }>): string {
    if (failure.reason !== 'locked') return failure.message;

    const minutes = Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 0) / 60));

    return `${failure.message} Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  }
}
