import { Component, input, output } from '@angular/core';
import { DimensionChoice } from '../../../core/models/quiz';

/** One selectable chip. */
export interface ChipOption {
  id: string;
  label: string;
}

const CHIP_BASE =
  'touch-target inline-flex items-center rounded-full border px-4 text-sm font-medium transition-colors';

/**
 * The single chip interaction used by every quiz step: a multi-select list of
 * options plus the exclusive "Any / No preference" chip (FR-005).
 *
 * Presentation only — it reports taps and holds no state, so the rules stay in
 * `quiz-rules.ts` where they are tested without a DOM.
 */
@Component({
  selector: 'app-choice-chips',
  template: `
    <div class="flex flex-wrap gap-2" role="group" [attr.aria-label]="groupLabel()">
      @for (option of options(); track option.id) {
        <button
          type="button"
          [class]="optionClass(option.id)"
          [attr.aria-pressed]="isSelected(option.id)"
          (click)="valueToggled.emit(option.id)"
        >
          {{ option.label }}
        </button>
      }

      <button
        type="button"
        [class]="anyClass()"
        [attr.aria-pressed]="choice().any"
        (click)="anyToggled.emit()"
      >
        {{ anyLabel() }}
      </button>
    </div>
  `,
})
export class ChoiceChips {
  readonly options = input.required<ChipOption[]>();
  readonly choice = input.required<DimensionChoice<string>>();
  readonly groupLabel = input('Options');
  readonly anyLabel = input('Any / No preference');

  readonly valueToggled = output<string>();
  readonly anyToggled = output<void>();

  protected isSelected(id: string): boolean {
    return this.choice().values.includes(id);
  }

  protected optionClass(id: string): string {
    return this.isSelected(id)
      ? `${CHIP_BASE} border-accent-500 bg-accent-500 text-white`
      : `${CHIP_BASE} border-ink-600 bg-ink-800 text-chalk-300`;
  }

  protected anyClass(): string {
    return this.choice().any
      ? `${CHIP_BASE} border-accent-400 bg-ink-800 text-accent-400`
      : `${CHIP_BASE} border-dashed border-ink-600 bg-transparent text-chalk-500`;
  }
}
