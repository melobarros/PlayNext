import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  InteractionDocument,
  InteractionState,
  RATING_ACTIONS,
} from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { MEDIA_TYPE_LABELS } from '../../../core/models/quiz';
import { DEFAULT_REGION } from '../../../core/models/quiz-options.data';
import { CatalogService } from '../../../core/services/catalog.service';
import { InteractionStore } from '../../../core/services/interaction-store';
import { QuizOptionsService } from '../../../core/services/quiz-options.service';
import { displayNames } from '../../../shared/display-names';
import { artworkAlt, Poster } from '../../../shared/poster/poster';
import { formatRating, formatRuntime } from '../../../shared/title-facts';
import { WaysToWatch } from '../../../shared/ways-to-watch/ways-to-watch';

/**
 * One title in full: what it is, and where to watch it (US1 scenario 3).
 *
 * **The one detail surface**, shared by the watchlist and the history
 * (research.md D9). A `watchingNow` title lives in no tab (FR-004), so the
 * history is the only route to it — and if the history opened a read-only copy
 * of this view, that title's rating would be the same dead end the 2026-09-26
 * clarification closed for `notInterested`. One surface, reached from two
 * lists, means one place where a rating can be changed. US2 adds that control
 * here.
 *
 * **Resolved from the address, never from handed-over state** (research.md
 * D10). The route binds `:titleId` through `withComponentInputBinding()`; the
 * title itself comes from the catalog. That is what makes the browser's back
 * button and a mid-session refresh land on the same view, and it is why the
 * streaming links are read from current availability rather than stored: a
 * saved link keeps sending the visitor to a page that no longer carries the
 * title.
 *
 * The unavailable branch reuses Match Found's wording on purpose. The same
 * situation should read the same way twice, and a rated title leaving the
 * catalog is exactly the situation both screens describe. The two *escapes*
 * differ — one returns to the deck, one to the watchlist — which is why this
 * is a second template rather than a shared component; if a third surface ever
 * needs it, that changes.
 */
@Component({
  selector: 'app-detail',
  imports: [Poster, RouterLink, WaysToWatch],
  templateUrl: './detail.html',
})
export class Detail {
  private readonly catalog = inject(CatalogService);
  private readonly interactions = inject(InteractionStore);
  private readonly options = inject(QuizOptionsService);
  private readonly router = inject(Router);

  /** Region scopes provider availability, never the title list (CatalogService). */
  private readonly region = DEFAULT_REGION;

  /** The `:titleId` route parameter. */
  readonly titleId = input.required<string>();

  private readonly titles = signal<MediaTitle[]>([]);

  /**
   * The saved document, read at construction and re-read after this view's own
   * writes — `InteractionStore` stays non-reactive (research.md D4).
   */
  private readonly document = signal<InteractionDocument>(this.interactions.read());

  /** The five, from the one table the deck's action bar also reads. */
  protected readonly ratingActions = RATING_ACTIONS;

  /**
   * The stored state, but only when it is one of the five.
   *
   * `null` for a `watchingNow` title, and for an unrated one — both mean "do not
   * offer a current state here", for the same reason: the only label the
   * vocabulary offers for `watchingNow` is `'Watch Now'`, which is a *verb*.
   * Printed as the current state beside five rating buttons it reads as a sixth
   * button, and a visitor would tap it expecting to rate the title and instead
   * lock in a decision they never made (FR-004, research.md D6). A history entry
   * opening here (research D9) already said the title was watched; this view
   * does not need to say it again in the one wording that would mislead.
   */
  protected readonly currentState = computed<InteractionState | null>(() => {
    const state = this.document().interactions[this.titleId()]?.state;
    if (state === undefined) return null;

    return RATING_ACTIONS.some((action) => action.state === state) ? state : null;
  });

  /** The label for {@link currentState}, resolved from the same table. */
  protected readonly currentStateLabel = computed(
    () => RATING_ACTIONS.find((action) => action.state === this.currentState())?.label ?? null,
  );

  /** The title, or `null` when the catalog no longer knows the id. */
  protected readonly title = computed(
    () => this.titles().find((candidate) => candidate.id === this.titleId()) ?? null,
  );

  protected readonly mediaTypeLabel = computed(() => {
    const title = this.title();
    return title === null ? '' : MEDIA_TYPE_LABELS[title.mediaType];
  });

  protected readonly rating = computed(() => {
    const title = this.title();
    return title === null ? null : formatRating(title.rating);
  });

  /** `null` for an absent runtime, so the template omits it rather than inventing one. */
  protected readonly runtime = computed(() => formatRuntime(this.title()?.runtimeMinutes));

  private readonly genreNames = new Map(
    this.options.getGenres().map((genre) => [genre.id, genre.displayName]),
  );

  protected readonly genreLabels = computed(() =>
    displayNames(this.title()?.genres ?? [], this.genreNames),
  );

  /** Read at render time, never from storage (research.md D10). */
  protected readonly availability = computed(() => this.title()?.availability ?? []);

  protected readonly posterAlt = computed(() => artworkAlt(this.title()));

  constructor() {
    this.catalog.loadTitles(this.region).subscribe((titles) => this.titles.set(titles));
  }

  /**
   * Records the rating the visitor just chose (FR-005).
   *
   * A plain overwrite: `record` replaces whatever state this title had, which is
   * what makes "change my mind" work without a separate retract step (FR-006).
   * Re-rating is also what puts a title back in the deck — the deck recomputes
   * eligibility from the document (FR-007), so this view's only job is to write
   * it correctly and re-read.
   *
   * The signal is set rather than mutated so the indicator and the button
   * styling redraw on the tap, with no navigation and no round trip.
   */
  protected choose(state: InteractionState): void {
    this.interactions.record(this.titleId(), state);
    this.document.set(this.interactions.read());
  }

  /**
   * Forgets this title entirely, then returns to the list it came from (FR-005).
   *
   * Navigating away is the honest ending: "remove" means "no longer rated", and
   * a detail view of an unrated title has nothing left to offer but the five
   * buttons the visitor just declined. The list is also where the change is
   * visible — the row is gone, and the tab's count dropped with it.
   *
   * `void` on the navigation promise: a component with no `canDeactivate` guard
   * and no error branch has nothing to do with a rejected navigation, and
   * awaiting it would only invite an `await` that never runs.
   */
  protected remove(): void {
    this.interactions.remove(this.titleId());
    void this.router.navigate(['/watchlist']);
  }
}
