import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { DECK_SESSION_STORAGE_KEY } from '../../../core/models/deck-session';
import { MediaTitle } from '../../../core/models/media-title';
import { CatalogService } from '../../../core/services/catalog.service';
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

class FakeCatalogService {
  loadTitles(_region: string): Observable<MediaTitle[]> {
    return of(CATALOG.map((title) => ({ ...title })));
  }
}

describe('match found', () => {
  let fixture: ComponentFixture<MatchFound>;
  let root: HTMLElement;

  /** Opens the view for a title id, the way the route does. */
  function build(titleId: string): void {
    fixture = TestBed.createComponent(MatchFound);
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('titleId', titleId);
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
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'deck', children: [] }]),
        { provide: CatalogService, useValue: new FakeCatalogService() },
      ],
    });
  });

  describe('the ways to watch (FR-008, US2 scenario 3)', () => {
    it('links to every service the title is available on', () => {
      build('t0');

      expect(linkNamed('Netflix')?.getAttribute('href')).toBe('https://www.netflix.com/title/1');
      expect(linkNamed('Max')?.getAttribute('href')).toBe('https://www.max.com/title/1');
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
