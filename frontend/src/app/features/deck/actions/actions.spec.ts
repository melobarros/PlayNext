import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import {
  INTERACTION_STATE_LABELS,
  Interaction,
  InteractionState,
  INTERACTION_STORAGE_KEY,
  WatchHistoryEntry,
} from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { QuizState } from '../../../core/models/quiz';
import { CatalogService } from '../../../core/services/catalog.service';
import { Connectivity } from '../../../core/services/connectivity';
import { PreferenceStore } from '../../../core/services/preference-store';
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

/** The five rating actions, and the state each one means (FR-007). */
const RATINGS: readonly { label: string; state: InteractionState }[] = [
  { label: 'Loved It', state: 'loved' },
  { label: 'Liked It', state: 'liked' },
  { label: 'Disliked', state: 'disliked' },
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

  describe('the five rating actions (FR-007, US2 scenario 1)', () => {
    for (const { label, state } of RATINGS) {
      it(`records ${state} and advances when "${label}" is tapped`, () => {
        build();
        expect(shownTitle()).toBe('Title 0');

        tap(label);

        expect(stored().interactions['t0']?.state).toBe(state);
        expect(shownTitle()).toBe('Title 1');
      });
    }

    it('shows every rating action, with the visitor-facing wording', () => {
      build();

      for (const { label } of RATINGS) {
        expect(() => findButton(label)).not.toThrow();
      }
    });

    it('records one interaction per tap, not one per card seen', () => {
      build();

      tap('Loved It');
      tap('Liked It');

      // Two cards rated, two entries — the map is keyed by title, so a third
      // entry could only come from writing twice for one card.
      expect(Object.keys(stored().interactions)).toHaveLength(2);
    });

    it('records exactly one next card per rapid tap (spec Edge Cases)', () => {
      build();

      tapWithoutRendering('Loved It', 3);

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

      // The card the visitor chose is the card that stays: Watch Now is a
      // decision, not a skip, so the loop must not carry on underneath it.
      expect(shownTitle()).toBe('Title 0');
      expect(stored().interactions['t1']).toBeUndefined();
    });

    it('opens Match Found for the chosen title', () => {
      build();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      tap('Watch Now');

      expect(navigate).toHaveBeenCalledExactlyOnceWith(['/deck/match', 't0']);
    });

    it('does not treat Watch Now as a rating that excludes the title', () => {
      // `watchingNow` is deliberately neither positive nor excluding: having
      // decided to watch something says nothing about wanting more like it.
      build();

      tap('Watch Now');

      expect(stored().interactions['t0']?.state).not.toBe('disliked');
      expect(stored().interactions['t0']?.state).not.toBe('notInterested');
    });
  });

  describe('the bar itself (FR-017)', () => {
    it('gives every action a 44px target', () => {
      build();

      const bar = root.querySelector('footer');
      const buttons = [...(bar?.querySelectorAll('button') ?? [])];

      expect(buttons.length).toBeGreaterThanOrEqual(RATINGS.length + 2);
      for (const button of buttons) {
        expect(button.classList.contains('touch-target')).toBe(true);
      }
    });

    it('sticks to the bottom so no action scrolls out of reach', () => {
      build();

      const bar = root.querySelector('footer');

      expect(bar?.classList.contains('sticky')).toBe(true);
      expect(bar?.classList.contains('bottom-0')).toBe(true);
    });

    it('disappears with the card when the loop ends', () => {
      build();
      tapWithoutRendering('Loved It', TITLE_COUNT);

      expect(root.querySelector('footer')).toBeNull();
      expect(text()).toContain('Start a new loop');
    });
  });

  describe('the wording the visitor reads', () => {
    it('labels each rating action in the shared vocabulary', () => {
      // Pins the label/state pairing in one place, so a rename on either side
      // of the action bar fails here rather than silently mis-recording.
      expect(RATINGS.map((rating) => rating.label)).toEqual([
        'Loved It',
        'Liked It',
        'Disliked',
        'Want to Watch',
        'Not Interested',
      ]);
    });

    it('has a label for every state the visitor can record', () => {
      for (const { state } of RATINGS) {
        expect(INTERACTION_STATE_LABELS[state]).toBeTruthy();
      }
      expect(INTERACTION_STATE_LABELS.watchingNow).toBe('Watch Now');
    });
  });
});
