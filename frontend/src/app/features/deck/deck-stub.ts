import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Placeholder for the recommendation deck (feature 002).
 *
 * It exists so the quiz's completion hand-off navigates somewhere real and
 * the seam between the two features is exercised from day one. Replaced
 * entirely when 002 is implemented.
 */
@Component({
  selector: 'app-deck-stub',
  imports: [RouterLink],
  template: `
    <main
      class="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 class="text-2xl font-semibold">Preferences saved</h1>
      <p class="text-chalk-300">
        Your recommendations are on the way — the deck arrives in the next release.
      </p>
      <a
        routerLink="/quiz"
        class="touch-target inline-flex items-center rounded-full bg-accent-500 px-6 font-medium text-white"
      >
        Review my answers
      </a>
    </main>
  `,
})
export class DeckStub {}
