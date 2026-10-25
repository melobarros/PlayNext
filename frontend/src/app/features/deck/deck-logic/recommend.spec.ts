import { FIXTURE_CATALOG } from '../../../core/models/media-catalog.fixture';
import { Preference } from '../../../core/models/quiz';
import {
  DEFAULT_ENGINE,
  ENGINE_VERSIONS,
  engineChoiceFrom,
  RECOMMEND_ENGINE_VERSION,
  rankTitles,
} from './recommend';
import { rankTitlesV1 } from './recommend-v1';
import { rankTitlesV2 } from './recommend-v2';

/**
 * The engine registry (010, D1/D7).
 *
 * The deck asks for an engine by name; this file pins the mapping from the
 * `?engine=` query value to that name and the version string each engine stamps
 * on an impression. The ordering itself is tested in the engine modules.
 */

function preference(): Preference {
  return {
    mediaType: { values: [], any: true },
    genre: { values: [], any: true },
    provider: { values: [], any: true },
    includeUnownedProviders: false,
    completedAt: '2026-09-26T10:00:00.000Z',
  };
}

const noInteractions = {};

describe('the engine choice', () => {
  it('defaults to v2, the owner decision of 2026-10-24', () => {
    expect(DEFAULT_ENGINE).toBe('v2');
    expect(RECOMMEND_ENGINE_VERSION).toBe('recommend-v2');
  });

  it('serves either engine by name, and the default for everything else', () => {
    expect(engineChoiceFrom('v1')).toBe('v1');
    expect(engineChoiceFrom('v2')).toBe('v2');
    expect(engineChoiceFrom(null)).toBe('v2');
    expect(engineChoiceFrom('')).toBe('v2');
    expect(engineChoiceFrom('v3')).toBe('v2');
  });

  it('maps each choice to the version it stamps on an impression', () => {
    expect(ENGINE_VERSIONS.v1).toBe('recommend-v1');
    expect(ENGINE_VERSIONS.v2).toBe('recommend-v2');
  });

  it('uses the version of the engine it actually ran', () => {
    expect(RECOMMEND_ENGINE_VERSION).toBe(ENGINE_VERSIONS[DEFAULT_ENGINE]);
  });
});

describe('rankTitles dispatch', () => {
  it('runs the candidate by default', () => {
    const byDefault = rankTitles(FIXTURE_CATALOG, preference(), noInteractions, []);
    const explicit = rankTitlesV2(FIXTURE_CATALOG, preference(), noInteractions, []);

    expect(byDefault).toEqual(explicit);
  });

  it('runs the candidate when asked for v2', () => {
    const byChoice = rankTitles(FIXTURE_CATALOG, preference(), noInteractions, [], 'v2');
    const explicit = rankTitlesV2(FIXTURE_CATALOG, preference(), noInteractions, []);

    expect(byChoice).toEqual(explicit);
  });

  it('runs the incumbent when asked for v1', () => {
    const byChoice = rankTitles(FIXTURE_CATALOG, preference(), noInteractions, [], 'v1');
    const explicit = rankTitlesV1(FIXTURE_CATALOG, preference(), noInteractions, []);

    expect(byChoice).toEqual(explicit);
  });
});
