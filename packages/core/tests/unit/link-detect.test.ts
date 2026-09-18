import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectPathCandidates } from '../../src/links/detect.js';
import type { LinkCandidate } from '../../src/links/types.js';

/**
 * 045 D1–D8 — `contracts/link-resolution.md` §1.
 *
 * Detection is the only part of this feature that can produce a false link out of ordinary text, so
 * the cases below are as much about what it REFUSES as about what it recognises. SC-003 is the
 * whole-file version of that: `prose.txt` is slashes, colons and dotted words naming nothing, and
 * the grammar must yield zero candidates for every line of it.
 *
 * Nothing here touches a disk. A candidate is not a link (FR-006) — resolution decides that, and it
 * is tested in `link-resolve.test.ts`.
 */

const texts = (line: string): string[] => detectPathCandidates(line, []).map((c) => c.text);

const one = (line: string): LinkCandidate => {
  const found = detectPathCandidates(line, []);
  expect(found, `expected exactly one candidate in ${JSON.stringify(line)}`).toHaveLength(1);
  return found[0];
};

describe('detectPathCandidates — D1: every FR-003 form, without markup', () => {
  it('FR-003a: relative paths', () => {
    expect(texts('built src/foo.ts ok')).toEqual(['src/foo.ts']);
    expect(texts('see ./foo.ts')).toEqual(['./foo.ts']);
    expect(texts('see ../docs/x.md')).toEqual(['../docs/x.md']);
    expect(texts('test.txt')).toEqual(['test.txt']);
  });

  it('FR-003b: Windows absolute paths, either separator', () => {
    expect(texts('at D:\\git\\x.ts')).toEqual(['D:\\git\\x.ts']);
    expect(texts('at D:/git/x.ts')).toEqual(['D:/git/x.ts']);
  });

  it('FR-003c: UNC paths, either separator', () => {
    expect(texts('at \\\\server\\share\\dir\\x.ts')).toEqual(['\\\\server\\share\\dir\\x.ts']);
    expect(texts('at //server/share/dir/x.ts')).toEqual(['//server/share/dir/x.ts']);
  });

  it('FR-003d: leading-slash paths, including the drive forms', () => {
    expect(texts('at /test.txt')).toEqual(['/test.txt']);
    expect(texts('at /d/git/x.ts')).toEqual(['/d/git/x.ts']);
    expect(texts('at /mnt/d/git/x.ts')).toEqual(['/mnt/d/git/x.ts']);
  });

  it('FR-003e: home-relative paths', () => {
    expect(texts('at ~/foo.ts')).toEqual(['~/foo.ts']);
  });

  it('FR-003f: a file: URI written as text', () => {
    expect(texts('see file:///D:/a%20b/c.txt now')).toEqual(['file:///D:/a%20b/c.txt']);
    expect(texts('see file://server/share/x.txt')).toEqual(['file://server/share/x.txt']);
  });

  it('a folder form with no extension still reads as a path when it is absolute', () => {
    expect(texts('cwd D:\\git\\throng')).toEqual(['D:\\git\\throng']);
    expect(texts('cwd ./packages/core')).toEqual(['./packages/core']);
  });
});

describe('detectPathCandidates — D3/FR-004: the position is never part of the text', () => {
  it('path:line', () => {
    const c = detectPathCandidates('error src/foo.ts:42 here', [])[0];
    expect(c.text).toBe('src/foo.ts');
    expect(c.position).toEqual({ line: 42 });
    expect(c.positionText).toBe(':42');
  });

  it('path:line:col', () => {
    const c = detectPathCandidates('error src/foo.ts:42:7 here', [])[0];
    expect(c.text).toBe('src/foo.ts');
    expect(c.position).toEqual({ line: 42, column: 7 });
    expect(c.positionText).toBe(':42:7');
  });

  it('path(line,col)', () => {
    const c = detectPathCandidates('error foo.ts(42,7) here', [])[0];
    expect(c.text).toBe('foo.ts');
    expect(c.position).toEqual({ line: 42, column: 7 });
    expect(c.positionText).toBe('(42,7)');
  });

  it('the span of a positioned candidate covers its path only', () => {
    const line = 'error src/foo.ts:42:7 here';
    const c = detectPathCandidates(line, [])[0];
    expect(line.slice(c.start, c.end)).toBe('src/foo.ts');
  });

  it('a candidate with no position carries neither position field', () => {
    const c = one('see test.txt');
    expect(c.position).toBeUndefined();
    expect(c.positionText).toBeUndefined();
  });
});

describe('detectPathCandidates — FR-005: punctuation, brackets and quotes', () => {
  it('drops trailing sentence punctuation', () => {
    expect(texts('see src/foo.ts.')).toEqual(['src/foo.ts']);
    expect(texts('see src/foo.ts,')).toEqual(['src/foo.ts']);
    expect(texts('see src/foo.ts;')).toEqual(['src/foo.ts']);
    expect(texts('see src/foo.ts:')).toEqual(['src/foo.ts']);
  });

  it('D5: drops an unbalanced enclosing bracket and keeps a balanced pair inside a path', () => {
    expect(texts('see (src/foo.ts)')).toEqual(['src/foo.ts']);
    expect(texts('see [src/foo.ts]')).toEqual(['src/foo.ts']);
    expect(texts('see src/foo(1).ts')).toEqual(['src/foo(1).ts']);
  });

  it('D6: a path in matching quotes is one candidate, spaces included and quotes excluded', () => {
    expect(texts('opened "docs/My File.md" ok')).toEqual(['docs/My File.md']);
    expect(texts("opened 'docs/My File.md' ok")).toEqual(['docs/My File.md']);
  });

  it('the span of a quoted candidate excludes the quotes', () => {
    const line = 'opened "docs/My File.md" ok';
    const c = one(line);
    expect(line.slice(c.start, c.end)).toBe('docs/My File.md');
  });
});

describe('detectPathCandidates — D2: a span claimed by a web link yields nothing', () => {
  it('drops a candidate overlapping a claimed range', () => {
    const line = 'go to https://example.com/a/b.html now';
    const start = line.indexOf('https://');
    const claimed = [{ start, end: start + 'https://example.com/a/b.html'.length }];
    expect(detectPathCandidates(line, claimed)).toEqual([]);
  });

  it('keeps a candidate outside every claimed range', () => {
    const line = 'https://example.com/a and src/foo.ts';
    const claimed = [{ start: 0, end: 'https://example.com/a'.length }];
    expect(detectPathCandidates(line, claimed).map((c) => c.text)).toEqual(['src/foo.ts']);
  });

  it('a web URL is not a candidate even with no claimed ranges', () => {
    expect(texts('go to https://example.com/a/b.html')).toEqual([]);
    expect(texts('go to http://example.com/a/b.html')).toEqual([]);
  });
});

describe('detectPathCandidates — the ambiguity rule: two candidates, positioned first', () => {
  it('C:\\x\\foo.ts:42:7 reads both ways, the positioned reading first', () => {
    const found = detectPathCandidates('at C:\\x\\foo.ts:42:7 here', []);
    expect(found.map((c) => c.text)).toEqual(['C:\\x\\foo.ts', 'C:\\x\\foo.ts:42:7']);
    expect(found[0].position).toEqual({ line: 42, column: 7 });
    expect(found[1].position).toBeUndefined();
  });

  it('foo.ts(42,7) likewise', () => {
    const found = detectPathCandidates('at foo.ts(42,7) here', []);
    expect(found.map((c) => c.text)).toEqual(['foo.ts', 'foo.ts(42,7)']);
    expect(found[0].position).toEqual({ line: 42, column: 7 });
    expect(found[1].position).toBeUndefined();
  });
});

describe('detectPathCandidates — D7/D8: total, pure, and over the given line alone', () => {
  it('the same line always yields the same candidates', () => {
    const line = 'error src/foo.ts:42:7 and D:\\x\\y.md';
    expect(detectPathCandidates(line, [])).toEqual(detectPathCandidates(line, []));
  });

  it('does not throw for any input', () => {
    for (const line of ['', ' ', '\t', ':', '/', '\\', '~', '...', '"', "'", 'a'.repeat(20_000)]) {
      expect(() => detectPathCandidates(line, [])).not.toThrow();
    }
  });

  it('offsets always index back into the line that was scanned', () => {
    const line = '  see ./docs/a.md and ../b.md  ';
    for (const c of detectPathCandidates(line, [])) {
      expect(line.slice(c.start, c.end)).toBe(c.text);
    }
  });
});

describe('detectPathCandidates — D12: PowerShell’s provider-qualified spelling (FR-003g, FR-107; T139)', () => {
  /*
   * Both PowerShells print a network location as `Microsoft.PowerShell.Core\FileSystem::\\s\h\dir`
   * — in the prompt, in `pwd`, in `Resolve-Path`. The qualifier is not part of the path: the
   * candidate is the path alone, and its span covers the path alone, so a Ctrl+click on the
   * qualifier is not a click on a link.
   */
  const alone = (line: string, path: string): void => {
    const found = detectPathCandidates(line, []);
    expect(
      found.map((c) => c.text),
      `candidates in ${JSON.stringify(line)}`,
    ).toEqual([path]);
    const [c] = found;
    expect(line.slice(c.start, c.end)).toBe(path);
  };

  it('`FileSystem::` before a UNC path yields the path alone', () => {
    alone('FileSystem::\\\\s\\h\\x', '\\\\s\\h\\x');
  });

  it('`Microsoft.PowerShell.Core\\FileSystem::` before a drive path yields the path alone', () => {
    alone('Microsoft.PowerShell.Core\\FileSystem::C:\\x\\y.ts', 'C:\\x\\y.ts');
  });

  it('the whole prompt yields the network folder alone', () => {
    alone('PS Microsoft.PowerShell.Core\\FileSystem::\\\\s\\h\\dir> ', '\\\\s\\h\\dir');
  });

  it('any other `Name::` token is still refused', () => {
    for (const line of ['std::vector', 'Foo::Bar', 'a::b', 'Other::C:\\x']) {
      expect(texts(line), line).toEqual([]);
    }
  });
});

describe('detectPathCandidates — SC-003: ordinary prose and log text yields nothing', () => {
  const prose = readFileSync(
    fileURLToPath(new URL('../../../ui/tests/fixtures/links/prose.txt', import.meta.url)),
    'utf8',
  );

  it('the fixture is actually there and is not empty', () => {
    expect(prose.split(/\r?\n/).filter((l) => l.trim().length > 0).length).toBeGreaterThan(20);
  });

  it('every line of prose.txt yields zero candidates', () => {
    const offenders: string[] = [];
    prose.split(/\r?\n/).forEach((line, i) => {
      const found = detectPathCandidates(line, []);
      if (found.length > 0) offenders.push(`line ${i + 1}: ${found.map((c) => c.text).join(', ')}`);
    });
    expect(offenders).toEqual([]);
  });
});
