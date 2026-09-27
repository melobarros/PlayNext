import { Component, computed, input, signal } from '@angular/core';
import { MediaTitle } from '../../core/models/media-title';

/**
 * Poster art, or a placeholder that cannot fail (FR-002, FR-016).
 *
 * Shared rather than copied: the deck card and the watchlist row both need this
 * behaviour, and the engineering standards forbid implementing one behaviour two
 * ways (research.md D11).
 *
 * **The placeholder is deliberately not a fallback image.** A second request
 * would fail for the same reason the first one did, and offline it would fail
 * too — which is exactly the scenario FR-015 asks the deck to survive. So the
 * fallback is a CSS-only block that cannot itself fail, and it carries the same
 * accessible name the artwork would have had, so the thing describes itself
 * identically whether or not the image arrived.
 *
 * The component owns the 2:3 aspect ratio (`--aspect-poster`, the design token),
 * because poster art is 2:3 wherever it appears. **The caller owns the width**,
 * via a class on the host element: the card lets it fill the column, a list row
 * pins it to a thumbnail.
 *
 * `placeholderText` is for card-scale rendering. A caller showing a thumbnail
 * passes none — a word at that size is not readable, and the row already names
 * the title beside it.
 */
@Component({
  selector: 'app-poster',
  templateUrl: './poster.html',
})
export class Poster {
  /** The artwork URL. `null`, `undefined` and `''` all mean "none". */
  readonly src = input<string | null | undefined>(null);

  /** The accessible name, identical with and without the artwork. */
  readonly alt = input.required<string>();

  /** Shown inside the placeholder. Omitted by callers rendering a thumbnail. */
  readonly placeholderText = input('');

  /**
   * Whether this is the one image worth fetching first (002 research.md D6).
   * Off by default: a list of twenty rows must not all be `high`.
   */
  readonly priority = input(false);

  /**
   * **Which URL failed**, not merely that one did.
   *
   * A bare boolean would outlive the image it described: `@if` and `@for` reuse
   * a component instance when its inputs change, so in a list a row that once
   * showed a broken poster would keep the placeholder for every title it was
   * later bound to. Remembering the URL makes the failure self-clearing — a
   * different poster was never the one that failed.
   */
  private readonly failedSrc = signal<string | null>(null);

  /** The artwork to render, or `null` to render the placeholder instead. */
  protected readonly artworkUrl = computed<string | null>(() => {
    const url = this.src();
    if (url === null || url === undefined || url === '') return null;

    return this.failedSrc() === url ? null : url;
  });

  protected onError(): void {
    const url = this.src();
    if (url !== null && url !== undefined && url !== '') this.failedSrc.set(url);
  }
}

/**
 * The accessible name for a title's artwork.
 *
 * Exported so every surface that shows a poster describes it the same way: the
 * deck card, a watchlist row, the detail view. A divergence here would be
 * invisible to a sighted visitor and audible only to a screen-reader user,
 * which is the worst kind of drift to leave to independent copies of a template
 * string.
 *
 * `null` is a title the catalog no longer knows — a rated id that has since
 * left it (003 data-model.md). Such a row still renders, with a placeholder, so
 * this still has to name it: an unlabelled image is worse than an approximate
 * label, and "Unavailable title poster" is at least true.
 */
export function artworkAlt(title: MediaTitle | null): string {
  return `${title?.title ?? 'Unavailable title'} poster`;
}
