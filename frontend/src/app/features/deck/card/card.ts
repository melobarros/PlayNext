import { Component, computed, inject, input } from '@angular/core';
import { MediaTitle } from '../../../core/models/media-title';
import { MEDIA_TYPE_LABELS } from '../../../core/models/quiz';
import { QuizOptionsService } from '../../../core/services/quiz-options.service';
import { displayNames } from '../../../shared/display-names';
import { artworkAlt, Poster } from '../../../shared/poster/poster';
import { formatRating, formatRuntime } from '../../../shared/title-facts';

/**
 * One recommendation card (FR-003).
 *
 * Presentation only, like the quiz's `ChoiceChips`: it renders the
 * `MediaTitle` it is given and reports nothing back. The loop's decisions are
 * not its business.
 *
 * Two rules here are real behaviour rather than markup, and both are about
 * **degrading instead of breaking** — the constitution's "never a dead end":
 *
 * 1. Ids become display names, and an id the option lists do not know is
 *    dropped. A title's genres and providers are stored as ids so a
 *    preference and a title are directly comparable; an unrecognised one is
 *    a data fault, and printing it raw would put `a-defunct-service` in front
 *    of the visitor (data-model.md: ignored, not fatal).
 * 2. A missing *or* failed poster falls back to a placeholder and the card
 *    stays fully readable (FR-016). That behaviour now lives in the shared
 *    `<app-poster>`, because the watchlist row needs exactly the same thing
 *    (research.md D11) — the card hands it a URL and gets on with its layout.
 *
 * Providers are named but not linked here. The direct links to the services
 * are Match Found's job (FR-008, US2): a link on the card would be a way to
 * leave the loop mid-deck, which is not an action the deck offers.
 */
@Component({
  selector: 'app-card',
  imports: [Poster],
  templateUrl: './card.html',
})
export class Card {
  private readonly options = inject(QuizOptionsService);

  readonly title = input.required<MediaTitle>();

  /** Genre and provider ids are dense; these are the lookup tables for them. */
  private readonly genreNames = new Map(
    this.options.getGenres().map((genre) => [genre.id, genre.displayName]),
  );

  private readonly providerNames = new Map(
    this.options.getProvidersById().map((provider) => [provider.id, provider.displayName]),
  );

  protected readonly mediaTypeLabel = computed(() => MEDIA_TYPE_LABELS[this.title().mediaType]);

  /**
   * One decimal, always: the numbers should line up card to card. The rule
   * lives in `shared/title-facts.ts` because the detail view writes the same
   * number (research.md D11).
   */
  protected readonly rating = computed(() => formatRating(this.title().rating));

  /** As the visitor would say it, or `null` so the template omits the row. */
  protected readonly runtime = computed(() => formatRuntime(this.title().runtimeMinutes));

  protected readonly genreLabels = computed(() =>
    displayNames(this.title().genres, this.genreNames),
  );

  protected readonly providerLabels = computed(() =>
    displayNames(
      this.title().availability.map((entry) => entry.providerId),
      this.providerNames,
    ),
  );

  protected readonly hasSynopsis = computed(() => this.title().synopsis.trim().length > 0);

  /** The description of the artwork, identical with and without it. */
  protected readonly posterAlt = computed(() => artworkAlt(this.title()));
}
