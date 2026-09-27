import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Poster } from './poster';

/**
 * Tests for the shared poster.
 *
 * This component exists because the same behaviour is needed in two places
 * (research.md D11): the deck card and the watchlist row. The engineering
 * standards forbid implementing one behaviour two ways, so the contract below
 * is what both consumers are entitled to.
 *
 * The behaviour that matters is the fallback. It is deliberately **not** a
 * fallback image: a second request would fail for the same reason the first one
 * did, and offline it would fail too — which is exactly the scenario FR-015
 * asks the deck to survive. So the placeholder makes no request at all, and
 * carries the same accessible name the image would have had.
 */

interface PosterInputs {
  src?: string | null | undefined;
  alt?: string;
  placeholderText?: string;
  priority?: boolean;
}

describe('poster', () => {
  let fixture: ComponentFixture<Poster>;
  let root: HTMLElement;

  function build(inputs: PosterInputs = {}): void {
    fixture = TestBed.createComponent(Poster);
    fixture.componentRef.setInput('alt', inputs.alt ?? 'Arrival poster');
    fixture.componentRef.setInput('src', inputs.src);

    if (inputs.placeholderText !== undefined) {
      fixture.componentRef.setInput('placeholderText', inputs.placeholderText);
    }
    if (inputs.priority !== undefined) {
      fixture.componentRef.setInput('priority', inputs.priority);
    }

    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function image(): HTMLImageElement | null {
    return root.querySelector('img');
  }

  function placeholder(): HTMLElement | null {
    return root.querySelector('[role="img"]');
  }

  /** Fails the poster the way a broken URL does. */
  function breakPoster(): void {
    const rendered = image();
    if (!rendered) throw new Error('No poster was rendered to fail');

    rendered.dispatchEvent(new Event('error'));
    fixture.detectChanges();
  }

  describe('when there is artwork', () => {
    it('renders the image at the URL it was given', () => {
      build({ src: '/posters/poster-1.svg' });

      expect(image()?.getAttribute('src')).toBe('/posters/poster-1.svg');
    });

    it('describes the image with the accessible name it was given', () => {
      build({ src: '/posters/poster-1.svg', alt: 'Arrival poster' });

      expect(image()?.getAttribute('alt')).toBe('Arrival poster');
    });

    it('does not claim high priority unless the caller asks for it', () => {
      // A list of twenty rows must not all be fetchpriority="high"; only the
      // single card on screen is (002 research.md D6).
      build({ src: '/posters/poster-1.svg' });

      expect(image()?.getAttribute('fetchpriority')).toBeNull();
    });

    it('marks the image high priority when the caller asks', () => {
      build({ src: '/posters/poster-1.svg', priority: true });

      expect(image()?.getAttribute('fetchpriority')).toBe('high');
    });
  });

  describe('when there is no artwork', () => {
    it('renders the placeholder and makes no request', () => {
      // `null`, `undefined` and `''` all mean "no artwork" — a caller should
      // not have to normalise three absences into one before rendering.
      for (const absent of [null, undefined, '']) {
        build({ src: absent });

        expect(image()).toBeNull();
        expect(placeholder()).not.toBeNull();
      }
    });

    it('describes the placeholder with the same accessible name', () => {
      build({ src: null, alt: 'Arrival poster' });

      expect(placeholder()?.getAttribute('aria-label')).toBe('Arrival poster');
    });

    it('shows the placeholder text it was given', () => {
      build({ src: null, placeholderText: 'Movie' });

      expect(placeholder()?.textContent).toContain('Movie');
    });

    it('treats an empty placeholder text as none, not as an empty label', () => {
      build({ src: null, placeholderText: '' });

      expect(placeholder()).not.toBeNull();
      expect(placeholder()?.textContent?.trim()).toBe('');
    });
  });

  describe('when the artwork fails to load', () => {
    it('swaps to the placeholder', () => {
      build({ src: '/posters/missing.svg' });

      breakPoster();

      expect(image()).toBeNull();
      expect(placeholder()).not.toBeNull();
    });

    it('does not retry a poster that has already failed', () => {
      // Re-rendering must not re-request a URL the browser just rejected —
      // that is a request loop on a broken asset.
      build({ src: '/posters/missing.svg' });
      breakPoster();

      fixture.detectChanges();

      expect(image()).toBeNull();
      expect(placeholder()).not.toBeNull();
    });

    it('names the title the same way whether or not the artwork loaded', () => {
      // The accessible surface must not depend on the network.
      build({ src: '/posters/poster-1.svg', alt: 'Arrival poster' });
      const withArt = image()?.getAttribute('alt');

      breakPoster();

      expect(withArt).toBe('Arrival poster');
      expect(placeholder()?.getAttribute('aria-label')).toBe(withArt);
    });

    it('renders a different poster after an earlier one failed', () => {
      // The failure is remembered **per URL**, not as "a poster failed". In a
      // reused list row a bare flag would keep the placeholder forever after
      // one bad image, which is the bug this shape exists to prevent.
      build({ src: '/posters/missing.svg' });
      breakPoster();

      fixture.componentRef.setInput('src', '/posters/poster-2.svg');
      fixture.detectChanges();

      expect(image()?.getAttribute('src')).toBe('/posters/poster-2.svg');
      expect(placeholder()).toBeNull();
    });
  });
});
