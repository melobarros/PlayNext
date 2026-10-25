import { Interaction } from '../../../core/models/interaction';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import { RankedTitle } from './recommend-shared';
import { RECOMMEND_V1_ENGINE_VERSION, rankTitlesV1 } from './recommend-v1';
import { RECOMMEND_V2_ENGINE_VERSION, rankTitlesV2 } from './recommend-v2';

/**
 * The recommendation engine's public surface
 * (`specs/002-recommendation-deck/contracts/recommendation-engine.md`,
 * `specs/010-deterministic-engine-v2/contracts/ranking-engine.md`).
 *
 * Feature 010 split the ordering rules into versioned modules —
 * `recommend-v1.ts` (the incumbent) and `recommend-v2.ts` (the candidate) —
 * while the candidate rule, the shared types, and this registry stay here. A
 * caller asks for an engine by name; it never imports a module directly unless
 * it is the offline harness, which must pin each row to a known version.
 *
 * A pure function, deliberately: it is the product's core asset and the reason
 * the deck is trustworthy, so both constitution invariants — Filter Enforcement
 * and the Feedback Loop — are provable by test rather than arguable. No Angular,
 * no DOM, no clock, no network, and **no randomness anywhere** (constitution VI).
 */

export { eligibleTitles, weightedRating, type RankedTitle } from './recommend-shared';

/**
 * The engine the deck runs unless asked otherwise (010, D7).
 *
 * **v2, by the owner's decision of 2026-10-24.** The spec's gate for switching
 * the default was a 10% NDCG@10 win over the incumbent on the frozen
 * `personas-v1` fixture (SC-001). v2 measured 0.611 against the incumbent's
 * 0.675 and did not clear it, so implementation initially shipped the fallback
 * with v1 as the default. The owner then chose to put v2 in front of every
 * visitor anyway, accepting the fixture result: the deck now runs v2, and the
 * incumbent stays selectable through `?engine=v1` and in the harness.
 *
 * Measured numbers: `specs/010-deterministic-engine-v2/tasks.md`, Evidence.
 */
export const DEFAULT_ENGINE = 'v2' as const;

export type EngineChoice = 'v1' | 'v2';

/**
 * The version string each choice stamps on an impression (FR-012).
 *
 * The deck records the engine that produced the card, not the engine that is
 * default today, so a stored row months later names the rule that actually
 * ranked it.
 */
export const ENGINE_VERSIONS: Readonly<Record<EngineChoice, string>> = {
  v1: RECOMMEND_V1_ENGINE_VERSION,
  v2: RECOMMEND_V2_ENGINE_VERSION,
};

/**
 * The default engine's version.
 *
 * Bump the default's entry whenever a change could reorder the deck; the
 * offline harness then compares the old fixture against the new rule instead of
 * comparing two reports that quietly disagree about what "incumbent" means.
 * During the 010 rollout this constant follows `DEFAULT_ENGINE`.
 */
export const RECOMMEND_ENGINE_VERSION = ENGINE_VERSIONS[DEFAULT_ENGINE];

/**
 * Turns the deck's `?engine=` value into a choice (010, D7).
 *
 * Each engine is selectable by name; everything else — absent, empty, unknown —
 * falls back to the current default, because an invalid override is not an
 * error a visitor should ever see. The default is v2 (the decision of
 * 2026-10-24); `v1` is the override that asks for the incumbent.
 */
export function engineChoiceFrom(value: string | null): EngineChoice {
  return value === 'v1' || value === 'v2' ? value : DEFAULT_ENGINE;
}

/**
 * Ranks the catalog for a visitor with the chosen engine, best first.
 *
 * Returns a new array every call and never mutates its inputs. An empty result
 * is a normal value — it drives the empty state (FR-014), it is not an error.
 */
export function rankTitles(
  catalog: readonly MediaTitle[],
  preferences: Preference,
  interactions: Readonly<Record<string, Interaction>>,
  shownTitleIds: readonly string[],
  engine: EngineChoice = DEFAULT_ENGINE,
): RankedTitle[] {
  return engine === 'v1'
    ? rankTitlesV1(catalog, preferences, interactions, shownTitleIds)
    : rankTitlesV2(catalog, preferences, interactions, shownTitleIds);
}
