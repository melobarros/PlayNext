import { eligibleTitles } from '../../recommend';
import { FixtureEvent, FixtureSession } from '../types';
import { personasFixture } from './personas';

/**
 * The frozen fixture's own invariants (T040).
 *
 * A fixture is an input to every number the harness prints, so it gets tested
 * like code: if a persona's walk drifts under the pool its preference admits,
 * or a title id stops resolving, the report does not fail — it silently starts
 * measuring a deck that could not have existed. These assertions are what keep
 * that from happening quietly.
 */

function impressions(session: FixtureSession): FixtureEvent[] {
  return session.events.filter((event) => event.type === 'impression');
}

function actions(session: FixtureSession): FixtureEvent[] {
  return session.events.filter((event) => event.type === 'action');
}

function timestamp(event: FixtureEvent): string {
  return event.type === 'impression' ? event.shownAt : event.occurredAt;
}

describe('the personas fixture', () => {
  it('is built from more than forty titles across the quiz’s genres', () => {
    const ids = new Set(personasFixture.catalog.map((title) => title.id));
    const genres = new Set(personasFixture.catalog.flatMap((title) => title.genres));

    // Distinct: two genres may not contribute the same id, or a report's
    // coverage denominator would count one title twice.
    expect(ids.size).toBe(personasFixture.catalog.length);
    expect(ids.size).toBeGreaterThanOrEqual(40);
    expect(genres.size).toBeGreaterThanOrEqual(6);
  });

  it('plays four personas', () => {
    const sessionIds = personasFixture.sessions.map((session) => session.sessionId);

    expect(new Set(sessionIds).size).toBe(4);
    expect(sessionIds).toHaveLength(4);
  });

  it('gives every persona at least twenty impressions', () => {
    for (const session of personasFixture.sessions) {
      expect(impressions(session).length).toBeGreaterThanOrEqual(20);
    }
  });

  it('records at least one undo and at least one watch-now', () => {
    const kinds = personasFixture.sessions
      .flatMap(actions)
      .map((event) => (event.type === 'action' ? event.kind : null));

    expect(kinds).toContain('undo');
    expect(kinds).toContain('watch_now');
  });

  it('carries a session with nothing relevant in it', () => {
    // Without one, "no label" would be an untested path and a report could
    // divide by an untouched denominator without anyone noticing.
    const silent = personasFixture.sessions.filter(
      (session) =>
        !actions(session).some(
          (event) => event.type === 'action' && (event.kind === 'liked' || event.kind === 'watch_now'),
        ),
    );

    expect(silent.length).toBeGreaterThanOrEqual(1);
  });

  it('only shows cards the persona’s own preference admits', () => {
    // Eligibility is checked against the arrival state, which is a superset of
    // every later state: interactions only ever remove titles from the pool.
    for (const session of personasFixture.sessions) {
      const pool = new Set(
        eligibleTitles(
          personasFixture.catalog,
          session.preference,
          session.initialInteractions,
          [],
        ).map((title) => title.id),
      );

      for (const event of impressions(session)) {
        expect(pool.has(event.titleId)).toBe(true);
      }
    }
  });

  it('names only titles that exist in the frozen catalog', () => {
    const known = new Set(personasFixture.catalog.map((title) => title.id));

    for (const session of personasFixture.sessions) {
      for (const event of session.events) {
        expect(known.has(event.titleId)).toBe(true);
      }
    }
  });

  it('moves forward in time within every session', () => {
    for (const session of personasFixture.sessions) {
      const times = session.events.map((event) => Date.parse(timestamp(event)));

      for (let index = 1; index < times.length; index++) {
        expect(times[index]).toBeGreaterThan(times[index - 1]);
      }
    }
  });
});
