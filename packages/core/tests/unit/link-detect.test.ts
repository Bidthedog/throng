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

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T199 — FR-150: a path may contain spaces without quotes (link-resolution.md §8.1, D16 – D19)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user sees today (O11's corpus rows 28, 36, 43, 60): `D:\…\test 1\test.md`,
 * `/d/…/test 1/test.md`, `/mnt/d/…/test 1/test.md:3` and `C:\Program Files\Common Files\…` are never
 * links, in either panel type — detection splits on the space and neither half names anything.
 *
 * FR-150: an ANCHORED token also yields readings extended across single spaces, one word at a time,
 * LONGEST FIRST, the unextended token last; each carries its own FR-004 position readings (with
 * before without) and its own FR-005 trim. Which one is the link is resolution's business (D19).
 *
 * Other candidates on the same line are not this rule's concern (`1\test.md` is a rule-C candidate of
 * its own, today and after), so the readings are compared among the candidates that START where the
 * anchored token starts — `detectPathCandidates` sorts stably by start, so their order is the order
 * detection emitted them in.
 */
type Reading = { text: string; position?: LinkCandidate['position'] };

const readingsAt = (line: string, at: number): Reading[] =>
  detectPathCandidates(line, [])
    .filter((c) => c.start === at)
    .map((c) => (c.position === undefined ? { text: c.text } : { text: c.text, position: c.position }));

const textsAt = (line: string, at: number): string[] => readingsAt(line, at).map((r) => r.text);

/** Every anchored form FR-150 names, each ending in a word the suffix below continues. */
const ANCHORED: readonly (readonly [string, string])[] = [
  ['drive, backslash', 'D:\\git\\throng_tests\\test'],
  ['drive, forward slash', 'D:/git/throng_tests/test'],
  ['UNC, backslash', '\\\\fileserver\\home\\test'],
  ['UNC, forward slash', '//fileserver/home/test'],
  ['Git Bash drive form', '/d/git/throng_tests/test'],
  ['WSL drive form', '/mnt/d/git/throng_tests/test'],
  ['leading /', '/usr/test'],
  ['home', '~/test'],
  ['./', './test'],
  ['../', '../test'],
  ['file: URI', 'file:///D:/git/test'],
];

describe('T199 / D16 – D17 — each anchored form, extended across one space, longest first', () => {
  for (const [label, token] of ANCHORED) {
    for (const suffix of [' 1\\test.md', ' 1/test.md', ' Files\\x']) {
      it(`${label}: ${JSON.stringify(token + suffix)}`, () => {
        expect(textsAt(token + suffix, 0)).toEqual([token + suffix, token]);
      });
    }
  }

  it('the corpus rows, verbatim: D:\\git\\throng_tests\\test 1\\test.md and /d/git/throng_tests/test 1/test.md', () => {
    expect(textsAt('D:\\git\\throng_tests\\test 1\\test.md', 0)[0]).toBe('D:\\git\\throng_tests\\test 1\\test.md');
    expect(textsAt('/d/git/throng_tests/test 1/test.md', 0)[0]).toBe('/d/git/throng_tests/test 1/test.md');
  });

  it('two words: C:\\Program Files\\Common Files\\x.js', () => {
    expect(textsAt('C:\\Program Files\\Common Files\\x.js', 0)).toEqual([
      'C:\\Program Files\\Common Files\\x.js',
      'C:\\Program Files\\Common',
      'C:\\Program',
    ]);
  });

  it('D12\u2019s provider-qualified form extends too, from where its path starts', () => {
    const line = 'FileSystem::\\\\fileserver\\home\\test 1\\x.md';
    const at = line.indexOf('\\\\');
    expect(textsAt(line, at)).toEqual(['\\\\fileserver\\home\\test 1\\x.md', '\\\\fileserver\\home\\test']);
  });

  it('every reading\u2019s span indexes back into the line', () => {
    const line = 'see D:\\git\\throng_tests\\test 1\\test.md now';
    for (const c of detectPathCandidates(line, [])) expect(line.slice(c.start, c.end)).toBe(c.text);
  });
});

describe('T199 / D17 — each reading carries its own position readings and its own trim', () => {
  it('/mnt/d/a b/c.md:3 carries :3 — with the position, then without, then the unextended token', () => {
    expect(readingsAt('/mnt/d/a b/c.md:3', 0)).toEqual([
      { text: '/mnt/d/a b/c.md', position: { line: 3 } },
      { text: '/mnt/d/a b/c.md:3' },
      { text: '/mnt/d/a' },
    ]);
  });

  it('the corpus row /mnt/d/git/throng_tests/test 1/test.md:3 leads with its positioned reading', () => {
    expect(readingsAt('/mnt/d/git/throng_tests/test 1/test.md:3', 0)[0]).toEqual({
      text: '/mnt/d/git/throng_tests/test 1/test.md',
      position: { line: 3 },
    });
  });

  it('FR-005\u2019s trailing punctuation is trimmed from the extended reading\u2019s own end', () => {
    expect(textsAt('D:\\x\\my file.txt.', 0)).toEqual(['D:\\x\\my file.txt', 'D:\\x\\my']);
  });

  it('the worked example: see D:\\git\\throng_tests\\test 1\\test.md:3 for details', () => {
    const line = 'see D:\\git\\throng_tests\\test 1\\test.md:3 for details';
    const found = readingsAt(line, line.indexOf('D:'));
    // Longest first …
    expect(found[0]!.text.length).toBeGreaterThan(found[1]!.text.length);
    // … and the tail is the positioned reading, the same without it, and the bare token.
    expect(found.slice(-3)).toEqual([
      { text: 'D:\\git\\throng_tests\\test 1\\test.md', position: { line: 3 } },
      { text: 'D:\\git\\throng_tests\\test 1\\test.md:3' },
      { text: 'D:\\git\\throng_tests\\test' },
    ]);
  });
});

describe('T199 / D18 — where an extension stops', () => {
  it('never into a word that begins an anchored form: C:\\a.txt C:\\b.txt is two candidates', () => {
    expect(texts('C:\\a.txt C:\\b.txt')).toEqual(['C:\\a.txt', 'C:\\b.txt']);
  });

  it('never into a web span — with or without the scanner\u2019s claim', () => {
    const line = 'D:\\git\\a see https://example.com/a';
    const at = line.indexOf('https://');
    for (const claimed of [[], [{ start: at, end: line.length }]]) {
      const found = detectPathCandidates(line, claimed).map((c) => c.text);
      expect(found.filter((t) => t.includes('https')), JSON.stringify(claimed)).toEqual([]);
    }
  });

  it('never past an unbalanced bracket', () => {
    expect(textsAt('D:\\git\\a b) c d', 0).filter((t) => t.includes(' c'))).toEqual([]);
    expect(textsAt('D:\\git\\a (b c d', 0).filter((t) => t.includes(' c'))).toEqual([]);
  });

  it('never into or past a quote', () => {
    expect(textsAt('D:\\git\\a "b c" d', 0)).toEqual(['D:\\git\\a']);
    expect(textsAt("D:\\git\\a it's here", 0).filter((t) => t.includes("'"))).toEqual([]);
  });

  it('never across a run of two or more spaces', () => {
    expect(textsAt('D:\\git\\a  b.md', 0)).toEqual(['D:\\git\\a']);
  });

  it('a bare word never starts one — test 1/test.md and notes.md more words', () => {
    expect(texts('see test 1/test.md').filter((t) => t.includes(' '))).toEqual([]);
    expect(texts('notes.md more words')).toEqual(['notes.md']);
  });
});

describe('T199 / SC-003, SC-020 — prose after a path does not make prose a link', () => {
  const prose = readFileSync(
    fileURLToPath(new URL('../../../ui/tests/fixtures/links/prose.txt', import.meta.url)),
    'utf8',
  )
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  it('prose.txt, each line spoken after an existing-looking path: every candidate is anchored at the path', () => {
    const PATH = 'D:\\git\\x.ts';
    const offenders: string[] = [];
    for (const l of prose) {
      const line = `built ${PATH} ${l}`;
      for (const c of detectPathCandidates(line, [])) {
        if (!c.text.startsWith(PATH)) offenders.push(`${JSON.stringify(l)} \u2192 ${c.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('and the unextended path is always among them, last of its readings', () => {
    const PATH = 'D:\\git\\x.ts';
    const line = `built ${PATH} and the split came out 60/40 in the end.`;
    const found = textsAt(line, line.indexOf(PATH));
    expect(found.length, 'extended readings exist').toBeGreaterThan(1);
    expect(found[found.length - 1]).toBe(PATH);
  });
});
