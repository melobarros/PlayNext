import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StreamingAvailability } from '../../core/models/media-title';
import { WaysToWatch } from './ways-to-watch';

/**
 * Tests for the "Where to watch" block.
 *
 * Extracted from `match-found.html` when 003's detail view needed the identical
 * block for the same data (research.md D11 — extracted, not copied). The rules
 * it carries are not markup preferences: **every link leaves the app**, and an
 * installed PWA has no back button, so a same-tab navigation would strand the
 * visitor on Netflix with their deck gone (constitution II).
 */

const NETFLIX: StreamingAvailability = {
  providerId: 'netflix',
  deepLinkUrl: 'https://www.netflix.com/title/1',
};
const MAX: StreamingAvailability = { providerId: 'max', deepLinkUrl: 'https://www.max.com/title/1' };
const UNKNOWN: StreamingAvailability = {
  providerId: 'hbo-max-legacy',
  deepLinkUrl: 'https://example.invalid/title/1',
};

describe('ways to watch', () => {
  let fixture: ComponentFixture<WaysToWatch>;
  let root: HTMLElement;

  function build(availability: readonly StreamingAvailability[]): void {
    fixture = TestBed.createComponent(WaysToWatch);
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('availability', availability);
    fixture.detectChanges();
  }

  function links(): HTMLAnchorElement[] {
    return [...root.querySelectorAll('a')] as HTMLAnchorElement[];
  }

  beforeEach(() => TestBed.configureTestingModule({}));

  describe('one link per service', () => {
    it('links to every service the title is available on', () => {
      build([NETFLIX, MAX]);

      const byName = Object.fromEntries(
        links().map((anchor) => [anchor.textContent?.trim(), anchor.getAttribute('href')]),
      );

      expect(byName).toEqual({
        Netflix: 'https://www.netflix.com/title/1',
        Max: 'https://www.max.com/title/1',
      });
    });

    it('skips a provider the option lists do not know', () => {
      // The visitor was only ever offered the services in the quiz, so an
      // unknown id is one they were never told they have — and a link labelled
      // "Watch on hbo-max-legacy" is worse than no link at all.
      build([NETFLIX, UNKNOWN]);

      expect(links()).toHaveLength(1);
      expect(root.textContent).not.toContain('hbo-max-legacy');
    });

    it('lists a service once however many entries produced it', () => {
      // Two entries for one service would read as two separate ways to watch
      // the same thing. Deduplicated by provider id, not by URL: the same
      // service can legitimately carry two links, and one is still the answer.
      build([NETFLIX, { ...NETFLIX, deepLinkUrl: 'https://www.netflix.com/title/1?src=x' }]);

      expect(links()).toHaveLength(1);
    });

    it('names the block, so the links are not a bare list', () => {
      build([NETFLIX]);

      expect(root.querySelector('h2')?.textContent).toContain('Where to watch');
    });
  });

  describe('leaving the app safely', () => {
    it('opens every link away from the app, because an installed PWA has no back button', () => {
      build([NETFLIX, MAX]);

      expect(links().length).toBeGreaterThan(0);
      for (const anchor of links()) {
        expect(anchor.getAttribute('target')).toBe('_blank');
        expect(anchor.getAttribute('rel')).toContain('noopener');
      }
    });

    it('sends the visitor to the official service, not through us', () => {
      // PlayNext hosts nothing (FR-008): a redirect or an interstitial here
      // would be a bug, not a nicety.
      build([NETFLIX, MAX]);

      for (const anchor of links()) {
        expect(anchor.getAttribute('href')).toMatch(/^https:\/\//);
      }
    });

    it('gives each link a 44px target (constitution I)', () => {
      build([NETFLIX]);

      for (const anchor of links()) {
        expect(anchor.classList.contains('touch-target')).toBe(true);
      }
    });
  });

  describe('when the title is on nothing', () => {
    it('says so, rather than showing an empty list', () => {
      build([]);

      expect(links()).toEqual([]);
      expect(root.textContent).toContain('Not on your services right now');
    });

    it('says the same thing when every entry was skipped', () => {
      // The distinction between "no availability" and "availability we cannot
      // name" is not one the visitor can act on, so both read the same.
      build([UNKNOWN]);

      expect(links()).toEqual([]);
      expect(root.textContent).toContain('Not on your services right now');
    });
  });
});
