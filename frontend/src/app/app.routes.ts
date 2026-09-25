import { Routes } from '@angular/router';

/**
 * `''` is the entry hop: it reads the visitor's saved state and forwards them
 * to the quiz or straight to the deck (FR-011). The deck route is a
 * placeholder until feature 002 lands.
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
    loadComponent: () => import('./features/deck/deck-stub').then((m) => m.DeckStub),
  },
  { path: '**', redirectTo: '' },
];
