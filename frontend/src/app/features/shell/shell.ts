import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/**
 * The frame around every main screen (003 FR-013).
 *
 * Two decisions worth stating, because both are easy to undo by accident:
 *
 * **Onboarding is outside this.** The quiz and the entry hop are not children
 * of this route, so they render no nav (research.md D5). Offering "skip to my
 * watchlist" to a visitor who has rated nothing would undercut the quiz and
 * land them on an empty screen — the dead end Principle II forbids, arrived at
 * by a shortcut rather than by a gap.
 *
 * **The nav is fixed and the content is padded to match.** A nav that floats
 * over the content has to be paid for somewhere, and `pb-16` on the outlet
 * wrapper is that payment. The `data-nav-clearance` marker is what the shell
 * spec reads: the nav's height and this padding live in two places, and a test
 * that reads the marker fails when they stop agreeing.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
})
export class Shell {
  /**
   * The nav's destinations, in order.
   *
   * Two, and deliberately not three: the history is reached from the watchlist
   * rather than the nav, because it is a part of the watchlist rather than a
   * peer of it. Every entry here is one tap from every screen behind the shell,
   * which is the whole of SC-006.
   */
  protected readonly destinations = [
    { path: '/deck', label: 'Deck' },
    { path: '/watchlist', label: 'Watchlist' },
  ];
}
