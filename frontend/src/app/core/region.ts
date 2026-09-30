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

/**
 * Display names for the regions this app is likely to be scoped to.
 *
 * Deliberately **not** a complete ISO 3166-1 table. A map that claims to be
 * complete is a map that goes stale in the next release, and the countries that
 * matter here are the ones with watch-provider data — so this names the places
 * a visitor is most likely to be in, and `regionLabel` below is honest about
 * the rest rather than quiet about them.
 */
const REGION_LABELS: Record<string, string> = {
  AR: 'Argentina',
  AT: 'Austria',
  AU: 'Australia',
  BE: 'Belgium',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CL: 'Chile',
  CO: 'Colombia',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  EC: 'Ecuador',
  EE: 'Estonia',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  HU: 'Hungary',
  ID: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IN: 'India',
  IT: 'Italy',
  JP: 'Japan',
  KR: 'South Korea',
  LT: 'Lithuania',
  LV: 'Latvia',
  MX: 'Mexico',
  MY: 'Malaysia',
  NL: 'Netherlands',
  NO: 'Norway',
  NZ: 'New Zealand',
  PE: 'Peru',
  PH: 'Philippines',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SE: 'Sweden',
  SG: 'Singapore',
  TH: 'Thailand',
  TR: 'Türkiye',
  TW: 'Taiwan',
  US: 'United States',
  VE: 'Venezuela',
  ZA: 'South Africa',
};

/**
 * The region as one display string: `"Brazil (BR)"`, or just `"ZW"` for a
 * country this build does not name.
 *
 * The code travels with the name rather than being dropped, because the name is
 * the part that can be wrong: "Türkiye" and "Turkey", "Czechia" and "Czech
 * Republic" are the same country under two spellings, and a visitor who knows
 * their own country by the other one still recognizes `TR`. It also makes the
 * line useful to someone who is somewhere we cannot name at all — they get the
 * code and nothing invented around it.
 *
 * The fallback is the bare code and **never a guess**. Rendering "Brazil" for a
 * country we only know as "ZW" would be inventing a fact, which is the mistake
 * this module's header already refuses to make for languages.
 */
export function regionLabel(code: string): string {
  const normalized = code.toUpperCase();
  const name = REGION_LABELS[normalized];

  return name === undefined ? normalized : `${name} (${normalized})`;
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
