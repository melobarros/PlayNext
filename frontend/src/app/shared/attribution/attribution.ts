import { Component } from '@angular/core';

/**
 * The provider's attribution notice (FR-018, research D13).
 *
 * **Both halves of the requirement, because the terms ask for both.** §3 of
 * TMDB's API Terms of Use requires the logo *and* a notice sentence, and the
 * sentence is given verbatim with only one word left to the Application:
 *
 *   "This [website, program, service, application, product] uses TMDB and the
 *   TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB."
 *
 * 005 originally shipped a paraphrase — "uses the TMDB API", "is not endorsed
 * or certified" — and a comment claiming the wording was the provider's and
 * not ours to rephrase. It was not the provider's; it had been reconstructed
 * from memory. The wording is quoted in `attribution.html` and pinned in
 * `attribution.spec.ts` for that reason: it is a term of the licence, not copy
 * we are free to tighten, and a test that reads the string off the template
 * would happily watch it drift.
 *
 * **Shared rather than written per screen.** The deck carried this line alone
 * while the watchlist, history and detail screens each render the provider's
 * titles and artwork with no notice anywhere near them. Four copies of a
 * legally-required sentence is four chances for one to be edited, and the
 * screen that gets missed is the one that was never updated — so the sentence
 * lives in one place and each screen imports it.
 *
 * The logo is bundled into `public/` rather than hotlinked: the client talks
 * only to our own API, which is what the SC-006 credential scan verified, and
 * an `<img>` pointing at the provider's site would quietly reopen a direct
 * channel from the visitor's browser to theirs.
 */
@Component({
  selector: 'app-attribution',
  templateUrl: './attribution.html',
})
export class Attribution {}
