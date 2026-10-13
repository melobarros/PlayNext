import { Component } from '@angular/core';

/**
 * A per-instance gradient id.
 *
 * SVG `url(#id)` references resolve document-wide, so two lockups on one page
 * sharing an id would not break the render — both gradients are identical — but
 * it would be two elements claiming one name, which is the kind of thing that
 * stops being harmless the first time one of them is styled. A counter is one
 * line and removes the question.
 */
let instances = 0;

/**
 * The PlayNext lockup: the mark, then the wordmark.
 *
 * Drawn inline rather than loaded from `public/logo.svg`. The same reasoning as
 * `icons.ts`, which holds every other glyph in this app as a path rather than a
 * dependency: the mark is decoration on a word that already says the name, so
 * it should not cost a request, should not arrive after the text it sits beside,
 * and should follow the theme rather than carry its own copy of the palette.
 * `public/logo.svg` is the same geometry for the two callers that cannot use a
 * component — the favicon and the README.
 *
 * The mark is `aria-hidden` and the word is real text, so a screen reader hears
 * "PlayNext" once rather than a graphic and then a word. The two halves are
 * adjacent spans with no whitespace between them, which is what makes that one
 * word instead of two.
 */
@Component({
  selector: 'app-logo',
  host: { class: 'block' },
  template: `
    <span class="inline-flex items-center gap-2">
      <svg class="h-7 w-7 shrink-0" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient
            [attr.id]="gradientId"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="64"
            y2="64"
          >
            <stop offset="0" stop-color="#6a46f5" />
            <stop offset="1" stop-color="#9b82ff" />
          </linearGradient>
        </defs>

        <rect width="64" height="64" rx="14" [attr.fill]="fill" />

        <!--
          Two triangles: the front one is Play, the one behind it is Next. The
          stroke is the same colour as the fill at the same opacity, which is
          the whole of how these get rounded corners — an SVG triangle has none,
          and the rounding is what keeps the mark soft rather than sharp.
        -->
        <g fill="#ffffff" stroke="#ffffff" stroke-width="7" stroke-linejoin="round">
          <path d="M12 20 L30 32 L12 44 Z" fill-opacity=".4" stroke-opacity=".4" />
          <path d="M34 20 L52 32 L34 44 Z" />
        </g>
      </svg>

      <span class="text-xl font-semibold tracking-tight text-chalk-50"
        >Play<span class="text-accent-400">Next</span></span
      >
    </span>
  `,
})
export class Logo {
  protected readonly gradientId = `playnext-mark-${instances++}`;
  protected readonly fill = `url(#${this.gradientId})`;
}
