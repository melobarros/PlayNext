import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MediaTitle } from '../../../core/models/media-title';
import { DEFAULT_REGION } from '../../../core/models/quiz-options.data';
import { MEDIA_TYPE_LABELS } from '../../../core/models/quiz';
import { CatalogService } from '../../../core/services/catalog.service';
import { DeckSessionStore } from '../../../core/services/deck-session-store';
import { QuizOptionsService } from '../../../core/services/quiz-options.service';
import { startNewLoop } from '../deck-logic/deck-session';

/** One service the chosen title can be watched on, ready to render. */
interface WayToWatch {
  name: string;
  url: string;
}

/**
 * Match Found: the end of a decision, and the start of watching something.
 *
 * **Resolved from the URL, not from navigation state** (research.md D10). The
 * only thing this view is given is a `titleId`; everything else comes from the
 * catalog. That is what makes the browser's back button and a mid-decision
 * refresh work, and it matches how spec 003 refreshes streaming links from
 * current availability rather than freezing them into a saved record.
 *
 * The route param binds to `titleId` through `withComponentInputBinding()`, so
 * this is an `input` like `Card`'s — the component declares what it needs and
 * the router supplies it.
 *
 * **Nothing plays here.** The trailer is an ordinary link to the official
 * service; no iframe, no player, no third-party script (FR-008). PlayNext hosts
 * no content, so there is nothing for a player to do but add weight and a
 * privacy problem.
 */
@Component({
  selector: 'app-match-found',
  templateUrl: './match-found.html',
})
export class MatchFound {
  private readonly catalog = inject(CatalogService);
  private readonly options = inject(QuizOptionsService);
  private readonly sessions = inject(DeckSessionStore);
  private readonly router = inject(Router);

  /** The `:titleId` route parameter. */
  readonly titleId = input.required<string>();

  private readonly titles = signal<MediaTitle[]>([]);

  private readonly providerNames = new Map(
    this.options.getProvidersById().map((provider) => [provider.id, provider.displayName]),
  );

  /** The chosen title, or `null` when the catalog no longer knows the id. */
  protected readonly title = computed(
    () => this.titles().find((candidate) => candidate.id === this.titleId()) ?? null,
  );

  protected readonly mediaTypeLabel = computed(() => {
    const match = this.title();
    return match === null ? '' : MEDIA_TYPE_LABELS[match.mediaType];
  });

  protected readonly waysToWatch = computed<WayToWatch[]>(() =>
    providerLinks(this.title()?.availability ?? [], this.providerNames),
  );

  protected readonly trailerUrl = computed(() => this.title()?.trailerUrl ?? null);

  constructor() {
    this.catalog.loadTitles(DEFAULT_REGION).subscribe((titles) => this.titles.set(titles));
  }

  /**
   * Throws away the finished loop and returns to a fresh one.
   *
   * Available in every state, including the unavailable one: Match Found is
   * where a decision ends, so it is the last place that should be a dead end
   * (constitution II).
   */
  protected startNewLoop(): void {
    this.sessions.write(startNewLoop());
    void this.router.navigate(['/deck']);
  }
}

/**
 * Turns availability into labelled links, in catalog order.
 *
 * A provider id with no display name is **skipped**, matching `Card`'s badges.
 * The visitor was only ever offered the services in the quiz, so an unknown id
 * is one they were never told they have — and a link labelled
 * "Watch on hbo-max-legacy" is worse than no link at all.
 *
 * Deduplicated by provider id: two entries for one service would read as two
 * separate ways to watch the same thing.
 */
function providerLinks(
  availability: readonly { providerId: string; deepLinkUrl: string }[],
  namesById: ReadonlyMap<string, string>,
): WayToWatch[] {
  const links: WayToWatch[] = [];
  const seen = new Set<string>();

  for (const entry of availability) {
    const name = namesById.get(entry.providerId);
    if (name === undefined || seen.has(entry.providerId)) continue;

    seen.add(entry.providerId);
    links.push({ name, url: entry.deepLinkUrl });
  }

  return links;
}
