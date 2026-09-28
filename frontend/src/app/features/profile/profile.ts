import { Component, computed, inject, signal } from '@angular/core';
import { AuthOutcome, AuthService } from '../../core/services/auth.service';
import { SyncService } from '../../core/services/sync.service';

/**
 * The Profile area: the always-available way to an account (US1, FR-001/002),
 * and the way to manage one once it exists (US4, FR-013/014).
 *
 * **One screen with two modes**, not two screens. The spec asks for account
 * creation with email and password *and* sign-in with Google (FR-002), and the
 * visitor who opens this screen is usually a guest who has not decided which of
 * those they are yet — signing up and signing in are the same decision seen from
 * two sides, and splitting them would ask the visitor to know which one applies
 * before they can start (research.md D11).
 *
 * The **signed-in half** is a different screen wearing the same route: who is
 * signed in, a way to change the password, and a way out. It replaces the guest
 * half rather than joining it, because a visitor holding a session has nothing
 * to do with a sign-up form and leaving one up invites them to create a second
 * account for the address they are already using.
 *
 * Three things this screen deliberately does not do:
 *
 * - **No confirm-password field.** The spec requires none, and a second field
 *   that can only disagree with the first is a way to fail at signing up that
 *   buys nothing (Principle II). The change form asks for the *current*
 *   password instead, which is FR-014's requirement and a different thing.
 * - **No client-side password policy.** The API's rules live in one place and
 *   its refusals are written for people, so they are passed through rather than
 *   restated here where they would drift (the same reasoning as `AuthService`'s
 *   message handling). That is why a rejected new password needs no validation
 *   here at all.
 * - **No credential storage.** Nothing on this screen writes a password
 *   anywhere, and every password field is a `type="password"` that nothing
 *   toggles (FR-010).
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
  private readonly sync = inject(SyncService);

  /** Who is signed in, or `null` — which is what chooses between the halves. */
  protected readonly session = this.auth.session;

  /** The change form's two fields (FR-014). */
  protected readonly currentPassword = signal('');

  protected readonly newPassword = signal('');

  /**
   * True once the visitor has been warned that signing out will lose changes
   * that never reached the account.
   *
   * A latch rather than a second button, because the state it records is "the
   * visitor has been told and pressed again" — and the alternative is a flow
   * that retries a connection that is still down, warns again, and leaves
   * someone with no signal unable to sign out at all (Principle II).
   */
  protected readonly confirmingSignOut = signal(false);

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

  protected onCurrentPassword(value: string): void {
    this.currentPassword.set(value);
  }

  protected onNewPassword(value: string): void {
    this.newPassword.set(value);
  }

  protected changePassword(event: Event): void {
    event.preventDefault();

    if (this.busy()) return;

    this.busy.set(true);
    this.notice.set(null);

    this.auth
      .changePassword(this.currentPassword(), this.newPassword())
      .subscribe((outcome) => {
        this.busy.set(false);

        // Cleared on both paths, and on the failure path most of all: FR-010
        // says a password MUST NOT be displayed in readable form, and a field
        // left holding it after a refusal is exactly that — on a screen the
        // visitor will now leave open while they go and look the old one up.
        this.currentPassword.set('');
        this.newPassword.set('');

        if (!outcome.ok) {
          this.notice.set(this.explain(outcome));
          return;
        }

        // The session is already over — the server revoked it as part of the
        // change (FR-014, contracts/api.md) and `AuthService` dropped the
        // marker. So this is not a success message with the visitor still
        // signed in; it is the instruction for what happens next.
        this.notice.set('Your password has changed. Sign in again with your new password.');
      });
  }

  /**
   * Sign-out (FR-013, SC-007), which has one branch before it.
   *
   * The spec's edge case: "the pending changes are saved to the account first
   * when a connection is available; otherwise the app warns that unsynced
   * changes will be lost". So a non-empty queue is not a reason to refuse or a
   * reason to warn — it is a reason to *try*, and the warning is what is left
   * when trying does not work.
   *
   * Once warned, the next press leaves regardless. Re-entering the replay would
   * warn again about the same unreachable server, and the visitor would be
   * holding a sign-out button that cannot sign them out.
   */
  protected signOut(): void {
    if (this.busy()) return;

    const pending = this.sync.pending();

    if (pending.length > 0 && !this.confirmingSignOut()) {
      this.busy.set(true);
      this.notice.set(null);

      this.sync.replay().subscribe((outcome) => {
        this.busy.set(false);

        if (outcome.ok) {
          // Everything reached the account, so there is nothing to lose and
          // nothing to warn about.
          this.leave();
          return;
        }

        this.confirmingSignOut.set(true);
        this.notice.set(
          `${pending.length} ${pending.length === 1 ? 'change has' : 'changes have'} not reached your account yet. Sign out again and ${pending.length === 1 ? 'it' : 'they'} will be lost.`,
        );
      });

      return;
    }

    this.leave();
  }

  /**
   * The end of the flow: everything the account left on this device goes.
   *
   * **Four documents owned by two services, and this screen is the only place
   * that can reach all of them.** `AuthService` wipes the session marker and
   * the two 001/002 documents, but not the queue: that is `SyncService`'s
   * document and nothing else may write it (`contracts/device-storage.md`), and
   * `SyncService` injects `AuthService`, so having `AuthService` reach back
   * would be a dependency cycle. The flow is what spans both, so the flow is
   * what ends it — and `profile.spec.ts` asserts all four keys are gone, which
   * is the guard against a later edit forgetting one.
   *
   * `clearQueue` before the request rather than after: the queue is the one
   * piece holding data the visitor has already been told will be discarded, and
   * a sign-out interrupted after the server call but before the wipe would
   * leave it behind. The rest waits for the response so the notice and the
   * buttons update together.
   */
  private leave(): void {
    this.busy.set(true);
    this.sync.clearQueue();

    this.auth.signOut().subscribe(() => {
      this.busy.set(false);
      this.confirmingSignOut.set(false);
      this.notice.set(null);
    });
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
