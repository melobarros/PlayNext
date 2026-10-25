import { personasFixture } from './fixtures/personas';
import { formatReport } from './report';
import { evaluate } from './replay';
import { candidateV2Ranker, incumbentRanker, invertedRanker } from './rankers';
import { FixtureSession } from './types';

/**
 * The harness's own contract (T041, T048)
 * (`specs/009-recommendation-telemetry/contracts/evaluation-harness.md`).
 *
 * Everything the contract promises about a *report* — which rows it always
 * has, what range a measure lies in, that the same fixture yields the same
 * numbers, and that a worse ordering scores worse — is asserted here against
 * the committed fixture. The measures' formulas are pinned separately in
 * `metrics.spec.ts`; this file is about the run.
 */

/** The fixture's session with no like and no watch-now, by construction. */
function silentSessions(): FixtureSession[] {
  return personasFixture.sessions.filter(
    (session) =>
      !session.events.some(
        (event) =>
          event.type === 'action' && (event.kind === 'liked' || event.kind === 'watch_now'),
      ),
  );
}

describe('the evaluation report', () => {
  // The standard run: the incumbent, the baseline, the candidate this feature
  // ships, and the deliberately inverted control (010, D9).
  const report = evaluate(personasFixture, candidateV2Ranker, invertedRanker);

  it('always carries the incumbent, the popularity baseline and every candidate', () => {
    expect(report.report.map((entry) => entry.name)).toEqual([
      'incumbent',
      'popularity',
      'candidate-v2',
      'candidate-inverted',
    ]);
  });

  it('does not report the incumbent twice when it is the candidate', () => {
    const onlyIncumbent = evaluate(personasFixture, incumbentRanker);

    expect(onlyIncumbent.report.map((entry) => entry.name)).toEqual(['incumbent', 'popularity']);
  });

  it('names the frozen data it describes', () => {
    expect(report.fixtureId).toBe('personas-v1');
    expect(report.catalogVersion).toBe(personasFixture.catalogVersion);
  });

  it('keeps every measure inside [0, 1]', () => {
    for (const entry of report.report) {
      for (const value of [
        entry.ndcgAt10,
        entry.mrr,
        entry.hitRateAt10,
        entry.precisionAt10,
        entry.coverage,
        entry.intraListDiversity,
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }

      expect(entry.engineVersion).not.toBe('');
      expect(entry.sessions).toBe(personasFixture.sessions.length);
      expect(entry.evaluatedDecisions).toBeGreaterThan(0);
    }
  });

  it('counts a session with no relevant action toward coverage but not toward the ranking measures', () => {
    const silent = silentSessions();

    expect(silent).toHaveLength(1);

    const solo = evaluate({ ...personasFixture, sessions: silent }, incumbentRanker);

    // Nothing in it was ever wanted, so there is nothing to have retrieved...
    expect(solo.report[0].evaluatedDecisions).toBe(0);
    // ...but its twenty top-ten lists were still shown, so they still tell us
    // what the deck offered.
    expect(solo.report[0].coverage).toBeGreaterThan(0);
  });

  it('produces deep-equal reports from two evaluations of the same fixture', () => {
    expect(evaluate(personasFixture, candidateV2Ranker, invertedRanker)).toEqual(report);
  });

  it('ranks a good ordering above a deliberately inverted one', () => {
    const incumbent = report.report[0];
    const candidate = report.report[3];

    // The labels in the fixture land on titles two selected genres deep, which
    // is exactly what the incumbent reads — and the reverse of what the
    // inverted candidate does with the same pool, always.
    expect(incumbent.ndcgAt10).toBeGreaterThan(candidate.ndcgAt10);
  });

  it('prints one row per ranker, with the engine that produced it', () => {
    const lines = formatReport(report).split('\n');
    const rows = lines.filter((line) => line.startsWith('| ') && !line.startsWith('| Ranker'));

    expect(rows).toHaveLength(report.report.length);

    for (const [index, entry] of report.report.entries()) {
      expect(rows[index]).toContain(`| ${entry.name} ${entry.engineVersion} |`);
      expect(rows[index].split('|')).toHaveLength(10);
    }
  });

  it('prints the report, so a CI run leaves the numbers in its log', () => {
    // The harness's output is its *only* output: it asserts nothing about how
    // good the deck is, it makes the comparison visible to whoever reads the
    // build.
    console.log(formatReport(evaluate(personasFixture, candidateV2Ranker, invertedRanker)));
  });
});
