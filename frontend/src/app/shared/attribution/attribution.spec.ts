import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Attribution } from './attribution';

/**
 * Tests for the provider's attribution notice (FR-018).
 *
 * **This is the one place the wording is written down.** §3 of the provider's
 * API Terms of Use fixes the sentence and leaves exactly one word to the
 * Application, so the constant below is quoted from the licence and is not
 * copy: "uses the TMDB APIs" and "otherwise approved" are terms, not phrasing.
 * 005 first shipped a paraphrase of both and a comment asserting the wording
 * was the provider's — so these tests exist to make the difference between
 * "reads about right" and "is what the licence says" fail loudly.
 *
 * The sentence is compared with whitespace collapsed, because that is what a
 * visitor sees: HTML folds a newline and its indentation into a single space
 * when it renders. Comparing raw `textContent` would fail on a line wrap, which
 * harms nobody, and that is how a real check gets deleted.
 */

/** The notice as §3 gives it, with `application` chosen from the placeholder. */
const NOTICE =
  'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.';

describe('the attribution', () => {
  let fixture: ComponentFixture<Attribution>;
  let root: HTMLElement;

  function build(): void {
    fixture = TestBed.createComponent(Attribution);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function notice(): string {
    return (root.querySelector('span')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => TestBed.configureTestingModule({}));

  describe('the notice', () => {
    it('carries the sentence the terms require, word for word', () => {
      build();

      expect(notice()).toBe(NOTICE);
    });
  });

  describe('the logo', () => {
    it('is present, because the terms require the logo as well as the notice', () => {
      build();

      expect(root.querySelector('img')).not.toBeNull();
    });

    it('is served from our own bundle rather than the provider’s site', () => {
      build();

      // An `<img>` pointing at themoviedb.org would open a direct channel from
      // the visitor's browser to the provider's — the exact thing the catalog
      // exists to prevent, and something the SC-006 scan reads as a clean
      // bundle because it only looks for credentials.
      const src = root.querySelector('img')?.getAttribute('src') ?? '';

      expect(src).not.toBe('');
      expect(src).not.toMatch(/^https?:/);
    });

    it('describes itself, since it is the only thing naming the source', () => {
      build();

      expect(root.querySelector('img')?.getAttribute('alt')).toBeTruthy();
    });
  });

  describe('the link', () => {
    function link(): HTMLAnchorElement | null {
      return root.querySelector('a');
    }

    it('points at the provider', () => {
      build();

      expect(link()?.getAttribute('href')).toBe('https://www.themoviedb.org/');
    });

    it('opens away from the app, because an installed PWA has no way back', () => {
      build();

      // The same rule every other outbound link in this app follows
      // (constitution II): a same-tab navigation would strand the visitor on
      // the provider's site with their deck gone.
      expect(link()?.getAttribute('target')).toBe('_blank');
      expect(link()?.getAttribute('rel')).toContain('noopener');
    });
  });
});
