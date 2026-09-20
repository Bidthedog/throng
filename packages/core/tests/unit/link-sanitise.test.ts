import { describe, expect, it } from 'vitest';
import { sanitiseLinkTarget } from '../../src/links/sanitise.js';

/**
 * 045 T250 (FR-156, FR-156b, SC-024) — `sanitiseLinkTarget(raw)` is what stands between a link's text
 * and the OS. It runs in `scanLinkLine` before a span is clickable and again in main before any OS call
 * (contracts `link-resolution.md` §9.5).
 *
 * It refuses control characters (C0 and C1), NULs — raw or `%00` — and reduces quote-delimited trailing
 * text to the value before it; a URI leaves as ONE `URL`-serialised string (data-model §16.3). Shell
 * metacharacters are never a refusal reason (FR-156b): the value is handed over as one argument and never
 * through a shell, so `D:\R&D\notes.txt` is a link.
 */

const ok = (raw: string): string => {
  const out = sanitiseLinkTarget(raw);
  if (!out.ok) throw new Error(`refused ${JSON.stringify(raw)}: ${out.why}`);
  return out.value;
};

const refusal = (raw: string): string | null => {
  const out = sanitiseLinkTarget(raw);
  return out.ok ? null : out.why;
};

/**
 * One value, no whitespace a receiver could split into a second argument, no quote, no control —
 * and no ENCODED control either. The encoded half matters because the receiver decodes: a `mailto:`
 * handler reading `%0D%0A` sees a header break where this fixture, reading code units, saw text.
 */
const isSingleValue = (value: string): boolean =>
  !/[\s"]/.test(value) &&
  !/%(?:[01][0-9a-f]|7f|[89][0-9a-f])/i.test(value) &&
  ![...value].some((c) => c.charCodeAt(0) < 0x20 || (c.charCodeAt(0) >= 0x7f && c.charCodeAt(0) <= 0x9f));

describe('sanitiseLinkTarget — SC-024: nothing crafted reaches the OS as more than one value (FR-156)', () => {
  const NUL = String.fromCharCode(0);
  const crafted: readonly string[] = [
    'file:///C:/x.txt%00.exe',
    'https://x" --foo',
    `https://example.com/a${String.fromCharCode(0x07)}b`,
    `https://example.com/a${String.fromCharCode(0x1b)}[31m`,
    `https://example.com/a${String.fromCharCode(0x85)}b`,
    `D:\\notes${String.fromCharCode(0x0a)}calc.txt`,
    `D:\\x${NUL}.exe`,
    `https://example.com/a${NUL}`,
    'https://example.com/?q=a&b|c;d',
    '"C:\\a.txt" --flag',
    'mailto:a@b.c" /c calc',
    // An OPAQUE URI never reaches the `URL` parser, so nothing normalises it on the way out — and
    // `hasControl` reads code units, so the ENCODED break is invisible to it. Without a percent-aware
    // check this line reaches `shell.openExternal` exactly as written.
    'mailto:a@b.c%0D%0ABcc:someone@elsewhere.example',
    'https://example.com/a%0D%0Ab',
    'tel:+441234%09%1B',
    'D:\\notes%0Acalc.txt',
  ];

  for (const raw of crafted) {
    it(`${JSON.stringify(raw)} is refused or reduced to one value`, () => {
      const out = sanitiseLinkTarget(raw);
      if (out.ok) expect(isSingleValue(out.value), out.value).toBe(true);
      else expect(['control', 'nul', 'malformed']).toContain(out.why);
    });
  }

  it('a raw NUL is refused as a NUL', () => {
    expect(refusal(`D:\\x${NUL}.exe`)).toBe('nul');
  });

  it('a percent-encoded NUL is refused as a NUL, in either case', () => {
    expect(refusal('file:///C:/x.txt%00.exe')).toBe('nul');
    expect(refusal('https://example.com/a%00b')).toBe('nul');
  });

  it('C0 and C1 controls, and DEL, are refused', () => {
    expect(refusal(`https://example.com/a${String.fromCharCode(0x07)}b`)).toBe('control');
    expect(refusal(`https://example.com/a${String.fromCharCode(0x1b)}[31m`)).toBe('control');
    expect(refusal(`https://example.com/a${String.fromCharCode(0x85)}b`)).toBe('control');
    expect(refusal(`https://example.com/a${String.fromCharCode(0x7f)}b`)).toBe('control');
    expect(refusal(`D:\\notes${String.fromCharCode(0x0a)}calc.txt`)).toBe('control');
  });

  it('a percent-encoded control character is refused too — in an OPAQUE URI above all', () => {
    // What the user sees without this: a crafted line in a `git log` or a fetched log offers a
    // `mailto:` link; clicking it opens their mail client with a Bcc header they never typed.
    expect(refusal('mailto:a@b.c%0D%0ABcc:someone@elsewhere.example')).toBe('control');
    expect(refusal('mailto:a@b.c%0d%0abcc:x@y.example')).toBe('control');
    expect(refusal('https://example.com/a%0Db')).toBe('control');
    expect(refusal('tel:+441234%09')).toBe('control');
    expect(refusal('slack://open%1B[31m')).toBe('control');
    expect(refusal('https://example.com/a%7Fb')).toBe('control');
    expect(refusal('https://example.com/a%85b')).toBe('control');
  });

  it('the encoded check reads the CUT-AWAY tail too, like the raw one', () => {
    expect(refusal('mailto:a@b.c" %0D%0ABcc:x@y.example')).toBe('control');
  });

  it('an ordinary percent escape is still a link — only the control range is refused', () => {
    expect(ok('https://example.com/a%20b')).toBe('https://example.com/a%20b');
    expect(ok('https://example.com/100%25')).toBe('https://example.com/100%25');
    expect(ok('D:\\a\\100%25.txt')).toBe('D:\\a\\100%25.txt');
    expect(ok('D:\\a\\%TEMP%\\x.txt')).toBe('D:\\a\\%TEMP%\\x.txt');
  });

  it('text after a closing quote is cut, and the URI leaves URL-serialised', () => {
    expect(ok('https://x" --foo')).toBe('https://x/');
    expect(ok('mailto:a@b.c" /c calc')).toBe('mailto:a@b.c');
  });

  it('a quoted path loses its quotes and whatever followed them', () => {
    expect(ok('"C:\\a.txt" --flag')).toBe('C:\\a.txt');
    expect(ok("'D:\\my dir\\a.txt' trailing")).toBe('D:\\my dir\\a.txt');
  });

  it('a URI is serialised by the WHATWG parser, so what leaves is one normalised value', () => {
    expect(ok('HTTPS://Example.COM/a b')).toBe('https://example.com/a%20b');
    expect(ok('https://example.com/?q=a&b|c;d')).toBe(new URL('https://example.com/?q=a&b|c;d').href);
    expect(ok('file:///D:/x/y.txt')).toBe('file:///D:/x/y.txt');
    expect(ok('slack://open')).toBe('slack://open');
    expect(ok('tel:+441234')).toBe('tel:+441234');
  });

  it('a URI the parser rejects is malformed', () => {
    expect(refusal('https://')).toBe('malformed');
    expect(refusal('http://exa mple.com')).toBe('malformed');
  });

  it('surrounding whitespace is trimmed, and nothing left is malformed', () => {
    expect(ok('  src/foo.ts \t')).toBe('src/foo.ts');
    expect(ok(' https://example.com/a ')).toBe('https://example.com/a');
    expect(refusal('   ')).toBe('malformed');
    expect(refusal('')).toBe('malformed');
    expect(refusal('"" --flag')).toBe('malformed');
  });
});

describe('sanitiseLinkTarget — FR-156b: metacharacters in a path are kept', () => {
  it('D:\\R&D\\notes.txt is accepted whole', () => {
    expect(ok('D:\\R&D\\notes.txt')).toBe('D:\\R&D\\notes.txt');
  });

  it('a path with ; or ^ or | or ( ) < > is accepted whole', () => {
    for (const p of ['D:\\a;b\\c.txt', 'D:\\a^b\\c.txt', 'src/a|b.ts', 'src/(x)/y.ts', 'src/<x>/y.ts']) {
      expect(ok(p)).toBe(p);
    }
  });

  it('a path written with a drive letter is not mistaken for a URI', () => {
    expect(ok('C:\\x\\y.txt')).toBe('C:\\x\\y.txt');
    expect(ok('C:/x/y.txt')).toBe('C:/x/y.txt');
  });

  it("an apostrophe inside a path is kept — only a LEADING quote encloses", () => {
    expect(ok("D:\\Bob's files\\a.txt")).toBe("D:\\Bob's files\\a.txt");
  });

  it('a positioned name is not taken for a URI — its case is kept (T256)', () => {
    expect(ok('Makefile:12')).toBe('Makefile:12');
    expect(ok('README.md:10:4')).toBe('README.md:10:4');
  });

  it('a UNC path is accepted whole', () => {
    expect(ok('\\\\fileserver\\home\\a.txt')).toBe('\\\\fileserver\\home\\a.txt');
  });
});

/**
 * 045 FR-156, review round four (M2) — the Win32 DEVICE NAMESPACE is not a link.
 *
 * `\\?\C:\Windows\System32\cmd.exe`, `\\.\pipe\some-name` and `\\?\GLOBALROOT\Device\…` all match the
 * UNC shape `^[\\/]{2}[^\\/]+[\\/]` — `?` and `.` are both `[^\\/]` — so before this they classified
 * `unc`, were drawn as links, were returned verbatim by `resolveCandidate`, were stat-ed, and were
 * handed to `showItemInFolder` / `openFolder` / `ShellExec_RunDLL`.
 *
 * ══ WHY REFUSE RATHER THAN SUPPORT ══
 *
 * Two reasons, and the second is the one that matters.
 *
 *  1. There is nothing to open. `\\.\pipe\…` names a device object, not a file, and Explorer declines
 *     a `\\?\` spelling — so the best case today is one `refused` notice for a gesture that could
 *     never have worked.
 *  2. **`\\?\` is precisely the prefix that DISABLES Win32 path normalisation.** `isLinkInProject` →
 *     `isUnderPath`, and `comparable()` in `file-link-resolver.ts`, are string comparisons that assume
 *     normalised input. A `\\?\` spelling is therefore a SECOND spelling of a path that FR-021's
 *     confinement check has never been shown to agree about — and a containment check with two
 *     spellings and one opinion is the shape of a confinement escape, whether or not one is reachable
 *     today. Refusing the spelling at the one validation gate costs a link nobody clicks and removes
 *     the question entirely.
 *
 * Refusing HERE rather than in the grammar is deliberate: `scanLinkLine` filters every candidate
 * through `sanitiseLinkTarget`, and `FileLinkResolver.plan` runs it again before any reading is built,
 * so one rule covers drawing, following and every menu action (FR-156's "again in main").
 */
describe('sanitiseLinkTarget — M2: the Win32 device namespace is refused', () => {
  for (const raw of [
    '\\\\?\\C:\\Windows\\System32\\cmd.exe',
    '\\\\?\\UNC\\fileserver\\home\\a.txt',
    '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\x.txt',
    '\\\\.\\pipe\\some-name',
    '\\\\.\\PhysicalDrive0',
    '//?/C:/Windows/System32/cmd.exe',
  ]) {
    it(`${JSON.stringify(raw)} is refused as a device path`, () => {
      expect(refusal(raw)).toBe('device');
    });
  }

  it('an ORDINARY UNC path is untouched — a server may be named anything else', () => {
    expect(ok('\\\\fileserver\\home\\a.txt')).toBe('\\\\fileserver\\home\\a.txt');
    expect(ok('\\\\localhost\\C$\\x.txt')).toBe('\\\\localhost\\C$\\x.txt');
    expect(ok('//fileserver/home/a.txt')).toBe('//fileserver/home/a.txt');
  });

  it('a file NAMED `?` or `.` inside an ordinary share is not mistaken for one', () => {
    expect(ok('\\\\fileserver\\home\\?.txt')).toBe('\\\\fileserver\\home\\?.txt');
    expect(ok('\\\\fileserver\\.hidden\\a.txt')).toBe('\\\\fileserver\\.hidden\\a.txt');
  });
});
