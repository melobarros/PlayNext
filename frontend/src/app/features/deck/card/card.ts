import { Component, computed, inject, input, signal } from '@angular/core';
import { MediaTitle } from '../../../core/models/media-title';
import { MEDIA_TYPE_LABELS } from '../../../core/models/quiz';
import { QuizOptionsService } from '../../../core/services/quiz-options.service';

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
 *    stays fully readable (FR-016).
 *
 * The placeholder is deliberately **not** a fallback image. A second request
 * would fail for the same reason the first one did, and offline it would fail
 * too — which is exactly the scenario FR-015 asks the deck to survive. So the
 * fallback is a CSS-only block that cannot itself fail, and it carries the same
 * accessible name the poster would have had, so the card describes itself
 * identically whether or not the artwork arrived.
 *
 * Providers are named but not linked here. The direct links to the services
 * are Match Found's job (FR-008, US2): a link on the card would be a way to
 * leave the loop mid-deck, which is not an action the deck offers.
 */
@Component({
  selector: 'app-card',
  templateUrl: './card.html',
})
export class Card {
  private readonly options = inject(QuizOptionsService);

  readonly title = input.required<MediaTitle>();

  /** Set when the browser reports the poster could not be loaded (FR-016). */
  private readonly posterFailed = signal(false);

  /** Genre and provider ids are dense; these are the lookup tables for them. */
  private readonly genreNames = new Map(
    this.options.getGenres().map((genre) => [genre.id, genre.displayName]),
  );

  private readonly providerNames = new Map(
    this.options.getProvidersById().map((provider) => [provider.id, provider.displayName]),
  );

  protected readonly mediaTypeLabel = computed(() => MEDIA_TYPE_LABELS[this.title().mediaType]);

  /** One decimal, always: the numbers should line up card to card. */
  protected readonly rating = computed(() => this.title().rating.toFixed(1));

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

  /** The poster to render, or `null` to render the placeholder instead. */
  protected readonly posterSrc = computed<string | null>(() => {
    const url = this.title().posterUrl;
    return url === undefined || this.posterFailed() ? null : url;
  });

  /** The description of the artwork, identical with and without it. */
  protected readonly posterAlt = computed(() => `${this.title().title} poster`);

  protected onPosterError(): void {
    this.posterFailed.set(true);
  }
}

/**
 * Ids resolved to display names.
 *
 * Unknown ids are dropped rather than passed through, and a name that appears
 * twice is listed once — the same provider reached through two availability
 * entries is one badge, not two.
 */
function displayNames(ids: readonly string[], namesById: ReadonlyMap<string, string>): string[] {
  const names: string[] = [];

  for (const id of ids) {
    const name = namesById.get(id);
    if (name !== undefined && !names.includes(name)) names.push(name);
  }

  return names;
}

/**
 * Minutes as a visitor would say them: `166` → `'2h 46m'`, `45` → `'45 min'`.
 *
 * Returns `null` — not `'0 min'` or `'NaN'` — for an absent or nonsensical
 * value, which is what lets the template leave the row out cleanly. The
 * guard matters because this field arrives from the API in Milestone 2.
 */
function formatRuntime(minutes: number | undefined): string | null {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return null;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
