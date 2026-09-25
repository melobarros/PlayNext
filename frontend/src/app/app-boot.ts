import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { QuizState } from './core/models/quiz';
import { PreferenceStore } from './core/services/preference-store';

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
 * The app's entry screen. It renders nothing: it reads the saved state and
 * forwards the visitor to the right place, replacing the history entry so the
 * back button never returns to this hop.
 */
@Component({
  selector: 'app-entry',
  template: '',
})
export class Entry {
  private readonly store = inject(PreferenceStore);
  private readonly router = inject(Router);

  constructor() {
    void this.router.navigateByUrl(resolveEntryPath(this.store.read()), { replaceUrl: true });
  }
}
