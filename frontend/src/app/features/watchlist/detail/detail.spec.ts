import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, of } from 'rxjs';
import { routes } from '../../../app.routes';
import { DECK_SESSION_STORAGE_KEY } from '../../../core/models/deck-session';
import {
  Interaction,
  INTERACTION_STORAGE_KEY,
  InteractionState,
  RATING_ACTIONS,
  surfaceFor,
} from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { QuizState } from '../../../core/models/quiz';
import { CatalogService } from '../../../core/services/catalog.service';
import { Connectivity } from '../../../core/services/connectivity';
import { PreferenceStore } from '../../../core/services/preference-store';
import { Deck } from '../../deck/deck';
import { Detail } from './detail';

/**
 * The title detail view (US1 scenario 3), and the one surface US3 shares
 * (research.md D9).
 *
 * Two properties are worth more than the rest of this file put together.
 *
 * The first is that the view is **resolved from the address**. It is handed an
 * id and nothing else — no catalogue passed through navigation state — which is
 * what makes the back button and a mid-session refresh land where the visitor
 * was (research.md D10). Every test here builds it that way, so the property is
 * enforced by the shape of the harness rather than by an assertion that could
 * be satisfied some other way.
 *
 * The second is that the streaming links are **refreshed from current
 * availability, never read back from anything saved** (spec 003's clarification,
 * research.md D10). A saved link keeps sending the visitor to a page that no
 * longer carries the title; the catalog is asked again on every render.
 */

const ARRIVAL: MediaTitle = {
  id: 'arrival',
  title: 'Arrival',
  releaseYear: 2016,
  mediaType: 'movie',
  genres: ['sci-fi', 'drama'],
  synopsis: 'A linguist is recruited to talk to the visitors.',
  rating: 7.9,
  voteCount: 12000,
  runtimeMinutes: 166,
  posterUrl: '/posters/arrival.svg',
  availability: [
    { providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/1' },
    { providerId: 'max', deepLinkUrl: 'https://www.max.com/title/1' },
  ],
};

const PARASITE: MediaTitle = {
  ...ARRIVAL,
  id: 'parasite',
  title: 'Parasite',
  releaseYear: 2019,
  mediaType: 'tv',
  genres: ['thriller'],
  synopsis: 'Two families, one house.',
  runtimeMinutes: 132,
  availability: [{ providerId: 'hulu', deepLinkUrl: 'https://www.hulu.com/title/2' }],
};

/**
 * Three interchangeable titles, all matching the quiz answers below.
 *
 * Identical but for their ids, so the deck's order is the `id` tiebreak alone
 * and "which card is first" is decided by eligibility and nothing else — which
 * is what makes the cross-view tests evidence rather than a scoring accident.
 */
const DECK_CATALOG: MediaTitle[] = ['alpha', 'bravo', 'charlie'].map((id) => ({
  ...ARRIVAL,
  id,
  title: id.charAt(0).toUpperCase() + id.slice(1),
  genres: ['horror'],
  availability: [{ providerId: 'netflix', deepLinkUrl: `https://www.netflix.com/title/${id}` }],
}));

const COMPLETED_AT = '2026-09-26T10:00:00.000Z';

/** The catalog the fake service answers from, swappable between builds. */
let catalog: MediaTitle[] = [];

class FakeCatalogService {
  /** A signal, like the real one — the deck reads it as `usingCachedTitles()`. */
  readonly usingCachedTitles = signal(false).asReadonly();

  loadTitles(_region: string): Observable<MediaTitle[]> {
    return of(catalog.map((candidate) => ({ ...candidate })));
  }
}

/** The connection, supplied rather than read from `navigator.onLine`. */
class FakeConnectivity {
  readonly isOffline = signal(false);
}

describe('title details', () => {
  let fixture: ComponentFixture<Detail>;
  let root: HTMLElement;

  function setCatalog(titles: MediaTitle[]): void {
    catalog = titles;
  }

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        // The one route this view navigates to is `/watchlist` — that is where
        // Remove leaves the visitor, since the title they were looking at is no
        // longer rated.
        provideRouter([{ path: 'watchlist', children: [] }]),
        { provide: CatalogService, useValue: new FakeCatalogService() },
        { provide: Connectivity, useValue: new FakeConnectivity() },
      ],
    });
  }

  /**
   * Builds the view for an id, the way the route does.
   *
   * Configures the module itself so a test can reset it and build a second,
   * genuinely fresh instance — which is the only way to tell "resolves from the
   * catalog now" apart from "remembers what it resolved before".
   */
  function build(titleId: string): void {
    configure();

    fixture = TestBed.createComponent(Detail);
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('titleId', titleId);
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  /** The streaming links only, so the way back is never counted as a service. */
  function streamingLinks(): HTMLAnchorElement[] {
    return [...root.querySelectorAll('app-ways-to-watch a')] as HTMLAnchorElement[];
  }

  function streamingNames(): string[] {
    return streamingLinks().map((anchor) => anchor.textContent?.trim() ?? '');
  }

  beforeEach(() => setCatalog([ARRIVAL, PARASITE]));

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  describe('resolving the title (research D10)', () => {
    it('shows the title the address names', () => {
      build('arrival');

      expect(text()).toContain('Arrival');
    });

    it('shows a different title for a different address', () => {
      build('parasite');

      expect(text()).toContain('Parasite');
      expect(text()).not.toContain('Arrival');
    });

    it('needs nothing but the id, so a shared link lands where the visitor was', () => {
      // No prior instance exists to have handed anything over — the module was
      // just reset — so this can only be resolving from the id.
      TestBed.resetTestingModule();

      build('arrival');

      expect(text()).toContain('Arrival');
      expect(text()).toContain('A linguist is recruited');
    });
  });

  describe('the details it shows (FR-002, US1 scenario 3)', () => {
    it('shows the year, the media type and the runtime', () => {
      build('arrival');

      expect(text()).toContain('2016');
      expect(text()).toContain('Movie');
      expect(text()).toContain('2h 46m');
    });

    it('shows the rating, to the same one decimal the card uses', () => {
      build('arrival');

      expect(text()).toContain('7.9');
    });

    it('names the genres rather than printing their ids', () => {
      build('arrival');

      expect(text()).toContain('Sci-Fi');
      expect(text()).toContain('Drama');
    });

    it('shows the synopsis outright rather than behind a disclosure', () => {
      // The deck card shows it outright too. It used to hide it behind a
      // `<details>` to keep the deck quiet; the second visual pass gave the
      // card the room and dropped the tap, so the two surfaces agree.
      build('arrival');

      expect(text()).toContain('A linguist is recruited to talk to the visitors.');
    });

    it('names the artwork the way every other surface does', () => {
      build('arrival');

      expect(root.querySelector('img')?.getAttribute('alt')).toBe('Arrival poster');
    });

    it('leaves out a runtime the title does not have, rather than inventing one', () => {
      setCatalog([{ ...ARRIVAL, runtimeMinutes: undefined }]);

      build('arrival');

      expect(text()).not.toContain('NaN');
      expect(text()).not.toContain('undefined');
    });
  });

  describe('the streaming links (FR-008, US1 scenario 3)', () => {
    it('links to every service the title is on', () => {
      build('arrival');

      expect(streamingNames()).toEqual(['Netflix', 'HBO Max']);
      expect(streamingLinks()[0].getAttribute('href')).toBe('https://www.netflix.com/title/1');
    });

    it('sends the visitor away safely, because an installed PWA has no back button', () => {
      build('arrival');

      for (const anchor of streamingLinks()) {
        expect(anchor.getAttribute('target')).toBe('_blank');
        expect(anchor.getAttribute('rel')).toContain('noopener');
      }
    });

    it('asks the catalog again on every render instead of remembering a saved link', () => {
      // The clarification behind research.md D10. A title moves between
      // services; a link captured when the rating was made would keep sending
      // the visitor somewhere the title no longer is.
      build('arrival');
      expect(streamingNames()).toEqual(['Netflix', 'HBO Max']);

      setCatalog([{ ...ARRIVAL, availability: [ARRIVAL.availability[0]] }]);
      TestBed.resetTestingModule();
      build('arrival');

      expect(streamingNames()).toEqual(['Netflix']);
    });

    it('lists a service once and ignores one the option lists do not know', () => {
      // The rule itself is the shared block's, and its spec proves it
      // (`shared/ways-to-watch/ways-to-watch.spec.ts`). What this covers is that
      // this view goes *through* that block rather than growing its own copy of
      // the rule — the duplication research.md D11 exists to prevent.
      setCatalog([
        {
          ...ARRIVAL,
          availability: [
            { providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/1' },
            { providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/1-alt' },
            { providerId: 'a-defunct-service', deepLinkUrl: 'https://defunct.test/1' },
          ],
        },
      ]);

      build('arrival');

      expect(streamingNames()).toEqual(['Netflix']);
    });

    it('says so when the title is on nothing, instead of an empty heading', () => {
      setCatalog([{ ...ARRIVAL, availability: [] }]);

      build('arrival');

      expect(streamingNames()).toEqual([]);
      expect(text()).toContain('Not on your services');
    });
  });

  describe('a title the catalog no longer knows (data-model.md)', () => {
    it('explains itself instead of throwing', () => {
      expect(() => build('gone')).not.toThrow();
    });

    it('reuses Match Found’s wording, so the same situation reads the same way twice', () => {
      build('gone');

      expect(text()).toContain('no longer available');
      expect(text()).toContain('left the catalog');
    });

    it('offers no streaming links for a title it cannot describe', () => {
      build('gone');

      expect(streamingLinks()).toEqual([]);
    });

    it('is not a dead end — this is still where a rating would be removed', () => {
      // The detail view is the only way back to a title that has left the
      // catalog, and T020 puts Remove here. A visitor who reached this state
      // must be able to leave it.
      build('gone');

      expect(root.querySelector('a[href="/watchlist"]')).not.toBeNull();
    });
  });

  describe('changing a rating (FR-004, FR-005, FR-006, US2 scenario 1)', () => {
    function saveRating(titleId: string, state: InteractionState): void {
      localStorage.setItem(
        INTERACTION_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          interactions: { [titleId]: { state, updatedAt: '2026-09-26T10:00:00.000Z' } },
          history: [],
          updatedAt: '2026-09-26T10:00:00.000Z',
        }),
      );
    }

    function savedInteractions(): Record<string, Interaction> {
      const raw = localStorage.getItem(INTERACTION_STORAGE_KEY);
      if (raw === null) return {};
      return (JSON.parse(raw) as { interactions: Record<string, Interaction> }).interactions;
    }

    function savedState(titleId: string): InteractionState | undefined {
      return savedInteractions()[titleId]?.state;
    }

    /** The five, in the order they are offered. */
    function ratingButtons(): HTMLButtonElement[] {
      return [...root.querySelectorAll('[data-rating]')] as HTMLButtonElement[];
    }

    function offeredStates(): string[] {
      return ratingButtons().map((button) => button.getAttribute('data-rating') ?? '');
    }

    function choose(state: InteractionState): void {
      const control = ratingButtons().find(
        (button) => button.getAttribute('data-rating') === state,
      );
      if (!control) throw new Error(`No control offering "${state}"`);
      control.click();
      fixture.detectChanges();
    }

    function removeControl(): HTMLButtonElement {
      const control = root.querySelector('[data-action="remove"]');
      if (!(control instanceof HTMLButtonElement)) throw new Error('No Remove action');
      return control;
    }

    function tapRemove(): void {
      removeControl().click();
      fixture.detectChanges();
    }

    it('offers exactly the five ratings a card offers, in the same order', () => {
      saveRating('arrival', 'liked');

      build('arrival');

      expect(offeredStates()).toEqual(RATING_ACTIONS.map((action) => action.state));
    });

    it('does not offer Watch Now as a sixth choice', () => {
      // FR-004: `watchingNow` is the deck's Watch Now action alone, and its
      // label is a verb. A button reading "Watch Now" beside five ratings reads
      // as a sixth rating — and it would put a title in the watching history
      // that was never locked in (research.md D6).
      saveRating('arrival', 'liked');

      build('arrival');

      // The count first: "no control offers `watchingNow`" is also true of a
      // control with no controls in it, which is what this test would otherwise
      // be asserting before the markup existed.
      expect(offeredStates()).toHaveLength(5);
      expect(offeredStates()).not.toContain('watchingNow');
      expect(ratingButtons().map((button) => button.textContent?.trim())).not.toContain('Watch Now');
    });

    it('records the state that was chosen', () => {
      saveRating('arrival', 'liked');
      build('arrival');

      choose('loved');

      expect(savedState('arrival')).toBe('loved');
    });

    it('replaces the previous rating rather than adding a second one', () => {
      // One rating per title, structurally: `interactions` is keyed by title id
      // (FR-006). A re-rate that appended would leave the old state reachable
      // by nothing and visible in nothing.
      saveRating('arrival', 'liked');
      build('arrival');

      choose('wantToWatch');

      expect(Object.keys(savedInteractions())).toEqual(['arrival']);
      expect(savedState('arrival')).toBe('wantToWatch');
    });

    it('moves the entry to the tab its new state belongs to', () => {
      // The composition, asserted at the seam these two halves share: this
      // control writes the state, and `surfaceFor` puts a state on exactly one
      // surface (proven in `entries.spec.ts`, and through the DOM by the
      // watchlist's own tab tests). A third, slower test mounting both
      // components would assert the same three facts again.
      saveRating('arrival', 'disliked');
      build('arrival');

      choose('loved');

      expect(surfaceFor(savedState('arrival') as InteractionState)).toBe('loved');
    });

    it('says which of the five the title currently is', () => {
      saveRating('arrival', 'liked');

      build('arrival');

      // Scoped to the indicator: the `Liked It` button says the same words, so
      // an unscoped assertion would pass without an indicator existing at all.
      expect(root.querySelector('[data-current]')?.textContent).toContain('Liked It');
    });

    it('does not restate a watched title as one of the five', () => {
      // A history entry opens here (research.md D9), and a `watchingNow` title
      // has no label that is a state rather than a verb — `INTERACTION_STATE_LABELS`
      // offers only "Watch Now". Saying nothing is truer than saying that, and
      // the history row already said it.
      saveRating('arrival', 'watchingNow');
      build('arrival');
      const showsForWatched = root.querySelector('[data-current]') !== null;

      // The other half, in the same test: "no indicator for a watched title" is
      // also true of a view with no indicator at all, so the rated case has to
      // be shown working or this proves nothing.
      saveRating('arrival', 'liked');
      TestBed.resetTestingModule();
      build('arrival');
      const showsForRated = root.querySelector('[data-current]') !== null;

      expect(showsForRated).toBe(true);
      expect(showsForWatched).toBe(false);
    });

    it('keeps Remove out of the five, because "no rating" is not a sixth rating', () => {
      // FR-005, research.md D6. Folding it in would make the control offer six
      // equally-weighted answers to a question with five.
      saveRating('arrival', 'liked');

      build('arrival');

      expect(offeredStates()).toEqual(RATING_ACTIONS.map((action) => action.state));
      expect(removeControl().hasAttribute('data-rating')).toBe(false);
    });

    it('deletes the rating when Remove is used', () => {
      saveRating('arrival', 'liked');
      build('arrival');

      tapRemove();

      expect(savedInteractions()['arrival']).toBeUndefined();
    });

    it('leaves the other ratings alone', () => {
      saveRating('arrival', 'liked');
      // A second rating, written straight over the first so both are present.
      const existing = JSON.parse(localStorage.getItem(INTERACTION_STORAGE_KEY) as string);
      existing.interactions['parasite'] = {
        state: 'disliked',
        updatedAt: '2026-09-26T10:00:00.000Z',
      };
      localStorage.setItem(INTERACTION_STORAGE_KEY, JSON.stringify(existing));

      build('arrival');
      tapRemove();

      expect(savedState('parasite')).toBe('disliked');
    });

    it('leaves the watching history standing', () => {
      // FR-008: the log records what happened, not what the visitor currently
      // thinks. The store's spec proves this where the delete happens; this
      // proves the screen a visitor actually uses reaches it by that route and
      // not some other one.
      localStorage.setItem(
        INTERACTION_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          interactions: { arrival: { state: 'liked', updatedAt: '2026-09-26T10:00:00.000Z' } },
          history: [{ titleId: 'arrival', chosenAt: '2026-09-25T20:00:00.000Z' }],
          updatedAt: '2026-09-26T10:00:00.000Z',
        }),
      );

      build('arrival');
      tapRemove();

      const stored = JSON.parse(localStorage.getItem(INTERACTION_STORAGE_KEY) as string);
      expect(stored.history).toEqual([
        { titleId: 'arrival', chosenAt: '2026-09-25T20:00:00.000Z' },
      ]);
    });
  });

  describe('what a change here does to the deck (FR-007, US2 scenarios 3 and 4)', () => {
    function quizState(): QuizState {
      return {
        schemaVersion: 1,
        status: 'completed',
        step: 3,
        mediaType: { values: ['movie'], any: false },
        genre: { values: ['horror'], any: false },
        provider: { values: ['netflix'], any: false },
        includeUnownedProviders: false,
        completedAt: COMPLETED_AT,
        updatedAt: COMPLETED_AT,
      };
    }

    /**
     * A brand-new deck, as if the app had been relaunched.
     *
     * **The loop document is discarded first**, and that is not tidiness. With
     * it intact, `shownTitleIds` would keep a rejected title away whether or not
     * the ratings were ever read — which is how 002's T033 passed for the wrong
     * reason on its first attempt. Discarding it is also the realistic case: the
     * loop is throwaway and "start a new loop" empties it.
     *
     * **The module is reset** because the stores are root singletons carrying a
     * memory fallback; a plain rebuild would hand the "new" deck the old state.
     */
    function openDeck(): HTMLElement {
      localStorage.removeItem(DECK_SESSION_STORAGE_KEY);
      TestBed.resetTestingModule();
      configure();
      TestBed.inject(PreferenceStore).write(quizState());

      const deck = TestBed.createComponent(Deck);
      deck.detectChanges();
      return deck.nativeElement as HTMLElement;
    }

    /** The title on the card, which is the deck's whole state. */
    function firstCard(screen: HTMLElement): string {
      return screen.querySelector('app-card h2')?.textContent?.trim() ?? '';
    }

    function reRate(state: InteractionState): void {
      const control = [...root.querySelectorAll('[data-rating]')].find(
        (candidate) => candidate.getAttribute('data-rating') === state,
      );
      if (!(control instanceof HTMLButtonElement)) throw new Error(`No control for "${state}"`);

      control.click();
      fixture.detectChanges();
    }

    beforeEach(() => setCatalog(DECK_CATALOG));

    it('makes a title eligible again once it is re-rated away from Disliked', () => {
      // US2 scenario 3 / FR-007, and the reason a mis-tapped Dislike is no
      // longer permanent. `disliked` is one of only two excluding states, so
      // changing it to any of the other four brings the title back.
      localStorage.setItem(
        INTERACTION_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          interactions: { alpha: { state: 'disliked', updatedAt: '2026-09-26T10:00:00.000Z' } },
          history: [],
          updatedAt: '2026-09-26T10:00:00.000Z',
        }),
      );

      build('alpha');
      reRate('loved');

      expect(firstCard(openDeck())).toBe('Alpha');
    });

    it('keeps a title out of the deck once it is rated Disliked from here', () => {
      // US2 scenario 4 / SC-002. The first assertion is the control: without it
      // this could pass because the deck never showed Alpha for some unrelated
      // reason, and a title that was never there staying away proves nothing.
      expect(firstCard(openDeck())).toBe('Alpha');

      // The module is live by now, and `build` configures it — so this test
      // resets between its two apps rather than letting the second one inherit
      // the first one's injector. Two genuinely separate launches, which is
      // also what makes the last assertion a cold-start read of the document
      // the rating was written to.
      TestBed.resetTestingModule();
      build('alpha');
      reRate('disliked');

      expect(firstCard(openDeck())).toBe('Bravo');
    });
  });

  describe('reaching it from the route table', () => {
    /**
     * The real route table, because what is being checked is the *pairing* of
     * this component with its address — and a pairing needs both halves named
     * in one place. `withComponentInputBinding()` matters here as much as the
     * path does: without it the id would never reach the input.
     */
    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes, withComponentInputBinding()),
          { provide: CatalogService, useValue: new FakeCatalogService() },
        ],
      });
    });

    async function visit(url: string): Promise<HTMLElement> {
      const harness = await RouterTestingHarness.create(url);
      return harness.fixture.nativeElement as HTMLElement;
    }

    it('is what /watchlist/title/:titleId resolves to', async () => {
      const screen = await visit('/watchlist/title/arrival');

      expect(screen.querySelector('app-detail')).not.toBeNull();
    });

    it('binds the id from the path, not from navigation state', async () => {
      // Nothing navigates here with a `titleId` in hand — the address is the
      // only carrier, which is what makes the back button and a refresh land on
      // the same view (research.md D10).
      const screen = await visit('/watchlist/title/parasite');

      expect(screen.textContent).toContain('Parasite');
      expect(screen.textContent).not.toContain('Arrival');
    });
  });
});
