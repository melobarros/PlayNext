import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { EnvironmentProviders, Provider, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, of, Subject } from 'rxjs';
import { AccountState } from '../../core/models/account-state';
import { Interaction, INTERACTION_STORAGE_KEY } from '../../core/models/interaction';
import { MediaTitle } from '../../core/models/media-title';
import { QuizState } from '../../core/models/quiz';
import { DECK_SESSION_STORAGE_KEY } from '../../core/models/deck-session';
import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { Connectivity } from '../../core/services/connectivity';
import { InteractionStore } from '../../core/services/interaction-store';
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
 * A catalog that answers when the test says so, one request at a time.
 *
 * Every other test in this file uses the synchronous fake above, which
 * completes before the first `detectChanges()` — and that is precisely how the
 * false-empty-state bug survived a suite this size: nothing ever looked at the
 * deck while a request was open. This one holds it open.
 *
 * Each call gets its own `Subject`, so a retry is a *second* answerable request
 * rather than a second subscription to a finished one.
 */
class DeferredCatalogService {
  private readonly requests: Subject<MediaTitle[]>[] = [];

  readonly usingCachedTitles = usingCachedTitles.asReadonly();

  /** How many times the catalog has been asked — the retry assertion. */
  get loadCalls(): number {
    return this.requests.length;
  }

  loadTitles(_region: string): Observable<MediaTitle[]> {
    const request = new Subject<MediaTitle[]>();
    this.requests.push(request);
    return request.asObservable();
  }

  /** Completes the request at `index` (the most recent by default). */
  emit(titles: MediaTitle[] = catalog, index = this.requests.length - 1): void {
    const request = this.requests[index];
    if (request === undefined) throw new Error(`No catalog request at index ${index}`);

    request.next(titles.map((title) => ({ ...title })));
    request.complete();
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

  /**
   * `extra` is for the one test that signs in. Everything else here gets the
   * module `beforeEach` builds, unchanged, so the deck's own claims are not
   * made against a TestBed that quietly grew a backend.
   */
  function configure(extra: (Provider | EnvironmentProviders)[] = []): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CatalogService, useValue: new FakeCatalogService() },
        { provide: Connectivity, useValue: new FakeConnectivity() },
        ...extra,
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

  describe('what a swipe records (FR-004, amended)', () => {
    /**
     * FR-004 originally said a swipe records nothing, and this suite pinned
     * that end to end: a full pass over the deck by tap and by swipe, with
     * `playnext:interactions` never written. The amendment keeps the guarantee
     * where it belongs — `Skip` is still the one action that advances without
     * recording — and gives the two directions meanings, because a gesture that
     * silently does nothing is a gesture the visitor has to be told not to use.
     *
     * So this test is rewritten rather than deleted: the same full pass, the
     * same three advances, and now a document at the end that names exactly
     * which one of them wrote something.
     */
    it('records a swipe as a rating, while Skip still records nothing', () => {
      completeQuiz();
      build();

      tap('Skip');
      swipe(-200);
      tap('Skip');

      // Confirms the pass really was the whole deck, not an early exit.
      expect(cards()).toHaveLength(0);
      expect(savedInteractions()).toEqual({
        bravo: expect.objectContaining({ state: 'notInterested' }),
      });
    });

    it('takes a leftward swipe as Not Interested (FR-009)', () => {
      // `notInterested` excludes the title from later loops, which is what
      // makes a left swipe worth making: it is remembered, not just an exit.
      completeQuiz();
      build();

      swipe(-200);

      expect(savedInteractions()['alpha']?.state).toBe('notInterested');
    });

    it('takes a rightward swipe as Want to Watch', () => {
      completeQuiz();
      build();

      swipe(200);

      expect(savedInteractions()['alpha']?.state).toBe('wantToWatch');
    });

    it('acknowledges a swipe exactly as it acknowledges a tap', () => {
      // The gesture is a rating, so it gets a rating's feedback — this is the
      // assertion that would fail if the swipe had kept its own path.
      completeQuiz();
      build();

      swipe(-200);

      expect(root.querySelector('[data-undo-strip]')?.textContent).toContain('Not Interested');
      expect(root.querySelector('[aria-live="polite"]')?.textContent).toMatch(
        /^Not Interested\. 1 rated\.$/,
      );
    });

    it('can be taken back like any other rating', () => {
      completeQuiz();
      build();
      swipe(200);

      tap('Undo');

      expect(shownTitle()).toBe('Alpha');
      expect(savedInteractions()['alpha']).toBeUndefined();
    });
  });

  describe('the drag hint', () => {
    function hint(): HTMLElement | null {
      return root.querySelector<HTMLElement>('[data-swipe-hint]');
    }

    /** Drags without lifting the finger, leaving the gesture open. */
    function drag(dx: number): void {
      const surface = cards()[0];
      if (!surface) throw new Error('No card was rendered to drag');
      surface.dispatchEvent(pointerEvent('pointerdown', 200, 1));
      surface.dispatchEvent(pointerEvent('pointermove', 200 + dx, 1));
      fixture.detectChanges();
    }

    it('says nothing until the finger has moved past the slop', () => {
      // Below the slop there is no gesture yet — this is a tap, and a tap does
      // not rate anything. The card has not moved, so nothing is promised.
      completeQuiz();
      build();

      drag(-4);

      expect(hint()).toBeNull();
    });

    it('names the rating a leftward drag is about to record', () => {
      completeQuiz();
      build();

      drag(-200);

      expect(hint()?.textContent?.trim()).toBe('Not Interested');
    });

    it('names the rating a rightward drag is about to record', () => {
      completeQuiz();
      build();

      drag(200);

      expect(hint()?.textContent?.trim()).toBe('Want to Watch');
    });

    it('sits on the side the card is leaving, and fades in with the drag', () => {
      completeQuiz();
      build();

      drag(-200);
      const leftward = hint();
      expect(leftward?.classList.contains('left-4')).toBe(true);
      expect(leftward?.classList.contains('right-4')).toBe(false);
      // The fixture card is 0px wide in jsdom, so the dismissal threshold is
      // the 72px floor and a 200px drag is well past full opacity.
      expect(leftward?.style.opacity).toBe('1');

      // A second, shallower drag on the next card: still visible, and dimmer.
      // Swiping back the other way is not available — the gesture would commit.
      cards()[0].dispatchEvent(pointerEvent('pointerup', 0, 0));
      fixture.detectChanges();
      drag(36);
      const shallow = hint();
      expect(shallow?.classList.contains('right-4')).toBe(true);
      expect(Number(shallow?.style.opacity)).toBeCloseTo(0.5, 1);
    });

    it('drops the hint the moment the finger lifts', () => {
      // It describes a gesture in progress. Once the gesture is over the strip
      // below says the same thing about a rating that actually happened, and
      // two labels for one decision is one too many.
      completeQuiz();
      build();
      drag(-200);

      cards()[0].dispatchEvent(pointerEvent('pointerup', 0, 0));
      fixture.detectChanges();

      expect(hint()).toBeNull();
    });

    it('is invisible to a screen reader, which hears the rating instead', () => {
      // The pill is a picture of a decision. Announcing it would have a screen
      // reader read out a rating for a gesture that may still be abandoned.
      completeQuiz();
      build();
      drag(-200);

      expect(hint()?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('acknowledging a rating, and taking it back (US2 undo)', () => {
    /** The strip offering to undo, or `undefined` when there is nothing to undo. */
    function strip(): HTMLElement | null {
      return root.querySelector<HTMLElement>('[data-undo-strip]');
    }

    /** What a screen reader was told, which is the strip's real counterpart. */
    function announcement(): string {
      return root.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? '';
    }

    it('says which rating landed, and how many are now recorded', () => {
      // The count is the part that proves the write happened rather than the
      // card merely sliding away — the tile gives no other feedback, and the
      // next card looks identical whether or not anything was saved.
      completeQuiz();
      build();

      tap('Loved It');

      expect(announcement()).toMatch(/^Loved It\. 1 rated\.$/);
    });

    it('counts every rating, not just the last one', () => {
      completeQuiz();
      build();

      tap('Loved It');
      tap('Liked It');

      expect(announcement()).toMatch(/^Liked It\. 2 rated\.$/);
    });

    it('offers the undo, reachable without aiming (FR-017)', () => {
      completeQuiz();
      build();

      tap('Loved It');

      const undo = button('Undo');
      expect(undo).toBeDefined();
      expect(undo?.classList.contains('touch-target')).toBe(true);
    });

    it('sits above the action bar, where the eye already is', () => {
      // Placement is the whole reason the offer is noticed at all: it has to be
      // between the tiles the visitor just used and the card they are now
      // looking at, and it has to live inside the footer so it leaves with the
      // card when the loop ends.
      completeQuiz();
      build();

      tap('Loved It');

      const footer = root.querySelector('footer');
      expect(footer?.firstElementChild).toBe(strip());
      expect(strip()?.nextElementSibling?.tagName.toLowerCase()).toBe('app-actions');
    });

    it('shows nothing at all before the first rating', () => {
      completeQuiz();
      build();

      expect(strip()).toBeNull();
      expect(announcement()).toBe('');
    });

    it('brings the rated card back, and forgets the rating (US2 undo)', () => {
      // The whole point: a mis-tap costs one tap to fix, not a reload.
      completeQuiz();
      build();
      tap('Loved It');
      expect(shownTitle()).toBe('Bravo');

      tap('Undo');

      expect(shownTitle()).toBe('Alpha');
      expect(savedInteractions()['alpha']).toBeUndefined();
      expect(savedSession()?.['shownTitleIds']).toEqual([]);
    });

    it('brings back a title the rating had excluded (FR-009)', () => {
      // `disliked` and `notInterested` remove their title from the ranking, so
      // undoing one is two repairs at once: the walk is rewound *and* the
      // title rejoins the pool. Clearing only the walk would leave a card
      // missing from a deck that looks complete.
      completeQuiz();
      build();
      tap('Disliked');
      expect(shownTitle()).toBe('Bravo');

      tap('Undo');

      expect(shownTitle()).toBe('Alpha');
      expect(savedInteractions()['alpha']).toBeUndefined();
    });

    it('takes back only the last rating, leaving the earlier ones alone', () => {
      completeQuiz();
      catalog = manyTitles(6);
      build();
      tap('Loved It');
      tap('Disliked');

      tap('Undo');

      expect(shownTitle()).toBe('Title 1');
      expect(savedInteractions()['title-00']?.state).toBe('loved');
      expect(savedInteractions()['title-01']).toBeUndefined();
    });

    it('leaves no offer once it has been taken', () => {
      // The strip is consumed, not merely hidden: a second Undo would have to
      // reach past the rating it just retracted to find another one, which is
      // the undo stack this deliberately is not.
      completeQuiz();
      build();
      tap('Loved It');

      tap('Undo');

      expect(strip()).toBeNull();
      expect(announcement()).toBe('');
    });

    it('withdraws the offer when the visitor skips instead', () => {
      // Skip says nothing about any title. A strip still offering to un-rate
      // the card before last would be offering to undo something that is no
      // longer the last thing they did.
      completeQuiz();
      build();
      tap('Loved It');

      tap('Skip');

      expect(strip()).toBeNull();
      expect(announcement()).toBe('');
      expect(shownTitle()).toBe('Golf');
    });

    it('withdraws the offer when the visitor decides, and leaves the screen', () => {
      // Watch Now ends the loop and opens Match Found. The offer to un-rate is
      // not actionable from there, and the strip would still be sitting in the
      // footer if they navigated back — an invitation to undo a decision they
      // have already acted on by finding a movie to watch.
      completeQuiz();
      build();
      tap('Loved It');

      // The navigation is stubbed, not followed: this spec has no `/deck/match`
      // route, and letting the router really leave would reject in the
      // background and be reported as an unhandled error in the run.
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      tap('Watch Now');

      expect(navigate).toHaveBeenCalledWith(['/deck/match', 'bravo']);
      expect(strip()).toBeNull();
      expect(savedInteractions()['bravo']?.state).toBe('watchingNow');
    });

    it('does not outlive a reload, because it describes a tap and not a state', () => {
      // The offer is deliberately not persisted. It is an answer to "what did
      // you just do", and a reload has no way to know — a strip restored from
      // storage would be inviting an undo of something the visitor may have
      // done in a different session, days ago. The rating survives; the offer
      // to retract it does not.
      completeQuiz();
      build();
      tap('Loved It');

      build();

      expect(strip()).toBeNull();
      expect(savedInteractions()['alpha']?.state).toBe('loved');
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

  describe('a merge that arrived from the account (004 US3 scenario 4)', () => {
    /**
     * Rebuilds the injector with an HTTP testing backend.
     *
     * This is the one deck test that signs in, and it does so through the real
     * `AuthService` rather than a stand-in. The claim spans the whole path a
     * merge travels — the guest document going up, the merged document coming
     * back down, the deck reading it — so replacing any one link would leave
     * the interesting part untested.
     *
     * A reset rather than a second `configureTestingModule` call: configuring
     * one injector twice leaves two sets of root providers in it, and the deck
     * would end up reading the stores from one and the session from the other.
     * Same idiom as `reopenWithAFreshLoop` above, for the same reason.
     */
    function configureWithAuth(): void {
      TestBed.resetTestingModule();
      configure([provideHttpClient(), provideHttpClientTesting()]);
    }

    it('keeps a title either side rejected out of the deck', () => {
      configureWithAuth();

      const http = TestBed.inject(HttpTestingController);
      const interactions = TestBed.inject(InteractionStore);
      const account = TestBed.inject(AuthService);

      completeQuiz();

      // The guest's half of the merge: rejected here, back when this device
      // was the only place that rating existed.
      interactions.record('golf', 'notInterested');

      account.signIn('visitor@example.com', 'Correct-Horse-9!').subscribe();

      const request = http.expectOne('/api/auth/login');

      // The premise, pinned. A rejection that never left the device would give
      // the server nothing of the guest's to merge, and the only exclusion left
      // under test would be the account's own.
      expect(request.request.body.guest.interactions.golf.state).toBe('notInterested');

      // The account's half, and the merged document as the server returns it:
      // the account's older Disliked of Alpha sitting alongside the guest's
      // rejection of Golf. Which side wins a conflict is the server's business
      // (MigrationTests covers it); this is about what the deck does with the
      // answer it was given.
      const merged: AccountState = {
        interactions: {
          alpha: { state: 'disliked', updatedAt: '2026-09-26T09:00:00.000Z' },
          golf: { state: 'notInterested', updatedAt: '2026-09-26T11:00:00.000Z' },
        },
        history: [],
        preferences: {
          mediaType: { values: ['movie'], any: false },
          genre: { values: ['horror'], any: false },
          provider: { values: ['netflix'], any: false },
          includeUnownedProviders: false,
          completedAt: COMPLETED_AT,
          updatedAt: COMPLETED_AT,
        },
      };

      request.flush({
        userId: '0e7d2c41-9f3a-4b8e-a1c6-5d0f9e2b3a11',
        email: 'visitor@example.com',
        accessToken: 'test-access-token-not-a-credential',
        state: merged,
      });

      build();

      // Alpha leads the fixture — the scores are tied and the id breaks them —
      // so reaching Bravo at all is the account's rejection doing the work.
      expect(shownTitle()).toBe('Bravo');

      // Golf was next in line, so an empty deck after one advance is the
      // guest's rejection doing the work. Had the merge dropped it, this would
      // be showing Golf.
      tap('Skip');
      expect(cards()).toHaveLength(0);
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

  describe('the attribution (FR-018)', () => {
    /**
     * Placement only. The wording, the link and the logo belong to
     * `Attribution` and are pinned in its own spec — asserting the sentence
     * here as well would mean two copies of one licence term, and the copy that
     * gets updated is never the one that fails.
     */

    it('appears on the screen that shows the provider’s titles', () => {
      completeQuiz();
      build();

      expect(root.querySelector('app-attribution')).not.toBeNull();
    });

    it('rides with the action bar, where a scrolling card cannot push it off screen', () => {
      completeQuiz();
      build();

      const footer = root.querySelector('footer');

      // The same element as the action bar, deliberately. A line placed in the
      // flow above it would sit below the fold as soon as a synopsis made the
      // card scroll — attribution that is in the document and not on the
      // screen, which is the failure this placement exists to avoid.
      expect(footer?.querySelector('app-attribution')).not.toBeNull();
      expect(footer?.querySelector('app-actions')).not.toBeNull();
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

  /**
   * The state between "asking" and "answered" — the P0 this pass exists for.
   *
   * Before it, a cold start rendered "Nothing matches right now" over a **Reset
   * Filters** button while the request was still in flight: the deck told the
   * visitor their answers were wrong before anything had been asked, and the
   * action it offered would have rewritten answers that were never the problem.
   *
   * Same idiom as `configureWithAuth` above — reset, reconfigure, then build —
   * because the module `beforeEach` built carries the synchronous catalog.
   */
  describe('the load (FR-013)', () => {
    function deferred(): DeferredCatalogService {
      const service = new DeferredCatalogService();
      TestBed.resetTestingModule();
      configure([{ provide: CatalogService, useValue: service }]);
      return service;
    }

    /** The sr-only status lines, which are the screen reader's whole picture. */
    function statuses(): (string | undefined)[] {
      return [...root.querySelectorAll('[role="status"]')].map(
        (node) => node.textContent?.trim(),
      );
    }

    it('shows a skeleton, not a verdict, while the catalog is in flight', () => {
      completeQuiz();
      deferred();

      build();

      // The bug, stated as a test.
      expect(text()).not.toContain('Nothing matches');
      expect(button('Reset Filters')).toBeUndefined();
      expect(root.querySelector('[data-card-skeleton]')).not.toBeNull();
      expect(cards()).toHaveLength(0);
      // There is no progress to report, so there is no progressbar to report
      // it with — the same pin the empty-state tests make from the other side.
      expect(root.querySelector('[role="progressbar"]')).toBeNull();
    });

    it('announces that it is loading, rather than leaving a screen reader in silence', () => {
      completeQuiz();
      deferred();

      build();

      expect(statuses()).toContain('Loading your deck…');
    });

    it('replaces the skeleton with the first card when the answer arrives', () => {
      completeQuiz();
      const service = deferred();
      build();

      service.emit();
      fixture.detectChanges();

      expect(root.querySelector('[data-card-skeleton]')).toBeNull();
      expect(shownTitle()).toBe('Alpha');
    });

    it('asks for the quiz before it asks for titles', () => {
      // Someone who has not taken the quiz is not waiting for a deck: no load
      // is going to change their answer, so a skeleton would be a delay they
      // cannot end by waiting — with the prompt that moves them forward hidden
      // behind it.
      deferred();

      build();

      expect(root.querySelector('[data-card-skeleton]')).toBeNull();
      expect(text()).toContain('quiz');
    });

    it('says the catalog could not be reached, and offers the retry', () => {
      completeQuiz();
      const service = deferred();
      usingCachedTitles.set(true);
      build();

      service.emit([]);
      fixture.detectChanges();

      expect(text()).toContain("Couldn't reach the catalog");
      expect(button('Try again')).toBeDefined();
      // The failure is the network's, not the visitor's answers.
      expect(button('Reset Filters')).toBeUndefined();
      // And there is no deck to walk again, so no new loop to offer.
      expect(button('Start a new loop')).toBeUndefined();
      // "Showing saved results" is a promise about results that do not exist.
      expect(text()).not.toContain('saved results');
      expect(root.querySelector('[role="progressbar"]')).toBeNull();
    });

    it('still asks for the quiz when the load failed as well', () => {
      // The one case where two screens could each claim to be the truth, so
      // the precedence is pinned rather than left to branch order. The quiz
      // prompt wins: it is not a verdict about the catalog — the visitor's own
      // answers need no request to read — and it is the thing they have to do
      // either way. The failure is waiting for them on the other side of it.
      const service = deferred();
      usingCachedTitles.set(true);
      build();

      service.emit([]);
      fixture.detectChanges();

      expect(text()).toContain('quiz');
      expect(button('Try again')).toBeUndefined();
    });

    it('recovers on retry, from the same screen', () => {
      completeQuiz();
      const service = deferred();
      usingCachedTitles.set(true);
      build();
      service.emit([]);
      fixture.detectChanges();

      tap('Try again');
      expect(service.loadCalls).toBe(2);
      // The retry is a real second attempt, not a re-render of the failure.
      expect(root.querySelector('[data-card-skeleton]')).not.toBeNull();

      service.emit();
      // The second request reached the catalog, so the fallback is over.
      usingCachedTitles.set(false);
      fixture.detectChanges();

      expect(shownTitle()).toBe('Alpha');
      expect(text()).not.toContain("Couldn't reach the catalog");
    });
  });
});
