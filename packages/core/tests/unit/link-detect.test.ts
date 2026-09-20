import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectPathCandidates } from '../../src/links/detect.js';
import { scanLinkLine } from '../../src/links/scan-line.js';
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
    // FR-179b (round four, superseding round three's extended readings): `c.txt` ends in a known
    // extension, so the span ends there and `now` is never part of it.
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
    // One span (FR-179b: `foo.ts` ends it), read both ways.
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

  // T243 / FR-174: any rooted path is a link, so the fixture must hold no rooted token — or expect it as
  // one. It holds none, so "zero" stands by grammar alone; this pins that, so a rooted token added to
  // the fixture later has to change the expectation rather than quietly redefine the grammar.
  it('T243 / FR-174: the fixture holds no rooted token', () => {
    const rooted = prose.split(/\s+/).filter((token) => /^\/[A-Za-z0-9._~-]/.test(token));
    expect(rooted).toEqual([]);
  });

  // T243: rendering reads `scanLinkLine`, not `detectPathCandidates` alone — so the fixture goes
  // through that too, with the shipped options: no path, web or protocol link on any line.
  it('T243: every line of prose.txt yields no link of any kind through scanLinkLine', () => {
    const offenders: string[] = [];
    prose.split(/\r?\n/).forEach((line, i) => {
      const { web, protocol, paths } = scanLinkLine(line);
      const found = [...web.map((w) => w.uri), ...protocol.map((p) => p.uri), ...paths.map((c) => c.text)];
      if (found.length > 0) offenders.push(`line ${i + 1}: ${found.join(', ')}`);
    });
    expect(offenders).toEqual([]);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T199, rewritten by T242 — paths with spaces: FR-173 as amended by FR-174 and FR-179
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user saw before round three (O11's corpus rows 28, 36, 43, 60): `D:\…\test 1\test.md`,
 * `/d/…/test 1/test.md`, `/mnt/d/…/test 1/test.md:3` and `C:\Program Files\Common Files\…` were never
 * links — detection split on the space and neither half named anything.
 *
 * Round three (FR-150) answered with extended readings, longest first, and let resolution pick by
 * existence. Round four removes them (FR-155: validity is syntactic): a token that is anchored or holds
 * a separator scans across single spaces to the FIRST word ending in a separator or a known extension,
 * and that is the ONE span — plus FR-004's positioned/unpositioned pair. These cases were rewritten to
 * that rule, as FR-173 / FR-179 permit; the maintainer-confirmed table is `link-detect-spaces.test.ts`,
 * and it wins every edge.
 *
 * Other candidates on the same line are compared separately, so the readings are those that START where
 * the token starts — `detectPathCandidates` sorts stably by start, so their order is emission order.
 */
type Reading = { text: string; position?: LinkCandidate['position'] };

const readingsAt = (line: string, at: number): Reading[] =>
  detectPathCandidates(line, [])
    .filter((c) => c.start === at)
    .map((c) => (c.position === undefined ? { text: c.text } : { text: c.text, position: c.position }));

const textsAt = (line: string, at: number): string[] => readingsAt(line, at).map((r) => r.text);

/** Every anchored form, each ending in a word the suffix below continues. */
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

describe('T242 / FR-179b — each anchored form crosses one space to a known extension, as one reading', () => {
  for (const [label, token] of ANCHORED) {
    for (const suffix of [' 1\\test.md', ' 1/test.md']) {
      it(`${label}: ${JSON.stringify(token + suffix)}`, () => {
        expect(textsAt(token + suffix, 0)).toEqual([token + suffix]);
      });
    }
    it(`${label}: ${JSON.stringify(`${token} Files\\x`)} — no terminator, so the token alone`, () => {
      expect(textsAt(`${token} Files\\x`, 0)).toEqual([token]);
    });
  }

  it('the corpus rows, verbatim: D:\\git\\throng_tests\\test 1\\test.md and /d/git/throng_tests/test 1/test.md', () => {
    expect(texts('D:\\git\\throng_tests\\test 1\\test.md')).toEqual(['D:\\git\\throng_tests\\test 1\\test.md']);
    expect(texts('/d/git/throng_tests/test 1/test.md')).toEqual(['/d/git/throng_tests/test 1/test.md']);
  });

  it('two spaces: C:\\Program Files\\Common Files\\x.js is one span', () => {
    expect(texts('C:\\Program Files\\Common Files\\x.js')).toEqual(['C:\\Program Files\\Common Files\\x.js']);
  });

  it('D12\u2019s provider-qualified form scans too, from where its path starts', () => {
    const line = 'FileSystem::\\\\fileserver\\home\\test 1\\x.md';
    const at = line.indexOf('\\\\');
    expect(textsAt(line, at)).toEqual(['\\\\fileserver\\home\\test 1\\x.md']);
  });

  it('every span indexes back into the line', () => {
    const line = 'see D:\\git\\throng_tests\\test 1\\test.md now';
    for (const c of detectPathCandidates(line, [])) expect(line.slice(c.start, c.end)).toBe(c.text);
  });
});

describe('T242 / FR-004, FR-005 — a spaced span carries its position readings and its trim', () => {
  it('/mnt/d/a b/c.md:3 — with the position, then without; nothing shorter', () => {
    expect(readingsAt('/mnt/d/a b/c.md:3', 0)).toEqual([
      { text: '/mnt/d/a b/c.md', position: { line: 3 } },
      { text: '/mnt/d/a b/c.md:3' },
    ]);
  });

  it('FR-005\u2019s trailing punctuation is trimmed from the span\u2019s own end', () => {
    expect(textsAt('D:\\x\\my file.txt.', 0)).toEqual(['D:\\x\\my file.txt']);
  });

  it('the worked example: see D:\\git\\throng_tests\\test 1\\test.md:3 for details', () => {
    const line = 'see D:\\git\\throng_tests\\test 1\\test.md:3 for details';
    expect(detectPathCandidates(line, []).map((c) => (c.position ? { text: c.text, position: c.position } : { text: c.text }))).toEqual([
      { text: 'D:\\git\\throng_tests\\test 1\\test.md', position: { line: 3 } },
      { text: 'D:\\git\\throng_tests\\test 1\\test.md:3' },
    ]);
  });
});

describe('T242 / FR-179 — where a scan stops', () => {
  it('never into a word that begins an anchored form: C:\\a.txt C:\\b.txt is two candidates', () => {
    expect(texts('C:\\a.txt C:\\b.txt')).toEqual(['C:\\a.txt', 'C:\\b.txt']);
  });

  it('never into a web span — with or without the scanner\u2019s claim', () => {
    const line = 'D:\\git\\a see https://example.com/a.md';
    const at = line.indexOf('https://');
    for (const claimed of [[], [{ start: at, end: line.length }]]) {
      const found = detectPathCandidates(line, claimed).map((c) => c.text);
      expect(found, JSON.stringify(claimed)).toEqual(['D:\\git\\a']);
    }
  });

  it('an unbalanced bracket is trimmed rather than ending it (FR-179f)', () => {
    expect(texts('[D:\\git\\a b\\c.md')).toEqual(['D:\\git\\a b\\c.md']);
    expect(texts('D:\\git\\a b) c d')).toEqual(['D:\\git\\a']);
  });

  it('never into or past a quote', () => {
    expect(textsAt('D:\\git\\a "b c" d.md', 0)).toEqual(['D:\\git\\a']);
    expect(textsAt("D:\\git\\a it's here", 0)).toEqual(['D:\\git\\a']);
  });

  it('never across a run of two or more spaces, or a tab', () => {
    expect(textsAt('D:\\git\\a  b.md', 0)).toEqual(['D:\\git\\a']);
    expect(textsAt('D:\\git\\a\tb.md', 0)).toEqual(['D:\\git\\a']);
  });

  it('a bare word never starts one — test 1/test.md and notes.md more words', () => {
    expect(texts('see test 1/test.md')).toEqual(['1/test.md']);
    expect(texts('notes.md more words')).toEqual(['notes.md']);
  });

  it('FR-179f: a span of exactly MAX_PATH_SPACE_WORDS (6) words is one link; 7 is not', () => {
    expect(texts('D:\\a one two three four five.md')).toEqual(['D:\\a one two three four five.md']);
    expect(texts('D:\\a one two three four five six.md')).toEqual(['D:\\a', 'six.md']);
  });
});

describe('T242 / FR-174 — any rooted path is a link; a `/` with no path character is not', () => {
  it('`/help` and `/s` are links', () => {
    expect(texts('type /help for help')).toEqual(['/help']);
    expect(texts('dir /s')).toEqual(['/s']);
  });

  it('a bare `/<letter>` with no following separator is a rooted path, not a drive form (detection keeps it whole)', () => {
    expect(texts('dir /c')).toEqual(['/c']);
  });

  it('`/?`, `/*` and a lone `/` are not', () => {
    expect(texts('dir /?')).toEqual([]);
    expect(texts('code /* comment */ more')).toEqual([]);
    expect(texts('a / b')).toEqual([]);
  });
});

describe('T242 / SC-003, SC-020 — prose after a path does not make prose a link', () => {
  const prose = readFileSync(
    fileURLToPath(new URL('../../../ui/tests/fixtures/links/prose.txt', import.meta.url)),
    'utf8',
  )
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  it('prose.txt, each line spoken after a path ending in a known extension: the path is the only candidate', () => {
    const PATH = 'D:\\git\\x.ts';
    const offenders: string[] = [];
    for (const l of prose) {
      const found = texts(`built ${PATH} ${l}`);
      if (found.length !== 1 || found[0] !== PATH) offenders.push(`${JSON.stringify(l)} \u2192 ${found.join(' | ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('and after a path with no extension, no prose word is ever taken into it', () => {
    const PATH = 'D:\\git\\throng';
    const offenders: string[] = [];
    for (const l of prose) {
      const found = texts(`built ${PATH} ${l}`);
      if (found.length !== 1 || found[0] !== PATH) offenders.push(`${JSON.stringify(l)} \u2192 ${found.join(' | ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
