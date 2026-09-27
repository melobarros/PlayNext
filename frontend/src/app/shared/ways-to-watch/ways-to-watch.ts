import { Component, computed, inject, input } from '@angular/core';
import { StreamingAvailability } from '../../core/models/media-title';
import { QuizOptionsService } from '../../core/services/quiz-options.service';

/** One service a title can be watched on, ready to render. */
export interface ProviderLink {
  name: string;
  url: string;
}

/**
 * "Where to watch": the title's streaming links, or an honest note that there
 * are none (FR-008).
 *
 * **Extracted rather than written twice.** Match Found and 003's detail view
 * show the same thing from the same catalog field, and what they show is not
 * neutral markup: every link opens away from the app with `rel="noopener"`
 * because an installed PWA has no back button, and an unknown provider id is
 * dropped rather than printed. Two copies of that reasoning is two chances for
 * one of them to stop being true (research.md D11).
 *
 * Provider names come from `QuizOptionsService` rather than from the caller, so
 * both callers pass the same one thing and cannot disagree about what a service
 * is called.
 */
@Component({
  selector: 'app-ways-to-watch',
  templateUrl: './ways-to-watch.html',
})
export class WaysToWatch {
  private readonly options = inject(QuizOptionsService);

  readonly availability = input.required<readonly StreamingAvailability[]>();

  private readonly providerNames = new Map(
    this.options.getProvidersById().map((provider) => [provider.id, provider.displayName]),
  );

  protected readonly links = computed(() =>
    providerLinks(this.availability(), this.providerNames),
  );
}

/**
 * Turns availability into labelled links, in catalog order.
 *
 * A provider id with no display name is **skipped**, matching the card's
 * badges. The visitor was only ever offered the services in the quiz, so an
 * unknown id is one they were never told they have — and a link labelled
 * "Watch on hbo-max-legacy" is worse than no link at all.
 *
 * Deduplicated by provider id: two entries for one service would read as two
 * separate ways to watch the same thing.
 */
export function providerLinks(
  availability: readonly StreamingAvailability[],
  namesById: ReadonlyMap<string, string>,
): ProviderLink[] {
  const links: ProviderLink[] = [];
  const seen = new Set<string>();

  for (const entry of availability) {
    const name = namesById.get(entry.providerId);
    if (name === undefined || seen.has(entry.providerId)) continue;

    seen.add(entry.providerId);
    links.push({ name, url: entry.deepLinkUrl });
  }

  return links;
}
