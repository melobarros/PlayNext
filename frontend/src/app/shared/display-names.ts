/**
 * Ids resolved to the names the visitor reads.
 *
 * Genres, providers and media types are stored as ids so a preference and a
 * title are directly comparable — there is no mapping table anywhere in the
 * codebase. This is the one place those ids become words.
 *
 * Two rules, and both are about not showing the visitor something they cannot
 * act on:
 *
 * - An **unknown id is dropped**. An unrecognised provider is a data fault, and
 *   printing it raw would put `a-defunct-service` on screen (data-model.md:
 *   ignored, not fatal).
 * - **A repeated name is listed once.** One service reached through two
 *   availability entries is one badge, not two.
 *
 * Generic rather than provider-specific on purpose: the deck card uses it for
 * genres as well, and a genre list that deduplicated differently from a
 * provider list would be a divergence nobody notices until it matters
 * (research.md D11 — extracted, not copied).
 */
export function displayNames(
  ids: readonly string[],
  namesById: ReadonlyMap<string, string>,
): string[] {
  const names: string[] = [];

  for (const id of ids) {
    const name = namesById.get(id);
    if (name !== undefined && !names.includes(name)) names.push(name);
  }

  return names;
}
