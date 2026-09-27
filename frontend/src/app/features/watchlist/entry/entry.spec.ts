import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MediaTitle } from '../../../core/models/media-title';
import { WatchlistEntry } from '../watchlist-logic/entries';
import { Entry } from './entry';

/**
 * Tests for one watchlist row (FR-002).
 *
 * Presentation only, like `Card` — but the "unavailable" case is real
 * behaviour rather than markup, and it is the case worth the most attention
 * here. A rating can outlive the title's presence in the catalog once TMDB
 * supplies the data (Milestone 2), and **an entry the visitor can see is always
 * an entry they can remove** (data-model.md). A row that threw, or silently
 * vanished, would strand that rating with no way back — the dead end
 * Principle II forbids.
 */

function title(overrides: Partial<MediaTitle> = {}): MediaTitle {
  return {
    id: 'arrival',
    title: 'Arrival',
    releaseYear: 2016,
    mediaType: 'movie',
    genres: ['sci-fi'],
    synopsis: 'A linguist.',
    rating: 7.9,
    voteCount: 12000,
    posterUrl: '/posters/arrival.svg',
    availability: [
      { providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/1' },
      { providerId: 'max', deepLinkUrl: 'https://www.max.com/title/1' },
    ],
    ...overrides,
  };
}

function entry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    titleId: 'arrival',
    state: 'loved',
    stateLabel: 'Loved It',
    updatedAt: '2026-09-26T10:00:00.000Z',
    title: title(),
    ...overrides,
  };
}

describe('watchlist row', () => {
  let fixture: ComponentFixture<Entry>;
  let root: HTMLElement;

  function build(row: WatchlistEntry): void {
    fixture = TestBed.createComponent(Entry);
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('entry', row);
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  function row(): HTMLAnchorElement {
    const anchor = root.querySelector('a');
    if (anchor === null) throw new Error('The row is not a link — it is unreachable');
    return anchor;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  describe('what the row shows (FR-002)', () => {
    it('shows the poster, the title and the year', () => {
      build(entry());

      expect(root.querySelector('app-poster img')?.getAttribute('src')).toBe('/posters/arrival.svg');
      expect(text()).toContain('Arrival');
      expect(text()).toContain('2016');
    });

    it('shows the entry’s own state, not its tab’s', () => {
      // The row is rendered inside a merged tab, so the tab's label would be
      // ambiguous: Liked and Loved share a tab, and the visitor needs to know
      // which one this is.
      build(entry({ state: 'liked', stateLabel: 'Liked It' }));

      expect(text()).toContain('Liked It');
    });

    it('shows where the title can be watched', () => {
      build(entry());

      expect(text()).toContain('Netflix');
      expect(text()).toContain('Max');
    });

    it('says so rather than showing nothing when the title is on no service', () => {
      build(entry({ title: title({ availability: [] }) }));

      expect(text()).toContain('Not on your services');
    });

    it('is one touch target for the whole row (constitution I)', () => {
      // Not a small link inside a big row: the visitor is aiming with a thumb.
      build(entry());

      expect(row().classList.contains('touch-target')).toBe(true);
    });
  });

  describe('the poster (FR-002, FR-016)', () => {
    it('falls back to the shared placeholder when the title has no artwork', () => {
      // The fallback comes from `<app-poster>` (T002), not from a copy here.
      // Asserting on the placeholder rather than on the absence of an `img`
      // is what shows the shared component is doing the work.
      build(entry({ title: title({ posterUrl: undefined }) }));

      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelector('[role="img"]')).not.toBeNull();
    });

    it('falls back when the artwork fails to load, and does not retry', () => {
      build(entry());

      const image = root.querySelector('img');
      image?.dispatchEvent(new Event('error'));
      fixture.detectChanges();

      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelector('[role="img"]')).not.toBeNull();
    });

    it('names the artwork for a screen reader even without it', () => {
      // The accessible name must not change with the artwork's fate, or a
      // screen-reader user gets told about a failure the sighted one cannot see.
      build(entry());
      const withArt = root.querySelector('img')?.getAttribute('alt');

      build(entry({ title: title({ posterUrl: undefined }) }));
      const withoutArt = root.querySelector('[role="img"]')?.getAttribute('aria-label');

      expect(withArt).toBe('Arrival poster');
      expect(withoutArt).toBe(withArt);
    });
  });

  describe('a title the catalog no longer knows (data-model.md, research D10)', () => {
    it('renders as unavailable instead of throwing', () => {
      expect(() => build(entry({ title: null }))).not.toThrow();
    });

    it('stays in the list rather than vanishing', () => {
      // Silently dropping it would leave a rating the visitor can neither see
      // nor clear.
      build(entry({ title: null }));

      expect(text()).toContain('Unavailable');
    });

    it('still says what it was rated, so the visitor knows what they are looking at', () => {
      build(entry({ title: null, state: 'disliked', stateLabel: 'Disliked' }));

      expect(text()).toContain('Disliked');
    });

    it('still opens, because an entry the visitor can see must be one they can remove', () => {
      // This is the property the whole case exists for: the detail view is
      // where Remove lives, so a row that did not link would make the rating
      // permanent.
      build(entry({ title: null }));

      expect(row().getAttribute('href')).toBe('/watchlist/title/arrival');
    });

    it('does not invent details it does not have', () => {
      build(entry({ title: null }));

      expect(text()).not.toContain('undefined');
      expect(text()).not.toContain('NaN');
    });

    it('does not claim to know which services it is on', () => {
      // An empty availability list is a fact about a title we have; a title we
      // do not have is a different thing, and "Not on your services" would be
      // asserting something nobody checked.
      build(entry({ title: null }));

      expect(text()).not.toContain('Not on your services');
    });

    it('still names the artwork, since a placeholder is still an image', () => {
      build(entry({ title: null }));

      expect(root.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
        'Unavailable title poster',
      );
    });
  });

  describe('opening the title', () => {
    it('links to the addressable detail view', () => {
      // Addressable rather than passed as state, so the back button and a
      // refresh both land on the same place (research D10).
      build(entry({ titleId: 'parasite' }));

      expect(row().getAttribute('href')).toBe('/watchlist/title/parasite');
    });
  });
});
