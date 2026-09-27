import { Routes } from '@angular/router';
import { Shell } from './features/shell/shell';

/**
 * The route table, in two tiers.
 *
 * **Outside the shell**: `''`, the entry hop — it reads the visitor's saved
 * state and forwards them to the quiz or straight to the deck (FR-011). That
 * hand-off lives in `app-boot.ts`'s `resolveEntryPath`; the deck route only has
 * to exist for it to navigate to. And `quiz`, because onboarding is a linear
 * flow and a "skip to my watchlist" mid-quiz undercuts it (research.md D5).
 *
 * **Inside the shell**: everything the bottom nav should be reachable from.
 * The nav is rendered by `Shell`, so a route's tier *is* whether it has one —
 * which is why the shell spec navigates real URLs rather than mounting the
 * component.
 *
 * `Shell` is imported eagerly while every screen behind it is lazy. The chrome
 * is needed by all of them, so deferring it would only make each one wait for
 * it in turn.
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
    path: '',
    component: Shell,
    children: [
      {
        path: 'deck',
        loadComponent: () => import('./features/deck/deck').then((m) => m.Deck),
      },
      {
        // Match Found is addressable rather than passed as state, so the back
        // button and a refresh both land on the decision that was made. The
        // view resolves the title from the catalog itself, by id (D10).
        //
        // A `deck/` child rather than the deck route's sibling so the nav's
        // deck link stays lit: both are the deck as far as the visitor is
        // concerned.
        path: 'deck/match/:titleId',
        loadComponent: () =>
          import('./features/deck/match-found/match-found').then((m) => m.MatchFound),
      },
      {
        // `pathMatch: 'full'` so this cannot swallow the title route below by
        // prefix — the switch is the *first* segment either way, but a route
        // that matches more than it was meant to is a bug that only shows up
        // once someone adds a second child.
        path: 'watchlist',
        pathMatch: 'full',
        loadComponent: () => import('./features/watchlist/watchlist').then((m) => m.Watchlist),
      },
      {
        // The `title/` segment is load-bearing: without it this route would be
        // `watchlist/:titleId`, and `watchlist/history` below would then be
        // shadowed by whichever happens to be declared first. A path shape that
        // cannot collide beats an ordering everyone has to remember (plan.md),
        // and `history.spec.ts` asserts this address opens the history rather
        // than a detail view for a title called "history".
        path: 'watchlist/title/:titleId',
        loadComponent: () => import('./features/watchlist/detail/detail').then((m) => m.Detail),
      },
      {
        // A grandchild of the shell rather than of `watchlist`, so the nav's
        // watchlist link stays lit: the history is where a recorded rating
        // lives, so it is the watchlist as far as the visitor is concerned
        // (research.md D3).
        path: 'watchlist/history',
        loadComponent: () =>
          import('./features/watchlist/history/history').then((m) => m.WatchHistory),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
