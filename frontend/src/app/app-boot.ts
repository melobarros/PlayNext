import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { QuizState } from './core/models/quiz';
import { PreferenceStore } from './core/services/preference-store';
import { SessionBoot } from './core/services/session-boot';

/**
 * Where a visitor should land when they open the app, given whatever is saved
 * on their device.
 *
 * A returning visitor who already finished the quiz goes straight to the
 * deck — they are never forced through the quiz again (FR-011).
 */
export function resolveEntryPath(state: QuizState | null): '/quiz' | '/deck' {
  return state?.status === 'completed' ? '/deck' : '/quiz';
}

/**
 * The app's entry screen. It renders nothing: it settles the session, reads
 * the saved state, and forwards the visitor to the right place, replacing the
 * history entry so the back button never returns to this hop.
 *
 * **The restore happens first, and the route is decided from what it left
 * behind.** That ordering is the point of doing this here rather than beside
 * it: a visitor opening the app on a new device has no quiz on it, and the
 * only thing that will give them one is the account's state arriving in the
 * cache. Deciding the route before that lands would walk them through a quiz
 * they took months ago, on the way to the deck they were already entitled to.
 *
 * The cost is that a returning signed-in visitor waits for one round-trip
 * before anything is drawn. It is bounded — `refresh` resolves on failure as
 * well as on success, and a device with no marker skips it entirely — and it
 * buys a first render that is the account's state rather than a blank that
 * fills in a moment later.
 */
@Component({
  selector: 'app-entry',
  template: '',
})
export class Entry {
  private readonly store = inject(PreferenceStore);
  private readonly boot = inject(SessionBoot);
  private readonly router = inject(Router);

  constructor() {
    this.boot.restore().subscribe(() => this.forward());
  }

  private forward(): void {
    void this.router.navigateByUrl(resolveEntryPath(this.store.read()), { replaceUrl: true });
  }
}
