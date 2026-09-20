import { describe, expect, it } from 'vitest';
import { scanLinkLine } from '../../src/links/scan-line.js';
import { KNOWN_FILE_EXTENSIONS } from '../../src/links/known-extensions.js';

/**
 * 045 T244 (FR-009, FR-104, FR-159, FR-159a, FR-178) — `scanLinkLine(line, options)` is the one scanner
 * both panel types read, so the user's known-extension set and protocol allowlist reach detection
 * through it and nowhere else.
 *
 * Options (data-model §16.11 `ScanOptions`): `knownExtensions` (FR-178's resolved set), `allowlist`
 * (FR-159, the setting's value) and `refused` (core's half, OS-neutral, by default — the renderer
 * later unites the platform's half in; plan *Corrections after analysis*, third pass). A caller with no
 * options gets the shipped defaults.
 *
 * Protocol spans (FR-159a) are their own kind: `<scheme>:` then a run of non-whitespace, `//` optional,
 * FR-005's trailing punctuation trimmed, a space ending it, an empty run not a link. A refused scheme is
 * never a link, even when allowlisted (refused is applied after the allowlist). FR-009's "never both":
 * no path candidate overlaps a web or a protocol span.
 */

const ALLOW: ReadonlySet<string> = new Set(['mailto', 'tel', 'slack']);

const protocols = (line: string, allowlist: ReadonlySet<string> = ALLOW, refused?: ReadonlySet<string>): string[] =>
  scanLinkLine(line, refused === undefined ? { allowlist } : { allowlist, refused }).protocol.map((p) => p.uri);

const paths = (line: string, options: Parameters<typeof scanLinkLine>[1] = {}): string[] =>
  scanLinkLine(line, options).paths.map((c) => c.text);

describe('scanLinkLine — the known-extension set reaches detection (FR-178)', () => {
  it('a user-added extension ends a spaced path', () => {
    const withFoo = new Set([...KNOWN_FILE_EXTENSIONS, 'foo']);
    expect(paths(String.raw`D:\my dir\a.foo`, { knownExtensions: withFoo })).toEqual([String.raw`D:\my dir\a.foo`]);
    expect(paths(String.raw`D:\my dir\a.foo`)).toEqual([String.raw`D:\my`, String.raw`dir\a.foo`]);
  });

  it('an empty set: no extension ends a spaced path', () => {
    expect(paths(String.raw`D:\my dir\a.md`, { knownExtensions: new Set() })).toEqual([String.raw`D:\my`, String.raw`dir\a.md`]);
  });

  it('with no options, the shipped set applies', () => {
    expect(paths(String.raw`D:\my dir\a.md`)).toEqual([String.raw`D:\my dir\a.md`]);
  });
});

describe('scanLinkLine — allowlisted protocol spans are their own kind (FR-159)', () => {
  it('mailto, tel and slack are returned as protocol spans with their scheme and range', () => {
    const line = 'write to mailto:a@b.c or call tel:+441234 or open slack://open now';
    const scanned = scanLinkLine(line, { allowlist: ALLOW });
    expect(scanned.protocol.map((p) => [p.scheme, p.uri])).toEqual([
      ['mailto', 'mailto:a@b.c'],
      ['tel', 'tel:+441234'],
      ['slack', 'slack://open'],
    ]);
    for (const p of scanned.protocol) expect(line.slice(p.start, p.end)).toBe(p.uri);
    expect(scanned.web).toEqual([]);
    expect(scanned.paths).toEqual([]);
  });

  it('a scheme is matched without case', () => {
    expect(protocols('MailTo:a@b.c')).toEqual(['MailTo:a@b.c']);
  });

  it('a scheme not in the allowlist is not a link', () => {
    expect(protocols('foo:bar')).toEqual([]);
    expect(protocols('zoommtg://x', ALLOW)).toEqual([]);
    expect(protocols('zoommtg://x', new Set(['zoommtg']))).toEqual(['zoommtg://x']);
  });

  it('an empty allowlist: no protocol link at all', () => {
    expect(protocols('mailto:a@b.c', new Set())).toEqual([]);
  });

  it('with no options, the shipped allowlist applies (mailto, tel, slack)', () => {
    expect(scanLinkLine('mailto:a@b.c tel:+44 slack:open foo:bar').protocol.map((p) => p.uri)).toEqual([
      'mailto:a@b.c',
      'tel:+44',
      'slack:open',
    ]);
  });
});

describe('scanLinkLine — refused wins over the allowlist (FR-159)', () => {
  it('core’s refused half applies by default, even to an allowlisted scheme', () => {
    const allowAll = new Set(['javascript', 'data', 'vbscript', 'about', 'blob', 'mailto']);
    expect(protocols('javascript:alert(1) data:text/html,x vbscript:x about:blank blob:x mailto:a@b.c', allowAll)).toEqual([
      'mailto:a@b.c',
    ]);
  });

  it('a supplied refused set replaces the default — the renderer passes the union', () => {
    const allow = new Set(['mailto', 'ms-msdt']);
    expect(protocols('ms-msdt:x mailto:a@b.c', allow, new Set(['ms-msdt']))).toEqual(['mailto:a@b.c']);
    expect(protocols('ms-msdt:x', allow)).toEqual(['ms-msdt:x']);
  });

  it('refused is matched without case', () => {
    expect(protocols('JavaScript:x', new Set(['javascript']))).toEqual([]);
  });
});

describe('scanLinkLine — FR-159a, the protocol span’s grammar', () => {
  it('FR-005’s trailing punctuation is trimmed: mailto:a@b.c. → mailto:a@b.c', () => {
    expect(protocols('mail mailto:a@b.c.')).toEqual(['mailto:a@b.c']);
    expect(protocols('mailto:a@b.c, then')).toEqual(['mailto:a@b.c']);
  });

  it('`//` after the colon is optional: slack:open and slack://open are both links', () => {
    expect(protocols('slack:open')).toEqual(['slack:open']);
    expect(protocols('slack://open')).toEqual(['slack://open']);
  });

  it('a space ends it: tel:+44 20 → tel:+44', () => {
    expect(protocols('tel:+44 20')).toEqual(['tel:+44']);
  });

  it('an empty run is not a link: mailto: alone, slack://', () => {
    expect(protocols('mailto:')).toEqual([]);
    expect(protocols('write to mailto: now')).toEqual([]);
    expect(protocols('slack://')).toEqual([]);
  });

  it('a scheme only starts a span at a word boundary', () => {
    expect(protocols('xmailto:a@b.c')).toEqual([]);
  });
});

describe('scanLinkLine — FR-009: never both', () => {
  it('no path candidate overlaps a protocol span', () => {
    const scanned = scanLinkLine('mailto:a/b.md', { allowlist: ALLOW });
    expect(scanned.protocol.map((p) => p.uri)).toEqual(['mailto:a/b.md']);
    expect(scanned.paths).toEqual([]);
  });

  it('a web link is never also a protocol span, whatever the allowlist says', () => {
    const scanned = scanLinkLine('see https://example.com/x', { allowlist: new Set(['https', 'mailto']) });
    expect(scanned.web.map((w) => w.uri)).toEqual(['https://example.com/x']);
    expect(scanned.protocol).toEqual([]);
  });

  it('a file: URI stays the path grammar’s (FR-003f), even if allowlisted', () => {
    const scanned = scanLinkLine('file:///D:/x.txt', { allowlist: new Set(['file']) });
    expect(scanned.protocol).toEqual([]);
    expect(scanned.paths.map((c) => c.text)).toEqual(['file:///D:/x.txt']);
  });

  it('a drive path is never a protocol span', () => {
    const scanned = scanLinkLine(String.raw`C:\x.txt`, { allowlist: new Set(['c']) });
    expect(scanned.protocol).toEqual([]);
    expect(scanned.paths.map((c) => c.text)).toEqual([String.raw`C:\x.txt`]);
  });

  // Review round four (M2): the device namespace matches the UNC shape (`?` and `.` are both
  // `[^\\/]`), so before `sanitiseLinkTarget` refused it, a line like this drew a link that Explorer
  // declines — and, worse, a second spelling of a path that FR-021's containment check has never been
  // shown to agree about, since `\\?\` is what disables Win32 normalisation.
  it('a Win32 device path is never drawn', () => {
    expect(scanLinkLine(String.raw`open \\?\C:\Windows\System32\cmd.exe now`).paths).toEqual([]);
    expect(scanLinkLine(String.raw`\\.\pipe\some-name`).paths).toEqual([]);
    expect(scanLinkLine(String.raw`\\fileserver\home\a.txt`).paths.map((c) => c.text)).toEqual([
      String.raw`\\fileserver\home\a.txt`,
    ]);
  });
});
