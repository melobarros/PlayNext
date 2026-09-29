import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MediaTitle } from '../../../core/models/media-title';
import { Card } from './card';

/**
 * Tests for the recommendation card.
 *
 * The card is presentational: it renders one `MediaTitle` and reports nothing.
 * What is worth testing here is not the markup but the two mapping rules that
 * have a real failure mode — turning ids into display names, and surviving
 * missing artwork (FR-016). Both are required to *degrade*, never to break,
 * which is why most of these assertions pair a "shows the right thing" case
 * with an "and the card is still readable" case.
 */

const SYNOPSIS = 'A linguist learns a language that rewrites how she remembers.';

function title(overrides: Partial<MediaTitle> = {}): MediaTitle {
  return {
    id: 'a-title',
    title: 'A Title',
    releaseYear: 2024,
    mediaType: 'movie',
    genres: [],
    synopsis: SYNOPSIS,
    rating: 8.4,
    voteCount: 1000,
    availability: [],
    ...overrides,
  };
}

describe('recommendation card', () => {
  let fixture: ComponentFixture<Card>;
  let root: HTMLElement;

  function build(overrides: Partial<MediaTitle> = {}): void {
    fixture = TestBed.createComponent(Card);
    fixture.componentRef.setInput('title', title(overrides));
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  /** Fails the poster the way a broken URL does. */
  function breakPoster(): void {
    const image = root.querySelector('img');
    if (!image) throw new Error('No poster was rendered to fail');
    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();
  }

  describe('the metadata FR-003 requires', () => {
    it('shows the title, release year, media type and rating', () => {
      build({ title: 'Arrival', releaseYear: 2016, mediaType: 'movie', rating: 7.9 });

      expect(text()).toContain('Arrival');
      expect(text()).toContain('2016');
      expect(text()).toContain('Movie');
      expect(text()).toContain('7.9');
    });

    it('renders the rating to exactly one decimal', () => {
      // The model calls the rating a display value; 8 renders as "8.0" so the
      // numbers line up card to card instead of jittering in width.
      build({ rating: 8 });

      expect(text()).toContain('8.0');
    });

    it('labels the media type of a series and of an anime, not just films', () => {
      build({ mediaType: 'tv' });
      expect(text()).toContain('TV Show');

      build({ mediaType: 'anime' });
      expect(text()).toContain('Anime');
    });

    it('shows a film runtime in hours and minutes', () => {
      build({ runtimeMinutes: 116 });

      expect(text()).toContain('1h 56m');
    });

    it('shows a short runtime in minutes alone', () => {
      build({ runtimeMinutes: 45 });

      expect(text()).toContain('45 min');
    });

    it('omits the runtime when the title does not have one', () => {
      build({ runtimeMinutes: undefined });

      expect(text()).not.toContain('undefined');
      expect(text()).not.toMatch(/\d+\s*(min|h\b)/);
    });
  });

  describe('genres', () => {
    it('renders genre ids as their display names', () => {
      build({ genres: ['sci-fi', 'drama'] });

      expect(text()).toContain('Sci-Fi');
      expect(text()).toContain('Drama');
      // The raw id must never reach the visitor.
      expect(text()).not.toContain('sci-fi');
    });

    it('shows each genre once, even if the data repeats it', () => {
      build({ genres: ['drama', 'drama'] });

      const matches = text().match(/Drama/g) ?? [];
      expect(matches).toHaveLength(1);
    });

    it('ignores a genre id the quiz never offered, rather than printing it raw', () => {
      // data-model.md: an unknown id is ignored, not fatal.
      build({ genres: ['drama', 'not-a-real-genre'] });

      expect(text()).toContain('Drama');
      expect(text()).not.toContain('not-a-real-genre');
    });

    it('stays readable with no genres at all', () => {
      build({ genres: [], title: 'Untagged' });

      expect(text()).toContain('Untagged');
    });
  });

  describe('availability (FR-003)', () => {
    it('names every provider the title is available on', () => {
      build({
        availability: [
          { providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/1' },
          { providerId: 'max', deepLinkUrl: 'https://play.max.com/title/1' },
        ],
      });

      expect(text()).toContain('Netflix');
      // The full name, not the substring: "Max" alone passes against both the
      // right label and the one the service stopped using.
      expect(text()).toContain('HBO Max');
      // Provider ids are an implementation detail, not visitor-facing copy.
      expect(text()).not.toContain('netflix');
    });

    it('degrades to no badges when the title is on nothing, and says so', () => {
      // The title still has to be decidable: "nowhere" is information, and a
      // card that silently dropped the row would look like a rendering fault.
      build({ availability: [], title: 'Nowhere To Be Found' });

      expect(text()).toContain('Nowhere To Be Found');
      expect(text()).toContain('Not on your services');
    });

    it('ignores an unknown provider id rather than rendering a nameless badge', () => {
      build({
        availability: [
          { providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/1' },
          { providerId: 'a-defunct-service', deepLinkUrl: 'https://example.invalid/x' },
        ],
      });

      expect(text()).toContain('Netflix');
      expect(text()).not.toContain('a-defunct-service');
    });
  });

  describe('the synopsis', () => {
    it('shows the synopsis outright, with no tap required', () => {
      // It used to be a native `<details>` (002 research.md D8), chosen so the
      // synopsis stayed reachable with no JavaScript. One that is simply shown
      // needs no interaction at all — more reachable, not less — and the card
      // has the room. The disclosure is pinned out so it cannot quietly return.
      build({ synopsis: SYNOPSIS });

      expect(text()).toContain(SYNOPSIS);
      expect(root.querySelector('details')).toBeNull();
      expect(root.querySelector('summary')).toBeNull();
    });

    it('spans the card below the poster row, rather than sharing the facts column', () => {
      // The whole point of the second visual pass: a synopsis in the ~176px
      // beside the poster is a tall skinny strip, so it takes the full width
      // under it. Specs cannot measure layout, so this pins the structure that
      // produces it — a direct child of the card, right after the poster row.
      build({ synopsis: SYNOPSIS });

      const article = root.querySelector('article');
      const synopsis = [...(article?.children ?? [])].find((child) =>
        child.textContent?.includes(SYNOPSIS),
      );

      expect(synopsis?.tagName).toBe('P');
      expect(synopsis?.previousElementSibling).toBe(article?.firstElementChild);
    });

    it('is purely presentational — nothing on it asks for interaction', () => {
      // The deck's wrapper owns every pointer gesture, including the swipe. A
      // control inside the card would compete with that gesture for the same
      // finger. This was pinned on the `<summary>` while there was one; now it
      // is pinned on the card.
      build({ synopsis: SYNOPSIS, availability: [] });

      expect(root.querySelectorAll('summary, button, a, input, select, textarea')).toHaveLength(0);
    });

    it('omits the synopsis entirely when there is none', () => {
      build({ synopsis: '' });

      expect(text()).not.toContain(SYNOPSIS);
      expect(text()).toContain('A Title');
    });
  });

  describe('poster art (FR-016)', () => {
    it('renders the poster when the title has one', () => {
      build({ posterUrl: '/posters/poster-1.svg' });

      const image = root.querySelector('img');
      expect(image?.getAttribute('src')).toBe('/posters/poster-1.svg');
    });

    it('describes the poster for a screen reader', () => {
      build({ posterUrl: '/posters/poster-1.svg', title: 'Arrival' });

      const image = root.querySelector('img');
      // Decorative artwork would take an empty alt; this is the only image on
      // the card and it names the title, so it carries a real description.
      expect(image?.getAttribute('alt')).toBe('Arrival poster');
    });

    it('falls back to a placeholder when posterUrl is absent', () => {
      build({ posterUrl: undefined, title: 'Arrival' });

      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelector('[role="img"]')).not.toBeNull();
      expect(text()).toContain('Arrival');
    });

    it('falls back to the placeholder when the poster fails to load', () => {
      build({ posterUrl: '/posters/missing.svg', title: 'Arrival' });

      breakPoster();

      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelector('[role="img"]')).not.toBeNull();
    });

    it('names the title the same way whether or not the artwork loaded', () => {
      // The accessible surface must not depend on the network. A visitor using
      // a screen reader gets the same description either way.
      build({ posterUrl: '/posters/poster-1.svg', title: 'Arrival' });
      const withArt = root.querySelector('img')?.getAttribute('alt');

      breakPoster();

      expect(withArt).toBe('Arrival poster');
      expect(root.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(withArt);
    });

    it('stays fully readable after the poster fails', () => {
      build({
        posterUrl: '/posters/missing.svg',
        title: 'Arrival',
        releaseYear: 2016,
        rating: 7.9,
        genres: ['sci-fi'],
        availability: [{ providerId: 'netflix', deepLinkUrl: 'https://www.netflix.com/title/1' }],
      });

      breakPoster();

      expect(text()).toContain('Arrival');
      expect(text()).toContain('2016');
      expect(text()).toContain('7.9');
      expect(text()).toContain('Sci-Fi');
      expect(text()).toContain('Netflix');
    });

    it('shows the poster beside the facts on phones and above them on desktop', () => {
      // A full-width 2:3 poster is ~525px at phone width, which puts the
      // badges and the synopsis below the fold — the visitor has to scroll to
      // decide. From `md` up the card has the height to spare and the
      // thumbnail is what leaves it empty, so the row turns into a column and
      // the poster fills the card. The width is the caller's to set
      // (poster.ts), so this is where it is pinned: `shrink-0` because a long
      // title beside it would otherwise squeeze the artwork out of its 2:3,
      // and the row direction is the half that puts them side by side at all.
      build({ posterUrl: '/posters/poster-1.svg' });

      const poster = root.querySelector('app-poster');
      const article = root.querySelector('article');
      const row = poster?.parentElement;

      expect(poster?.classList.contains('w-28')).toBe(true);
      expect(poster?.classList.contains('shrink-0')).toBe(true);
      expect(poster?.classList.contains('md:w-full')).toBe(true);
      // The card is a column now, so the synopsis can span it — but the poster
      // is in an inner *row*, which is what keeps it beside the facts.
      expect(article?.classList.contains('flex-col')).toBe(true);
      expect(row?.classList.contains('flex')).toBe(true);
      expect(row?.classList.contains('md:flex-col')).toBe(true);
      // The `md:` prefix is load-bearing: an unprefixed `flex-col` here would
      // stack the poster above the facts at 360px too, which is the layout the
      // phone just rejected. This pins that the stacking is desktop-only.
      expect(row?.classList.contains('flex-col')).toBe(false);
    });

    it('does not retry a poster that has already failed', () => {
      // Re-rendering the card must not re-request a URL the browser just
      // rejected — that is a request loop on a broken asset.
      build({ posterUrl: '/posters/missing.svg' });
      breakPoster();

      fixture.detectChanges();

      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelector('[role="img"]')).not.toBeNull();
    });
  });
});
