import { describe, expect, it } from 'vitest';
import { resourceClass } from '../../src/links/resource-class.js';
import { CORE_REFUSED_URI_SCHEMES } from '../../src/links/refused-schemes.js';

/**
 * 045 FR-009, FR-011, FR-013, FR-157, FR-159 (R5) — the ONE scheme gate, asked of a hyperlink TARGET.
 *
 * *Rewritten in round four (T289; plan Corrections after analysis, fourth pass — "one scheme gate"):*
 * this file pinned `classifyTerminalLinkTarget` (web | file | inert), whose `mailto:` answer was
 * `inert`. S5 / FR-159 supersede that for an allowlisted scheme, and `classifyTerminalLinkTarget` is
 * retired into `resourceClass`, so the cases below are the same questions asked of the gate every
 * surface now uses. `null` is what `inert` meant: not a link, never handed to the OS.
 * *Review round four (L1): `classify.ts` is now DELETED. It had no production consumer left — only the
 * export and two comments — and a retired gate sitting beside the one gate is what the next author
 * reaches for by mistake.*
 *
 * Before this existed the same `^https?://` test was written out three times, and 045 needed a
 * fourth answer (`file:`) at every one of them. The gate answers once, for every caller.
 */

const ALLOW: ReadonlySet<string> = new Set(['mailto', 'tel', 'slack']);
const gate = (uri: string, allowlist: ReadonlySet<string> = ALLOW): ReturnType<typeof resourceClass> =>
  resourceClass(uri, allowlist, CORE_REFUSED_URI_SCHEMES);

describe('resourceClass as the hyperlink-target gate', () => {
  it('answers web for http and https', () => {
    expect(gate('http://example.com')).toBe('web');
    expect(gate('https://example.com/a/b')).toBe('web');
  });

  it('answers on-device for a file: URI — a file link, resolved by main', () => {
    expect(gate('file:///D:/x/y.txt')).toBe('onDevice');
    expect(gate('file://server/share/x')).toBe('onDevice');
  });

  it('javascript: and data: are never links', () => {
    expect(gate('javascript:alert(1)')).toBeNull();
    expect(gate('data:text/html,<b>x</b>')).toBeNull();
  });

  it('mailto: is a protocol link when allowlisted, and not a link when not (S5, FR-159)', () => {
    expect(gate('mailto:someone@example.com')).toBe('protocol');
    expect(gate('mailto:someone@example.com', new Set(['tel']))).toBeNull();
  });

  it('any unknown scheme is not a link', () => {
    expect(gate('ftp://example.com/x')).toBeNull();
    expect(gate('throng://whatever')).toBeNull();
    expect(gate('')).toBeNull();
  });

  it('is case-insensitive on the scheme, and only on the scheme', () => {
    expect(gate('HTTPS://Example.COM/A')).toBe('web');
    expect(gate('FILE:///D:/x')).toBe('onDevice');
    expect(gate('JavaScript:alert(1)', new Set(['javascript']))).toBeNull();
  });

  it('is total — no input throws', () => {
    for (const s of ['', ':', '://', 'http:/', 'file:', 'a'.repeat(10_000)]) {
      expect(() => gate(s)).not.toThrow();
    }
  });

  it('does not treat a scheme-like prefix inside the path as a scheme', () => {
    expect(gate('https://example.com/file:///x')).toBe('web');
  });
});
