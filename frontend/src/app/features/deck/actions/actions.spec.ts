import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import {
  INTERACTION_STATE_LABELS,
  Interaction,
  InteractionState,
  INTERACTION_STORAGE_KEY,
  RATING_ACTIONS,
  WatchHistoryEntry,
} from '../../../core/models/interaction';
import { DECK_SESSION_STORAGE_KEY } from '../../../core/models/deck-session';
import { MediaTitle } from '../../../core/models/media-title';
import { QuizState } from '../../../core/models/quiz';
import { CatalogService } from '../../../core/services/catalog.service';
import { Connectivity } from '../../../core/services/connectivity';
import { PreferenceStore } from '../../../core/services/preference-store';
import { RATING_ICONS } from '../../../shared/icons';
import { Deck } from '../deck';

/**
 * The action bar, driven through the deck shell.
 *
 * These are shell-level tests rather than component-level ones, and
 * deliberately so: the buttons hold no state and reach no store — they report a
 * tap (the `ChoiceChips` pattern). "Records exactly one interaction and
 * advances" is therefore a statement about the *shell*, and this is where it can
 * be checked. `actions.ts` itself has nothing to test beyond its markup.
 *
 * The fixture is eight interchangeable eligible titles, so a rapid-tap test has
 * room to over-run without hitting the end of the deck and mistaking "ran out"
 * for "did not advance".
 */

const COMPLETED_AT = '2026-09-26T10:00:00.000Z';
const TITLE_COUNT = 8;

/**
 * Stands in for the Match Found screen.
 *
 * Watch Now really navigates, so the test router needs the route to exist —
 * without it the router rejects with `NG04002` and the suite reports unhandled
 * errors even though every assertion passed. T031 registers the real one; this
 * only has to be somewhere for the URL to land.
 */
@Component({ selector: 'app-blank', template: '' })
class Blank {}

function fixtureTitles(): MediaTitle[] {
  return Array.from({ length: TITLE_COUNT }, (_, index) => ({
    id: `t${index}`,
    title: `Title ${index}`,
    releaseYear: 2020,
    mediaType: 'movie' as const,
    genres: ['horror'],
    synopsis: 'Filler.',
    rating: 8,
    voteCount: 1000,
    availability: [{ providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/x' }],
  }));
}

/**
 * The rating actions the bar currently offers, and the state each means.
 *
 * **Two, not five, for the duration of the 2026-09-29 trial** — the same
 * boundary `TRIAL_HIDDEN_STATES` draws in `actions.ts`, restated here because a
 * test that reads its expectations from the code under test proves nothing.
 * `RATING_ACTIONS` below is still the five-state contract, and the tests that
 * are about the *vocabulary* rather than the *bar* read from it.
 *
 * When the trial ends, fold this back into the full five:
 *
 * ```ts
 * const RATINGS = RATING_ACTIONS.map((action) => ({ label: action.label, state: action.state }));
 * ```
 */
const RATINGS: readonly { label: string; state: InteractionState }[] = [
  { label: 'Liked It', state: 'liked' },
  { label: 'Disliked', state: 'disliked' },
];

/**
 * The three the trial took off the bar.
 *
 * Two of them stay recordable by swipe, so "hidden" is only ever about tiles.
 * `loved` does not: with its tile gone there is no control on this screen that
 * writes it, and the tests below say so rather than pretending the state is
 * merely out of sight. It is still in the vocabulary, still labelled, and still
 * written by the watchlist's re-rating control — which is what the assertions
 * here pin, because losing the tile must not become losing the state.
 */
const HIDDEN_RATINGS: readonly { label: string; state: InteractionState }[] = [
  { label: 'Loved It', state: 'loved' },
  { label: 'Want to Watch', state: 'wantToWatch' },
  { label: 'Not Interested', state: 'notInterested' },
];

describe('deck action bar', () => {
  let fixture: ComponentFixture<Deck>;
  let root: HTMLElement;

  function build(): void {
    fixture = TestBed.createComponent(Deck);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  function shownTitle(): string {
    return root.querySelector('app-card h2')?.textContent?.trim() ?? '';
  }

  function findButton(label: string): HTMLButtonElement {
    const button = [...root.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`No button labelled "${label}"`);
    return button as HTMLButtonElement;
  }

  function tap(label: string): void {
    findButton(label).click();
    fixture.detectChanges();
  }

  /** Clicks without letting the view catch up — the rapid-tap edge case. */
  function tapWithoutRendering(label: string, times: number): void {
    const button = findButton(label);
    for (let press = 0; press < times; press++) button.click();
    fixture.detectChanges();
  }

  /**
   * The loop's own record of what has been walked past.
   *
   * Read from storage for the same reason `stored()` is: it is the document the
   * deck actually keeps, not a mirror the test set up. It has to be read
   * separately from the interactions because the two answer different
   * questions — "what did they say about this title?" versus "has it been
   * shown?" — and Watch Now is precisely the case where the answers differ.
   */
  function shownTitleIds(): string[] {
    const raw = localStorage.getItem(DECK_SESSION_STORAGE_KEY);
    if (raw === null) return [];
    return (JSON.parse(raw) as { shownTitleIds: string[] }).shownTitleIds;
  }

  /** The persisted interaction document, read straight from LocalStorage. */
  function stored(): { interactions: Record<string, Interaction>; history: WatchHistoryEntry[] } {
    const raw = localStorage.getItem(INTERACTION_STORAGE_KEY);
    if (raw === null) return { interactions: {}, history: [] };
    return JSON.parse(raw) as {
      interactions: Record<string, Interaction>;
      history: WatchHistoryEntry[];
    };
  }

  function completeQuiz(): void {
    TestBed.inject(PreferenceStore).write({
      schemaVersion: 1,
      status: 'completed',
      step: 3,
      mediaType: { values: ['movie'], any: false },
      genre: { values: ['horror'], any: false },
      provider: { values: ['netflix'], any: false },
      includeUnownedProviders: false,
      completedAt: COMPLETED_AT,
      updatedAt: COMPLETED_AT,
    } satisfies QuizState);
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'deck/match/:titleId', component: Blank }]),
        {
          provide: CatalogService,
          useValue: {
            loadTitles: (): Observable<MediaTitle[]> => of(fixtureTitles()),
            // The notices (FR-013) have their own tests in deck.spec.ts; the
            // shell reads this on every render, so the double must answer.
            usingCachedTitles: signal(false),
          },
        },
        // Likewise the offline notice (FR-015): nothing here is offline.
        { provide: Connectivity, useValue: { isOffline: signal(false) } },
      ],
    });
    completeQuiz();
  });

  describe('the rating actions (FR-007, US2 scenario 1)', () => {
    for (const { label, state } of RATINGS) {
      it(`records ${state} and advances when "${label}" is tapped`, () => {
        build();
        expect(shownTitle()).toBe('Title 0');

        tap(label);

        expect(stored().interactions['t0']?.state).toBe(state);
        expect(shownTitle()).toBe('Title 1');
      });
    }

    it('shows every rating action it offers, with the visitor-facing wording', () => {
      build();

      for (const { label } of RATINGS) {
        expect(() => findButton(label)).not.toThrow();
      }
    });

    it('hides the three answers the trial took off the bar', () => {
      // The provisional half. All three states are still in the vocabulary and
      // still written by something — the swipe writes two of them, the
      // watchlist's re-rating control writes the third — so the point of this
      // test is that removing their tiles removed *only* their tiles.
      build();

      for (const { label, state } of HIDDEN_RATINGS) {
        expect(() => findButton(label)).toThrow();
        expect(INTERACTION_STATE_LABELS[state]).toBeTruthy();
        expect(RATING_ACTIONS.map((action) => action.state)).toContain(state);
      }
    });

    it('leaves `loved` with no control of its own (what the trial costs)', () => {
      // The third hidden tile is the one with a consequence, so it is pinned
      // rather than left to be discovered as a missing button. What it costs is
      // narrower than it looks: `POSITIVE_STATES` in `recommend.ts` reads
      // `loved` and `liked` as the same "more like this", so a Liked It tap
      // already votes for the title's genres and already produces the
      // "Because you loved …" reason line — the deck loses no reach. What ends
      // is the visitor's ability to say it *more strongly*, and with it the one
      // input a future "a love outranks a like" rule would have needed.
      build();

      for (const { label } of RATINGS) tap(label);

      const recorded = Object.values(stored().interactions).map((entry) => entry.state);
      expect(recorded).toEqual(['liked', 'disliked']);
      expect(recorded).not.toContain('loved');
    });

    it('records one interaction per tap, not one per card seen', () => {
      build();

      tap('Liked It');
      tap('Disliked');

      // Two cards rated, two entries — the map is keyed by title, so a third
      // entry could only come from writing twice for one card.
      expect(Object.keys(stored().interactions)).toHaveLength(2);
    });

    it('records exactly one next card per rapid tap (spec Edge Cases)', () => {
      build();

      tapWithoutRendering('Liked It', 3);

      // Three presses, three cards, three ratings. Anything else means a tap
      // was swallowed or a card was skipped.
      expect(shownTitle()).toBe('Title 3');
      expect(Object.keys(stored().interactions)).toEqual(['t0', 't1', 't2']);
    });

    it('keeps rating the card the visitor can actually see', () => {
      build();

      tapWithoutRendering('Disliked', 2);

      expect(stored().interactions['t0']?.state).toBe('disliked');
      expect(stored().interactions['t1']?.state).toBe('disliked');
      expect(stored().interactions['t2']).toBeUndefined();
    });

    it('advances without recording anything when the card is skipped', () => {
      build();

      tap('Skip');

      expect(stored().interactions).toEqual({});
      expect(shownTitle()).toBe('Title 1');
    });
  });

  describe('Watch Now (FR-008, US2 scenario 2)', () => {
    it('records a watchingNow interaction for the chosen title', () => {
      build();

      tap('Watch Now');

      expect(stored().interactions['t0']?.state).toBe('watchingNow');
    });

    it('appends exactly one watching-history entry', () => {
      build();

      tap('Watch Now');

      expect(stored().history).toHaveLength(1);
      expect(stored().history[0].titleId).toBe('t0');
      expect(stored().history[0].chosenAt).toBeTruthy();
    });

    it('stops the loop without advancing past the chosen title', () => {
      build();

      tap('Watch Now');

      // Not a skip: the chosen title was never walked past, so it is not
      // recorded as seen. It leaves the deck by being *rated*, which is why
      // the assertion is about the walk rather than about the card on screen —
      // the two are now different things.
      expect(shownTitleIds()).not.toContain('t0');
      expect(stored().interactions['t0']?.state).toBe('watchingNow');
      expect(stored().interactions['t1']).toBeUndefined();
    });

    it('opens Match Found for the chosen title', () => {
      build();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      tap('Watch Now');

      expect(navigate).toHaveBeenCalledExactlyOnceWith(['/deck/match', 't0']);
    });

    it('takes the chosen title out of the deck, like any other rating', () => {
      // The eligibility rule reads presence, not a list of states, so Watch Now
      // excludes its title for the same reason Loved It does — the deck is for
      // open questions. What `watchingNow` is *not* is a rejection: it keeps
      // the title out without voting "less like this" on its genres, which
      // `interaction.spec.ts` pins directly.
      build();

      tap('Watch Now');

      expect(shownTitle()).toBe('Title 1');
      expect(stored().interactions['t0']?.state).not.toBe('disliked');
      expect(stored().interactions['t0']?.state).not.toBe('notInterested');
    });
  });

  describe('the bar itself (FR-017)', () => {
    it('gives every action a 44px target', () => {
      build();

      const bar = root.querySelector('footer');
      const buttons = [...(bar?.querySelectorAll('button') ?? [])];

      // Exact, not a floor: the bar's buttons are the tiles plus the two
      // advances, and nothing else belongs in the footer. A count that only had
      // to be *at least* this would pass if a control were added without a
      // 44px target, which is the one thing this is checking.
      expect(buttons).toHaveLength(RATINGS.length + 2);
      for (const button of buttons) {
        expect(button.classList.contains('touch-target')).toBe(true);
      }
    });

    it('gives the labels room instead of slivers (FR-017)', () => {
      // Five columns at 360px left each label a column narrower than a thumb
      // and roughly fourteen characters of room, so "Not Interested" wrapped
      // into a stack that was no longer a word — hence three columns and a
      // 12px floor. The trial keeps the three columns and drops the `md`
      // expansion with the tiles that needed the width.
      build();

      const grid = findButton('Liked It').parentElement;

      expect(grid?.classList.contains('grid-cols-3')).toBe(true);
      expect(grid?.classList.contains('md:grid-cols-5')).toBe(false);

      for (const { label } of RATINGS) {
        expect(findButton(label).classList.contains('text-xs')).toBe(true);
      }
    });

    it('puts Skip in the verdict row and Watch Now on its own (trial layout)', () => {
      // Skip moved up into the row it shares with the two verdicts — the point
      // of this pass — while the filled button stays last and stays alone, so
      // "skip this" and "watch this" never read as the same size of decision.
      // Skip is a grid cell like its neighbours now, not the full-width pill it
      // was, which is exactly what makes the third cell worth watching: a cell
      // in a verdict row is read as a verdict unless it is drawn otherwise,
      // which is what Skip's arrow — and only its *kind* of shape — is for.
      build();

      const liked = findButton('Liked It');
      const skip = findButton('Skip');
      const watchNow = findButton('Watch Now');

      expect(skip.parentElement).toBe(liked.parentElement);
      expect(skip.classList.contains('w-full')).toBe(false);
      expect(skip.compareDocumentPosition(watchNow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(watchNow.parentElement).not.toBe(liked.parentElement);
      expect(watchNow.classList.contains('w-full')).toBe(true);
    });

    it('sticks above the nav so no action scrolls out of reach (FR-017)', () => {
      // 003 moved the deck inside the navigation shell, so the viewport bottom
      // is no longer free: the nav is fixed there. Pinning the bar at
      // `bottom-0` would tuck it behind the nav — still in the DOM, still in
      // the accessibility tree, and gone as far as the visitor is concerned.
      // The offset is the nav's own height, so the two cannot disagree.
      build();

      const bar = root.querySelector('footer');

      expect(bar?.classList.contains('sticky')).toBe(true);
      expect(bar?.classList.contains('bottom-nav')).toBe(true);
    });

    it('disappears with the card when the loop ends', () => {
      build();
      tapWithoutRendering('Skip', TITLE_COUNT);

      expect(root.querySelector('footer')).toBeNull();
      expect(text()).toContain('Start a new loop');
    });

    it('does not offer a new loop when the deck ran out of ratings, not cards', () => {
      // Rating every card empties the deck by removing titles from it, which a
      // new loop cannot undo — it clears the walk, and the walk was not what
      // was full. So the bar waits behind the empty state and the state offers
      // the one action that can actually help.
      build();
      tapWithoutRendering('Liked It', TITLE_COUNT);

      expect(stored().interactions).toHaveProperty('t0');
      expect(root.querySelector('footer')).toBeNull();
      expect(text()).toContain("You've rated everything here");
      expect(text()).not.toContain('Start a new loop');
      expect(text()).toContain('Preferences');
    });
  });

  describe('the rating glyphs', () => {
    it('draws one hidden icon inside each control, beside its label', () => {
      // The glyph is decoration on a button whose word already says what it
      // does, so it must be exactly one and hidden from the accessibility tree:
      // two, or an unhidden one, would have a screen reader announce the
      // control twice in words that are not the label. Skip is in the loop now
      // that it carries an arrow — the row is uniform, so the rule is too.
      build();

      for (const label of [...RATINGS.map((rating) => rating.label), 'Skip']) {
        const icons = [...findButton(label).querySelectorAll('svg')];

        expect(icons).toHaveLength(1);
        expect(icons[0].getAttribute('aria-hidden')).toBe('true');
        expect(icons[0].querySelector('path')?.getAttribute('d')).toBeTruthy();
        // The namespace is the difference between a glyph and a blank square:
        // an `<svg>` created in the HTML namespace is in the DOM, has its `d`,
        // and draws nothing at all.
        expect(icons[0].namespaceURI).toBe('http://www.w3.org/2000/svg');
      }
    });

    it('has a drawn glyph for every rating, not a blank cell', () => {
      // `RATING_ICONS` is a total `Record`, so a new state fails to compile.
      // What that cannot catch is a value that is present but empty, which
      // renders as a button with a hole in it.
      for (const { state } of RATING_ACTIONS) {
        expect(RATING_ICONS[state]).toMatch(/^M\d/);
      }
    });

    it('draws Skip with a glyph no rating uses (the separation, drawn)', () => {
      // The row's third cell is the one that records nothing, and now that
      // every cell has a glyph the separation can no longer be "Skip has
      // none" — it is "Skip's is a different kind of shape": an arrow among
      // objects, which in a row of opinions reads as navigation. What is worth
      // pinning is that the arrow belongs to no rating. If one ever adopts it,
      // the third cell starts reading as a third verdict again, and this is
      // where that shows up rather than in a visitor's mis-tap.
      build();

      const skipGlyph = findButton('Skip').querySelector('path')?.getAttribute('d');

      expect(skipGlyph).toBeTruthy();
      expect(Object.values(RATING_ICONS)).not.toContain(skipGlyph);
    });
  });

  describe('the wording the visitor reads', () => {
    it('labels each rating action in the shared vocabulary', () => {
      // Pins the label/state pairing in one place, so a rename on either side
      // of the action bar fails here rather than silently mis-recording.
      //
      // Read from `RATING_ACTIONS`, not from the bar: the contract is five
      // states in this order, and the trial hides three of them without being
      // allowed to reorder or rename what is left. That is exactly the drift
      // this test exists to catch, and it should keep catching it while the
      // trial runs.
      expect(RATING_ACTIONS.map((action) => action.label)).toEqual([
        'Loved It',
        'Liked It',
        'Disliked',
        'Want to Watch',
        'Not Interested',
      ]);

      // The bar shows a *subsequence* of that order, in that order. It stopped
      // being a prefix when the trial hid `loved`, which leads the vocabulary —
      // "the first N" is no longer the right way to say it. What has not
      // changed is the part worth pinning: the bar may drop entries, and may
      // never reorder or rename the ones it keeps.
      const vocabulary = RATING_ACTIONS.map((action) => action.label);
      const positions = RATINGS.map((rating) => vocabulary.indexOf(rating.label));

      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((first, second) => first - second));
    });

    it('has a label for every state the visitor can record', () => {
      for (const { state } of RATING_ACTIONS) {
        expect(INTERACTION_STATE_LABELS[state]).toBeTruthy();
      }
      expect(INTERACTION_STATE_LABELS.watchingNow).toBe('Watch Now');
    });
  });
});
