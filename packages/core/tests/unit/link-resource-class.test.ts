import { describe, expect, it } from 'vitest';
import { resourceClass } from '../../src/links/resource-class.js';
import { CORE_REFUSED_URI_SCHEMES } from '../../src/links/refused-schemes.js';

/**
 * 045 T251 (FR-157, FR-159; data-model §16.2, §16.9) — `resourceClass(target, allowlist, refused)` is the
 * ONE scheme gate: every surface asks it what a link is, and what a Ctrl+click on it does follows from
 * the answer.
 *
 * Five classes: web (`http`/`https`), loopback (web to `localhost`, `127.0.0.1`, `[::1]` — named only so
 * the tests can name it; it routes as web), UNC (`\\server\share\…`, `//server/share/…`,
 * `FileSystem::\\…`), on-device (a `file:` URI and every other path spelling), and protocol (a scheme on
 * the allowlist). `null` is "not a link": empty, refused, not allowlisted, malformed.
 *
 * Refused is applied AFTER the allowlist, so allowlisting a refused scheme does nothing (FR-159). A
 * `file:` URI is classified BEFORE any refusal — `file` is not in the set classification reads; refusing
 * it is FR-037's rule at the external opener only (plan *Corrections after analysis*, first pass).
 */

const ALLOW: ReadonlySet<string> = new Set(['mailto', 'tel', 'slack']);
const cls = (target: string, allowlist: ReadonlySet<string> = ALLOW, refused: ReadonlySet<string> = CORE_REFUSED_URI_SCHEMES) =>
  resourceClass(target, allowlist, refused);

describe('resourceClass — FR-157, the five classes', () => {
  it('web: http and https', () => {
    expect(cls('http://example.com')).toBe('web');
    expect(cls('https://example.com/a/b?q=1')).toBe('web');
  });

  it('loopback: localhost, 127.0.0.1 and [::1], over either web scheme, with or without a port', () => {
    expect(cls('http://localhost')).toBe('loopback');
    expect(cls('https://localhost:5173/app')).toBe('loopback');
    expect(cls('http://127.0.0.1:8080/')).toBe('loopback');
    expect(cls('http://[::1]:3000/x')).toBe('loopback');
    expect(cls('HTTP://LOCALHOST/')).toBe('loopback');
  });

  it('a host that merely starts like a loopback one is web', () => {
    expect(cls('http://localhost.example.com/')).toBe('web');
    expect(cls('http://127.0.0.10/')).toBe('web');
  });

  it('UNC: all three spellings', () => {
    expect(cls('\\\\fileserver\\home\\a.txt')).toBe('unc');
    expect(cls('//fileserver/home/a.txt')).toBe('unc');
    expect(cls('FileSystem::\\\\fileserver\\home\\a.txt')).toBe('unc');
    expect(cls('Microsoft.PowerShell.Core\\FileSystem::\\\\fileserver\\home')).toBe('unc');
  });

  it('on-device: a file: URI, and every plain path spelling', () => {
    expect(cls('file:///D:/x/y.txt')).toBe('onDevice');
    expect(cls('file://fileserver/home/a.txt')).toBe('onDevice');
    expect(cls('FILE:///D:/x')).toBe('onDevice');
    for (const p of ['D:\\x\\y.txt', 'C:/x/y.txt', 'src/foo.ts', './a.txt', '../b.txt', '~/c.txt', '/d/git/x.ts', '/etc/hosts', 'FileSystem::C:\\x']) {
      expect(cls(p), p).toBe('onDevice');
    }
  });

  it('protocol: only when the scheme is allowlisted', () => {
    expect(cls('mailto:a@b.c')).toBe('protocol');
    expect(cls('tel:+441234')).toBe('protocol');
    expect(cls('slack://open')).toBe('protocol');
    expect(cls('slack:open')).toBe('protocol');
    expect(cls('zoommtg://x')).toBeNull();
    expect(cls('mailto:a@b.c', new Set())).toBeNull();
    expect(cls('zoommtg://x', new Set(['zoommtg']))).toBe('protocol');
  });

  it('an unknown scheme is not a link', () => {
    expect(cls('ftp://example.com/x')).toBeNull();
    expect(cls('throng://whatever')).toBeNull();
  });
});

describe('resourceClass — refused wins over the allowlist (FR-159)', () => {
  for (const scheme of CORE_REFUSED_URI_SCHEMES) {
    it(`${scheme}: refused even when allowlisted`, () => {
      const allow = new Set([...ALLOW, scheme]);
      expect(cls(`${scheme}:x`, allow)).toBeNull();
      expect(cls(`${scheme.toUpperCase()}:x`, allow)).toBeNull();
    });
  }

  it('a platform scheme in the refused set is refused even when allowlisted', () => {
    const refused = new Set([...CORE_REFUSED_URI_SCHEMES, 'ms-msdt']);
    expect(cls('ms-msdt:/id x', new Set([...ALLOW, 'ms-msdt']), refused)).toBeNull();
  });

  it('file is not in the set classification reads — a file: URI is on-device even when "file" is refused', () => {
    expect(CORE_REFUSED_URI_SCHEMES.has('file')).toBe(false);
    expect(cls('file:///D:/x', ALLOW, new Set([...CORE_REFUSED_URI_SCHEMES, 'file']))).toBe('onDevice');
  });
});

describe('resourceClass — edges', () => {
  it('schemes compare without case', () => {
    expect(cls('HTTPS://example.com')).toBe('web');
    expect(cls('MailTo:a@b.c')).toBe('protocol');
    expect(cls('JavaScript:alert(1)', new Set(['javascript']))).toBeNull();
  });

  it('an empty or blank target is null', () => {
    expect(cls('')).toBeNull();
    expect(cls('   ')).toBeNull();
  });

  it('a web address the URL parser rejects is null', () => {
    expect(cls('https://')).toBeNull();
    expect(cls('http://exa mple.com')).toBeNull();
  });

  it('a drive letter is not a scheme', () => {
    expect(cls('C:\\x')).toBe('onDevice');
    expect(cls('c:x')).toBe('onDevice');
  });

  it('is total — no input throws', () => {
    for (const s of ['', ':', '://', 'http:/', 'file:', 'a'.repeat(10_000), '\\\\', '//']) {
      expect(() => cls(s)).not.toThrow();
    }
  });
});

/**
 * Review round four (M2) — the Win32 DEVICE NAMESPACE is not one of the five classes.
 *
 * `?` and `.` are both `[^\\/]`, so the UNC shape this file's `unc` cases rely on matched `\\?\…` and
 * `\\.\pipe\…` too. The reason that is worth a rule rather than a shrug: `\\?\` is the prefix that
 * DISABLES Win32 path normalisation, and FR-021's confinement (`isUnderPath`, and `comparable()` in
 * `file-link-resolver.ts`) is a string comparison that assumes normalised input — so it is a second
 * spelling the containment check has never been shown to agree about. `sanitiseLinkTarget` refuses it
 * at the one validation gate; this gate agrees, so nothing that asks "what is this" gets `unc` for an
 * answer and then goes looking for a folder.
 */
describe('resourceClass — M2: a device path is not a link', () => {
  it('`\\\\?\\` and `\\\\.\\` are null, not unc', () => {
    expect(cls('\\\\?\\C:\\Windows\\System32\\cmd.exe')).toBeNull();
    expect(cls('\\\\?\\UNC\\fileserver\\home\\a.txt')).toBeNull();
    expect(cls('\\\\.\\pipe\\some-name')).toBeNull();
    expect(cls('//?/C:/Windows')).toBeNull();
  });

  it('an ordinary share is still unc', () => {
    expect(cls('\\\\fileserver\\home\\a.txt')).toBe('unc');
    expect(cls('\\\\fileserver\\.hidden\\a.txt')).toBe('unc');
  });
});
