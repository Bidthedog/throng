import { describe, expect, it } from 'vitest';
import { detectWebLinks, WEB_URL_REGEX } from '../../src/links/web-url.js';
import { scanLinkLine } from '../../src/links/scan-line.js';

/**
 * 045 FR-009, FR-102, FR-104 — D9 – D11, `contracts/link-resolution.md` §6.1 and `data-model.md`
 * §13.2.
 *
 * ══ ONE WEB GRAMMAR, IN CORE ══
 *
 * The terminal's plain-text url pattern (`TERMINAL_URL_REGEX`, with #198's balanced-parenthesis
 * widening) moves to `@throng/core` as `WEB_URL_REGEX`, byte for byte (D10), so terminals and
 * editors cannot recognise web links differently. The first block below is EVERY case of
 * `packages/ui/tests/unit/terminal-url.test.ts`, run against core's pattern — that file itself must
 * pass unchanged once `terminal-url.ts` re-exports this one.
 *
 * ══ ONE LINE SCAN ══
 *
 * `scanLinkLine` returns a line's web spans and its path candidates together, and no path candidate
 * ever overlaps a web span (FR-009, D11). Both panel types take a line's links from it and from
 * nothing else (D9) — that is FR-104's parity, by construction.
 */

/** The urls a printed line yields, matched the way WebLinksAddon's LinkComputer matches them. */
function urlsIn(line: string): string[] {
  const rex = new RegExp(WEB_URL_REGEX.source, `${WEB_URL_REGEX.flags}g`);
  return [...line.matchAll(rex)].map((m) => m[0]);
}

describe('WEB_URL_REGEX — every case of terminal-url.test.ts, against core’s pattern (D10)', () => {
  it('keeps balanced parentheses inside the url', () => {
    expect(urlsIn('see https://en.wikipedia.org/wiki/Bash_(Unix_shell) for details')).toEqual([
      'https://en.wikipedia.org/wiki/Bash_(Unix_shell)',
    ]);
    expect(urlsIn('https://example.com/f(a)(b)/g')).toEqual(['https://example.com/f(a)(b)/g']);
  });

  it('drops a closing parenthesis the url did not open', () => {
    expect(urlsIn('(see https://example.com/a)')).toEqual(['https://example.com/a']);
    expect(urlsIn('(https://en.wikipedia.org/wiki/Bash_(Unix_shell))')).toEqual([
      'https://en.wikipedia.org/wiki/Bash_(Unix_shell)',
    ]);
  });

  it('stops at an opening parenthesis that is never closed', () => {
    expect(urlsIn('https://example.com/a_(b c')).toEqual(['https://example.com/a_']);
  });

  it('still drops trailing sentence punctuation', () => {
    expect(urlsIn('Go to https://example.com/a.')).toEqual(['https://example.com/a']);
    expect(urlsIn('https://example.com/q?a=1, then')).toEqual(['https://example.com/q?a=1']);
    expect(urlsIn('"https://example.com/quoted"')).toEqual(['https://example.com/quoted']);
  });

  it('matches only http(s), several per line', () => {
    expect(urlsIn('ftp://x.com and http://a.com/1 and HTTPS://b.com/2')).toEqual([
      'http://a.com/1',
      'HTTPS://b.com/2',
    ]);
  });
});

describe('detectWebLinks — spans that index back into the line', () => {
  it('each span is the url, with start and end inside the line', () => {
    const line = 'see https://example.com/a and (http://b.com/x_(y)) done';
    const spans = detectWebLinks(line);
    expect(spans.map((s) => s.uri)).toEqual(['https://example.com/a', 'http://b.com/x_(y)']);
    for (const s of spans) expect(line.slice(s.start, s.end)).toBe(s.uri);
  });

  it('a line with no url yields no span, and is total over odd input', () => {
    expect(detectWebLinks('plain text, src/foo.ts:42')).toEqual([]);
    for (const line of ['', ' ', 'https://', 'http:/x', 'a'.repeat(20_000)]) {
      expect(() => detectWebLinks(line)).not.toThrow();
    }
  });

  it('`javascript:` and `mailto:` text are not web links', () => {
    expect(detectWebLinks('javascript:alert(1) mailto:a@b.com')).toEqual([]);
  });
});

describe('scanLinkLine — web spans and path candidates together, never overlapping (D9 – D11)', () => {
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean =>
    a.start < b.end && b.start < a.end;

  it('a line with both yields both', () => {
    const line = 'see https://example.com/docs and src/foo.ts:42';
    const scanned = scanLinkLine(line);
    expect(scanned.web.map((w) => w.uri)).toEqual(['https://example.com/docs']);
    expect(scanned.paths.map((p) => p.text)).toContain('src/foo.ts');
  });

  it('FR-009: a url that looks like it ends in a path is a web link and NOT also a path candidate', () => {
    const line = 'open https://host/src/foo.ts:42 now';
    const scanned = scanLinkLine(line);
    expect(scanned.web.map((w) => w.uri)).toHaveLength(1);
    for (const p of scanned.paths) {
      for (const w of scanned.web) expect(overlaps(p, w), `${p.text} overlaps ${w.uri}`).toBe(false);
    }
  });

  it('no path candidate overlaps any web span, over a line holding several of each', () => {
    const line =
      'a https://x.com/a/b.html b ./docs/a.md c http://y.com/c.ts:1 d D:\\git\\x.ts e https://z.com/(p)';
    const scanned = scanLinkLine(line);
    expect(scanned.web.length).toBe(3);
    expect(scanned.paths.map((p) => p.text)).toEqual(
      expect.arrayContaining(['./docs/a.md', 'D:\\git\\x.ts']),
    );
    for (const p of scanned.paths) {
      for (const w of scanned.web) expect(overlaps(p, w), `${p.text} overlaps ${w.uri}`).toBe(false);
    }
  });

  it('its path candidates are exactly what detection yields with the web spans claimed', () => {
    const line = 'src/a.ts then https://example.com/b.ts then ../c.md';
    const scanned = scanLinkLine(line);
    expect(scanned.paths.map((p) => p.text)).toEqual(['src/a.ts', '../c.md']);
  });

  it('is pure: the same line always scans the same', () => {
    const line = 'https://example.com/a and src/foo.ts:42:7';
    expect(scanLinkLine(line)).toEqual(scanLinkLine(line));
  });
});
