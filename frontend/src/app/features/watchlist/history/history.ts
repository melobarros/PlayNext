import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { InteractionDocument } from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { DEFAULT_REGION } from '../../../core/models/quiz-options.data';
import { CatalogService } from '../../../core/services/catalog.service';
import { InteractionStore } from '../../../core/services/interaction-store';
import { artworkAlt, Poster } from '../../../shared/poster/poster';
import { historyEntries, HistoryEntryView } from '../watchlist-logic/entries';
import { formatChosenAt } from '../watchlist-logic/dates';

/** One history row, with the title resolved and the choice time already worded. */
interface HistoryRow extends HistoryEntryView {
  /** `null` when the catalog no longer knows the id — the row says so instead. */
  name: string | null;
  /** The choice time, formatted for display rather than as a timestamp. */
  chosenAtLabel: string;
}

/**
 * The watching history: every Watch Now decision, newest first (US3, FR-008).
 *
 * The counterpart to the watchlist. Ratings are the loop's *inputs*; this is
 * its *output*, and it is a separate destination rather than a fourth tab
 * because a fourth tab is not what it is — the watchlist is what the visitor
 * decided about titles, the history is what they decided to *do* (research.md
 * D3).
 *
 * **This screen is the only route to a `watchingNow` title.** That state is set
 * by the deck's Watch Now action and appears in no tab, so if a row here opened
 * a read-only view, that rating could never be changed — the identical dead end
 * the 2026-09-26 clarification closed for `notInterested`. Every row therefore
 * opens the shared detail view, re-rate control and all (research.md D9), and
 * `history.spec.ts` proves that through the route table rather than assuming it.
 *
 * **No streaming links are rendered here**, deliberately. A row is a decision,
 * not a page of availability; the links come from the catalog at render time
 * when a title is opened (research.md D10), so what the visitor acts on is
 * today's answer rather than a snapshot taken when they chose.
 *
 * Like the watchlist, a **derived view**: computed from the interaction document
 * plus the catalog, with nothing cached and no second storage key.
 */
@Component({
  selector: 'app-watch-history',
  imports: [Poster, RouterLink],
  templateUrl: './history.html',
})
export class WatchHistory {
  private readonly catalog = inject(CatalogService);
  private readonly interactions = inject(InteractionStore);

  /** Region scopes provider availability, never the title list (CatalogService). */
  private readonly region = DEFAULT_REGION;

  private readonly titles = signal<MediaTitle[]>([]);

  private readonly document = signal<InteractionDocument>(this.interactions.read());

  /**
   * The rows, resolved and worded.
   *
   * `name` stays nullable rather than being flattened to a fallback sentence
   * here: the template needs to know *which* case it is in, because an
   * unavailable title gets different wording from a known one and the poster
   * beside it has to agree. `artworkAlt` below takes the same null and says the
   * same "unavailable", so the two never disagree about the same row.
   */
  protected readonly rows = computed<HistoryRow[]>(() =>
    historyEntries(this.document(), this.titles()).map((entry) => ({
      ...entry,
      name: entry.title?.title ?? null,
      chosenAtLabel: formatChosenAt(entry.chosenAt),
    })),
  );

  constructor() {
    this.catalog.loadTitles(this.region).subscribe((titles) => this.titles.set(titles));
  }

  protected posterAlt(row: HistoryRow): string {
    return artworkAlt(row.title);
  }
}
