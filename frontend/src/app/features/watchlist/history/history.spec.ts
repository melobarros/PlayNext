import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, of } from 'rxjs';
import { routes } from '../../../app.routes';
import {
  INTERACTION_STATE_LABELS,
  INTERACTION_STORAGE_KEY,
  InteractionState,
  RATING_ACTIONS,
} from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { CatalogService } from '../../../core/services/catalog.service';
import { InteractionStore } from '../../../core/services/interaction-store';
import { WatchHistory } from './history';

/**
 * The watching history (US3), driven through the DOM against the real
 * `InteractionStore` and a fixture catalog.
 *
 * This screen exists because `watchingNow` lives in no tab (FR-004), which
 * makes it the only route to a title that was locked in — and therefore the
 * only place its rating could become unreachable. Two properties carry that
 * weight, and both are asserted here rather than assumed: a row opens the
 * **shared detail view, re-rate control and all** (research.md D9), and
 * **removing a rating leaves the log standing** (FR-008).
 *
 * What the rows deliberately do *not* carry is a streaming link. Links are
 * resolved from current availability when a title is opened (research.md D10),
 * so a row that stored one would be a snapshot of availability at the moment of
 * choosing — and a dead deep link in the visitor's own history is a worse
 * outcome than one tap to today's answer.
 */

function title(id: string, name: string, providerId = 'netflix'): MediaTitle {
  return {
    id,
    title: name,
    releaseYear: 2016,
    mediaType: 'movie',
    genres: ['sci-fi'],
    synopsis: 'Filler.',
    rating: 7.9,
    voteCount: 12000,
    posterUrl: `/posters/${id}.svg`,
    availability: [{ providerId, deepLinkUrl: `https://example.test/${id}` }],
  };
}

const CATALOG: MediaTitle[] = [
  title('arrival', 'Arrival'),
  title('parasite', 'Parasite', 'hulu'),
];

const ARRIVAL_WATCHED = '2026-09-25T20:00:00.000Z';
const PARASITE_WATCHED = '2026-09-20T18:30:00.000Z';

/** What each entry's choice time must read as, once formatted. */
const ARRIVAL_WATCHED_LABEL = '25 Sep 2026';
const PARASITE_WATCHED_LABEL = '20 Sep 2026';

class FakeCatalogService {
  /** A signal, like the real one — templates read it as `usingCachedTitles()`. */
  readonly usingCachedTitles = signal(false).asReadonly();

  loadTitles(_region: string): Observable<MediaTitle[]> {
    return of(CATALOG.map((candidate) => ({ ...candidate })));
  }
}

interface SavedHistoryEntry {
  titleId: string;
  chosenAt: string;
}

describe('watching history', () => {
  let fixture: ComponentFixture<WatchHistory>;
  let root: HTMLElement;

  /**
   * Writes a document the way the deck writes it, straight to LocalStorage.
   *
   * `interactions` is a parameter rather than a constant because the FR-008
   * test needs a log whose title is *also* rated — the case where a removal
   * could plausibly take the log with it.
   */
  function saveHistory(
    history: SavedHistoryEntry[],
    interactions: Record<string, InteractionState> = {},
  ): void {
    localStorage.setItem(
      INTERACTION_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        interactions: Object.fromEntries(
          Object.entries(interactions).map(([titleId, state]) => [
            titleId,
            { state, updatedAt: ARRIVAL_WATCHED },
          ]),
        ),
        history,
        updatedAt: ARRIVAL_WATCHED,
      }),
    );
  }

  /** The two entries the happy-path tests start from, newest first by time. */
  function saveTwoChoices(): void {
    saveHistory([
      { titleId: 'parasite', chosenAt: PARASITE_WATCHED },
      { titleId: 'arrival', chosenAt: ARRIVAL_WATCHED },
    ]);
  }

  /**
   * Configures the module and builds the view.
   *
   * Configuration lives here rather than in `beforeEach` so a test can reset the
   * module and build a second, genuinely fresh instance — a fresh injector, and
   * therefore a store with nothing in memory. Without that, "reads the saved
   * log" and "remembers what it read the first time" are indistinguishable.
   */
  function build(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CatalogService, useValue: new FakeCatalogService() },
      ],
    });

    fixture = TestBed.createComponent(WatchHistory);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  /** The rows, by the one anchor each one is. */
  function rows(): HTMLAnchorElement[] {
    return [...root.querySelectorAll('[data-history-entry]')] as HTMLAnchorElement[];
  }

  function rowTargets(): string[] {
    return rows().map((row) => row.getAttribute('href') ?? '');
  }

  function rowTexts(): string[] {
    return rows().map((row) => row.textContent ?? '');
  }

  beforeEach(() => {
    localStorage.clear();
    saveTwoChoices();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  describe('what it lists (US3 scenario 1)', () => {
    it('lists every decision, newest first', () => {
      // Ordering is the log's own timestamps, not the array's — the document
      // above stores them in the opposite order on purpose, so a view that
      // simply echoed the array would fail here.
      build();

      expect(rowTargets()).toEqual(['/watchlist/title/arrival', '/watchlist/title/parasite']);
    });

    it('names each title from the catalog, not from the log', () => {
      // The log stores `{titleId, chosenAt}` and nothing else (research.md
      // D10), so a name on this screen can only have come from the catalog.
      build();

      expect(text()).toContain('Arrival');
      expect(text()).toContain('Parasite');
    });

    it('says when each decision was made', () => {
      build();

      expect(rowTexts().some((row) => row.includes(ARRIVAL_WATCHED_LABEL))).toBe(true);
      expect(rowTexts().some((row) => row.includes(PARASITE_WATCHED_LABEL))).toBe(true);
    });

    it('keeps both rows when the same title was watched twice', () => {
      // FR-008 and 002's `WatchHistoryEntry`: the log is append-only, so a
      // second decision adds a row rather than replacing the first. This is
      // also why `@for` tracks a per-entry key and not `titleId` — tracking the
      // id would make the two rows one, silently.
      saveHistory([
        { titleId: 'arrival', chosenAt: PARASITE_WATCHED },
        { titleId: 'arrival', chosenAt: ARRIVAL_WATCHED },
      ]);

      build();

      expect(rows()).toHaveLength(2);
      expect(rowTargets()).toEqual(['/watchlist/title/arrival', '/watchlist/title/arrival']);
    });

    it('does not label a row with a state', () => {
      // T022: the surface *is* the state, and the only label the vocabulary
      // offers for it is the action verb "Watch Now" — read back as the thing
      // that was recorded, it says the visitor asked for it just now.
      build();

      const labels = Object.values(INTERACTION_STATE_LABELS);

      for (const row of rowTexts()) {
        expect(labels.filter((label) => row.includes(label))).toEqual([]);
      }
    });

    it('reads the saved log when it is built, not once at some earlier time', () => {
      build();
      expect(rows()).toHaveLength(2);

      // A different log, and a fresh injector — as if the app had been closed,
      // another choice locked in, and it launched again.
      saveHistory([{ titleId: 'parasite', chosenAt: PARASITE_WATCHED }]);
      TestBed.resetTestingModule();
      build();

      expect(rowTargets()).toEqual(['/watchlist/title/parasite']);
    });
  });

  describe('a title the catalog no longer knows (research D10)', () => {
    it('still lists the row rather than dropping it or crashing', () => {
      // Milestone 2 makes the catalog a TMDB response whose contents change
      // between visits, so this is a normal Tuesday rather than a corrupted
      // document. The entry stays: a decision the visitor can see is one they
      // can still open and clear.
      saveHistory([{ titleId: 'delisted', chosenAt: ARRIVAL_WATCHED }]);

      build();

      expect(rowTargets()).toEqual(['/watchlist/title/delisted']);
    });

    it('names it in a way the visitor can act on', () => {
      saveHistory([{ titleId: 'delisted', chosenAt: ARRIVAL_WATCHED }]);

      build();

      expect(text()).toContain('Unavailable title');
      expect(text()).not.toContain('undefined');
      expect(text()).not.toContain('NaN');
    });
  });

  describe('nothing watched yet (US3 scenario 3, FR-010)', () => {
    it('invites the visitor to the deck rather than showing a blank panel', () => {
      // "Never a dead end" (Principle II) applies to a screen with nothing on
      // it as much as to one with a broken control.
      saveHistory([]);

      build();

      expect(rows()).toEqual([]);
      expect(text().toLowerCase()).toContain('deck');
    });

    it('offers the way there rather than only naming it', () => {
      saveHistory([]);

      build();

      expect(root.querySelector('a[href="/deck"]')).not.toBeNull();
    });
  });

  describe('opening an entry (US3 scenario 2, research D9)', () => {
    beforeEach(() => {
      // The real route table, so the address a row carries is proven to resolve
      // rather than assumed to.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes, withComponentInputBinding()),
          { provide: CatalogService, useValue: new FakeCatalogService() },
        ],
      });
    });

    it('lands on the shared detail view, with the re-rate control on it', async () => {
      // The reason this screen cannot be read-only. A `watchingNow` title lives
      // in no tab, so without a way to change its rating here, that rating
      // would be the identical dead end the 2026-09-26 clarification closed for
      // `notInterested`.
      const harness = await RouterTestingHarness.create('/watchlist/history');
      const row = (harness.fixture.nativeElement as HTMLElement).querySelector(
        '[data-history-entry]',
      );
      const target = row?.getAttribute('href') ?? '';
      expect(target).toBe('/watchlist/title/arrival');

      await harness.navigateByUrl(target);
      const screen = harness.fixture.nativeElement as HTMLElement;

      expect(screen.querySelector('app-detail')).not.toBeNull();
      expect(screen.querySelectorAll('[data-rating]')).toHaveLength(RATING_ACTIONS.length);
    });
  });

  describe('removing a rating (FR-008)', () => {
    it('leaves the history entry standing', () => {
      // The view-level half of the store's guarantee: the log records what
      // happened, not what the visitor currently thinks. The same title is
      // rated *and* logged here, so a removal that took the history with it
      // would show up as a vanished row rather than as nothing at all.
      saveHistory([{ titleId: 'arrival', chosenAt: ARRIVAL_WATCHED }], { arrival: 'watchingNow' });
      build();

      TestBed.inject(InteractionStore).remove('arrival');
      TestBed.resetTestingModule();
      build();

      expect(rowTargets()).toEqual(['/watchlist/title/arrival']);
    });
  });

  describe('reaching it from the route table (T023)', () => {
    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes, withComponentInputBinding()),
          { provide: CatalogService, useValue: new FakeCatalogService() },
        ],
      });
    });

    it('is what /watchlist/history resolves to, inside the shell', async () => {
      const harness = await RouterTestingHarness.create('/watchlist/history');
      const screen = harness.fixture.nativeElement as HTMLElement;

      expect(screen.querySelector('app-watch-history')).not.toBeNull();
      expect(screen.querySelector('nav')).not.toBeNull();
    });

    it('is not swallowed by the title route it sits beside', async () => {
      // The collision the `title/` segment in `watchlist/title/:titleId` exists
      // to prevent. Without it, `history` would bind as a `:titleId` and this
      // address would open a detail view for a title called "history" — a link
      // that works, lands somewhere, and shows the wrong screen, which is the
      // hardest kind of routing bug to notice.
      const harness = await RouterTestingHarness.create('/watchlist/history');
      const screen = harness.fixture.nativeElement as HTMLElement;

      expect(screen.querySelector('app-detail')).toBeNull();
      expect(screen.querySelector('app-watch-history')).not.toBeNull();
    });
  });
});
