import { Interaction } from '../../../core/models/interaction';
import { FIXTURE_CATALOG } from '../../../core/models/media-catalog.fixture';
import { MediaTitle } from '../../../core/models/media-title';
import { Preference } from '../../../core/models/quiz';
import { rankTitles } from './recommend';

const RATED_AT = '2026-09-26T10:00:00.000Z';

/** A rating as stored: the state and when it was recorded. */
function rated(state: Interaction['state']): Interaction {
  return { state, updatedAt: RATED_AT };
}

/**
 * Tests for the recommendation engine
 * (`specs/002-recommendation-deck/contracts/recommendation-engine.md`).
 *
 * The engine is the product's core asset and the reason the deck is
 * trustworthy, so it is specified as a pure function and tested as one: no
 * `TestBed`, no DOM, no clock. Two of the constitution's named invariants —
 * Filter Enforcement (G1) and the Feedback Loop (G2) — are proven here.
 *
 * Filter assertions compare **sorted** id lists. That keeps this file about
 * membership only; ordering is T014's subject, and a bug in the sort should
 * not be able to masquerade as a filter failure.
 */

/** A title with sensible defaults, so each test states only what it cares about. */
function title(id: string, overrides: Partial<MediaTitle> = {}): MediaTitle {
  return {
    id,
    title: id,
    releaseYear: 2020,
    mediaType: 'movie',
    genres: [],
    synopsis: '',
    rating: 7,
    voteCount: 1000,
    availability: [],
    ...overrides,
  };
}

/** A completed preference with everything set to "Any". */
function preference(overrides: Partial<Preference> = {}): Preference {
  return {
    mediaType: { values: [], any: true },
    genre: { values: [], any: true },
    provider: { values: [], any: true },
    includeUnownedProviders: false,
    completedAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  };
}

function on(providerId: string): MediaTitle['availability'] {
  return [{ providerId, deepLinkUrl: `https://example.test/${providerId}` }];
}

describe('rankTitles — hard filters', () => {
  const noInteractions: Record<string, Interaction> = {};

  // ---------------------------------------------------------- filter 1 --
  describe('filter 1: media type (FR-005)', () => {
    it('drops titles whose media type was not chosen', () => {
      const catalog = [
        title('a-film', { mediaType: 'movie' }),
        title('a-series', { mediaType: 'tv' }),
        title('an-anime', { mediaType: 'anime' }),
      ];

      const result = rankTitles(
        catalog,
        preference({ mediaType: { values: ['movie'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['a-film']);
    });

    it('keeps every chosen media type', () => {
      const catalog = [
        title('a-film', { mediaType: 'movie' }),
        title('a-series', { mediaType: 'tv' }),
        title('an-anime', { mediaType: 'anime' }),
      ];

      const result = rankTitles(
        catalog,
        preference({ mediaType: { values: ['movie', 'anime'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id).sort()).toEqual(['a-film', 'an-anime']);
    });

    it('filters nothing when the visitor chose Any', () => {
      const catalog = [
        title('a-film', { mediaType: 'movie' }),
        title('a-series', { mediaType: 'tv' }),
        title('an-anime', { mediaType: 'anime' }),
      ];

      const result = rankTitles(catalog, preference(), noInteractions, []);

      expect(result).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------- filter 2 --
  describe('filter 2: genre (FR-005)', () => {
    it('drops a title sharing no genre with the choice', () => {
      const catalog = [
        title('scary', { genres: ['horror'] }),
        title('funny', { genres: ['comedy'] }),
      ];

      const result = rankTitles(
        catalog,
        preference({ genre: { values: ['horror'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['scary']);
    });

    it('keeps a title sharing at least one genre', () => {
      const catalog = [title('both', { genres: ['comedy', 'horror'] })];

      const result = rankTitles(
        catalog,
        preference({ genre: { values: ['horror'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['both']);
    });

    it('drops a title with no genres at all', () => {
      const catalog = [title('unlabelled', { genres: [] })];

      const result = rankTitles(
        catalog,
        preference({ genre: { values: ['horror'], any: false } }),
        noInteractions,
        [],
      );

      expect(result).toEqual([]);
    });

    it('filters nothing when the visitor chose Any', () => {
      const catalog = [title('unlabelled', { genres: [] }), title('scary', { genres: ['horror'] })];

      const result = rankTitles(catalog, preference(), noInteractions, []);

      expect(result).toHaveLength(2);
    });
  });

  // ------------------------------------- filter 3 (the constitution one) --
  describe('filter 3: availability (FR-006, Filter Enforcement invariant)', () => {
    it('drops a title that is not on any selected service', () => {
      const catalog = [
        title('on-netflix', { availability: on('netflix') }),
        title('on-hulu', { availability: on('hulu') }),
      ];

      const result = rankTitles(
        catalog,
        preference({ provider: { values: ['netflix'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['on-netflix']);
    });

    it('keeps a title available on any one of several selected services', () => {
      const catalog = [title('on-hulu', { availability: on('hulu') })];

      const result = rankTitles(
        catalog,
        preference({ provider: { values: ['netflix', 'hulu'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['on-hulu']);
    });

    it('matches a retired service to the one that carries its catalog now', () => {
      // Star+ was discontinued in Latin America and its catalog folded into
      // Disney+; the server stopped being able to emit a `star-plus` badge at
      // all. A visitor whose stored preference still says `star-plus` — 001's
      // storage contract is frozen, so there are such visitors — would
      // otherwise match nothing, in every genre, with no way to find out why.
      const catalog = [title('on-disney', { availability: on('disney-plus') })];

      const result = rankTitles(
        catalog,
        preference({ provider: { values: ['star-plus'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['on-disney']);
    });

    it('still matches a retired service directly if the server ever reports it', () => {
      // The alias adds a match; it must not replace the literal one. If a
      // service were ever un-retired, or a snapshot predating the retirement
      // were served from a cache, the id would still resolve on its own.
      const catalog = [title('on-star', { availability: on('star-plus') })];

      const result = rankTitles(
        catalog,
        preference({ provider: { values: ['star-plus'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['on-star']);
    });

    it('does not widen a selection to services the visitor did not pick', () => {
      // The alias is one-directional and per-id. A visitor who picked Disney+
      // directly is unaffected, and a retired id must not drag in anything
      // beyond its own successor.
      const catalog = [
        title('on-disney', { availability: on('disney-plus') }),
        title('on-netflix', { availability: on('netflix') }),
      ];

      const result = rankTitles(
        catalog,
        preference({ provider: { values: ['star-plus'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['on-disney']);
    });

    it('drops a title with no availability when services were chosen', () => {
      // We cannot claim a title is watchable for them, so it is not suggested.
      const catalog = [title('nowhere', { availability: [] })];

      const result = rankTitles(
        catalog,
        preference({ provider: { values: ['netflix'], any: false } }),
        noInteractions,
        [],
      );

      expect(result).toEqual([]);
    });

    it('disables filter 3 entirely when the visitor opted into other platforms', () => {
      // This is an explicit opt-in (spec 001 FR-006), not an exception to be
      // quietly re-applied. Every title survives, including unavailable ones.
      const catalog = [
        title('on-netflix', { availability: on('netflix') }),
        title('on-hulu', { availability: on('hulu') }),
        title('nowhere', { availability: [] }),
      ];

      const result = rankTitles(
        catalog,
        preference({
          provider: { values: ['netflix'], any: false },
          includeUnownedProviders: true,
        }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id).sort()).toEqual(['nowhere', 'on-hulu', 'on-netflix']);
    });

    it('filters nothing when the visitor chose Any service', () => {
      const catalog = [
        title('on-hulu', { availability: on('hulu') }),
        title('nowhere', { availability: [] }),
      ];

      const result = rankTitles(
        catalog,
        preference({ provider: { values: [], any: true } }),
        noInteractions,
        [],
      );

      expect(result).toHaveLength(2);
    });

    it('holds the invariant across every shape of provider preference', () => {
      // G1: no returned title is unavailable on the selected services unless
      // the visitor opted into other platforms. This is the whole reason the
      // deck can be trusted not to waste the visitor's time.
      const catalog = [
        title('netflix-only', { availability: on('netflix') }),
        title('hulu-only', { availability: on('hulu') }),
        title('both', { availability: [...on('netflix'), ...on('hulu')] }),
        title('nowhere', { availability: [] }),
      ];

      const preferences = [
        preference({ provider: { values: ['netflix'], any: false } }),
        preference({ provider: { values: ['hulu'], any: false } }),
        preference({ provider: { values: ['netflix', 'hulu'], any: false } }),
        preference({ provider: { values: ['mubi'], any: false } }),
      ];

      for (const preferencesUnderTest of preferences) {
        const result = rankTitles(catalog, preferencesUnderTest, noInteractions, []);
        const selected = preferencesUnderTest.provider.values;

        for (const returned of result) {
          const available = returned.availability.some((entry) =>
            selected.includes(entry.providerId),
          );
          expect(available).toBe(true);
        }
      }
    });
  });

  // ---------------------------------------------------------- filter 4 --
  describe('filter 4: previously rejected (FR-009, Feedback Loop invariant)', () => {
    /**
     * The constitution's second named invariant, stated as a property rather
     * than as three examples: whatever the visitor rejected, none of it comes
     * back.
     *
     * **These pass the moment they are written.** Filter 4 ships inside
     * `rankTitles` from US1, so this is regression coverage pinning a guarantee
     * that already holds — the genuinely new US3 work is the persistence wiring,
     * and `deck.spec.ts`'s cross-session test is the one that had to be observed
     * failing first. Saying so plainly beats staging a red that was never real.
     */
    it('never suggests a disliked title again (US3 scenario 1)', () => {
      const catalog = [title('rejected'), title('fine')];

      const result = rankTitles(catalog, preference(), { rejected: rated('disliked') }, []);

      expect(result.map((t) => t.id)).toEqual(['fine']);
    });

    it('treats notInterested exactly as it treats disliked', () => {
      // Two states, one rule: `isExcluding` owns the list, so the pair can only
      // diverge if someone edits it — which is what this pins.
      const catalog = [title('rejected'), title('fine')];

      const disliked = rankTitles(catalog, preference(), { rejected: rated('disliked') }, []);
      const notInterested = rankTitles(
        catalog,
        preference(),
        { rejected: rated('notInterested') },
        [],
      );

      expect(notInterested.map((t) => t.id)).toEqual(disliked.map((t) => t.id));
      expect(notInterested.map((t) => t.id)).toEqual(['fine']);
    });

    it('excludes a title rejected in an earlier session (US3 scenario 2)', () => {
      // The map is read straight from storage, so a rating made last week is
      // indistinguishable from one made a second ago. That is the whole of
      // cross-session exclusion: there is no session concept to honour.
      const catalog = [title('rejected-last-week'), title('fresh')];
      const fromStorage = { 'rejected-last-week': rated('notInterested') };

      const result = rankTitles(catalog, preference(), fromStorage, []);

      expect(result.map((t) => t.id)).toEqual(['fresh']);
    });

    it('suggests nothing the visitor has already rated, whatever they said', () => {
      // **Amended 2026-09-29.** This used to assert the opposite for the four
      // non-rejections, on the grounds that removing them would shrink the
      // visitor's options. Shrinking them is correct: a new loop is a new
      // *walk*, not a fresh memory, and a title already judged, saved or
      // watched is not an open question. Leaving them in shrank something
      // worse instead — the deck's credibility, the moment a visitor tapped
      // Watch Now, started a new loop, and was handed the film they just chose.
      const catalog = [title('a'), title('b'), title('c'), title('d')];
      const interactions = {
        a: rated('loved'),
        b: rated('liked'),
        c: rated('wantToWatch'),
        d: rated('watchingNow'),
      };

      expect(rankTitles(catalog, preference(), interactions, [])).toEqual([]);
    });

    it('does not hand back the movie they chose, when a new loop starts', () => {
      // The path that produced the report, stated as the visitor walks it:
      // Watch Now on a film, Match Found, "Start a new loop" — and the same
      // poster again. `startNewLoop` clears `shownTitleIds` and nothing else,
      // so filter 4 is the only thing standing between a rated title and the
      // top of the next deck.
      const catalog = [title('watched'), title('loved'), title('fresh')];
      const interactions = {
        watched: rated('watchingNow'),
        loved: rated('loved'),
      };

      const newLoop = rankTitles(catalog, preference(), interactions, []);

      expect(newLoop.map((t) => t.id)).toEqual(['fresh']);
    });

    it('puts a title back when the rating is taken away', () => {
      // Un-rating is the only way back in, and it is how Undo works: the
      // document *is* the rule, so deleting the entry restores eligibility with
      // nothing else to keep in step. Spec 003 FR-007's "un-dislike" needs the
      // same property, and gets it from the same place.
      //
      // Note what is deliberately no longer covered here: re-rating a disliked
      // title as loved does not put it back, because it is still rated. Only
      // removal does.
      const catalog = [title('changed-their-mind')];

      const rejected = rankTitles(
        catalog,
        preference(),
        { 'changed-their-mind': rated('disliked') },
        [],
      );
      const unRated = rankTitles(catalog, preference(), {}, []);

      expect(rejected).toEqual([]);
      expect(unRated.map((t) => t.id)).toEqual(['changed-their-mind']);
    });

    it('stays excluded when the loop restarts, though a merely-shown title returns', () => {
      // The seam between filter 4 and filter 5, and the reason both exist.
      // Clearing the shown list is what makes a new loop feel fresh; it must
      // not also resurrect everything the visitor rejected (US3 scenario 1).
      const catalog = [title('seen-but-fine'), title('rejected')];
      const interactions = { rejected: rated('disliked') };

      const firstLoop = rankTitles(catalog, preference(), interactions, [
        'seen-but-fine',
        'rejected',
      ]);
      const newLoop = rankTitles(catalog, preference(), interactions, []);

      expect(firstLoop).toEqual([]);
      expect(newLoop.map((t) => t.id)).toEqual(['seen-but-fine']);
    });
  });

  // ---------------------------------------------------------- filter 5 --
  describe('filter 5: already shown (FR-010)', () => {
    it('drops a title the visitor has already advanced past', () => {
      const catalog = [title('seen'), title('unseen')];

      const result = rankTitles(catalog, preference(), noInteractions, ['seen']);

      expect(result.map((t) => t.id)).toEqual(['unseen']);
    });

    it('treats an id the catalog does not know as harmless', () => {
      const catalog = [title('seen')];

      const result = rankTitles(catalog, preference(), noInteractions, ['a-retired-title']);

      expect(result.map((t) => t.id)).toEqual(['seen']);
    });
  });

  describe('the filters compose', () => {
    it('applies every filter at once', () => {
      const catalog = [
        title('wanted', {
          mediaType: 'movie',
          genres: ['horror'],
          availability: on('netflix'),
        }),
        title('wrong-type', { mediaType: 'tv', genres: ['horror'], availability: on('netflix') }),
        title('wrong-genre', {
          mediaType: 'movie',
          genres: ['comedy'],
          availability: on('netflix'),
        }),
        title('wrong-service', {
          mediaType: 'movie',
          genres: ['horror'],
          availability: on('hulu'),
        }),
        title('already-seen', {
          mediaType: 'movie',
          genres: ['horror'],
          availability: on('netflix'),
        }),
      ];

      const result = rankTitles(
        catalog,
        preference({
          mediaType: { values: ['movie'], any: false },
          genre: { values: ['horror'], any: false },
          provider: { values: ['netflix'], any: false },
        }),
        noInteractions,
        ['already-seen'],
      );

      expect(result.map((t) => t.id)).toEqual(['wanted']);
    });

    it('returns an empty array rather than throwing when nothing survives (G5, FR-014)', () => {
      const catalog = [title('on-hulu', { availability: on('hulu') })];

      const result = rankTitles(
        catalog,
        preference({ provider: { values: ['netflix'], any: false } }),
        noInteractions,
        [],
      );

      expect(result).toEqual([]);
    });
  });
});

describe('rankTitles — score and order', () => {
  const noInteractions: Record<string, Interaction> = {};

  describe('matchedGenres (term 1)', () => {
    it('ranks a title matching more of the chosen genres higher', () => {
      const catalog = [
        title('one-genre', { genres: ['horror'] }),
        title('two-genres', { genres: ['horror', 'thriller'] }),
      ];

      const result = rankTitles(
        catalog,
        preference({ genre: { values: ['horror', 'thriller'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['two-genres', 'one-genre']);
    });

    it('contributes nothing when the visitor chose Any', () => {
      // With every term equal, the two titles fall back to the id tiebreak.
      const catalog = [
        title('bbb', { genres: ['horror', 'thriller', 'drama'] }),
        title('aaa', { genres: [] }),
      ];

      const result = rankTitles(catalog, preference(), noInteractions, []);

      expect(result.map((t) => t.id)).toEqual(['aaa', 'bbb']);
    });
  });

  /*
    The visitor asked for this in so many words: "I would expect to see rom-coms
    first, and when those get exhausted, maybe start seeing animations." The
    tier is a sort key of its own (contract G6) rather than a weighted term, so
    no total of the terms below it can carry a title past the tier above —
    which is what these two tests pin, one per way the old flat score broke it.
  */
  describe('tier dominance (term 1 is the sort’s primary key)', () => {
    it('keeps a two-genre match above a one-genre match wearing every loved genre', () => {
      // `signal` shares no genre with the choice, so filter 2 drops it — but
      // genreSignals reads the catalog *before* filtering, so its genres are
      // still what the visitor has loved. That is the worst case for the tier
      // key: the one-genre title gets the full affinity lift (+12) and the
      // two-genre title gets none, and under the old flat score
      // (10 × matches + 6 × affinity + rating) the lower tier won, 28.8 to 26.8.
      const catalog = [
        title('two-match', { genres: ['horror', 'thriller'] }),
        title('one-match', { genres: ['horror', 'comedy', 'drama'] }),
        title('signal', { genres: ['comedy', 'drama'] }),
      ];

      const result = rankTitles(
        catalog,
        preference({ genre: { values: ['horror', 'thriller'], any: false } }),
        { signal: rated('loved') },
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['two-match', 'one-match']);
    });

    it('keeps the tier even when the tier below is far better rated', () => {
      // A wall of high-vote titles one genre short is exactly the Shrek
      // complaint; popularity reorders within a tier and never across one.
      const catalog = [
        title('two-match', { genres: ['horror', 'thriller'], rating: 5, voteCount: 1000 }),
        title('one-match', { genres: ['horror'], rating: 9.5, voteCount: 2_000_000 }),
      ];

      const result = rankTitles(
        catalog,
        preference({ genre: { values: ['horror', 'thriller'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['two-match', 'one-match']);
    });
  });

  /*
    The demotion term. A selection is also a statement about what the visitor
    did *not* pick, and this is where that lands — the difference between "a
    comedy" and a kids animation that TMDB files under comedy.
  */
  describe('mismatchedGenres (the demotion term)', () => {
    it('ranks a pure comedy above a better-rated comedy animation', () => {
      const catalog = [
        title('pure-comedy', { genres: ['comedy'], rating: 8, voteCount: 1000 }),
        title('kids-comedy', { genres: ['comedy', 'animation'], rating: 9, voteCount: 100_000 }),
      ];

      const result = rankTitles(
        catalog,
        preference({ genre: { values: ['comedy'], any: false } }),
        noInteractions,
        [],
      );

      // Both match the one chosen genre, so the tier cannot separate them —
      // the demotion is what puts the 8.0 comedy ahead of the 9.0 animation,
      // a gap raw rating would have decided the other way.
      expect(result.map((t) => t.id)).toEqual(['pure-comedy', 'kids-comedy']);
    });

    it('adds no demotion when the visitor chose Any', () => {
      // "Any" is the absence of a selection, not a choice against everything:
      // with no statement to enforce, the order is the one the terms alone
      // produce — here the rating, which favors the animated title. If the
      // demotion leaked into this path, it would sink it instead.
      const catalog = [
        title('with-animation', { genres: ['comedy', 'animation'], rating: 9, voteCount: 100_000 }),
        title('plain', { genres: ['comedy'], rating: 8, voteCount: 1000 }),
      ];

      const result = rankTitles(catalog, preference(), noInteractions, []);

      expect(result.map((t) => t.id)).toEqual(['with-animation', 'plain']);
    });

    it('never demotes for a slug tag the visitor was never offered', () => {
      // `family` is a TMDB tag the catalog carries, not one of the nine the
      // quiz offers, so a title wearing it has disobeyed nothing. Only the
      // selectable vocabulary can trigger the term (contract G7).
      const catalog = [
        title('tagged', { genres: ['comedy', 'family'], rating: 9, voteCount: 100_000 }),
        title('plain', { genres: ['comedy'], rating: 8, voteCount: 1000 }),
      ];

      const result = rankTitles(
        catalog,
        preference({ genre: { values: ['comedy'], any: false } }),
        noInteractions,
        [],
      );

      expect(result.map((t) => t.id)).toEqual(['tagged', 'plain']);
    });
  });

  describe('historyAffinity (term 2, the Feedback Loop invariant)', () => {
    it('lifts titles wearing a genre the visitor has loved', () => {
      const catalog = [
        title('loved-horror', { genres: ['horror'] }),
        title('a-comedy', { genres: ['comedy'] }),
        title('another-horror', { genres: ['horror'] }),
      ];
      const interactions = { 'loved-horror': rated('loved') };

      const withHistory = rankTitles(catalog, preference(), interactions, []).map((t) => t.id);
      const withoutHistory = rankTitles(catalog, preference(), noInteractions, []).map((t) => t.id);

      // The loved title is gone from the second list — filter 4 takes it, as it
      // takes every rated title. The lift is therefore observed where the term
      // actually does its work: on a title the visitor has *never rated*, which
      // is the whole point of generalizing from their taste. `another-horror`
      // and `a-comedy` swap places between the two runs, and nothing else about
      // the catalog changed.
      expect(withoutHistory).toEqual(['a-comedy', 'another-horror', 'loved-horror']);
      expect(withHistory).toEqual(['another-horror', 'a-comedy']);
    });

    it('sinks titles wearing a genre the visitor rejected, and can go negative', () => {
      const catalog = [
        title('disliked-horror', { genres: ['horror'] }),
        title('a-comedy', { genres: ['comedy'] }),
        title('another-horror', { genres: ['horror'] }),
      ];
      const interactions = { 'disliked-horror': rated('disliked') };

      const result = rankTitles(catalog, preference(), interactions, []).map((t) => t.id);

      // The rejected title itself is gone (filter 4 / G2), but its genre still
      // drags down a title the visitor has never rated. That generalization is
      // the entire point of the term.
      expect(result).toEqual(['a-comedy', 'another-horror']);
    });

    it('counts wantToWatch and liked as positive, like loved', () => {
      // Positive for the *affinity* term, that is — which is a different
      // question from whether the title comes back. It does not: every state in
      // the vocabulary keeps its title out of the deck (filter 4), and what is
      // being pinned here is that the same three states that say "no" to a
      // suggestion still say "more like this" to its genre.
      for (const state of ['loved', 'liked', 'wantToWatch'] as const) {
        const catalog = [
          title('rated-horror', { genres: ['horror'] }),
          title('a-comedy', { genres: ['comedy'] }),
          title('another-horror', { genres: ['horror'] }),
        ];

        const result = rankTitles(catalog, preference(), { 'rated-horror': rated(state) }, []).map(
          (t) => t.id,
        );

        expect(result).toEqual(['another-horror', 'a-comedy']);
      }
    });
  });

  describe('weightedRating (term 3, confidence weighting)', () => {
    it('does not let a lone 10.0 outrank a well-established 8.4 (D7)', () => {
      // The anchors authored into the mock catalog for exactly this assertion
      // (T006): a 10.0 on a handful of votes, against an 8.4 with hundreds of
      // thousands. Weighting is (rating x votes + 6.5 x 500) / (votes + 500),
      // which lands them at 6.53 and 8.40 — a decisive gap, not a rounding one.
      const loud = FIXTURE_CATALOG.find((t) => t.id === 'midnight-static')!;
      const established = FIXTURE_CATALOG.find((t) => t.id === 'your-name')!;

      expect(loud.rating).toBeGreaterThan(established.rating);
      expect(loud.voteCount).toBeLessThan(established.voteCount);

      const result = rankTitles(FIXTURE_CATALOG, preference(), noInteractions, []);

      expect(result.findIndex((t) => t.id === 'midnight-static')).toBeGreaterThan(
        result.findIndex((t) => t.id === 'your-name'),
      );
    });

    it('still ranks a better-rated title above a worse-rated one at equal confidence', () => {
      const catalog = [
        title('worse', { rating: 7, voteCount: 5000 }),
        title('better', { rating: 9, voteCount: 5000 }),
      ];

      const result = rankTitles(catalog, preference(), noInteractions, []);

      expect(result.map((t) => t.id)).toEqual(['better', 'worse']);
    });
  });

  describe('the total order (FR-011)', () => {
    it('breaks a score tie by id ascending, whatever order the catalog arrived in', () => {
      const sameScore = { rating: 8, voteCount: 1000, genres: ['horror'] };
      const inOrder = [title('aaa', sameScore), title('bbb', sameScore), title('ccc', sameScore)];
      const shuffled = [title('ccc', sameScore), title('aaa', sameScore), title('bbb', sameScore)];

      expect(rankTitles(inOrder, preference(), noInteractions, []).map((t) => t.id)).toEqual([
        'aaa',
        'bbb',
        'ccc',
      ]);
      expect(rankTitles(shuffled, preference(), noInteractions, []).map((t) => t.id)).toEqual([
        'aaa',
        'bbb',
        'ccc',
      ]);
    });

    it('is deterministic: equal inputs give an identical array, element for element (G3)', () => {
      const reversed = [...FIXTURE_CATALOG].reverse();

      const fromCatalog = rankTitles(FIXTURE_CATALOG, preference(), noInteractions, []);
      const fromReversed = rankTitles(reversed, preference(), noInteractions, []);

      // Two devices, two arrival orders, one deck — the guarantee FR-011 and
      // SC-005 rest on.
      expect(fromReversed.map((t) => t.id)).toEqual(fromCatalog.map((t) => t.id));
    });

    it('orders by score descending, not merely by the id tiebreak', () => {
      const catalog = [
        title('zzz-best', { rating: 9.5, voteCount: 100000 }),
        title('aaa-worst', { rating: 5, voteCount: 100000 }),
      ];

      const result = rankTitles(catalog, preference(), noInteractions, []);

      expect(result.map((t) => t.id)).toEqual(['zzz-best', 'aaa-worst']);
    });
  });

  describe('purity (G4)', () => {
    it('never mutates its inputs', () => {
      const catalog = [title('bbb', { genres: ['horror'] }), title('aaa', { genres: ['horror'] })];
      const preferences = preference({ genre: { values: ['horror'], any: false } });
      const interactions = { bbb: rated('loved') };
      const shown = ['ccc'];

      const before = structuredClone({ catalog, preferences, interactions, shown });

      rankTitles(catalog, preferences, interactions, shown);

      expect(catalog).toEqual(before.catalog);
      expect(preferences).toEqual(before.preferences);
      expect(interactions).toEqual(before.interactions);
      expect(shown).toEqual(before.shown);
    });

    it('returns a new array each call, so a caller cannot corrupt the engine', () => {
      const first = rankTitles(FIXTURE_CATALOG, preference(), noInteractions, []);
      first.length = 0;

      expect(rankTitles(FIXTURE_CATALOG, preference(), noInteractions, []).length).toBe(
        FIXTURE_CATALOG.length,
      );
    });
  });
});

/**
 * Stage 4 — the sentence the card shows (FR-003's "why this card is here").
 *
 * The reason is part of the engine's contract rather than the card's
 * presentation, so it is tested as one: the card is handed a string and shows
 * it. What matters here is *which* string — the precedence between the three
 * signals, and the cases where the honest answer is nothing at all.
 */
describe('rankTitles — the reason (stage 4)', () => {
  const nothing: Record<string, Interaction> = {};

  /**
   * The reason on the only title in a one-title catalog.
   *
   * Throws rather than returning `null` when the title was filtered out: a
   * filter that dropped it and a reason that is legitimately absent are two
   * different results, and only one of them is what these tests are about.
   */
  function reasonOf(
    preferences: Preference,
    overrides: Partial<MediaTitle> = {},
    interactions: Record<string, Interaction> = nothing,
  ): string | null {
    const [only] = rankTitles(
      [title('a-title', overrides)],
      preferences,
      interactions,
      [],
    );

    if (only === undefined) {
      throw new Error('The title was filtered out; this test is about its reason');
    }

    return only.reason;
  }

  describe('the precedence', () => {
    it('quotes the quiz answer first — this is what the visitor asked for', () => {
      expect(
        reasonOf(preference({ genre: { values: ['comedy'], any: false } }), {
          genres: ['comedy'],
        }),
      ).toBe('Because you picked Comedy');
    });

    it('prefers what the visitor chose over what their ratings point at', () => {
      // Both signals fire for this title: it wears a picked genre *and* a
      // genre the visitor has loved elsewhere. The quiz answer is the one they
      // can still see themselves having given, so that is the one they are told.
      const catalog = [
        title('a-title', { genres: ['comedy'] }),
        title('a-loved', { genres: ['comedy'] }),
      ];

      const result = rankTitles(
        catalog,
        preference({ genre: { values: ['comedy'], any: false } }),
        { 'a-loved': rated('loved') },
        [],
      );

      expect(result.find((t) => t.id === 'a-title')?.reason).toBe('Because you picked Comedy');
    });

    it('falls back to the ratings when nothing was chosen', () => {
      // Under `Any` there is no selection to quote, so the feedback loop is
      // the whole story — the deck saying "you have loved things like this".
      const catalog = [
        title('a-title', { genres: ['horror'] }),
        title('a-loved', { genres: ['horror'] }),
      ];

      const result = rankTitles(catalog, preference(), { 'a-loved': rated('loved') }, []);

      expect(result.find((t) => t.id === 'a-title')?.reason).toBe('Because you loved Horror');
    });

    it('falls back to the service when neither signal applies', () => {
      expect(
        reasonOf(preference({ provider: { values: ['netflix'], any: false } }), {
          availability: on('netflix'),
        }),
      ).toBe('On Netflix, one of your services');
    });

    it('names the service through a retired id’s successor', () => {
      // A visitor whose stored preference says `star-plus` is looking for
      // Disney+ titles, so Disney+ is the name they are given — not the dead
      // service they picked years ago, and not the id.
      expect(
        reasonOf(preference({ provider: { values: ['star-plus'], any: false } }), {
          availability: on('disney-plus'),
        }),
      ).toBe('On Disney+, one of your services');
    });
  });

  describe('when it says nothing', () => {
    it('is null for a title that ranked on nothing but its rating', () => {
      // `Any` everywhere and no ratings to learn from: the card is here
      // because of the confidence-weighted rating and nothing else, and there
      // is no sentence for that which is not noise.
      expect(reasonOf(preference())).toBeNull();
    });

    it('is null for a service the visitor did not select', () => {
      // The title can legitimately be on screen — they asked to see other
      // platforms — but "one of your services" would be a lie about it.
      expect(
        reasonOf(
          preference({
            provider: { values: ['hulu'], any: false },
            includeUnownedProviders: true,
          }),
          { availability: on('netflix') },
        ),
      ).toBeNull();
    });

    it('never prints an id the option lists do not know', () => {
      // A slug tag (`family`, `fantasy`…) is not a genre the quiz offered, so
      // nobody selected it and there is nothing to say. Printing it raw is
      // exactly what the card's own id→name rule exists to prevent.
      expect(
        reasonOf(preference({ genre: { values: ['family'], any: false } }), {
          genres: ['family'],
        }),
      ).toBeNull();
    });
  });
});
