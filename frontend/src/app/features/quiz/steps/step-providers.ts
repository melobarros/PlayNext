import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { DimensionChoice } from '../../../core/models/quiz';
import { DEFAULT_REGION } from '../../../core/models/quiz-options.data';
import { QuizOptionsService } from '../../../core/services/quiz-options.service';
import { toggleAny, toggleValue } from '../quiz-logic/quiz-rules';
import { ChoiceChips, ChipOption } from './choice-chips';

/** Where the provider list currently stands (FR-013). */
export type ProviderLoadState = 'loading' | 'loaded' | 'failed' | 'fallback';

/**
 * Step 3 — the services the visitor actually has (FR-004), plus the
 * "Show content on other platforms" toggle (FR-006).
 *
 * Never a dead end: a failed load offers a Retry, and a failed retry falls
 * back to a popular default list with a small notice, so the visitor can
 * always continue (FR-013).
 */
@Component({
  selector: 'app-step-providers',
  imports: [ChoiceChips],
  template: `
    <h2 class="text-xl font-semibold">What can you watch on?</h2>
    <p class="mt-1 text-sm text-chalk-500">Only these services will be suggested.</p>

    @switch (status()) {
      @case ('loading') {
        <p class="mt-5 text-sm text-chalk-500" role="status">Loading streaming services…</p>
      }

      @case ('failed') {
        <div class="mt-5 rounded-2xl border border-ink-700 bg-ink-900 p-4" role="alert">
          <p class="text-sm text-chalk-300">
            We couldn't load the streaming services for your region.
          </p>
          <button
            type="button"
            class="touch-target mt-3 inline-flex items-center rounded-full bg-accent-500 px-4 text-sm font-medium text-white"
            (click)="retry()"
          >
            Retry
          </button>
        </div>
      }

      @default {
        @if (status() === 'fallback') {
          <p class="mt-4 rounded-xl bg-ink-800 px-3 py-2 text-xs text-chalk-500" role="status">
            Showing a default list of popular services — you can change this later.
          </p>
        }

        <div class="mt-5">
          <app-choice-chips
            groupLabel="Streaming services"
            [options]="providers()"
            [choice]="choice()"
            (valueToggled)="choiceChange.emit(toggleValue(choice(), $event))"
            (anyToggled)="choiceChange.emit(toggleAny(choice()))"
          />
        </div>

        <label
          class="touch-target mt-6 flex cursor-pointer items-center gap-3 rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3"
        >
          <input
            type="checkbox"
            class="h-5 w-5 accent-accent-500"
            [checked]="includeUnownedProviders()"
            (change)="includeUnownedProvidersChange.emit($any($event.target).checked)"
          />
          <span class="text-sm text-chalk-300">Show content on other platforms</span>
        </label>
      }
    }
  `,
})
export class StepProviders implements OnInit {
  private readonly optionsService = inject(QuizOptionsService);

  readonly choice = input.required<DimensionChoice<string>>();
  readonly includeUnownedProviders = input.required<boolean>();
  readonly region = input(DEFAULT_REGION);

  readonly choiceChange = output<DimensionChoice<string>>();
  readonly includeUnownedProvidersChange = output<boolean>();

  protected readonly status = signal<ProviderLoadState>('loading');
  protected readonly providers = signal<ChipOption[]>([]);

  protected readonly toggleValue = toggleValue;
  protected readonly toggleAny = toggleAny;

  ngOnInit(): void {
    this.status.set('loading');
    this.optionsService.loadProviders(this.region()).subscribe({
      next: (providers) => this.showProviders(providers, 'loaded'),
      error: () => this.status.set('failed'),
    });
  }

  /** A failed retry falls back to the default list rather than failing again. */
  protected retry(): void {
    this.status.set('loading');
    this.optionsService.loadProviders(this.region()).subscribe({
      next: (providers) => this.showProviders(providers, 'loaded'),
      error: () => this.showProviders(this.optionsService.getFallbackProviders(), 'fallback'),
    });
  }

  private showProviders(
    providers: { id: string; displayName: string }[],
    state: ProviderLoadState,
  ): void {
    this.providers.set(providers.map((provider) => ({
      id: provider.id,
      label: provider.displayName,
    })));
    this.status.set(state);
  }
}
