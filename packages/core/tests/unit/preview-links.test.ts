import { describe, it, expect } from 'vitest';
import { classifyPreviewLink, headingSlug, languageForFenceInfo, resolvePreviewImage } from '../../src/preview/links.js';

/**
 * 044 T007 — what a link or an image in a rendered preview is ALLOWED to be.
 *
 * These run in the sanitiser's hook on every `<a>` and `<img>` (contracts/security-policy.md Layer 2),
 * so they are a security decision before they are a navigation one: anything that is not provably an
 * `http:`/`https:`/`mailto:` URL or a path inside the project must come back `inert` or `blocked`,
 * however it is spelled.
 */

const win = { docPath: 'C:\\proj\\docs\\guide.md', projectRoot: 'C:\\proj' };
const posix = { docPath: '/home/u/proj/docs/guide.md', projectRoot: '/home/u/proj' };

describe('classifyPreviewLink — external (FR-091)', () => {
  it.each(['https://example.com/a?b=c#d', 'http://example.com', 'HTTPS://Example.com/', 'mailto:someone@example.com'])(
    '%j is external',
    (href) => {
      expect(classifyPreviewLink(href, win)).toEqual({ kind: 'external', url: href });
    },
  );

  it('trims surrounding whitespace from an external URL', () => {
    expect(classifyPreviewLink('  https://example.com  ', win)).toEqual({
      kind: 'external',
      url: 'https://example.com',
    });
  });
});

describe('classifyPreviewLink — files in the project (FR-090)', () => {
  it('resolves a relative path against the document folder, in the root’s separator', () => {
    expect(classifyPreviewLink('other.md', win)).toEqual({ kind: 'file', absPath: 'C:\\proj\\docs\\other.md' });
    expect(classifyPreviewLink('./sub/x.md', win)).toEqual({ kind: 'file', absPath: 'C:\\proj\\docs\\sub\\x.md' });
    expect(classifyPreviewLink('../README.md', win)).toEqual({ kind: 'file', absPath: 'C:\\proj\\README.md' });
    expect(classifyPreviewLink('../README.md', posix)).toEqual({ kind: 'file', absPath: '/home/u/proj/README.md' });
  });

  it('resolves a root-relative path against the PROJECT root', () => {
    expect(classifyPreviewLink('/README.md', win)).toEqual({ kind: 'file', absPath: 'C:\\proj\\README.md' });
    expect(classifyPreviewLink('/docs/a.md', posix)).toEqual({ kind: 'file', absPath: '/home/u/proj/docs/a.md' });
  });

  it('carries a decoded fragment, and drops a query string', () => {
    expect(classifyPreviewLink('other.md#Getting%20Started', win)).toEqual({
      kind: 'file',
      absPath: 'C:\\proj\\docs\\other.md',
      fragment: 'Getting Started',
    });
    expect(classifyPreviewLink('other.md?raw=1#install', posix)).toEqual({
      kind: 'file',
      absPath: '/home/u/proj/docs/other.md',
      fragment: 'install',
    });
    expect(classifyPreviewLink('other.md#', posix)).toEqual({ kind: 'file', absPath: '/home/u/proj/docs/other.md' });
  });

  it('percent-decodes the path', () => {
    expect(classifyPreviewLink('my%20notes.md', posix)).toEqual({
      kind: 'file',
      absPath: '/home/u/proj/docs/my notes.md',
    });
  });
});

describe('classifyPreviewLink — same-document headings (FR-090f)', () => {
  it('a bare fragment is a heading, decoded', () => {
    expect(classifyPreviewLink('#install', win)).toEqual({ kind: 'heading', fragment: 'install' });
    expect(classifyPreviewLink('#Hello%20World', win)).toEqual({ kind: 'heading', fragment: 'Hello World' });
  });

  it('an empty fragment follows nothing', () => {
    expect(classifyPreviewLink('#', win)).toEqual({ kind: 'inert' });
  });
});

describe('classifyPreviewLink — outside the project (FR-090e)', () => {
  it.each(['../../outside.md', '../../../Windows/win.ini', '%2e%2e/%2e%2e/outside.md', '/../outside.md'])(
    '%j is outside, naming the target as written',
    (href) => {
      expect(classifyPreviewLink(href, win)).toEqual({ kind: 'outside', target: href });
    },
  );

  it('respects a segment boundary: a sibling folder sharing a prefix is outside', () => {
    const ctx = { docPath: 'C:/proj/guide.md', projectRoot: 'C:/proj' };
    expect(classifyPreviewLink('../proj-two/a.md', ctx)).toEqual({ kind: 'outside', target: '../proj-two/a.md' });
  });
});

describe('classifyPreviewLink — everything else is inert (FR-091)', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0001javascript:alert(1)',
    'javascript&#58;alert(1)',
    'javascript&#x3A;alert(1)',
    'javascript&#0000058;alert(1)',
    'javascript&colon;alert(1)',
    'javascript%3Aalert(1)',
    // An obfuscated scheme is never honoured — even when what it hides is a scheme we would allow.
    'https&#58;//example.com/a.md',
    'https%3A//example.com/a.md',
    'data:text/html,<script>alert(1)</script>',
    'file:///C:/Windows/win.ini',
    'vbscript:msgbox(1)',
    'ftp://example.com/a',
    '//evil.example.com/a.md',
    '\\\\server\\share\\a.md',
    'C:/Windows/win.ini',
    '',
    '   ',
    '%E0%A4%A.md',
  ])('%j is inert', (href) => {
    expect(classifyPreviewLink(href, win)).toEqual({ kind: 'inert' });
  });
});

describe('pinned rows — spellings a reader would otherwise have to trust', () => {
  it('a backslash traversal is outside, exactly as a forward-slash one is', () => {
    expect(classifyPreviewLink('..\\..\\x.md', win)).toEqual({ kind: 'outside', target: '..\\..\\x.md' });
  });

  it('/\\host is a network reference: inert as a link, blocked as an image', () => {
    expect(classifyPreviewLink('/\\host/a.md', win)).toEqual({ kind: 'inert' });
    expect(resolvePreviewImage('/\\host/a.png', { ...win, remoteImages: true })).toEqual({ kind: 'blocked' });
  });

  it('a named &Tab; entity inside a scheme is inert', () => {
    expect(classifyPreviewLink('java&Tab;script:alert(1)', win)).toEqual({ kind: 'inert' });
  });
});

/**
 * A numeric character reference too large for a code point must never throw. These run inside the
 * sanitiser hook for every href and src, so an exception here fails the render of the whole file —
 * a document could make itself unpreviewable, or hide what follows, with one malformed reference.
 */
describe('oversized numeric character references fail closed, never throw', () => {
  const decimal = `&#${'9'.repeat(400)};x`;
  const hex = `&#x${'f'.repeat(300)};x`;
  const beyondUnicode = '&#x110000;x';

  it.each([decimal, hex, beyondUnicode])('classifyPreviewLink(%j…) is inert', (href) => {
    expect(classifyPreviewLink(href, win)).toEqual({ kind: 'inert' });
  });

  it.each([decimal, hex, beyondUnicode])('resolvePreviewImage(%j…) is blocked', (src) => {
    expect(resolvePreviewImage(src, { ...win, remoteImages: true })).toEqual({ kind: 'blocked' });
  });
});

describe('resolvePreviewImage (FR-084, FR-092, FR-093)', () => {
  const on = { ...win, remoteImages: true };
  const off = { ...win, remoteImages: false };

  it('a relative image resolves against the document folder, as a project-relative path', () => {
    expect(resolvePreviewImage('img/a.png', on)).toEqual({ kind: 'project', relPath: 'docs/img/a.png' });
    expect(resolvePreviewImage('../assets/b.png', off)).toEqual({ kind: 'project', relPath: 'assets/b.png' });
    expect(resolvePreviewImage('/assets/b.png', off)).toEqual({ kind: 'project', relPath: 'assets/b.png' });
    expect(resolvePreviewImage('a%20b.png?v=2#x', off)).toEqual({ kind: 'project', relPath: 'docs/a b.png' });
  });

  it('an https image is remote only while remote images are permitted (FR-092)', () => {
    const src = 'https://img.shields.io/badge/x.svg';
    expect(resolvePreviewImage(src, on)).toEqual({ kind: 'remote', url: src });
    expect(resolvePreviewImage(src, off)).toEqual({ kind: 'blocked' });
  });

  it.each([
    'http://example.com/a.png',
    'HTTP://example.com/a.png',
    'file:///C:/Windows/win.ini',
    'data:image/png;base64,iVBORw0KGgo=',
    '//host.example.com/a.png',
    '../../outside.png',
    'javascript:alert(1)',
    'https&#58;//example.com/a.png',
    '#frag',
    '',
  ])('%j is blocked whatever the setting (FR-084, FR-093)', (src) => {
    expect(resolvePreviewImage(src, on)).toEqual({ kind: 'blocked' });
    expect(resolvePreviewImage(src, off)).toEqual({ kind: 'blocked' });
  });
});

describe('headingSlug — GitHub-style, de-duplicated (FR-090b)', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ['Hello, World!', 'hello-world'],
    ['API: v2.0', 'api-v20'],
    ['  Padded  ', 'padded'],
    ['foo_bar-baz', 'foo_bar-baz'],
    ['Ünïcödé Tëxt', 'ünïcödé-tëxt'],
    ['🎉 Party', '-party'],
    ['`code` and *emphasis*', 'code-and-emphasis'],
  ])('%j → %j', (text, slug) => {
    expect(headingSlug(text, new Set())).toBe(slug);
  });

  it('suffixes -1, -2 on repeats and records every slug it hands out', () => {
    const taken = new Set<string>();
    expect(headingSlug('Intro', taken)).toBe('intro');
    expect(headingSlug('Intro', taken)).toBe('intro-1');
    expect(headingSlug('intro', taken)).toBe('intro-2');
    expect(headingSlug('Intro 1', taken)).toBe('intro-1-1');
    expect([...taken]).toEqual(['intro', 'intro-1', 'intro-2', 'intro-1-1']);
  });

  /*
   * Adversarial review I2: the suffix search restarted at 1 for every heading, so N identical (or empty)
   * headings cost N²/2 lookups — `'#\n'.repeat(50_000)` hung the window. The search now resumes where the
   * last one for that base stopped. The slugs it hands out must not change.
   */
  it('a literal heading that collides with a generated suffix still de-duplicates, in both orders', () => {
    const literalFirst = new Set<string>();
    expect(['A-1', 'A', 'A', 'A'].map((t) => headingSlug(t, literalFirst))).toEqual(['a-1', 'a', 'a-2', 'a-3']);

    const generatedFirst = new Set<string>();
    expect(['A', 'A', 'A-1', 'A'].map((t) => headingSlug(t, generatedFirst))).toEqual(['a', 'a-1', 'a-1-1', 'a-2']);

    const gap = new Set<string>();
    expect(['a', 'a-2', 'a', 'a', 'a', 'a-3'].map((t) => headingSlug(t, gap))).toEqual([
      'a',
      'a-2',
      'a-1',
      'a-3',
      'a-4',
      'a-3-1',
    ]);
  });

  it('empty headings de-duplicate as -1, -2, … exactly as before', () => {
    const taken = new Set<string>();
    expect(['', '', '', '🎉'].map((t) => headingSlug(t, taken))).toEqual(['', '-1', '-2', '-3']);
  });

  it('N repeats of one heading cost O(N) set lookups, not O(N²) (adversarial review I2)', () => {
    let lookups = 0;
    class CountingSet extends Set<string> {
      override has(value: string): boolean {
        lookups += 1;
        return super.has(value);
      }
    }
    const taken = new CountingSet();
    const n = 5_000;
    for (let i = 0; i < n; i += 1) headingSlug('Same', taken);
    expect(taken.size).toBe(n);
    expect(taken.has(`same-${n - 1}`)).toBe(true);
    expect(lookups).toBeLessThan(3 * n);
  });

  it.each([
    ['empty', ''],
    ['identical', 'a'],
  ])('50,000 %s headings slug within a bound (adversarial review I2)', (_name, text) => {
    const taken = new Set<string>();
    const started = performance.now();
    for (let i = 0; i < 50_000; i += 1) headingSlug(text, taken);
    // Measured: ~45 ms after the fix, ~140-167 s before it.
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(taken.size).toBe(50_000);
  }, 60_000);
});

// markdownHeadingLine moved to heading-line.test.ts alongside its function (fix round 1, item 3).

describe('languageForFenceInfo — the editor’s registry, never an alias table (FR-086)', () => {
  it.each([
    ['ts', 'typescript'],
    ['typescript', 'typescript'],
    ['TypeScript', 'typescript'],
    ['py', 'python'],
    ['sh', 'shell'],
    ['JSON', 'json'],
    ['yml', 'yaml'],
    ['c++', 'cpp'],
    ['ts {1,3}', 'typescript'],
    ['  python  ', 'python'],
    ['mermaid', 'plaintext'],
    ['unknownlang', 'plaintext'],
    ['', 'plaintext'],
  ])('%j → %j', (info, id) => {
    expect(languageForFenceInfo(info)).toBe(id);
  });
});
