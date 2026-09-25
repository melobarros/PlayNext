import { Component, input, output } from '@angular/core';
import { DimensionChoice } from '../../../core/models/quiz';
import { toggleAny, toggleValue } from '../quiz-logic/quiz-rules';
import { ChoiceChips, ChipOption } from './choice-chips';

/** Step 2 — the genres and themes that fit the visitor's mood (FR-003). */
@Component({
  selector: 'app-step-genres',
  imports: [ChoiceChips],
  template: `
    <h2 class="text-xl font-semibold">What's the mood tonight?</h2>
    <p class="mt-1 text-sm text-chalk-500">Choose as many as you like.</p>

    <div class="mt-5">
      <app-choice-chips
        groupLabel="Genres and themes"
        [options]="options()"
        [choice]="choice()"
        (valueToggled)="choiceChange.emit(toggleValue(choice(), $event))"
        (anyToggled)="choiceChange.emit(toggleAny(choice()))"
      />
    </div>
  `,
})
export class StepGenres {
  readonly choice = input.required<DimensionChoice<string>>();
  readonly options = input.required<ChipOption[]>();

  readonly choiceChange = output<DimensionChoice<string>>();

  protected readonly toggleValue = toggleValue;
  protected readonly toggleAny = toggleAny;
}
