import { DEFAULT_REGION } from './models/quiz-options.data';

/**
 * The region the catalog is scoped to (FR-005, research.md D14).
 *
 * The visitor's region is a **browser fact, not a preference**: nothing in the
 * quiz asks for it, and asking would be one more question between a visitor and
 * a card (constitution II). The device already knows, so `navigator.language`
 * is where it comes from — and this module is the only place in the app that
 * reads it, so the fallback rule below has exactly one owner.
 *
 * What it does *not* do is invent a country for a language. "pt" is spoken in
 * Brazil, Portugal, Angola and elsewhere; "en" in a few dozen countries.
 * Picking one from the language would be a guess presented as a fact, so a tag
 * without a region falls back to `DEFAULT_REGION` and the app is honest about
 * being scoped to somewhere rather than pretending to be local.
 *
 * **The output is uppercase, always.** The server refuses anything that is not
 * two uppercase ASCII letters (`CatalogRegion`, contracts/catalog.md) rather
 * than quietly normalizing it — a deliberate strictness, so a client that
 * starts sending lowercase fails loudly in development. BCP 47 tags are
 * case-insensitive, though, so a device is entitled to report "pt-br", and this
 * is where that gets settled before it becomes a 400.
 */
export function deriveRegion(languageTag: string | null | undefined): string {
  const subtags = (languageTag ?? '').split('-');

  // Without a language at the front this is not a language tag: "-BR" and ""
  // both land here, and reading a country out of either would be guessing at a
  // string that does not mean anything.
  if (!isLanguage(subtags[0])) {
    return DEFAULT_REGION;
  }

  for (const subtag of subtags.slice(1)) {
    // A one-character subtag is an extension singleton ("en-u-ca-gregory"):
    // everything after it belongs to the extension, and a "ca" in there is a
    // calendar, not Canada. Stop rather than keep looking.
    if (subtag.length === 1) {
      break;
    }

    // The first two-letter subtag is the region. A four-letter one is a script
    // ("zh-Hans-CN") and is skipped by the same test.
    if (isCountry(subtag)) {
      return subtag.toUpperCase();
    }
  }

  return DEFAULT_REGION;
}

/**
 * The visitor's region, as the device reports it.
 *
 * The one call site of `navigator.language` in the app, so the pure function
 * above can be tested without a browser and the browser is read in exactly one
 * place. Every component that loads a catalog asks for a region; none of them
 * needs to know where it came from.
 */
export function currentRegion(): string {
  return deriveRegion(navigator.language);
}

/** Whether a subtag can be the language of a tag: 2–8 ASCII letters. */
function isLanguage(subtag: string | undefined): boolean {
  return subtag !== undefined && subtag.length >= 2 && subtag.length <= 8 && isAsciiLetters(subtag);
}

/** Whether a subtag is an ISO 3166-1 alpha-2 country code, in any case. */
function isCountry(subtag: string): boolean {
  return subtag.length === 2 && isAsciiLetters(subtag);
}

/**
 * ASCII letters only, deliberately — `\p{L}` would accept "１２" and every
 * accented letter, and a subtag is never any of those.
 */
function isAsciiLetters(value: string): boolean {
  return /^[A-Za-z]+$/.test(value);
}
