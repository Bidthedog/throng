import { describe, expect, it } from 'vitest';
import { classifyTerminalLinkTarget } from '../../src/links/classify.js';

/**
 * 045 FR-009, FR-011, FR-013 (R5) — the ONE scheme gate.
 *
 * Before this existed the same `^https?://` test was written out three times, and 045 needed a
 * fourth answer (`file:`) at every one of them. Three copies of a two-answer question become three
 * copies of a three-answer question, which is how one of them ends up disagreeing. The gate answers
 * once, for every caller.
 *
 * `inert` is the important answer: it is what 024 FR-019 means by "MUST NOT be opened at all", and
 * a scheme nobody has heard of has to land there rather than fall through to the OS URL opener.
 */
describe('classifyTerminalLinkTarget', () => {
  it('answers web for http and https', () => {
    expect(classifyTerminalLinkTarget('http://example.com')).toBe('web');
    expect(classifyTerminalLinkTarget('https://example.com/a/b')).toBe('web');
  });

  it('answers file for a file: URI', () => {
    expect(classifyTerminalLinkTarget('file:///D:/x/y.txt')).toBe('file');
    expect(classifyTerminalLinkTarget('file://server/share/x')).toBe('file');
  });

  it('answers inert for javascript:, data: and mailto:', () => {
    expect(classifyTerminalLinkTarget('javascript:alert(1)')).toBe('inert');
    expect(classifyTerminalLinkTarget('data:text/html,<b>x</b>')).toBe('inert');
    expect(classifyTerminalLinkTarget('mailto:someone@example.com')).toBe('inert');
  });

  it('answers inert for any unknown scheme, and for text carrying no scheme at all', () => {
    expect(classifyTerminalLinkTarget('ftp://example.com/x')).toBe('inert');
    expect(classifyTerminalLinkTarget('throng://whatever')).toBe('inert');
    expect(classifyTerminalLinkTarget('src/foo.ts')).toBe('inert');
    expect(classifyTerminalLinkTarget('')).toBe('inert');
  });

  it('is case-insensitive on the scheme, and only on the scheme', () => {
    expect(classifyTerminalLinkTarget('HTTPS://Example.COM/A')).toBe('web');
    expect(classifyTerminalLinkTarget('FILE:///D:/x')).toBe('file');
    expect(classifyTerminalLinkTarget('JavaScript:alert(1)')).toBe('inert');
  });

  it('is total — no input throws', () => {
    for (const s of ['', ':', '://', 'http:/', 'file:', 'a'.repeat(10_000)]) {
      expect(() => classifyTerminalLinkTarget(s)).not.toThrow();
    }
  });

  it('does not treat a scheme-like prefix inside the path as a scheme', () => {
    expect(classifyTerminalLinkTarget('https://example.com/file:///x')).toBe('web');
  });
});
