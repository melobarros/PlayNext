import { Component, computed, inject, input, output } from '@angular/core';
import { DimensionChoice, MEDIA_TYPE_LABELS, MediaType, QuizState } from '../../../core/models/quiz';
import { QuizOptionsService } from '../../../core/services/quiz-options.service';

const ANY_LABEL = 'Any / No preference';
const EMPTY_LABEL = 'Nothing selected';

/**
 * The quiz summary: every answer in one place with a single primary action
 * that starts recommendations (FR-009).
 *
 * It also hosts the retake entry point, since retaking is something a visitor
 * decides after seeing what they picked (FR-012).
 */
@Component({
  selector: 'app-summary',
  template: `
    <h2 class="text-xl font-semibold">You're all set</h2>
    <p class="mt-1 text-sm text-chalk-500">Here's what we'll look for.</p>

    <dl class="mt-6 divide-y divide-ink-800 overflow-hidden rounded-2xl border border-ink-800">
      @for (row of rows(); track row.label) {
        <div class="bg-ink-900 px-4 py-3">
          <dt class="text-xs uppercase tracking-wide text-chalk-500">{{ row.label }}</dt>
          <dd class="mt-1 text-sm text-chalk-50">{{ row.value }}</dd>
        </div>
      }
    </dl>

    <button
      type="button"
      class="touch-target mt-8 inline-flex w-full items-center justify-center rounded-full bg-accent-500 px-6 font-semibold text-white"
      (click)="start.emit()"
    >
      Start recommendations
    </button>

    <div class="mt-3 flex items-center justify-center gap-4">
      <button
        type="button"
        class="touch-target text-sm text-chalk-500 underline-offset-4 hover:underline"
        (click)="goBack.emit()"
      >
        Change my answers
      </button>
      <button
        type="button"
        class="touch-target text-sm text-chalk-500 underline-offset-4 hover:underline"
        (click)="retake.emit()"
      >
        Start over
      </button>
    </div>
  `,
})
export class Summary {
  private readonly optionsService = inject(QuizOptionsService);

  readonly state = input.required<QuizState>();

  readonly start = output<void>();
  readonly retake = output<void>();
  readonly goBack = output<void>();

  protected readonly rows = computed(() => {
    const state = this.state();
    return [
      { label: 'Watching', value: this.describeMediaTypes(state.mediaType) },
      { label: 'Genres and themes', value: this.describeGenres(state.genre) },
      { label: 'Streaming services', value: this.describeProviders(state.provider) },
      {
        label: 'Other platforms',
        value: state.includeUnownedProviders ? 'Included' : 'Only my services',
      },
    ];
  });

  private describeMediaTypes(choice: DimensionChoice<MediaType>): string {
    if (choice.any) return ANY_LABEL;
    if (choice.values.length === 0) return EMPTY_LABEL;
    return choice.values.map((value) => MEDIA_TYPE_LABELS[value]).join(', ');
  }

  private describeGenres(choice: DimensionChoice<string>): string {
    return this.describe(choice, new Map(
      this.optionsService.getGenres().map((genre) => [genre.id, genre.displayName]),
    ));
  }

  private describeProviders(choice: DimensionChoice<string>): string {
    return this.describe(choice, new Map(
      this.optionsService.getProvidersById().map((provider) => [provider.id, provider.displayName]),
    ));
  }

  private describe(choice: DimensionChoice<string>, labels: Map<string, string>): string {
    if (choice.any) return ANY_LABEL;
    if (choice.values.length === 0) return EMPTY_LABEL;
    return choice.values.map((id) => labels.get(id) ?? id).join(', ');
  }
}
