import { describe, it, expect } from 'vitest';
import { compileQuery } from '../../src/picker/match.js';
import { rankFilePath, rankStable, QUICK_OPEN_MAX_ROWS } from '../../src/picker/rank.js';

// 033 (contracts/picker-extensions.md §2, K1–K6): Quick Open's ranking. Higher is better.
// Two rules and a tiebreak — a hit in the FILE NAME beats a hit only in the directory part,
// an EARLIER hit beats a later one, and anything the score cannot separate keeps the order it
// was seeded in. The tiebreak is an explicit index comparison, never the sort's stability.

/** Rank a list of paths for `query`, best first — the pipeline Quick Open actually runs. */
function ranked(paths: readonly string[], query: string): string[] {
  const compiled = compileQuery(query);
  return rankStable(
    paths.filter((p) => compiled.test(p)),
    (p) => rankFilePath(p, compiled),
  );
}

describe('QUICK_OPEN_MAX_ROWS (R11)', () => {
  it('is 200 — a named constant in core, never a literal at its point of use', () => {
    expect(QUICK_OPEN_MAX_ROWS).toBe(200);
  });
});

describe('rankFilePath — a name hit outranks a directory-only hit (K1)', () => {
  it('scores a name-segment hit above a directory-segment hit', () => {
    const compiled = compileQuery('report');
    const inName = rankFilePath('src/monthly/report.ts', compiled);
    const inDirectory = rankFilePath('report/monthly/summary.ts', compiled);
    expect(inName).toBeGreaterThan(inDirectory);
  });

  it('puts the name match first even when the directory match is much earlier in the path', () => {
    expect(ranked(['report/a/b/c/d/e/f.ts', 'a/b/c/d/e/report.ts'], 'report')).toEqual([
      'a/b/c/d/e/report.ts',
      'report/a/b/c/d/e/f.ts',
    ]);
  });

  it('treats a path with no directory part as a name hit', () => {
    const compiled = compileQuery('readme');
    expect(rankFilePath('readme.md', compiled)).toBeGreaterThan(
      rankFilePath('readme/notes.txt', compiled),
    );
  });

  it('ranks every name hit above every directory-only hit, whatever their positions', () => {
    const paths = [
      'zzz/aaa/xxx.ts', // directory-only hit, late
      'aaa/zzz/xxx.ts', // directory-only hit, early
      'zzz/xxx/zaaa.ts', // name hit, late in the name
      'zzz/xxx/aaa.ts', // name hit, at the start of the name
    ];
    expect(ranked(paths, 'aaa')).toEqual([
      'zzz/xxx/aaa.ts',
      'zzz/xxx/zaaa.ts',
      'aaa/zzz/xxx.ts',
      'zzz/aaa/xxx.ts',
    ]);
  });
});

describe('rankFilePath — an earlier hit outranks a later one (K2)', () => {
  it('prefers the earlier hit inside the file name', () => {
    const compiled = compileQuery('log');
    expect(rankFilePath('src/logger.ts', compiled)).toBeGreaterThan(
      rankFilePath('src/catalogue.ts', compiled),
    );
  });

  it('prefers the earlier hit inside the directory part', () => {
    const compiled = compileQuery('lib');
    expect(rankFilePath('lib/vendor/x.ts', compiled)).toBeGreaterThan(
      rankFilePath('vendor/lib/x.ts', compiled),
    );
  });

  it('orders a set of name hits by how early they start', () => {
    expect(ranked(['src/zzlog.ts', 'src/log.ts', 'src/zlog.ts'], 'log')).toEqual([
      'src/log.ts',
      'src/zlog.ts',
      'src/zzlog.ts',
    ]);
  });
});

describe('rankStable — the tiebreak is the seeded index, not the sort (K3)', () => {
  it('keeps the seeded order for entries the score cannot separate', () => {
    const items = ['b.ts', 'a.ts', 'c.ts'];
    expect(rankStable(items, () => 0)).toEqual(['b.ts', 'a.ts', 'c.ts']);
  });

  it('scores each item EXACTLY once and breaks ties on the index, so an unstable comparator cannot decide the order', () => {
    // A score function that answers differently every time it is asked. An implementation that
    // leans on the sort's stability would call it inside the comparator and produce an arbitrary
    // (and inconsistent) order; one that scores once per item and tiebreaks on the seeded index
    // returns the input order, every time.
    const items = Array.from({ length: 64 }, (_, i) => `entry-${i}`);
    let calls = 0;
    const result = rankStable(items, () => {
      calls += 1;
      return 0;
    });
    expect(calls).toBe(items.length);
    expect(result).toEqual(items);
  });

  it('preserves the seeded order across a list long enough that no engine detail could', () => {
    const items = Array.from({ length: 500 }, (_, i) => i);
    expect(rankStable(items, () => 7)).toEqual(items);
  });

  it('applies the index tiebreak only WITHIN a score, never across scores', () => {
    const items = ['a', 'b', 'c', 'd'];
    const score = (item: string) => (item === 'b' || item === 'd' ? 10 : 1);
    expect(rankStable(items, score)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('rankFilePath / rankStable — purity (K4)', () => {
  it('gives the same order for the same inputs, every time', () => {
    const paths = ['src/find/file.ts', 'find/src/file.ts', 'src/file/find.ts', 'other/thing.ts'];
    const first = ranked(paths, 'find');
    for (let i = 0; i < 5; i += 1) expect(ranked(paths, 'find')).toEqual(first);
  });

  it('gives the same score for the same (text, query), whatever was scored in between', () => {
    const compiled = compileQuery('find file');
    const before = rankFilePath('src/find/file.ts', compiled);
    rankFilePath('completely/different/thing.ts', compiled);
    rankFilePath('find/file.ts', compiled);
    expect(rankFilePath('src/find/file.ts', compiled)).toBe(before);
  });

  it('does not depend on the order the items arrive in — the same set ranks the same either way', () => {
    const paths = ['src/zlog.ts', 'log/src/a.ts', 'src/log.ts'];
    expect(ranked(paths, 'log')).toEqual(ranked([...paths].reverse(), 'log'));
  });
});

describe('rankFilePath — an empty query scores everything equally (K5)', () => {
  it('gives one identical score to every entry', () => {
    const compiled = compileQuery('   ');
    const scores = ['a.ts', 'z/y/x.ts', 'deeply/nested/name.ts'].map((p) =>
      rankFilePath(p, compiled),
    );
    expect(new Set(scores).size).toBe(1);
  });

  it('leaves the list in the seeded order in full', () => {
    const paths = ['z.ts', 'a.ts', 'm/n/o.ts'];
    expect(ranked(paths, '')).toEqual(paths);
    expect(ranked(paths, '   ')).toEqual(paths);
  });
});

describe('rankStable — returns a new array (K6)', () => {
  it('does not mutate its input', () => {
    const items = ['a', 'b', 'c'];
    const copy = [...items];
    const result = rankStable(items, (item) => item.charCodeAt(0));
    expect(items).toEqual(copy);
    expect(result).not.toBe(items);
    expect(result).toEqual(['c', 'b', 'a']);
  });

  it('returns an empty array for an empty input', () => {
    const items: string[] = [];
    const result = rankStable(items, () => 0);
    expect(result).toEqual([]);
    expect(result).not.toBe(items);
  });
});
