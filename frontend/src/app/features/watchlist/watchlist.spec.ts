import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, of } from 'rxjs';
import { routes } from '../../app.routes';
import { InteractionState, INTERACTION_STORAGE_KEY } from '../../core/models/interaction';
import { MediaTitle } from '../../core/models/media-title';
import { CatalogService } from '../../core/services/catalog.service';
import { Connectivity } from '../../core/services/connectivity';
import { Watchlist } from './watchlist';

/**
 * The tabbed watchlist (US1), driven through the DOM against the real
 * `InteractionStore` and a fixture catalog.
 *
 * The fixture holds one title per state, so "which tab did it land in" is a
 * question with exactly one right answer per title. Two of the six states share
 * a tab by design (FR-001), and the tests covering those are the ones worth
 * reading: a merged tab whose rows stopped carrying their own labels would sail
 * past any test that only counted rows. So those assertions look for a string
 * **only a row can supply** — `Liked It` and `Not Interested` are not tab
 * names, and no tab strip can produce them.
 */

function title(id: string, name: string, providerId = 'netflix'): MediaTitle {
  return {
    id,
    title: name,
    releaseYear: 2020,
    mediaType: 'movie',
    genres: ['horror'],
    synopsis: 'Filler.',
    rating: 8,
    voteCount: 1000,
    posterUrl: `/posters/${id}.svg`,
    availability: [{ providerId, deepLinkUrl: `https://example.test/${id}` }],
  };
}

/** One title per state, plus a second Loved one so no tab is a single row. */
const CATALOG: MediaTitle[] = [
  title('t-want', 'Wanted'),
  title('t-loved', 'Adored'),
  title('t-liked', 'Enjoyed'),
  title('t-disliked', 'Rejected'),
  title('t-not-interested', 'Ignored'),
  title('t-watching', 'Watching'),
  title('t-hulu', 'Only On Hulu', 'hulu'),
];

class FakeCatalogService {
  /** Flips the fallback on for the notice tests; declared first so it exists. */
  readonly fellBack = signal(false);

  /** A signal, like the real one — templates read it as `usingCachedTitles()`. */
  readonly usingCachedTitles = this.fellBack.asReadonly();

  loadTitles(_region: string): Observable<MediaTitle[]> {
    return of(CATALOG.map((candidate) => ({ ...candidate })));
  }
}

/** The connection, supplied rather than read from `navigator.onLine`. */
class FakeConnectivity {
  readonly isOffline = signal(false);
}

/** The ratings the tests start from, covering all six states. */
const RATINGS: Record<string, InteractionState> = {
  't-want': 'wantToWatch',
  't-loved': 'loved',
  't-liked': 'liked',
  't-disliked': 'disliked',
  't-not-interested': 'notInterested',
  't-watching': 'watchingNow',
  't-hulu': 'loved',
};

describe('watchlist', () => {
  let fixture: ComponentFixture<Watchlist>;
  let root: HTMLElement;
  let catalogService: FakeCatalogService;
  let connectivity: FakeConnectivity;

  /** Writes a document the way the deck writes it, straight to LocalStorage. */
  function saveRatings(ratings: Record<string, InteractionState>): void {
    localStorage.setItem(
      INTERACTION_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        interactions: Object.fromEntries(
          Object.entries(ratings).map(([titleId, state], index) => [
            titleId,
            { state, updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString() },
          ]),
        ),
        history: [],
        updatedAt: '2026-09-26T10:00:00.000Z',
      }),
    );
  }

  /**
   * Configures the module and builds the view.
   *
   * Configuration lives here rather than in `beforeEach` so that a test can
   * reset the module and build a second, genuinely fresh instance — a fresh
   * injector, and therefore a store with nothing in memory. That is the only
   * way to tell "reads the saved document" apart from "remembers what it read
   * the first time".
   */
  function build(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CatalogService, useValue: catalogService },
        { provide: Connectivity, useValue: connectivity },
      ],
    });

    fixture = TestBed.createComponent(Watchlist);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  function tabs(): HTMLButtonElement[] {
    return [...root.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
  }

  function tabNamed(label: string): HTMLButtonElement {
    const tab = tabs().find((candidate) => candidate.textContent?.includes(label));
    if (!tab) throw new Error(`No tab named "${label}" — got ${tabs().length}`);
    return tab;
  }

  function openTab(label: string): void {
    tabNamed(label).click();
    fixture.detectChanges();
  }

  /** The rows currently rendered, by the address each one opens. */
  function rows(): string[] {
    return renderedRows().map((row) => row.querySelector('a')?.getAttribute('href') ?? '');
  }

  /** What each rendered row says, one string per row. */
  function rowTexts(): string[] {
    return renderedRows().map((row) => row.textContent ?? '');
  }

  function renderedRows(): Element[] {
    return [...root.querySelectorAll('app-entry')];
  }

  beforeEach(() => {
    localStorage.clear();
    saveRatings(RATINGS);
    catalogService = new FakeCatalogService();
    connectivity = new FakeConnectivity();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  describe('the tabs (FR-001)', () => {
    it('offers three tabs, in the order the table declares them', () => {
      build();

      expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
        expect.stringContaining('Want to Watch'),
        expect.stringContaining('Loved'),
        expect.stringContaining('Disliked'),
      ]);
    });

    it('opens on Want to Watch', () => {
      build();

      expect(rows()).toEqual(['/watchlist/title/t-want']);
    });

    it('counts each tab’s entries, so an empty tab is visible before it is opened', () => {
      // The count is its list's length, derived from the same grouping the list
      // renders (data-model.md), so it cannot disagree with what is beneath it.
      build();

      expect(tabNamed('Want to Watch').textContent).toContain('1');
      expect(tabNamed('Loved').textContent).toContain('3');
      expect(tabNamed('Disliked').textContent).toContain('2');
    });
  });

  describe('where each rating lands (US1 scenarios 1 and 2)', () => {
    it('puts Want to Watch under its own tab', () => {
      build();

      openTab('Want to Watch');

      expect(rows()).toEqual(['/watchlist/title/t-want']);
    });

    it('puts Loved and Liked together under Loved', () => {
      build();

      openTab('Loved');

      expect(rows().sort()).toEqual(
        ['/watchlist/title/t-hulu', '/watchlist/title/t-liked', '/watchlist/title/t-loved'].sort(),
      );
    });

    it('puts Disliked and Not Interested together under Disliked', () => {
      build();

      openTab('Disliked');

      expect(rows().sort()).toEqual(
        ['/watchlist/title/t-disliked', '/watchlist/title/t-not-interested'].sort(),
      );
    });

    it('gives each row in a merged tab its own label, so the tab is never ambiguous', () => {
      // `Liked It` is not a tab name and no tab strip can produce it, so this
      // passing at all is proof the row is labelling itself (FR-001).
      build();

      openTab('Loved');

      expect(rowTexts().some((row) => row.includes('Loved It'))).toBe(true);
      expect(rowTexts().some((row) => row.includes('Liked It'))).toBe(true);
    });

    it('labels a Not Interested row as itself under Disliked', () => {
      // The 2026-09-26 clarification put `notInterested` under Disliked. Without
      // the row's own label it would be indistinguishable from a dislike.
      build();

      openTab('Disliked');

      expect(rowTexts().some((row) => row.includes('Not Interested'))).toBe(true);
    });

    it('keeps Watching Now out of every tab', () => {
      // FR-004: it is set only by the deck's Watch Now action, and its surface
      // is the history — a separate destination rather than a fourth tab
      // (research.md D3). US3 builds it.
      build();

      for (const label of ['Want to Watch', 'Loved', 'Disliked']) {
        openTab(label);
        expect(rows()).not.toContain('/watchlist/title/t-watching');
      }
    });
  });

  describe('what a row carries (FR-002)', () => {
    it('shows poster, title, year, state and availability', () => {
      build();

      openTab('Loved');

      expect(root.querySelectorAll('app-poster').length).toBeGreaterThan(0);
      expect(text()).toContain('Adored');
      expect(text()).toContain('2020');
      expect(text()).toContain('Loved It');
      expect(text()).toContain('Netflix');
      expect(text()).toContain('Hulu');
    });
  });

  describe('surviving a refresh (FR-009, US1 scenario 4)', () => {
    it('reads the saved document when it is built, not once at some earlier time', () => {
      build();
      openTab('Disliked');
      expect(rows()).toHaveLength(2);

      // A different document, and a fresh injector — as if the app had been
      // closed, more titles rated, and it launched again.
      saveRatings({ ...RATINGS, 't-extra': 'disliked' });
      TestBed.resetTestingModule();
      build();

      openTab('Disliked');
      expect(rows()).toHaveLength(3);
    });

    it('counts from the saved document too, not from the tab that is open', () => {
      // Every tab's count is derived from the whole document at construction,
      // so it is right before the tab has ever been looked at.
      saveRatings({ 't-loved': 'loved', 't-disliked': 'disliked' });

      build();

      expect(tabNamed('Loved').textContent).toContain('1');
      expect(tabNamed('Disliked').textContent).toContain('1');
    });
  });

  describe('an empty tab (FR-010)', () => {
    it('invites the visitor to rate cards rather than showing a blank panel', () => {
      // "Never a dead end" applies to a screen with nothing on it as much as to
      // one with a broken control.
      saveRatings({ 't-loved': 'loved' });

      build();
      openTab('Want to Watch');

      expect(rows()).toEqual([]);
      expect(text().toLowerCase()).toContain('deck');
    });

    it('offers the way there rather than only naming it', () => {
      saveRatings({ 't-loved': 'loved' });

      build();
      openTab('Want to Watch');

      expect(root.querySelector('a[href="/deck"]')).not.toBeNull();
    });

    it('says the same thing when the visitor has rated nothing at all', () => {
      saveRatings({});

      build();

      expect(rows()).toEqual([]);
      expect(text().toLowerCase()).toContain('deck');
    });

    it('still offers the tabs, so an empty list is not an empty screen', () => {
      saveRatings({});

      build();

      expect(tabs()).toHaveLength(3);
    });
  });

  describe('when the app is degraded (FR-012)', () => {
    it('keeps the saved list viewable and says why it is offline', () => {
      // FR-012 is two requirements in one sentence, and the order matters:
      // the list staying viewable is the point, the notice is the explanation.
      // A notice that replaced the list would satisfy the wording and lose the
      // requirement.
      connectivity.isOffline.set(true);

      build();

      expect(rows()).toHaveLength(1);
      expect(text()).toContain("You're offline");
    });

    it('says nothing about being offline when it is not', () => {
      // The other half, or the notice above proves only that some text renders.
      build();

      expect(text()).not.toContain("You're offline");
    });

    it('explains a catalog that came from the cache', () => {
      // Not the same condition as being offline: this is a request that failed
      // while the device is connected. The deck already says so, and the
      // watchlist reads the same catalog — a title falling back to cached data
      // here without a word would be the same event reported two ways.
      catalogService.fellBack.set(true);

      build();

      expect(text().toLowerCase()).toContain('saved results');
    });

    it('reports both when both are true, rather than inventing a precedence', () => {
      // Offline implies the fetch failed, so in practice these arrive together
      // and the cached-results line reads as the offline line restated. The
      // deck already ships that redundancy, and suppressing it here would mean
      // two screens explaining the same pair of conditions by different rules —
      // a divergence that costs more to keep in step than the line costs to
      // read. Recorded as a known cosmetic wart rather than fixed by halves.
      catalogService.fellBack.set(true);
      connectivity.isOffline.set(true);

      build();

      expect(text()).toContain("You're offline");
      expect(text().toLowerCase()).toContain('saved results');
    });
  });

  describe('the way to the watching history (US3, FR-003)', () => {
    // `watchingNow` is in no tab (FR-004), so the history is the only place a
    // locked-in title is listed — and this link is the only way to it, because
    // the nav is deliberately two destinations. A state that is stored, listed
    // and unreachable is a dead end with extra steps.
    it('offers it from the watchlist, which is where the nav expects it to be reached from', () => {
      build();

      expect(root.querySelector('a[href="/watchlist/history"]')).not.toBeNull();
    });

    it('offers it even when every tab is empty', () => {
      // The visitor who just tapped Watch Now in the deck has a history and no
      // ratings at all, so the empty watchlist is exactly the screen they land
      // on — and the one that must not hide their history from them.
      saveRatings({});

      build();

      expect(root.querySelector('a[href="/watchlist/history"]')).not.toBeNull();
    });
  });

  describe('reaching it from the route table', () => {
    // The nav's link to `/watchlist` is asserted in `shell.spec.ts`; that the
    // link *arrives* is asserted here. A nav entry pointing at a path with no
    // route is a tap that silently lands somewhere else — the dead end
    // constitution II forbids, wearing a working link.
    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes),
          { provide: CatalogService, useValue: new FakeCatalogService() },
        ],
      });
    });

    it('is what /watchlist resolves to, inside the shell', async () => {
      const harness = await RouterTestingHarness.create('/watchlist');
      const screen = harness.fixture.nativeElement as HTMLElement;

      expect(screen.querySelector('app-watchlist')).not.toBeNull();
      expect(screen.querySelector('nav')).not.toBeNull();
    });

    it('shows the visitor’s own ratings when it arrives there', async () => {
      const harness = await RouterTestingHarness.create('/watchlist');
      const screen = harness.fixture.nativeElement as HTMLElement;

      expect(screen.querySelector('a[href="/watchlist/title/t-want"]')).not.toBeNull();
      expect(screen.textContent).toContain('Wanted');
    });
  });
});
