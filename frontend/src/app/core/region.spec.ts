import { DEFAULT_REGION } from './models/quiz-options.data';
import { currentRegion, deriveRegion, regionLabel } from './region';

/**
 * The region the catalog is scoped to (FR-005, research.md D14).
 *
 * This is the client's end of a contract with a server that is deliberately
 * strict: `GET /api/catalog` refuses anything that is not two uppercase ASCII
 * letters with a 400, rather than quietly uppercasing it (contracts/catalog.md,
 * `CatalogRegion`). So the interesting cases here are not "does it find BR in
 * pt-BR" — they are the tags where a plausible implementation produces
 * something the server will refuse, or worse, a *different valid country* than
 * the visitor is in.
 *
 * The spec is written against a pure function on purpose. Reading
 * `navigator.language` is one call in one place; everything that can be got
 * wrong is in what happens to the string afterwards, and that part takes an
 * argument.
 */
describe('deriveRegion', () => {
  it('reads the country out of a language-region tag', () => {
    expect(deriveRegion('pt-BR')).toBe('BR');
    expect(deriveRegion('en-US')).toBe('US');
  });

  it('falls back for a tag that names a language and no country', () => {
    // "pt" is not a country, and guessing Portugal from it would send a
    // Brazilian visitor to a catalog full of the wrong streaming services.
    expect(deriveRegion('pt')).toBe(DEFAULT_REGION);
    expect(deriveRegion('en')).toBe(DEFAULT_REGION);
  });

  it('uppercases the country, because the server will not', () => {
    // BCP 47 is case-insensitive, so "pt-br" is a legal tag a browser may hand
    // over. The server answers it with a 400 instead of a catalog, so
    // normalizing here is the difference between a working deck and an empty
    // one for a visitor whose device reports its tag in lowercase.
    expect(deriveRegion('pt-br')).toBe('BR');
    expect(deriveRegion('EN-us')).toBe('US');
  });

  it('skips a script subtag to reach the country', () => {
    // "zh-Hans-CN": the four-letter subtag is a script, not a region, and the
    // first two-letter subtag after the language is the country.
    expect(deriveRegion('zh-Hans-CN')).toBe('CN');
    expect(deriveRegion('sr-Latn-RS')).toBe('RS');
  });

  it('does not mistake an extension for a country', () => {
    // "en-u-ca-gregory" carries no region at all: everything after the "u"
    // singleton is an extension, and "ca" in there is a calendar. Taking the
    // first two-letter subtag blindly would send an English speaker to Canada.
    expect(deriveRegion('en-u-ca-gregory')).toBe(DEFAULT_REGION);
  });

  it('falls back for anything it cannot read as a tag', () => {
    // "-BR" is the case worth naming: a leading hyphen makes the first subtag
    // empty, so there is no language and the tag is not one — reading the "BR"
    // out of it anyway would be guessing at a malformed string.
    for (const tag of ['', '   ', 'not a tag', 'x', '12', 'e', '-BR', null, undefined]) {
      expect(deriveRegion(tag)).toBe(DEFAULT_REGION);
    }
  });

  it('never answers with anything the server would refuse', () => {
    // The property that matters, stated once: whatever comes in, what goes out
    // is either a well-formed region or the default, which is one.
    const tags = ['pt-BR', 'en-US', 'pt', 'zh-Hans-CN', 'en-u-ca-gregory', '', 'nonsense', null];

    for (const tag of tags) {
      expect(deriveRegion(tag)).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('currentRegion', () => {
  /** Reports `tag` as the device's language for the duration of one test. */
  function deviceLanguageIs(tag: string | undefined): void {
    Object.defineProperty(navigator, 'language', { value: tag, configurable: true });
  }

  const original = navigator.language;

  afterEach(() => deviceLanguageIs(original));

  it('derives from what the device reports', () => {
    deviceLanguageIs('pt-BR');

    expect(currentRegion()).toBe('BR');
  });

  it('falls back when the device reports nothing usable', () => {
    deviceLanguageIs(undefined);

    expect(currentRegion()).toBe(DEFAULT_REGION);
  });
});

describe('regionLabel', () => {
  it('names the country and keeps the code beside it', () => {
    // Both, not one. "Czechia" and "Czech Republic" are one country under two
    // spellings, and the code is the half that does not depend on which one
    // this build happened to write down.
    expect(regionLabel('BR')).toBe('Brazil (BR)');
    expect(regionLabel('US')).toBe('United States (US)');
  });

  it('normalizes the case, as the region itself is normalized', () => {
    // `deriveRegion` uppercases, and this is fed its output — but a caller that
    // passed "br" should get the name rather than the fallback, which would
    // read as "we have never heard of this country".
    expect(regionLabel('br')).toBe('Brazil (BR)');
    expect(regionLabel('gb')).toBe('United Kingdom (GB)');
  });

  it('shows the bare code for a country it does not name, and invents nothing', () => {
    // The fallback is the point of the function. Rendering a country name we do
    // not have would be a guess presented as a fact — the mistake this module
    // already refuses to make when it declines to read a country out of "pt".
    expect(regionLabel('ZW')).toBe('ZW');
    expect(regionLabel('zw')).toBe('ZW');
    expect(regionLabel('QQ')).toBe('QQ');
  });

  it('names every region the app can fall back to', () => {
    // `DEFAULT_REGION` is the value a visitor with an unreadable language tag
    // gets, which makes it the one region guaranteed to be shown to somebody.
    expect(regionLabel(DEFAULT_REGION)).not.toBe(DEFAULT_REGION);
  });
});
