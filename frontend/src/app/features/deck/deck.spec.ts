import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';
import { Interaction, INTERACTION_STORAGE_KEY } from '../../core/models/interaction';
import { MediaTitle } from '../../core/models/media-title';
import { QuizState } from '../../core/models/quiz';
import { DECK_SESSION_STORAGE_KEY } from '../../core/models/deck-session';
import { CatalogService } from '../../core/services/catalog.service';
import { Connectivity } from '../../core/services/connectivity';
import { PreferenceStore } from '../../core/services/preference-store';
import { Deck } from './deck';

/**
 * End-to-end coverage of the deck shell: the US1 acceptance scenarios, driven
 * through the DOM against the real stores with a fixture catalog.
 *
 * The fixture is small and its scores are **tied on purpose**, so the expected
 * order is decided by the `id` tiebreak alone. A test that passed because of a
 * scoring accident would not be testing the loop at all.
 *
 * Two guarantees can only be proven here, because they are about what the shell
 * does *not* touch: a swipe records no rating (FR-004), and a reload mid-deck
 * returns the visitor to the same card (research.md D5). Both need stores to
 * inspect, which the pure-logic specs do not have.
 */

const COMPLETED_AT = '2026-09-26T10:00:00.000Z';

/**
 * Six titles. Only the first three survive Movie + Horror + Netflix, and they
 * are identical but for their ids — so the deck's order is the id tiebreak.
 */
const CATALOG: MediaTitle[] = [
  {
    id: 'alpha',
    title: 'Alpha',
    releaseYear: 2020,
    mediaType: 'movie',
    genres: ['horror'],
    synopsis: 'The first one.',
    rating: 8,
    voteCount: 1000,
    posterUrl: '/posters/poster-1.svg',
    availability: [{ providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/1' }],
  },
  {
    id: 'bravo',
    title: 'Bravo',
    releaseYear: 2021,
    mediaType: 'movie',
    genres: ['horror'],
    synopsis: 'The second one.',
    rating: 8,
    voteCount: 1000,
    // No poster: the FR-016 placeholder path, on a card the deck really shows.
    availability: [{ providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/2' }],
  },
  {
    id: 'golf',
    title: 'Golf',
    releaseYear: 2022,
    mediaType: 'movie',
    genres: ['horror'],
    synopsis: 'The third one.',
    rating: 8,
    voteCount: 1000,
    posterUrl: '/posters/poster-3.svg',
    availability: [{ providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/3' }],
  },
  {
    id: 'delta',
    title: 'Delta',
    releaseYear: 2023,
    mediaType: 'movie',
    genres: ['comedy'],
    synopsis: 'Wrong genre.',
    rating: 9,
    voteCount: 1000,
    availability: [{ providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/4' }],
  },
  {
    id: 'echo',
    title: 'Echo',
    releaseYear: 2024,
    mediaType: 'tv',
    genres: ['horror'],
    synopsis: 'Wrong media type.',
    rating: 9,
    voteCount: 1000,
    availability: [{ providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/5' }],
  },
  {
    id: 'foxtrot',
    title: 'Foxtrot',
    releaseYear: 2025,
    mediaType: 'movie',
    genres: ['horror'],
    synopsis: 'Wrong service.',
    rating: 9,
    voteCount: 1000,
    availability: [{ providerId: 'hulu', deepLinkUrl: 'https://www.hulu.com/title/6' }],
  },
];

/**
 * The catalog the service under test will serve. Reassigned by the tests that
 * need a wider deck; `beforeEach` puts it back.
 */
let catalog: MediaTitle[] = CATALOG;

/** Whether the catalog had to fall back to cache (FR-013). */
const usingCachedTitles = signal(false);

class FakeCatalogService {
  readonly usingCachedTitles = usingCachedTitles.asReadonly();

  loadTitles(_region: string): Observable<MediaTitle[]> {
    return of(catalog.map((title) => ({ ...title })));
  }
}

/**
 * The connection, driven by the test rather than by `navigator.onLine`.
 *
 * The real `Connectivity` is covered by its own spec, listeners and all. What
 * matters here is only what the shell does with the signal, so this supplies
 * the signal and nothing else.
 */
const offline = signal(false);

class FakeConnectivity {
  readonly isOffline = offline.asReadonly();
}

/**
 * `count` interchangeable eligible titles.
 *
 * Identical but for their ids, so the order is the `id` tiebreak and a long
 * walk through the deck is reproducible rather than score-dependent.
 */
function manyTitles(count: number): MediaTitle[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `title-${String(index).padStart(2, '0')}`,
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

describe('deck shell', () => {
  let fixture: ComponentFixture<Deck>;
  let root: HTMLElement;

  /** Opens the deck. A second call is a reload: a fresh component, same storage. */
  function build(): void {
    fixture = TestBed.createComponent(Deck);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  function cards(): HTMLElement[] {
    return [...root.querySelectorAll('app-card')] as HTMLElement[];
  }

  /** The title of the card on screen, which is the deck's whole state. */
  function shownTitle(): string {
    return root.querySelector('app-card h2')?.textContent?.trim() ?? '';
  }

  function button(label: string): HTMLButtonElement | undefined {
    return [...root.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  }

  function tap(label: string): void {
    const target = button(label);
    if (!target) throw new Error(`No button labelled "${label}"`);
    target.click();
    fixture.detectChanges();
  }

  function pointerEvent(type: string, x: number, buttons: number): PointerEvent {
    // No `view` member: it throws under Vitest (pointer-events.smoke.spec.ts).
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: 0,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      buttons,
    });
  }

  /** Drags the card horizontally and lifts the finger. */
  function swipe(dx: number): void {
    const surface = cards()[0];
    if (!surface) throw new Error('No card was rendered to swipe');
    const from = 200;
    surface.dispatchEvent(pointerEvent('pointerdown', from, 1));
    surface.dispatchEvent(pointerEvent('pointermove', from + dx, 1));
    surface.dispatchEvent(pointerEvent('pointerup', from + dx, 0));
    fixture.detectChanges();
  }

  function savedSession(): Record<string, unknown> | null {
    const raw = localStorage.getItem(DECK_SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  /** The persisted ratings, read straight from LocalStorage. */
  function savedInteractions(): Record<string, Interaction> {
    const raw = localStorage.getItem(INTERACTION_STORAGE_KEY);
    if (raw === null) return {};
    return (JSON.parse(raw) as { interactions: Record<string, Interaction> }).interactions;
  }

  /** Completes the quiz the way the quiz itself would, through the real store. */
  function completeQuiz(overrides: Partial<QuizState> = {}): void {
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
      ...overrides,
    });
  }

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CatalogService, useValue: new FakeCatalogService() },
        { provide: Connectivity, useValue: new FakeConnectivity() },
      ],
    });
  }

  beforeEach(() => {
    localStorage.clear();
    catalog = CATALOG;
    usingCachedTitles.set(false);
    offline.set(false);
    configure();
  });

  describe('the first card (US1 scenario 1)', () => {
    it('appears immediately, with no further input', () => {
      completeQuiz();

      build();

      expect(shownTitle()).toBe('Alpha');
    });

    it('is the only card on screen (FR-002)', () => {
      completeQuiz();

      build();

      expect(cards()).toHaveLength(1);
    });

    it('carries the metadata FR-003 requires', () => {
      completeQuiz();

      build();

      expect(text()).toContain('2020');
      expect(text()).toContain('Movie');
      expect(text()).toContain('8.0');
      expect(text()).toContain('Horror');
      expect(text()).toContain('Netflix');
      expect(text()).toContain('The first one.');
    });

    it('degrades rather than hides when a title has no poster (FR-016)', () => {
      // Bravo is second, so one advance lands on the artwork-less card.
      completeQuiz();
      build();

      tap('Skip');

      expect(shownTitle()).toBe('Bravo');
      expect(root.querySelector('app-card img')).toBeNull();
      expect(text()).toContain('The second one.');
    });
  });

  describe('what may be suggested (US1 scenarios 3 and 4)', () => {
    it('suggests only titles matching the chosen media type and genre', () => {
      // Delta is the wrong genre and Echo the wrong media type; both outrank the
      // fixture on rating, so seeing either would mean the filter did not run.
      completeQuiz();
      build();

      const seen = [shownTitle()];
      tap('Skip');
      seen.push(shownTitle());
      tap('Skip');
      seen.push(shownTitle());

      expect(seen).toEqual(['Alpha', 'Bravo', 'Golf']);
      expect(text()).not.toContain('Delta');
      expect(text()).not.toContain('Echo');
    });

    it('suggests only titles on a selected service (FR-006)', () => {
      completeQuiz();
      build();

      tap('Skip');
      tap('Skip');

      const seen = [shownTitle()];
      expect(text()).not.toContain('Foxtrot');
      expect(seen).toEqual(['Golf']);
    });

    it('suggests everything when the quiz answered "Any"', () => {
      completeQuiz({
        mediaType: { values: [], any: true },
        genre: { values: [], any: true },
        provider: { values: [], any: true },
      });

      build();

      // Every title is now eligible, so the top card is decided by score — and
      // the fixture's highest-rated titles are the previously filtered ones.
      expect(['Delta', 'Echo', 'Foxtrot']).toContain(shownTitle());
    });
  });

  describe('advancing (FR-004, FR-010)', () => {
    it('shows the next card on the explicit action, one at a time', () => {
      completeQuiz();
      build();

      tap('Skip');

      expect(shownTitle()).toBe('Bravo');
      expect(cards()).toHaveLength(1);
    });

    it('shows the next card on a leftward swipe', () => {
      completeQuiz();
      build();

      swipe(-200);

      expect(shownTitle()).toBe('Bravo');
    });

    it('shows the next card on a rightward swipe', () => {
      completeQuiz();
      build();

      swipe(200);

      expect(shownTitle()).toBe('Bravo');
    });

    it('leaves the card alone when the touch only wobbles — a tap, not a swipe', () => {
      // Deliberately inside the gesture slop. A drag *past* the slop but short of
      // the distance threshold is judged on release velocity, and `event.timeStamp`
      // is not something a test can set: asserting that case here would be
      // asserting jsdom's clock. It is covered with explicit timings in
      // `deck-logic/swipe.spec.ts`, which is where the thresholds belong.
      completeQuiz();
      build();

      swipe(-4);

      expect(shownTitle()).toBe('Alpha');
    });

    it('leaves the card alone when the finger scrolls vertically', () => {
      // The card's synopsis scrolls; a vertical drag must not dismiss (FR-017).
      completeQuiz();
      build();

      const surface = cards()[0];
      surface.dispatchEvent(pointerEvent('pointerdown', 200, 1));
      const vertical = new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 202,
        clientY: 160,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        buttons: 1,
      });
      surface.dispatchEvent(vertical);
      surface.dispatchEvent(pointerEvent('pointerup', 202, 0));
      fixture.detectChanges();

      expect(shownTitle()).toBe('Alpha');
    });

    it('never repeats a title within the loop (FR-010, US1 scenario 5)', () => {
      completeQuiz();
      build();

      const seen = [shownTitle()];
      tap('Skip');
      seen.push(shownTitle());
      tap('Skip');
      seen.push(shownTitle());

      expect(new Set(seen).size).toBe(seen.length);
    });

    it('never repeats a title across a long walk through the deck (FR-010)', () => {
      // 17 advances — well past the three the tied fixture allows, and past the
      // 15 the task asks for. A repeat would most likely come from the shown-ids
      // list and the ranking disagreeing, which only shows up over distance.
      completeQuiz();
      catalog = manyTitles(18);
      build();

      const seen = [shownTitle()];
      for (let advance = 0; advance < 17; advance++) {
        tap('Skip');
        seen.push(shownTitle());
      }

      expect(seen).toHaveLength(18);
      expect(new Set(seen).size).toBe(18);

      // The eighteenth and last title is the one now on screen; one more
      // advance is what runs the loop dry.
      expect(shownTitle()).toBe('Title 17');
      tap('Skip');
      expect(cards()).toHaveLength(0);
    });

    it('takes exactly one card per advance, however fast they come (spec Edge Cases)', () => {
      // Three clicks with no rendering between them: the loop must land three
      // cards on, not two and not four.
      completeQuiz();
      catalog = manyTitles(6);
      build();

      const skipButton = [...root.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Skip',
      ) as HTMLButtonElement;
      skipButton.click();
      skipButton.click();
      skipButton.click();
      fixture.detectChanges();

      expect(shownTitle()).toBe('Title 3');
    });

    it('records the advance in the loop document, and only there', () => {
      completeQuiz();
      build();

      tap('Skip');

      expect(savedSession()?.['shownTitleIds']).toEqual(['alpha']);
    });
  });

  describe('a swipe records no rating (FR-004)', () => {
    it('leaves the interaction document untouched', () => {
      // The pure-logic specs prove the advance path has nowhere to put a rating
      // (deck-session.spec.ts). This is the end-to-end version: a full pass over
      // every card, by tap and by swipe, without the store ever being written.
      completeQuiz();
      build();

      tap('Skip');
      swipe(-200);
      tap('Skip');

      // Confirms the pass really was the whole deck, not an early exit.
      expect(cards()).toHaveLength(0);
      expect(localStorage.getItem(INTERACTION_STORAGE_KEY)).toBeNull();
    });
  });

  describe('a reload mid-deck (research.md D5)', () => {
    it('returns the visitor to the card they were looking at', () => {
      completeQuiz();
      build();
      tap('Skip');

      build();

      expect(shownTitle()).toBe('Bravo');
    });

    it('resumes the same order, because ranking is deterministic (FR-011)', () => {
      completeQuiz();
      build();
      tap('Skip');
      tap('Skip');

      build();
      const first = shownTitle();
      build();

      expect(first).toBe('Golf');
      expect(shownTitle()).toBe('Golf');
    });
  });

  describe('when the loop runs out', () => {
    it('offers a new loop instead of stopping dead', () => {
      completeQuiz();
      build();
      tap('Skip');
      tap('Skip');
      tap('Skip');

      expect(cards()).toHaveLength(0);
      expect(text()).toContain('Start a new loop');
    });

    it('starts a fresh loop that replays the rankings (FR-009)', () => {
      completeQuiz();
      build();
      tap('Skip');
      tap('Skip');
      tap('Skip');

      tap('Start a new loop');

      expect(shownTitle()).toBe('Alpha');
      expect(savedSession()?.['shownTitleIds']).toEqual([]);
    });
  });

  describe('a title the visitor rejected (US3, FR-009)', () => {
    /**
     * Closing and reopening the app.
     *
     * Resetting the module is what makes this real: the stores are root
     * singletons that keep a memory fallback, so a plain `build()` hands the
     * "new" component the same store instances and the same in-memory state.
     * Only a fresh injector reads the way a launched app reads — from
     * LocalStorage and nothing else.
     *
     * The loop document is then discarded, which is the realistic part rather
     * than a convenience: it is throwaway by design (research.md D3) and
     * "start a new loop" empties it, so a returning visitor can easily arrive
     * with nothing in the shown list. That is the state in which only the
     * ratings can keep a rejected title away — the whole of FR-009's "or any
     * later session". Kept, it would prove nothing: the shown list still holds
     * the rejected id, and filter 5 excludes it whether or not the ratings were
     * ever loaded.
     */
    function reopenWithAFreshLoop(): void {
      localStorage.removeItem(DECK_SESSION_STORAGE_KEY);
      TestBed.resetTestingModule();
      configure();
      build();
    }

    /** Walks the deck, collecting the titles as they appear. */
    function walk(advances: number): string[] {
      const seen: string[] = [];

      for (let advance = 0; advance < advances; advance++) {
        const current = shownTitle();
        if (current === '') break;
        seen.push(current);
        tap('Skip');
      }

      return seen;
    }

    it('keeps both rejecting states out after the loop restarts (FR-009 vs FR-010)', () => {
      completeQuiz();
      catalog = manyTitles(20);
      build();

      tap('Disliked');
      tap('Not Interested');
      walk(20);
      tap('Start a new loop');

      // The walk has to come *after* the restart, or it proves nothing: the
      // shown list would still hold both ids, and filter 5 would keep them away
      // whether or not the ratings ever reached the ranking. Emptying it is
      // what leaves the ratings as the only thing standing between the visitor
      // and a title they already rejected.
      const seen = walk(20);

      expect(seen.length).toBeGreaterThanOrEqual(17);
      expect(seen).not.toContain('Title 0');
      expect(seen).not.toContain('Title 1');
    });

    it('still holds after the app is closed and reopened (US3 scenario 2, SC-004)', () => {
      completeQuiz();
      catalog = manyTitles(40);
      build();

      tap('Disliked');
      expect(savedInteractions()['title-00']?.state).toBe('disliked');

      reopenWithAFreshLoop();

      const seen = walk(35);

      // Confirms the walk really did cover a full deck rather than exit early
      // — a short walk would make "never reappears" meaningless.
      expect(seen.length).toBeGreaterThanOrEqual(30);
      expect(seen).not.toContain('Title 0');
    });
  });

  describe('when nothing matches the filters (FR-014, US4 scenario 2)', () => {
    it('explains why and offers a one-tap way out, never a spinner', () => {
      // Documentary is a real genre and no title in the fixture carries it, so
      // this visitor has narrowed themselves into a corner rather than run out
      // of deck — a different outcome, and a different way out.
      completeQuiz({ genre: { values: ['documentary'], any: false } });

      build();

      expect(cards()).toHaveLength(0);
      expect(root.querySelector('[role="progressbar"]')).toBeNull();
      expect(button('Reset Filters')).toBeDefined();
      // The reason, not just the action: an exhausted deck offers the same
      // button, and telling this visitor they had "seen everything" when
      // their filters matched nothing would be a different lie.
      expect(text()).toContain('Nothing matches');
    });

    it('does not offer a new loop, which would land on this same screen', () => {
      completeQuiz({ genre: { values: ['documentary'], any: false } });

      build();

      expect(button('Start a new loop')).toBeUndefined();
    });
  });

  describe('answering the quiz again (FR-014, US4 scenario 3)', () => {
    it('starts a new loop rather than resuming the walk the old answers produced', () => {
      completeQuiz();
      build();
      tap('Skip');
      tap('Skip');
      tap('Skip');
      expect(text()).toContain('Start a new loop');

      // They reset their filters, widened them, and finished the quiz again.
      // Strictly after the loop they are holding, whatever the clock says.
      const retakenAt = new Date(Date.now() + 60_000).toISOString();
      completeQuiz({ completedAt: retakenAt, updatedAt: retakenAt });

      build();

      // The whole point of the reset: not the same spent deck they left.
      expect(shownTitle()).toBe('Alpha');
    });

    it('still resumes the loop when the answers have not changed', () => {
      // The guard against being too eager. A reload is not a retake, and
      // discarding the visitor's place on one would break the D5 promise.
      completeQuiz();
      build();
      tap('Skip');

      build();

      expect(shownTitle()).toBe('Bravo');
    });
  });

  describe('the notices (FR-013, FR-015)', () => {
    it('says the catalog is unreachable instead of passing cache off as live', () => {
      completeQuiz();
      usingCachedTitles.set(true);

      build();

      expect(text()).toContain('saved results');
      // A notice is not a replacement: the visitor still gets a card.
      expect(shownTitle()).toBe('Alpha');
    });

    it('says nothing about the catalog when the catalog answered', () => {
      completeQuiz();

      build();

      expect(text()).not.toContain('saved results');
    });

    it('says the visitor is offline, and leaves the loaded cards usable (US4 scenario 4)', () => {
      completeQuiz();
      build();

      offline.set(true);
      fixture.detectChanges();

      expect(text()).toContain("You're offline");
      // FR-015 is not "show a banner" — it is that browsing *continues*, which
      // is what makes the notice non-blocking rather than decorative.
      expect(shownTitle()).toBe('Alpha');
      tap('Skip');
      expect(shownTitle()).toBe('Bravo');
    });

    it('keeps the action bar in reach while offline (FR-017)', () => {
      completeQuiz();
      build();

      offline.set(true);
      fixture.detectChanges();

      // The banners sit in the flow above the card. Anything that took the
      // actions off screen — an overlay, a full-height banner — would leave
      // the visitor able to see a card and unable to decide on it.
      for (const label of ['Loved It', 'Skip', 'Watch Now']) {
        expect(button(label)).toBeDefined();
      }
    });
  });

  describe('when no preferences exist', () => {
    it('does not crash, and shows the way back to the quiz', () => {
      // Reaching /deck directly, without having completed the quiz.
      build();

      expect(cards()).toHaveLength(0);
      expect(text()).toContain('quiz');
      const link = [...root.querySelectorAll('a')].find((anchor) =>
        anchor.getAttribute('href')?.includes('/quiz'),
      );
      expect(link).toBeDefined();
    });
  });
});
