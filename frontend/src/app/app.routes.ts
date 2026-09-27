import { Routes } from '@angular/router';

/**
 * `''` is the entry hop: it reads the visitor's saved state and forwards them
 * to the quiz or straight to the deck (FR-011). That hand-off lives in
 * `app-boot.ts`'s `resolveEntryPath`; the deck route only has to exist for it
 * to navigate to.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./app-boot').then((m) => m.Entry),
  },
  {
    path: 'quiz',
    loadComponent: () => import('./features/quiz/quiz').then((m) => m.Quiz),
  },
  {
    path: 'deck',
    loadComponent: () => import('./features/deck/deck').then((m) => m.Deck),
  },
  {
    // Match Found is addressable rather than passed as state, so the back
    // button and a refresh both land on the decision that was made. The view
    // resolves the title from the catalog itself, by id (research.md D10).
    path: 'deck/match/:titleId',
    loadComponent: () =>
      import('./features/deck/match-found/match-found').then((m) => m.MatchFound),
  },
  { path: '**', redirectTo: '' },
];
