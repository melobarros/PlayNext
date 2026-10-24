import { DimensionChoice, Preference } from '../models/quiz';

/**
 * An opaque digest of the filters a deck was ranked under (009, research D7).
 *
 * The record needs to answer one question about the visitor's quiz — "were
 * these two decks ranked under the same filters?" — without storing the quiz
 * itself. The selection is a preference document, and copying it into an
 * append-only log would make the log a profile; a sixteen-character hash
 * answers the question and nothing else.
 *
 * **FNV-1a, 64-bit.** Chosen for what it is not: no dependency, no salt to
 * manage, no key, and trivially reproducible in any language the analysis side
 * might later use. It is a fingerprint, not a security control — the input is
 * low-entropy and guessable by design, so a cryptographic hash would add cost
 * without adding secrecy.
 *
 * **Canonical form first.** Dimensions are deduplicated and sorted before
 * hashing, because the contract reads a dimension as OR — order and repetition
 * carry no meaning, and a digest that split "horror, thriller" from "thriller,
 * horror" would split one population in two. `completedAt` is excluded: it says
 * when the quiz was answered, not what the deck was filtered to.
 */
export function filterDigest(region: string, preferences: Preference): string {
  const canonical = JSON.stringify({
    region,
    mediaType: canonicalChoice(preferences.mediaType),
    genre: canonicalChoice(preferences.genre),
    provider: canonicalChoice(preferences.provider),
    includeUnownedProviders: preferences.includeUnownedProviders,
  });

  return fnv1a64(canonical);
}

/** One dimension in canonical form: the `any` flag, then the sorted distinct values. */
function canonicalChoice(choice: DimensionChoice<string>): [boolean, string[]] {
  return [choice.any, [...new Set(choice.values)].sort()];
}

/** 64-bit FNV-1a over the UTF-8 bytes of the text, as sixteen hex characters. */
function fnv1a64(text: string): string {
  const offsetBasis = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask64 = 0xffffffffffffffffn;

  let hash = offsetBasis;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask64;
  }

  // Padded so the digest has one fixed width: a leading zero does not make a
  // different filter set, and a variable-length string would.
  return hash.toString(16).padStart(16, '0');
}
