import { Component, input, output } from '@angular/core';
import { DimensionChoice } from '../../../core/models/quiz';
import { toggleAny, toggleValue } from '../quiz-logic/quiz-rules';
import { ChoiceChips, ChipOption } from './choice-chips';

/** Step 1 — what kind of content the visitor wants (FR-002). */
@Component({
  selector: 'app-step-media-type',
  imports: [ChoiceChips],
  template: `
    <h2 class="text-xl font-semibold">What do you feel like watching?</h2>
    <p class="mt-1 text-sm text-chalk-500">Pick one or more.</p>

    <div class="mt-5">
      <app-choice-chips
        groupLabel="Media type"
        [options]="options()"
        [choice]="choice()"
        (valueToggled)="choiceChange.emit(toggleValue(choice(), $event))"
        (anyToggled)="choiceChange.emit(toggleAny(choice()))"
      />
    </div>
  `,
})
export class StepMediaType {
  readonly choice = input.required<DimensionChoice<string>>();
  readonly options = input.required<ChipOption[]>();

  readonly choiceChange = output<DimensionChoice<string>>();

  protected readonly toggleValue = toggleValue;
  protected readonly toggleAny = toggleAny;
}
