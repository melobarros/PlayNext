import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MediaTitle } from '../../core/models/media-title';
import {
  InteractionDocument,
  WATCHLIST_TABS,
  WatchlistSurface,
} from '../../core/models/interaction';
import { currentRegion } from '../../core/region';
import { CatalogService } from '../../core/services/catalog.service';
import { Connectivity } from '../../core/services/connectivity';
import { InteractionStore } from '../../core/services/interaction-store';
import { Attribution } from '../../shared/attribution/attribution';
import { Entry } from './entry/entry';
import { groupBySurface, WatchlistEntry, watchlistEntries } from './watchlist-logic/entries';

/**
 * The watchlist: three tabs over the visitor's ratings (US1, FR-001).
 *
 * A **derived view**. There is no fourth storage key and nothing is cached: the
 * rows are computed from the interaction document plus the catalog every time
 * either changes, so the tabs cannot drift from what was actually rated
 * (research.md D1). Deleting the document is the same as having rated nothing,
 * which is a property no denormalised copy would have.
 *
 * Every grouping decision comes from `watchlist-logic/entries.ts` and the tab
 * table in `core/models/interaction.ts`. The counts in particular are *lengths
 * of the lists they sit above* rather than a second tally, so a badge cannot
 * disagree with the rows beneath it (data-model.md).
 *
 * `InteractionStore` stays non-reactive (research.md D4), so the document is
 * read once here and re-read after this component's own writes — US2's re-rate
 * and Remove. Two views alive at once would need more than that, and the
 * caveat is recorded in D4 rather than papered over.
 */
@Component({
  selector: 'app-watchlist',
  imports: [Attribution, Entry, RouterLink],
  templateUrl: './watchlist.html',
})
export class Watchlist {
  private readonly catalog = inject(CatalogService);
  private readonly connections = inject(Connectivity);
  private readonly interactions = inject(InteractionStore);

  /** The device's region (FR-005): scopes availability, never the title list (CatalogService). */
  private readonly region = currentRegion();

  private readonly titles = signal<MediaTitle[]>([]);

  private readonly document = signal<InteractionDocument>(this.interactions.read());

  /** Which tab is showing. Opens on Want to Watch, the first of the three. */
  protected readonly active = signal<WatchlistSurface>('loved');

  protected readonly tabs = WATCHLIST_TABS;

  /** Every entry, grouped. One grouping, so every count and every list agree. */
  private readonly grouped = computed(() =>
    groupBySurface(watchlistEntries(this.document(), this.titles())),
  );

  protected readonly entries = computed<WatchlistEntry[]>(() => this.grouped()[this.active()]);

  /**
   * The degraded-state notices (FR-012), read from the same two sources the
   * deck reads them from — `Connectivity.isOffline` and the catalog's own
   * fallback signal — so the two screens cannot explain one condition
   * differently.
   */
  protected readonly isOffline = this.connections.isOffline;

  protected readonly usingCachedTitles = this.catalog.usingCachedTitles;

  constructor() {
    this.catalog.loadTitles(this.region).subscribe((titles) => this.titles.set(titles));
  }

  /** The number on a tab: literally the length of the list it opens. */
  protected countOf(surface: WatchlistSurface): number {
    return this.grouped()[surface].length;
  }

  protected select(surface: WatchlistSurface): void {
    this.active.set(surface);
  }
}
