import { inject, Injectable } from '@angular/core';
import { AccountState, toQuizState } from '../models/account-state';
import { InteractionStore } from './interaction-store';
import { PreferenceStore } from './preference-store';

/**
 * Writes the account's canonical state into the device's documents.
 *
 * Once a session exists, `playnext:interactions` and `playnext:quiz-state`
 * stop being *the store* and become *the cache of the account state*
 * (research D7). This is the one place that turns an `AccountState` into those
 * two documents, so the auth response (T026) and the sync response (T029)
 * cannot drift into caching the same state two different ways — and so that
 * 001–003's read paths keep working untouched, which is the whole point of
 * caching rather than rewriting them.
 *
 * It writes exactly what it is given. The merge has already happened on the
 * server, so anything this class chose to keep "just in case" would be a second
 * opinion about state the account has already settled (Principle IV). That is
 * why a `null` preference clears the quiz document instead of leaving the
 * device's older answers to disagree with the account.
 */
@Injectable({ providedIn: 'root' })
export class AccountCache {
  private readonly interactions = inject(InteractionStore);
  private readonly preferences = inject(PreferenceStore);

  write(state: AccountState): void {
    this.interactions.replace(state.interactions, state.history);

    const quiz = toQuizState(state.preferences);

    // `replace`, not `write`: this is the account's copy, and the `write` path
    // announces what it stores so the change can be pushed. Caching a sync
    // response through the announcing path would push it back, and the next
    // response would be cached and announced again — the same echo
    // `InteractionStore.replace` exists to prevent.
    if (quiz === null) this.preferences.clear();
    else this.preferences.replace(quiz);
  }
}
