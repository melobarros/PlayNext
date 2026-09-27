import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QuizOptionsService } from '../../../core/services/quiz-options.service';
import { displayNames } from '../../../shared/display-names';
import { artworkAlt, Poster } from '../../../shared/poster/poster';
import { WatchlistEntry } from '../watchlist-logic/entries';

/**
 * One row in a watchlist tab (FR-002).
 *
 * Presentation only, like `Card`: it renders the `WatchlistEntry` it is given
 * and reports nothing back. It does not read the store, and it has no opinion
 * about which tab it is in — that is what keeps the merged tabs honest, because
 * a row cannot label itself with the tab's name when it has never been told
 * one.
 *
 * **The row is the link**, not a small link inside a big row. The visitor is
 * aiming with a thumb, and a 44px target that is mostly padding around a
 * 16px word is a target that misses.
 *
 * The interesting case is `title: null` — a rated id the catalog no longer
 * knows (data-model.md, research.md D10). It is the case the whole detail view
 * exists for: **an entry the visitor can see must be one they can remove**, so
 * this row degrades to "Unavailable" and stays tappable rather than throwing or
 * quietly dropping out of the list. A row that vanished would leave a rating
 * with no way to see it and no way to clear it, which is the dead end
 * constitution II forbids.
 */
@Component({
  selector: 'app-entry',
  imports: [Poster, RouterLink],
  templateUrl: './entry.html',
})
export class Entry {
  private readonly options = inject(QuizOptionsService);

  readonly entry = input.required<WatchlistEntry>();

  private readonly providerNames = new Map(
    this.options.getProvidersById().map((provider) => [provider.id, provider.displayName]),
  );

  /** The title's name, or the honest admission that we no longer have it. */
  protected readonly name = computed(() => this.entry().title?.title ?? 'Unavailable title');

  /** Absent when the title is absent — never `NaN`, never a stand-in year. */
  protected readonly releaseYear = computed(() => this.entry().title?.releaseYear ?? null);

  /**
   * The services this title is on, named rather than linked.
   *
   * Linking here would send the visitor out of the app from a list they are
   * still browsing; the links belong on the detail view, where they have
   * stopped to look at one thing. Same division the deck draws between its card
   * and Match Found.
   *
   * `null` rather than `'Not on your services'` when there is no title to ask:
   * claiming a delisted title is on no service would be inventing a fact, which
   * is a different thing from reporting an empty availability list.
   */
  protected readonly availabilityLabel = computed(() => {
    const title = this.entry().title;
    if (title === null) return null;

    const names = displayNames(
      title.availability.map((available) => available.providerId),
      this.providerNames,
    );

    return names.length > 0 ? names.join(', ') : 'Not on your services';
  });

  /** The same name the poster would have had if it had loaded (FR-016). */
  protected readonly posterAlt = computed(() => artworkAlt(this.entry().title));
}
