import { EvaluationReport, RankerReport } from './types';

/**
 * The harness's printed output
 * (`specs/009-recommendation-telemetry/contracts/evaluation-harness.md`).
 *
 * A markdown table because the report's life is a CI log and a pasted comment:
 * both are read side by side with an earlier run, and aligned columns are what
 * makes a change of three thousandths visible instead of buried in prose.
 */

/** Columns in the contract's order — the order two reports are read in. */
const HEADER =
  '| Ranker | NDCG@10 | MRR | Hit@10 | Precision@10 | Coverage | Diversity | Decisions |';

const DIVIDER = '|---|---|---|---|---|---|---|---|';

/** Three decimals: enough to show a ranking change, few enough to diff by eye. */
function measure(value: number): string {
  return value.toFixed(3);
}

/**
 * One row: the ranker, its six measures, and the decisions they were averaged
 * over.
 *
 * `engineVersion` shares the first cell with the name because a row that does
 * not say which engine produced it is not a comparison — `incumbent` will be
 * `recommend-v2` one day, and two tables must never look alike across that
 * line.
 */
function row(entry: RankerReport): string {
  return [
    `| ${entry.name} ${entry.engineVersion}`,
    measure(entry.ndcgAt10),
    measure(entry.mrr),
    measure(entry.hitRateAt10),
    measure(entry.precisionAt10),
    measure(entry.coverage),
    measure(entry.intraListDiversity),
    String(entry.evaluatedDecisions),
    '',
  ].join(' | ');
}

/**
 * The caption names the frozen data, then the table.
 *
 * `fixtureId` and `catalogVersion` are in the report for exactly this reason:
 * a number only means something against the catalog that produced it, and a
 * log line that omits them invites comparing two runs of different data.
 */
export function formatReport(report: EvaluationReport): string {
  return [
    `fixture ${report.fixtureId} · catalog ${report.catalogVersion}`,
    '',
    HEADER,
    DIVIDER,
    ...report.report.map(row),
  ].join('\n');
}
