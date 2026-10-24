import { Interaction } from '../../../../core/models/interaction';
import { MediaTitle } from '../../../../core/models/media-title';
import { Preference } from '../../../../core/models/quiz';
import { TelemetryActionKind } from '../../../../core/models/telemetry';

/**
 * The offline evaluation harness's vocabulary
 * (`specs/009-recommendation-telemetry/contracts/evaluation-harness.md`).
 *
 * Declared apart from the code that computes with it so the fixture, the
 * rankers, the replay and the report can each be read — and reviewed — against
 * one shared definition. A type added here is a claim about what a report
 * means, which is why none of them mention how a number is calculated.
 */

/**
 * A frozen run: one catalog, one region, and the sessions played against it.
 *
 * `catalogVersion` is carried into the report so two reports can be shown to
 * describe the same data. It is the catalog's own `fetchedAt`, not the date the
 * fixture file was written.
 */
export interface EvaluationFixture {
  fixtureId: string;
  /** ISO-8601, frozen. Compared between runs, never read as a clock. */
  catalogVersion: string;
  /** ISO 3166-1 alpha-2, the region the catalog is scoped to. */
  region: string;
  catalog: readonly MediaTitle[];
  sessions: readonly FixtureSession[];
}

/**
 * One visitor's walk, as it would have reached the server.
 *
 * `initialInteractions` is the state the visitor arrived with — ratings from
 * earlier sessions. They are input, never labels: a rated title is excluded
 * from the candidate pool, so it could never be retrieved and scoring it as a
 * miss would punish every ranker equally for a card nobody could have shown.
 */
export interface FixtureSession {
  sessionId: string;
  preference: Preference;
  initialInteractions: Record<string, Interaction>;
  /** In the order they happened. Timestamps increase within a session. */
  events: readonly FixtureEvent[];
}

/**
 * What the record holds, replayed in order.
 *
 * A discriminated union rather than one shape with a nullable `kind`, because
 * an impression and an action answer different questions and the replay reads
 * exactly one of them at a time.
 */
export type FixtureEvent =
  | { type: 'impression'; titleId: string; shownAt: string }
  | { type: 'action'; titleId: string; kind: TelemetryActionKind; occurredAt: string };

/** Everything a ranker is allowed to know at one decision. */
export interface RankerInput {
  catalog: readonly MediaTitle[];
  preference: Preference;
  interactions: Readonly<Record<string, Interaction>>;
  shownTitleIds: readonly string[];
}

/**
 * One ranking rule.
 *
 * `rank` must be pure — no clock, no network, no randomness, and a total
 * tie-breaker — or two runs of the same fixture would disagree and the report
 * would stop being comparable with last week's.
 */
export interface Ranker {
  readonly name: string;
  readonly engineVersion: string;
  rank(input: RankerInput): readonly MediaTitle[];
}

/** One decision: what a ranker offered, and what turned out to be wanted. */
export interface RankedDecision {
  /** Title ids, best first. At most ten; shorter when the pool is smaller. */
  readonly ranked: readonly string[];
  /** Titles the visitor liked or chose to watch later in the same session. */
  readonly labels: ReadonlySet<string>;
}

/** One ranker's row in the report. Every measure is in `[0, 1]`. */
export interface RankerReport {
  name: string;
  engineVersion: string;
  ndcgAt10: number;
  mrr: number;
  hitRateAt10: number;
  precisionAt10: number;
  /** Distinct titles offered / distinct titles in the fixture catalog. */
  coverage: number;
  intraListDiversity: number;
  /** Decisions with at least one label: the denominator of the four above. */
  evaluatedDecisions: number;
  /** Sessions replayed, including any that contributed no evaluated decision. */
  sessions: number;
}

/**
 * The whole run.
 *
 * `report` always carries the incumbent and the popularity baseline, whatever
 * the caller asked to compare: a candidate with no reference point is a number
 * without a meaning.
 */
export interface EvaluationReport {
  fixtureId: string;
  catalogVersion: string;
  report: readonly RankerReport[];
}
