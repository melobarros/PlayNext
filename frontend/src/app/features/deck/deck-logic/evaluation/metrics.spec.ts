import { MediaTitle } from '../../../../core/models/media-title';
import {
  coverage,
  genreJaccard,
  hitAt10,
  idcgAt10,
  intraListDiversity,
  ndcgAt10,
  precisionAt10,
  rankerMetrics,
  reciprocalRank,
} from './metrics';
import { RankedDecision } from './types';

/**
 * The six measures (T038), each pinned to its formula.
 *
 * Expectations are written as arithmetic on `Math.log2` rather than as decimal
 * literals: a literal would be a second, silently rounded statement of the same
 * rule, so a wrong constant in the implementation could be matched by a
 * transposed digit in the test and the pair would agree with nobody.
 */

function decision(ranked: readonly string[], labels: readonly string[]): RankedDecision {
  return { ranked, labels: new Set(labels) };
}

/** A title carrying only what the two catalog-wide measures read. */
function title(id: string, genres: string[]): MediaTitle {
  return {
    id,
    title: id,
    releaseYear: 2020,
    mediaType: 'movie',
    genres,
    synopsis: '',
    rating: 7,
    voteCount: 100,
    availability: [],
  };
}

describe('NDCG@10', () => {
  it('scores a ranking whose relevant titles are exactly on top as 1', () => {
    const perfect = decision(['a', 'b', 'c'], ['a', 'b']);

    expect(ndcgAt10(perfect)).toBeCloseTo(1, 12);
  });

  it('discounts a relevant title that was ranked lower', () => {
    // Relevant at ranks 1 and 4, one irrelevant between them. The ideal
    // arrangement of the same two labels is ranks 1 and 2, which is the IDCG.
    const ranked = decision(['r1', 'n1', 'n2', 'r4', 'n3'], ['r1', 'r4']);

    const dcg = 1 / Math.log2(2) + 1 / Math.log2(5);
    const idcg = 1 / Math.log2(2) + 1 / Math.log2(3);

    expect(ndcgAt10(ranked)).toBeCloseTo(dcg / idcg, 12);
  });

  it('is 0 when the top ten holds no relevant title at all', () => {
    expect(ndcgAt10(decision(['x', 'y', 'z'], ['a']))).toBe(0);
  });

  it('earns nothing for a label ranked outside the top ten, but still counts it in the ideal', () => {
    // The window truncates the credit, not the bar: t10 was retrievable and
    // the ranker put it eleventh, so the ideal is still "both labels in the
    // first two slots" and the miss is discounted rather than forgiven.
    const eleven = Array.from({ length: 11 }, (_, index) => `t${index}`);

    expect(ndcgAt10(decision(eleven, ['t10', 't0']))).toBeCloseTo(
      1 / (1 + 1 / Math.log2(3)),
      12,
    );
  });
});

describe('IDCG@10', () => {
  it('is 1 for a single label', () => {
    expect(idcgAt10(1)).toBeCloseTo(1, 12);
  });

  it('stops at ten: twelve labels are worth no more than ten', () => {
    const ten = Array.from({ length: 10 }, (_, index) => 1 / Math.log2(index + 2));
    const allTen = ten.reduce((total, term) => total + term, 0);

    expect(idcgAt10(12)).toBeCloseTo(allTen, 12);
    expect(idcgAt10(12)).toBeCloseTo(idcgAt10(10), 12);
  });

  it('is 0 when there is nothing relevant', () => {
    expect(idcgAt10(0)).toBe(0);
  });
});

describe('MRR', () => {
  it('is 1 when the first card was relevant', () => {
    expect(reciprocalRank(decision(['a', 'b'], ['a']))).toBeCloseTo(1, 12);
  });

  it('is the reciprocal of the first relevant rank', () => {
    expect(reciprocalRank(decision(['x', 'y', 'a'], ['a']))).toBeCloseTo(1 / 3, 12);
  });

  it('is 0 when nothing in the top ten was relevant', () => {
    expect(reciprocalRank(decision(['x', 'y'], ['a']))).toBe(0);
  });
});

describe('hit rate and precision', () => {
  const ranked = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];

  it('counts a hit and the share of the list that was relevant', () => {
    const mixed = decision(ranked, ['p2', 'p5']);

    expect(hitAt10(mixed)).toBe(true);
    expect(precisionAt10(mixed)).toBeCloseTo(2 / 10, 12);
  });

  it('is a miss and zero precision when nothing was relevant', () => {
    const missed = decision(ranked, ['elsewhere']);

    expect(hitAt10(missed)).toBe(false);
    expect(precisionAt10(missed)).toBe(0);
  });

  it('divides by ten even when the pool was shorter', () => {
    // The measure is "of the ten a deck would have shown"; a short deck is a
    // deck that showed fewer good options, not one that should be graded on a
    // friendlier scale.
    expect(precisionAt10(decision(['a'], ['a']))).toBeCloseTo(1 / 10, 12);
  });
});

describe('coverage', () => {
  const catalog = Array.from({ length: 60 }, (_, index) => title(`t${index}`, ['action']));

  it('is the distinct titles offered over the distinct titles available', () => {
    const first = Array.from({ length: 10 }, (_, index) => `t${index}`);
    const second = Array.from({ length: 10 }, (_, index) => `t${index + 5}`);

    // {t0..t14} — fifteen distinct, of sixty.
    expect(coverage([first, second], catalog)).toBeCloseTo(15 / 60, 12);
  });

  it('is 0 when nothing was offered', () => {
    expect(coverage([], catalog)).toBe(0);
  });
});

describe('intra-list diversity', () => {
  const catalog = [
    title('abi', ['a', 'b']),
    title('cd', ['c', 'd']),
    title('abi2', ['a', 'b']),
    title('bc', ['b', 'c']),
    title('bare1', []),
    title('bare2', []),
  ];

  it('is 1 for two titles sharing no genre', () => {
    expect(intraListDiversity([['abi', 'cd']], catalog)).toBeCloseTo(1, 12);
  });

  it('is 0 for two titles sharing every genre', () => {
    expect(intraListDiversity([['abi', 'abi2']], catalog)).toBeCloseTo(0, 12);
  });

  it('is one minus the pairwise Jaccard for an overlap', () => {
    // {a,b} ∩ {b,c} = {b}, {a,b} ∪ {b,c} = {a,b,c} → 1/3, so 2/3.
    expect(genreJaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 12);
    expect(intraListDiversity([['abi', 'bc']], catalog)).toBeCloseTo(2 / 3, 12);
  });

  it('treats two genre-less titles as maximally similar', () => {
    // Nothing distinguishes them, so the list is as narrow as a list can be.
    expect(genreJaccard([], [])).toBe(1);
    expect(intraListDiversity([['bare1', 'bare2']], catalog)).toBeCloseTo(0, 12);
  });

  it('skips a list with fewer than two titles', () => {
    // One title has no pair to compare; counting it as 1 would let a ranker
    // that offers almost nothing look maximally diverse.
    expect(intraListDiversity([['abi'], ['abi', 'cd']], catalog)).toBeCloseTo(1, 12);
  });

  it('averages across lists', () => {
    const disjoint = 1;
    const identical = 0;

    expect(
      intraListDiversity(
        [
          ['abi', 'cd'],
          ['abi', 'abi2'],
        ],
        catalog,
      ),
    ).toBeCloseTo((disjoint + identical) / 2, 12);
  });
});

describe('averaging over decisions', () => {
  it('leaves decisions with no label out of the four ranking measures', () => {
    // An impression nobody ever liked or watched says nothing about the order
    // it was shown in. Including it as a zero would make a ranker that showed
    // more of them look worse for it.
    const perfect = decision(['a'], ['a']);
    const unlabeled = decision(['b'], []);

    const metrics = rankerMetrics([perfect, unlabeled]);

    expect(metrics.evaluatedDecisions).toBe(1);
    expect(metrics.ndcgAt10).toBeCloseTo(1, 12);
    expect(metrics.mrr).toBeCloseTo(1, 12);
    expect(metrics.hitRateAt10).toBeCloseTo(1, 12);
    expect(metrics.precisionAt10).toBeCloseTo(1 / 10, 12);
  });

  it('reports zeros and no evaluated decisions when nothing was labelled', () => {
    const metrics = rankerMetrics([decision(['a'], []), decision(['b'], [])]);

    expect(metrics.evaluatedDecisions).toBe(0);
    expect(metrics.ndcgAt10).toBe(0);
    expect(metrics.mrr).toBe(0);
    expect(metrics.hitRateAt10).toBe(0);
    expect(metrics.precisionAt10).toBe(0);
  });

  it('averages across the evaluated decisions', () => {
    // One perfect (1), one relevant at rank 3 (1/3).
    const metrics = rankerMetrics([
      decision(['a'], ['a']),
      decision(['x', 'y', 'b'], ['b']),
    ]);

    expect(metrics.mrr).toBeCloseTo((1 + 1 / 3) / 2, 12);
  });
});
