import { TestBed } from '@angular/core/testing';
import {
  FALLBACK_PROVIDERS,
  RETIRED_PROVIDER_SUCCESSORS,
  STREAMING_PROVIDERS,
} from '../models/quiz-options.data';
import { QuizOptionsService } from './quiz-options.service';

/**
 * The quiz's option lists, and the one distinction that now matters inside
 * them: a service can be **named** without being **offered**.
 *
 * Star+ is the case. It was discontinued in Latin America and its catalog
 * folded into Disney+, so the quiz must stop offering it — a visitor choosing a
 * service that does not exist is wrong however the matching is arranged. But
 * 001's storage contract is frozen, so preferences already on visitors' devices
 * name it, and an id the app cannot name renders as nothing: the visitor's own
 * selection would quietly shrink, with no explanation and no way to ask.
 *
 * The two lists are therefore deliberately different, and these tests exist so
 * that a later tidy-up cannot collapse them back into one without noticing.
 */
describe('QuizOptionsService', () => {
  let service: QuizOptionsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(QuizOptionsService);
  });

  describe('the services the quiz offers', () => {
    it('offers the region-relevant ones', () => {
      const ids = service.providersFor('BR').map((provider) => provider.id);

      expect(ids).toContain('netflix');
      expect(ids).toContain('globoplay');
    });

    it('does not offer a service that no longer exists', () => {
      // Brazil is exactly where Star+ was offered, so this is the region where
      // leaving it in would be visible.
      const ids = service.providersFor('BR').map((provider) => provider.id);

      expect(ids).not.toContain('star-plus');
    });

    it('names HBO Max the way the service now does', () => {
      const max = service.providersFor('BR').find((provider) => provider.id === 'max');

      expect(max?.displayName).toBe('HBO Max');
    });
  });

  describe('looking a saved id up by name', () => {
    it('can still name every service it offers', () => {
      const names = new Map(
        service.getProvidersById().map((provider) => [provider.id, provider.displayName]),
      );

      for (const provider of STREAMING_PROVIDERS) {
        expect(names.get(provider.id)).toBe(provider.displayName);
      }
    });

    it('can name a retired service, so a saved selection does not vanish', () => {
      const names = new Map(
        service.getProvidersById().map((provider) => [provider.id, provider.displayName]),
      );

      // Not "Star+": a visitor reading this needs to know where their pick
      // went, or the only honest reaction to seeing it is to wonder whether
      // they ever picked it at all.
      expect(names.get('star-plus')).toBe('Star+ (now Disney+)');
    });
  });

  describe('the fallback list shown when the region list cannot load', () => {
    it('gives every service the same name the quiz would have offered it under', () => {
      // Two lists, one set of services, and a name free to drift between them:
      // `max` was corrected to "HBO Max" in the offered list and stayed "Max"
      // here, so a visitor on a bad connection read a different name for the
      // same service than a visitor on a good one. Nothing failed — the two
      // lists are never rendered together — which is exactly why it needs a
      // test rather than an eye.
      const offered = new Map(STREAMING_PROVIDERS.map((p) => [p.id, p.displayName]));

      for (const fallback of FALLBACK_PROVIDERS) {
        expect(offered.get(fallback.id)).toBe(fallback.displayName);
      }
    });
  });

  describe('retired services and their successors', () => {
    it('retires only services that have somewhere to have gone', () => {
      // A retired id with no successor would be named and then match nothing —
      // the dead end this machinery exists to avoid, arrived at from the other
      // side.
      for (const provider of service.getProvidersById()) {
        if (STREAMING_PROVIDERS.some((offered) => offered.id === provider.id)) continue;

        expect(RETIRED_PROVIDER_SUCCESSORS[provider.id]).toBeDefined();
      }
    });

    it('sends a retired service somewhere the quiz actually offers', () => {
      // Otherwise the alias matches titles whose badges name a service the
      // visitor was never offered and cannot select.
      const offered = new Set(STREAMING_PROVIDERS.map((provider) => provider.id));

      for (const successor of Object.values(RETIRED_PROVIDER_SUCCESSORS)) {
        expect(offered.has(successor)).toBe(true);
      }
    });
  });
});
