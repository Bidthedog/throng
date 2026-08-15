import { describe, it, expect } from 'vitest';
import { matches, matchSpans } from '../../src/picker/match.js';
import { compileQuery, type CompiledQuery } from '../../src/picker/match.js';

// 033 (contracts/picker-extensions.md §1, C1–C3): `compileQuery` is the same matching
// rule as `matches`/`matchSpans`, with the per-term regular expressions built ONCE for
// the query instead of once per entry. The refactor's whole point is that nothing about
// the RESULT changes — so every assertion here is an equivalence, and the one assertion
// that is not is a count of constructions.

/** The table both surfaces are compared over. Deliberately the shape 031's own test uses. */
const TABLE: ReadonlyArray<readonly [text: string, query: string]> = [
  ['file find.txt', 'find file'],
  ['find any file.md', 'find file'],
  ['prefix file any find.pdf', 'find file'],
  ['file.txt', 'find file'],
  ['find.txt', 'find file'],
  ['build output', 'out'],
  ['build output', 'input'],
  ['abc', 'c a'],
  ['abc', 'a c'],
  ['find any file.md', '  find \t file  '],
  ['f-i-l-e', 'file'],
  ['a+b', 'a+'],
  ['ab', 'a+'],
  ['main.ts', '.ts'],
  ['maints', '.ts'],
  ['FILE Find.TXT', 'find file'],
  ['file find.txt', 'FIND FILE'],
  ['Build Output', 'oUtPuT bUiLd'],
  ['anything at all', ''],
  ['anything at all', '   '],
  ['anything at all', '\t\n '],
  ['', ''],
  ['', 'find'],
  ['src/find/file.ts', 'find file'],
  ['src/find/file.ts', 'find/file'],
  ['C:\\repo\\src\\main.ts', 'repo\\src'],
  ['src/find/file.ts', 'file src'],
  ['prefix file any find.pdf', 'find any file'],
  ['FILE find.txt', 'file'],
  ['Build Output', 'output'],
  ['file.txt', 'file file'],
  ['abc', 'ab bc'],
];

describe('compileQuery — equivalence with matches (C1)', () => {
  it.each(TABLE)('matches(%j, %j) === compileQuery(q).test(t)', (text, query) => {
    expect(compileQuery(query).test(text)).toBe(matches(text, query));
  });
});

describe('compileQuery — equivalence with matchSpans (C1)', () => {
  it.each(TABLE)('matchSpans(%j, %j) deep-equals compileQuery(q).spans(t)', (text, query) => {
    expect(compileQuery(query).spans(text)).toEqual(matchSpans(text, query));
  });
});

describe('CompiledQuery.empty (C1, K6)', () => {
  it('is true for an empty or whitespace-only query', () => {
    expect(compileQuery('').empty).toBe(true);
    expect(compileQuery('   ').empty).toBe(true);
    expect(compileQuery('\t\n ').empty).toBe(true);
  });

  it('is false as soon as the query holds one term', () => {
    expect(compileQuery('a').empty).toBe(false);
    expect(compileQuery('  find  ').empty).toBe(false);
  });

  it('matches everything when it is empty — including an empty text', () => {
    const compiled = compileQuery('   ');
    expect(compiled.test('anything at all')).toBe(true);
    expect(compiled.test('')).toBe(true);
    expect(compiled.spans('anything at all')).toEqual([]);
  });
});

describe('compileQuery — a compiled query is reusable and stateless', () => {
  it('gives the same answer however many times it is asked', () => {
    const compiled: CompiledQuery = compileQuery('find file');
    for (let i = 0; i < 5; i += 1) {
      expect(compiled.test('src/find/file.ts')).toBe(true);
      expect(compiled.test('src/find/other.ts')).toBe(false);
      expect(compiled.spans('src/find/file.ts')).toEqual([
        { start: 4, end: 8 },
        { start: 9, end: 13 },
      ]);
    }
  });

  it('returns a fresh span array each call, so a caller cannot corrupt the next one', () => {
    const compiled = compileQuery('find');
    const first = compiled.spans('src/find/file.ts');
    first[0].end = 999;
    expect(compiled.spans('src/find/file.ts')).toEqual([{ start: 4, end: 8 }]);
  });
});

/**
 * Count `new RegExp(...)` constructions while `run` executes.
 *
 * Regular-expression LITERALS use the intrinsic %RegExp% and are unaffected by swapping the
 * global, so `query.split(/\s+/u)` and the escaping `.replace()` are invisible here — which is
 * exactly what makes the count a count of the query's OWN compiled terms.
 */
function countRegExpConstructions(run: () => void): number {
  const Original = globalThis.RegExp;
  let count = 0;
  class Counting extends Original {
    constructor(pattern: string | RegExp, flags?: string) {
      count += 1;
      super(pattern as string, flags);
    }
  }
  (globalThis as { RegExp: unknown }).RegExp = Counting;
  try {
    run();
  } finally {
    (globalThis as { RegExp: unknown }).RegExp = Original;
  }
  return count;
}

describe('compileQuery — built once per term, not once per entry (C2)', () => {
  const corpus = Array.from({ length: 1000 }, (_, i) => `src/find/file-${i}.ts`);

  it('constructs exactly one RegExp per term across a 1,000-entry corpus', () => {
    let hits = 0;
    const constructions = countRegExpConstructions(() => {
      const compiled = compileQuery('find file');
      for (const entry of corpus) if (compiled.test(entry)) hits += 1;
    });
    expect(hits).toBe(1000);
    expect(constructions).toBe(2);
  });

  it('constructs one RegExp for a single-term query and none for an empty one', () => {
    expect(
      countRegExpConstructions(() => {
        const compiled = compileQuery('find');
        for (const entry of corpus) compiled.test(entry);
      }),
    ).toBe(1);
    expect(
      countRegExpConstructions(() => {
        const compiled = compileQuery('   ');
        for (const entry of corpus) compiled.test(entry);
      }),
    ).toBe(0);
  });

  it('is dramatically cheaper than the per-call path it replaces', () => {
    const compiled = countRegExpConstructions(() => {
      const q = compileQuery('find file');
      for (const entry of corpus) q.test(entry);
    });
    const perCall = countRegExpConstructions(() => {
      for (const entry of corpus) matches(entry, 'find file');
    });
    expect(perCall).toBeGreaterThan(compiled);
  });

  it('compiles the spans path once too', () => {
    const constructions = countRegExpConstructions(() => {
      const compiled = compileQuery('find file');
      for (const entry of corpus) compiled.spans(entry);
    });
    expect(constructions).toBe(2);
  });
});
