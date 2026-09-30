import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { DECK_SESSION_STORAGE_KEY } from '../../../core/models/deck-session';
import { MediaTitle } from '../../../core/models/media-title';
import { QuizState } from '../../../core/models/quiz';
import { SESSION_SCHEMA_VERSION, SESSION_STORAGE_KEY } from '../../../core/models/session';
import { CatalogService } from '../../../core/services/catalog.service';
import { DeckSessionStore } from '../../../core/services/deck-session-store';
import { InteractionStore } from '../../../core/services/interaction-store';
import { PreferenceStore } from '../../../core/services/preference-store';
import { ACCOUNT_NUDGE_STORAGE_KEY } from './account-nudge';
import { MatchFound } from './match-found';

/**
 * The Match Found view: the payoff screen, and the only place in the product
 * that sends the visitor somewhere else to watch something.
 *
 * Two things are worth proving here rather than assuming. The first is that the
 * view is **resolved from the URL**, not from state handed over by the deck:
 * that is what makes the browser's back button and a mid-decision refresh work
 * (research.md D10), and it is only observable by building the component with
 * nothing but an id. The second is that the trailer is a **link and nothing
 * more** — FR-008 forbids third-party player code on the page, and the way that
 * requirement is normally broken is by embedding a player "just for the
 * trailer".
 */

const TRAILER_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** Two providers, so "a link for each service" is a statement about all of them. */
const WITH_TRAILER: MediaTitle = {
  id: 't0',
  title: 'Alpha',
  releaseYear: 2020,
  mediaType: 'movie',
  genres: ['horror'],
  synopsis: 'The first one.',
  rating: 8,
  voteCount: 1000,
  trailerUrl: TRAILER_URL,
  availability: [
    { providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/1' },
    { providerId: 'max', deepLinkUrl: 'https://www.max.com/title/1' },
  ],
};

/** The US2 scenario 4 case: no trailer at all. */
const WITHOUT_TRAILER: MediaTitle = {
  ...WITH_TRAILER,
  id: 't1',
  title: 'Bravo',
  trailerUrl: undefined,
  availability: [{ providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/2' }],
};

const CATALOG: MediaTitle[] = [WITH_TRAILER, WITHOUT_TRAILER];

const COMPLETED_AT = '2026-09-26T10:00:00.000Z';

/** A finished quiz, answered Movie + Horror + Netflix. */
function completedQuiz(): QuizState {
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

class FakeCatalogService {
  loadTitles(_region: string): Observable<MediaTitle[]> {
    return of(CATALOG.map((title) => ({ ...title })));
  }
}

describe('match found', () => {
  let fixture: ComponentFixture<MatchFound>;
  let root: HTMLElement;
  let interactions: InteractionStore;

  /** Opens the view for a title id, the way the route does. */
  function build(titleId: string): void {
    fixture = TestBed.createComponent(MatchFound);
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('titleId', titleId);
    fixture.detectChanges();
  }

  /** A session marker, written the way a successful sign-in writes it. */
  function signIn(): void {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SESSION_SCHEMA_VERSION,
        userId: '0e7d2c41-9f3a-4b8e-a1c6-5d0f9e2b3a11',
        email: 'visitor@example.com',
        signedInAt: '2026-09-27T10:00:00.000Z',
      }),
    );
  }

  /** The account nudge, or null when this visit is not being offered one. */
  function nudge(): HTMLElement | null {
    return root.querySelector('[data-account-nudge]');
  }

  /** Dismisses the nudge the way a visitor does, through its own control. */
  function dismiss(): void {
    const button = [...(nudge()?.querySelectorAll('button') ?? [])].find((candidate) =>
      /dismiss/i.test(candidate.getAttribute('aria-label') ?? candidate.textContent ?? ''),
    );

    if (!button) throw new Error('The nudge has no dismiss control');

    button.click();
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  function links(): HTMLAnchorElement[] {
    return [...root.querySelectorAll('a')] as HTMLAnchorElement[];
  }

  /** The anchor whose visible text names `label` — a provider, or the trailer. */
  function linkNamed(label: string): HTMLAnchorElement | undefined {
    return links().find((anchor) => anchor.textContent?.trim() === label);
  }

  function tap(label: string): void {
    const button = [...root.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`No button labelled "${label}"`);
    button.click();
    fixture.detectChanges();
  }

  function savedSession(): Record<string, unknown> | null {
    const raw = localStorage.getItem(DECK_SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  beforeEach(() => {
    localStorage.clear();
    // The nudge's dismissal lives here, and jsdom reuses one storage area
    // across the tests in a file — left alone, one test's dismissal would be
    // the next test's starting condition.
    sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        // Both destinations are stubbed: an unmatched URL must never be the
        // reason a navigation assertion passes or fails.
        provideRouter([
          { path: 'deck', children: [] },
          { path: 'quiz', children: [] },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CatalogService, useValue: new FakeCatalogService() },
      ],
    });

    // The component now reads the session, which means it reaches `AuthService`
    // and therefore `HttpClient`. A signed-out test never sends anything; the
    // provider is here because injection is not lazy.
    interactions = TestBed.inject(InteractionStore);
  });

  describe('the ways to watch (FR-008, US2 scenario 3)', () => {
    it('links to every service the title is available on', () => {
      build('t0');

      expect(linkNamed('Netflix')?.getAttribute('href')).toBe('https://www.netflix.com/title/1');
      expect(linkNamed('HBO Max')?.getAttribute('href')).toBe('https://www.max.com/title/1');
    });

    it('names the title the visitor chose', () => {
      build('t0');

      expect(text()).toContain('Alpha');
    });

    it('keeps the visitor in the app, because an installed PWA has no back button', () => {
      // Every one of these links leaves playnext.com. In a standalone PWA there
      // is no browser chrome and therefore no way back, so a same-tab
      // navigation would strand the visitor on Netflix with their deck gone
      // (constitution II).
      build('t0');

      for (const anchor of links()) {
        expect(anchor.getAttribute('target')).toBe('_blank');
        expect(anchor.getAttribute('rel')).toContain('noopener');
      }
    });

    it('sends the visitor to the official service, not through us', () => {
      // PlayNext hosts nothing (FR-008): every link is the provider's own URL,
      // so a redirect or an interstitial here would be a bug, not a nicety.
      build('t0');

      for (const anchor of links()) {
        expect(anchor.getAttribute('href')).toMatch(/^https:\/\//);
      }
    });
  });

  describe('the trailer (FR-008)', () => {
    it('opens in a new tab when a trailer exists', () => {
      build('t0');

      const trailer = linkNamed('Watch trailer');

      expect(trailer?.getAttribute('href')).toBe(TRAILER_URL);
      expect(trailer?.getAttribute('target')).toBe('_blank');
    });

    it('severs the opener so the trailer cannot reach back into the app', () => {
      build('t0');

      expect(linkNamed('Watch trailer')?.getAttribute('rel')).toContain('noopener');
    });

    it('is absent, not broken, when the title has no trailer (US2 scenario 4)', () => {
      build('t1');

      expect(linkNamed('Watch trailer')).toBeUndefined();
      // The rest of the view is untouched — this is the scenario's whole point.
      expect(linkNamed('Netflix')?.getAttribute('href')).toBe('https://www.netflix.com/title/2');
      expect(text()).toContain('Bravo');
    });

    it('loads no third-party player code (FR-008)', () => {
      // The requirement is about what is *not* on the page. Embedding a player
      // for the trailer is the usual way this gets violated, and every way of
      // doing that needs one of these elements.
      build('t0');

      for (const element of ['iframe', 'video', 'embed', 'object']) {
        expect(root.querySelector(element)).toBeNull();
      }
    });
  });

  describe('starting over', () => {
    it('offers a way back into the deck', () => {
      build('t0');

      expect(() => tap('Start a new loop')).not.toThrow();
    });

    it('clears the finished loop, so the next visit starts fresh (FR-009)', () => {
      localStorage.setItem(
        DECK_SESSION_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          shownTitleIds: ['t0', 't1'],
          updatedAt: '2026-09-26T10:00:00.000Z',
        }),
      );
      build('t0');

      tap('Start a new loop');

      expect(savedSession()?.['shownTitleIds']).toEqual([]);
    });

    it('returns the visitor to the deck', () => {
      build('t0');
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      tap('Start a new loop');

      expect(navigate).toHaveBeenCalledExactlyOnceWith(['/deck']);
    });
  });

  describe('changing preferences (FR-014)', () => {
    // The same transition the empty state performs, offered from a second place.
    // The question — "where do I change my preferences?" — arrives on this
    // screen too, and this is the screen where a visitor has just been handed a
    // title and may want to say "not like this". Making them walk the whole deck
    // to the empty state to say it would be the app hiding its own front door.
    //
    // Tested through the real `PreferenceStore` rather than a spy, for the same
    // reason the empty state is: what matters is that the document left behind
    // is one `/quiz` can actually reopen, not that some method was called.
    beforeEach(() => {
      TestBed.inject(PreferenceStore).write(completedQuiz());
    });

    it('is offered in both states, because neither is a dead end', () => {
      // Constitution II. The two branches are different screens as far as the
      // visitor is concerned — one has a title, one does not — and both have to
      // end in something pressable.
      build('t0');
      expect(() => tap('Preferences')).not.toThrow();

      build('t-does-not-exist');
      expect(() => tap('Preferences')).not.toThrow();
    });

    it('reopens the quiz at the beginning, no longer completed', () => {
      build('t0');

      tap('Preferences');

      const reopened = TestBed.inject(PreferenceStore).read();
      expect(reopened?.status).toBe('in-progress');
      expect(reopened?.step).toBe(1);
      // `toPreference` gates on this: while it is set, the deck would keep
      // treating the retake as finished and never show the quiz.
      expect(reopened?.completedAt).toBeUndefined();
    });

    it('keeps every answer, so the visitor is re-aiming rather than starting over', () => {
      build('t0');

      tap('Preferences');

      const reopened = TestBed.inject(PreferenceStore).read();
      expect(reopened?.mediaType).toEqual({ values: ['movie'], any: false });
      expect(reopened?.genre).toEqual({ values: ['horror'], any: false });
      expect(reopened?.provider).toEqual({ values: ['netflix'], any: false });
    });

    it('hands the visitor to the quiz', () => {
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      build('t0');
      tap('Preferences');

      expect(navigate).toHaveBeenCalledExactlyOnceWith(['/quiz']);
    });

    it('leaves the finished loop where it is', () => {
      // Starting a new loop and re-aiming are different errands. This one hands
      // the visitor to `/quiz`, and `loopFor` starts a fresh loop on its own
      // once the retake is completed — a stamp the quiz writes, not this view.
      TestBed.inject(DeckSessionStore).write({
        schemaVersion: 1,
        startedAt: '2026-09-26T09:00:00.000Z',
        shownTitleIds: ['t0', 't1'],
      });

      build('t0');
      tap('Preferences');

      expect(savedSession()?.['shownTitleIds']).toEqual(['t0', 't1']);
    });
  });

  describe('changing preferences on a device with no saved quiz', () => {
    // Its own block, and deliberately *not* inside the one above: that one seeds
    // a completed quiz, and `PreferenceStore` keeps an in-memory copy of every
    // write, so a `localStorage.clear()` there would still read back the seeded
    // document and the test would prove nothing.
    //
    // The case is reachable because this view resolves from the URL alone
    // (research.md D10): a visitor with a cleared device, or a link opened on a
    // new one, lands here with nothing to reopen. There is nothing to pre-fill
    // and nothing worth writing — but a screen whose only exit is a new loop
    // would be the dead end the spec forbids, so the door still opens.
    it('opens the quiz anyway, and writes no document it would have to invent', () => {
      const preferences = TestBed.inject(PreferenceStore);
      expect(preferences.read()).toBeNull();

      build('t0');

      expect(() => tap('Preferences')).not.toThrow();
      expect(preferences.read()).toBeNull();
    });
  });

  describe('the account nudge (US1 scenario 5, FR-001)', () => {
    // The nudge is scoped to a Watch Now lock-in, so this view has to know one
    // happened. It reads that from the interaction document rather than from
    // navigation state, for the same reason everything else here is resolved
    // from the URL (research.md D10): a mid-decision refresh has to land on the
    // same screen, nudge included.
    it('offers account creation after a Watch Now lock-in', () => {
      interactions.recordWatch('t0');

      build('t0');

      expect(nudge()).not.toBeNull();
      expect(nudge()?.querySelector('a[href="/profile"]')).not.toBeNull();
      expect(root.querySelectorAll('[data-account-nudge]')).toHaveLength(1);
    });

    it('stays away from a title the visitor only rated', () => {
      // The negative half, without which the test above proves only that some
      // markup renders. FR-001 attaches the nudge to the lock-in, not to
      // arriving here.
      interactions.record('t0', 'loved');

      build('t0');

      expect(nudge()).toBeNull();
    });

    it('is not offered to someone who already has an account', () => {
      // Advertising account creation to a signed-in visitor is the app not
      // knowing who it is talking to.
      signIn();
      interactions.recordWatch('t0');

      build('t0');

      expect(nudge()).toBeNull();
    });

    it('can be dismissed', () => {
      interactions.recordWatch('t0');
      build('t0');
      expect(nudge()).not.toBeNull();

      dismiss();

      expect(nudge()).toBeNull();
    });

    it('stays dismissed for the rest of the session', () => {
      // The spec's edge case, and the reason the dismissal is written to
      // storage at all: a reload mid-session must not start the pitch over.
      interactions.recordWatch('t0');
      build('t0');
      dismiss();

      build('t0');

      expect(nudge()).toBeNull();
    });

    it('remembers the dismissal in sessionStorage, not LocalStorage (research D11)', () => {
      // "The rest of the session" is what sessionStorage means exactly — a
      // reload keeps it, tomorrow does not. LocalStorage would make one tap a
      // permanent setting.
      interactions.recordWatch('t0');
      build('t0');
      dismiss();

      expect(sessionStorage.getItem(ACCOUNT_NUDGE_STORAGE_KEY)).not.toBeNull();
      expect(localStorage.getItem(ACCOUNT_NUDGE_STORAGE_KEY)).toBeNull();
    });

    it('offers itself again in a new session', () => {
      // The other half of the storage choice: if this failed, LocalStorage
      // would pass every test above it.
      interactions.recordWatch('t0');
      build('t0');
      dismiss();
      sessionStorage.clear();

      build('t0');

      expect(nudge()).not.toBeNull();
    });

    it('never blocks Start a new loop (US1 scenario 5)', () => {
      interactions.recordWatch('t0');
      build('t0');
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      expect(nudge()).not.toBeNull();

      tap('Start a new loop');

      expect(navigate).toHaveBeenCalledExactlyOnceWith(['/deck']);
    });

    it('is an addition to the screen, not a replacement for it', () => {
      // "MUST never block or delay the core loop" (FR-001). A nudge that
      // replaced the ways to watch would satisfy "a nudge appears" and lose the
      // screen the visitor just earned.
      interactions.recordWatch('t0');

      build('t0');

      expect(linkNamed('Netflix')).toBeDefined();
      expect(linkNamed('Watch trailer')).toBeDefined();
    });
  });

  describe('resolving the title from the URL (research.md D10)', () => {
    it('shows the title the id names, not some other one', () => {
      build('t1');

      expect(text()).toContain('Bravo');
      expect(text()).not.toContain('Alpha');
    });

    it('renders the same view after a refresh', () => {
      // A reload on this URL gives the component nothing but the id. Rebuilding
      // from scratch with the same input is that refresh.
      build('t0');
      const before = text();

      build('t0');

      expect(text()).toBe(before);
      expect(linkNamed('Netflix')?.getAttribute('href')).toBe('https://www.netflix.com/title/1');
    });

    it('degrades to an unavailable entry for an id the catalog has never heard of', () => {
      // A stale link, or a title retired since it was rated.
      build('t-does-not-exist');

      expect(text()).toContain('no longer available');
      expect(links()).toHaveLength(0);
    });

    it('still offers a way out when the title is unavailable', () => {
      // Constitution II: never a dead end, including the dead ends we did not
      // plan for.
      build('t-does-not-exist');

      expect(() => tap('Start a new loop')).not.toThrow();
    });
  });
});
