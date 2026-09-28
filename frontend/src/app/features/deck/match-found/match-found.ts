import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MediaTitle } from '../../../core/models/media-title';
import { MEDIA_TYPE_LABELS } from '../../../core/models/quiz';
import { currentRegion } from '../../../core/region';
import { AuthService } from '../../../core/services/auth.service';
import { CatalogService } from '../../../core/services/catalog.service';
import { DeckSessionStore } from '../../../core/services/deck-session-store';
import { InteractionStore } from '../../../core/services/interaction-store';
import { WaysToWatch } from '../../../shared/ways-to-watch/ways-to-watch';
import { isNudgeDismissed, rememberNudgeDismissal } from './account-nudge';
import { startNewLoop } from '../deck-logic/deck-session';

/**
 * Match Found: the end of a decision, and the start of watching something.
 *
 * **Resolved from the URL, not from navigation state** (research.md D10). The
 * only thing this view is given is a `titleId`; everything else comes from the
 * catalog. That is what makes the browser's back button and a mid-decision
 * refresh work, and it matches how spec 003 refreshes streaming links from
 * current availability rather than freezing them into a saved record.
 *
 * The route param binds to `titleId` through `withComponentInputBinding()`, so
 * this is an `input` like `Card`'s — the component declares what it needs and
 * the router supplies it.
 *
 * **Nothing plays here.** The trailer is an ordinary link to the official
 * service; no iframe, no player, no third-party script (FR-008). PlayNext hosts
 * no content, so there is nothing for a player to do but add weight and a
 * privacy problem.
 */
@Component({
  selector: 'app-match-found',
  imports: [WaysToWatch, RouterLink],
  templateUrl: './match-found.html',
})
export class MatchFound {
  private readonly catalog = inject(CatalogService);
  private readonly sessions = inject(DeckSessionStore);
  private readonly interactions = inject(InteractionStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** The `:titleId` route parameter. */
  readonly titleId = input.required<string>();

  private readonly titles = signal<MediaTitle[]>([]);

  /** The chosen title, or `null` when the catalog no longer knows the id. */
  protected readonly title = computed(
    () => this.titles().find((candidate) => candidate.id === this.titleId()) ?? null,
  );

  protected readonly mediaTypeLabel = computed(() => {
    const match = this.title();
    return match === null ? '' : MEDIA_TYPE_LABELS[match.mediaType];
  });

  protected readonly availability = computed(() => this.title()?.availability ?? []);

  protected readonly trailerUrl = computed(() => this.title()?.trailerUrl ?? null);

  /** Read once, at construction: a dismissal made here is not un-made here. */
  private readonly nudgeDismissed = signal(isNudgeDismissed());

  /**
   * Whether this visit is offered the account nudge (US1 scenario 5, FR-001).
   *
   * "After a Watch Now lock-in" is read from the interaction document rather
   * than from navigation state, for the same reason everything else on this
   * screen is resolved from the URL (research.md D10): a mid-decision refresh
   * has to land on the same view, nudge included. A `watchingNow` record for
   * the title on screen *is* the lock-in; there is no second place for it to be
   * recorded and therefore nothing that can disagree about whether it happened.
   *
   * The other two conditions are the ones that make it a nudge rather than
   * spam: nothing is offered to someone who already has an account, and nothing
   * is offered twice in one session.
   */
  protected readonly showNudge = computed(
    () =>
      !this.auth.isSignedIn() &&
      !this.nudgeDismissed() &&
      this.interactions.read().interactions[this.titleId()]?.state === 'watchingNow',
  );

  constructor() {
    this.catalog.loadTitles(currentRegion()).subscribe((titles) => this.titles.set(titles));
  }

  /**
   * Turns the nudge down for the rest of the session.
   *
   * The signal is what makes it disappear now; the storage write is what stops
   * it coming back on the next reload (research D11). Nothing else on the
   * screen changes — the nudge is an addition to this view, never a gate in
   * front of it.
   */
  protected dismissNudge(): void {
    rememberNudgeDismissal();
    this.nudgeDismissed.set(true);
  }

  /**
   * Throws away the finished loop and returns to a fresh one.
   *
   * Available in every state, including the unavailable one: Match Found is
   * where a decision ends, so it is the last place that should be a dead end
   * (constitution II).
   */
  protected startNewLoop(): void {
    this.sessions.write(startNewLoop());
    void this.router.navigate(['/deck']);
  }
}
