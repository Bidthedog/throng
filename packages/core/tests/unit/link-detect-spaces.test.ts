import { describe, expect, it } from 'vitest';
import { detectPathSpans } from '../../src/links/detect.js';
import { KNOWN_FILE_EXTENSIONS } from '../../src/links/known-extensions.js';

/**
 * 045 FR-173 as amended by FR-174, FR-178, FR-178a and FR-179 — the space rule's CONFIRMED case table
 * (SC-022). The maintainer reviewed it at `6d272de9` and accepted every recommendation, including the
 * cases once marked unsure; this file at `80e13719` encodes those answers (spec *Clarifications*,
 * planning block: "Is the space-rule table at `80e13719` the confirmed one? → Yes"). Where the spec's
 * prose and this table disagree on an edge, the table is the maintainer's answer.
 *
 * The maintainer's rule, verbatim: "Spaces in paths are not supported for bare links i.e. /file 1
 * would only catch the /file part. This rule is explicitly overridden if a path is surrounded with
 * backticks, paired quotes, brackets ((), <>, []), ends with a supported slash, OR if a
 * known-extension is greedily discovered." Also decided: any rooted path counts (`/help` in prose is
 * a link), and there is NO existence check — detection is purely syntactic.
 *
 * `detectPathSpans` returns the text of each span drawn as a FILE link, in line order, after FR-005's
 * trim, with FR-004's position suffix EXCLUDED from the text. Web links are the web scanner's, so a
 * URL is never returned.
 *
 * ══ THE RULE AS ENCODED ══
 *
 *  1. DEFAULT. A path stops at the first space. Bare tokens keep today's rules A–D unchanged.
 *  2. ENCLOSED. Text inside backticks, a matched pair of `"…"` or `'…'`, or a matched `()`, `<>`,
 *     `[]`, `{}` may contain spaces — the span is the enclosed text, trimmed — provided that text
 *     starts like a path: anchored, or relative with a separator or a plausible extension. Otherwise
 *     the enclosure is ignored and its contents obey the default (`(x86)`, `<DIR>`, `[WARN]`,
 *     `${HOME}`). Brackets pair by depth; the innermost pair holding a path wins. A quote opens only
 *     at the start of the line or after whitespace or an opening bracket, so an apostrophe (`it's`)
 *     never opens one.
 *  3. SCAN. A token that is anchored (drive, UNC, leading `/`, `~/`, `./`, `../`, `file:`) OR
 *     contains a separator (`src/my`) scans forward word by word across single spaces. The FIRST
 *     word (the token itself included) that ends in a separator, or whose last segment ends in a
 *     KNOWN extension, ends the span. With no such word the default applies. The scan never takes a
 *     word that begins an anchored path, a URL, a quote or backtick, or a path-holding enclosure, and
 *     stops after MAX_PATH_SPACE_WORDS (6).
 *  4. Words the scan did not consume are judged on their own, by rule C as today.
 *  5. KNOWN extensions are an INPUT: `detectPathSpans(line, { knownExtensions })`, defaulting to the
 *     shipped `KNOWN_FILE_EXTENSIONS`. The user edits the set in their instance (adds and removes);
 *     detection only ever sees the resolved set. Matching is case-insensitive.
 */

interface Case {
  readonly line: string;
  readonly spans: readonly string[];
  readonly why: string;
}

interface OptionCase extends Case {
  readonly knownExtensions: ReadonlySet<string>;
}

/** Positive: a span crosses at least one space. */
const CROSSES: readonly Case[] = [
  // ── rule 3, known extension ──
  { line: String.raw`D:\git\throng_tests\test 1\test.md`, spans: [String.raw`D:\git\throng_tests\test 1\test.md`], why: 'corpus: `.md` is known, so the scan reaches `1\\test.md`' },
  { line: '/d/git/throng_tests/test 1/test.md', spans: ['/d/git/throng_tests/test 1/test.md'], why: 'corpus, Git Bash drive form' },
  { line: '/mnt/d/git/throng_tests/test 1/test.md:3', spans: ['/mnt/d/git/throng_tests/test 1/test.md'], why: 'corpus, WSL: the position is judged off and left out of the span' },
  { line: String.raw`C:\Program Files\Common Files\x.js`, spans: [String.raw`C:\Program Files\Common Files\x.js`], why: 'corpus: `Files\\Common` is neither terminator, `Files\\x.js` is' },
  { line: String.raw`\\share\path to file.xlsx`, spans: [String.raw`\\share\path to file.xlsx`], why: 'maintainer example: UNC, known `.xlsx`' },
  { line: String.raw`C:\my folder\my file.txt`, spans: [String.raw`C:\my folder\my file.txt`], why: 'maintainer example, unquoted: `.txt` is known' },
  { line: String.raw`see D:\my notes\a.md for details`, spans: [String.raw`D:\my notes\a.md`], why: 'the first known extension ends it; `for details` is never taken' },
  { line: String.raw`C:\Program Files (x86)\Microsoft\Edge\msedge.exe`, spans: [String.raw`C:\Program Files (x86)\Microsoft\Edge\msedge.exe`], why: '`(x86)` holds no path, so it is not an enclosure and does not stop the scan' },
  { line: String.raw`C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\x.exe`, spans: [String.raw`C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\x.exe`], why: 'five words, within MAX_PATH_SPACE_WORDS' },
  { line: String.raw`D:\my.folder name\x.txt`, spans: [String.raw`D:\my.folder name\x.txt`], why: '`.folder` is not a KNOWN extension, so `D:\\my.folder` does not end the scan' },
  { line: String.raw`D:\x\my file.txt.`, spans: [String.raw`D:\x\my file.txt`], why: 'FR-005 trims the full stop before the extension is judged' },
  { line: String.raw`error: C:\my proj\src\a.ts(12,5): bad token`, spans: [String.raw`C:\my proj\src\a.ts`], why: '`(12,5)` is a position, `:` is trimmed; the span ends at `.ts`' },
  { line: '~/my projects/app/src/index.ts:10:5', spans: ['~/my projects/app/src/index.ts'], why: 'home-relative anchor with a position' },
  { line: './test 1/x.md', spans: ['./test 1/x.md'], why: '`./` anchors' },
  { line: '//fileserver/home/my docs/report.pdf', spans: ['//fileserver/home/my docs/report.pdf'], why: 'UNC, forward slash' },
  { line: 'file:///C:/my dir/x.txt', spans: ['file:///C:/my dir/x.txt'], why: 'a file: URI written with a raw space' },
  { line: String.raw`copy D:\my notes\a.md D:\backup dir\a.md`, spans: [String.raw`D:\my notes\a.md`, String.raw`D:\backup dir\a.md`], why: 'two paths on one line; each ends at its own `.md`' },
  { line: String.raw`D:\my docs\a.md see https://example.com/x`, spans: [String.raw`D:\my docs\a.md`], why: 'a path then a URL: the URL is never part of the path' },
  { line: String.raw`[D:\a b\c.md`, spans: [String.raw`D:\a b\c.md`], why: 'unbalanced `[` is no enclosure, is trimmed, and rule 3 still finds `.md`' },
  { line: String.raw`D:\a b.txt and c.md`, spans: [String.raw`D:\a b.txt`, 'c.md'], why: 'the FIRST known extension ends the scan; `c.md` is its own bare link' },
  { line: String.raw`D:\temp is full of foo/bar.md`, spans: [String.raw`D:\temp is full of foo/bar.md`], why: 'prose bridges to a known extension within the cap: a false positive the rule allows' },
  // ── rule 3, trailing separator ──
  { line: 'Z:\\folder with spaces\\folder\\', spans: ['Z:\\folder with spaces\\folder\\'], why: 'maintainer example: `spaces\\folder\\` ends in a separator' },
  { line: '//path to/file/', spans: ['//path to/file/'], why: 'maintainer example: `to/file/` ends in a separator' },
  { line: 'ls /c/Users/me/My Documents/', spans: ['/c/Users/me/My Documents/'], why: '`Documents/` ends in a separator' },
  { line: 'C:\\Program Files\\', spans: ['C:\\Program Files\\'], why: '`Files\\` ends in a separator' },
  { line: String.raw`\\network.local\folder one\ folder`, spans: ['\\\\network.local\\folder one\\'], why: 'unquoted: `one\\` is the first separator-ending word, so ` folder` is left out' },
  // ── rule 2, enclosed ──
  { line: 'open `/file with spaces.md` now', spans: ['/file with spaces.md'], why: 'maintainer example: backticks' },
  { line: String.raw`"C:\my folder\my file.txt"`, spans: [String.raw`C:\my folder\my file.txt`], why: 'maintainer example: double quotes' },
  { line: String.raw`"\\network.local\folder one\ folder"`, spans: [String.raw`\\network.local\folder one\ folder`], why: 'maintainer example: quoted, taken verbatim — a folder named ` folder`' },
  { line: String.raw`open "C:\my dir\x" now`, spans: [String.raw`C:\my dir\x`], why: 'quoted: no terminator needed' },
  { line: String.raw`"C:\Program Files"`, spans: [String.raw`C:\Program Files`], why: 'the quoted form of the default-rule negative' },
  { line: String.raw`it's in 'D:\my dir\x'`, spans: [String.raw`D:\my dir\x`], why: 'single quotes; the apostrophe in `it\u2019s` is mid-word, so never an opener' },
  { line: String.raw`(D:\my notes\x)`, spans: [String.raw`D:\my notes\x`], why: 'parentheses' },
  { line: String.raw`<C:\my dir\x>`, spans: [String.raw`C:\my dir\x`], why: 'angle brackets' },
  { line: '[/d/folder/a link to file.png]', spans: ['/d/folder/a link to file.png'], why: 'maintainer example: square brackets' },
  { line: String.raw`[text](C:\a b\c.md)`, spans: [String.raw`C:\a b\c.md`], why: 'markdown link: `[text]` holds no path, `(…)` does' },
  { line: '"my dir/x.md"', spans: ['my dir/x.md'], why: 'enclosed relative with a separator' },
  { line: '`foo bar.md`', spans: ['foo bar.md'], why: 'enclosed relative with a plausible extension' },
  { line: String.raw`"C:\my dir\x.ts:12:3"`, spans: [String.raw`C:\my dir\x.ts`], why: 'a position inside the enclosure is still left out of the span' },
  { line: String.raw`"  C:\my dir\x  "`, spans: [String.raw`C:\my dir\x`], why: 'the enclosed text is trimmed' },
  { line: String.raw`(see [D:\a b\c])`, spans: [String.raw`D:\a b\c`], why: 'nested: `(see …)` holds no path, the inner `[…]` does' },
  { line: String.raw`([C:\my dir\x])`, spans: [String.raw`C:\my dir\x`], why: 'nested, both enclosing the same path' },
  { line: String.raw`(C:\a (b)\c d)`, spans: [String.raw`C:\a (b)\c d`], why: 'brackets pair by depth, so the outer pair holds the whole path' },
  { line: String.raw`D:\a "b c.md"`, spans: [String.raw`D:\a`, 'b c.md'], why: 'the scan never takes a quote; the quoted text is its own span' },
  // ── rule 2, curly braces ──
  { line: String.raw`{C:\my dir\a.md}`, spans: [String.raw`C:\my dir\a.md`], why: 'braces enclose like any bracket' },
  { line: String.raw`{C:\a b\c}`, spans: [String.raw`C:\a b\c`], why: 'enclosed: no terminator needed' },
  { line: String.raw`{[C:\a b\c]}`, spans: [String.raw`C:\a b\c`], why: 'nested braces and square brackets' },
  { line: '{/d/my dir/x}', spans: ['/d/my dir/x'], why: 'braces around a rooted path' },
  // ── rule 3, relative with a separator ──
  { line: 'src/my file.ts', spans: ['src/my file.ts'], why: 'a separator lets a relative token scan' },
  { line: 'src/my file.ts:12', spans: ['src/my file.ts'], why: 'relative scan with a position' },
  { line: 'see docs/user guide/intro.md here', spans: ['docs/user guide/intro.md'], why: 'relative scan ends at the first known extension' },
  { line: 'build\\out dir\\', spans: ['build\\out dir\\'], why: 'relative scan ends at a trailing separator' },
  { line: '50/50 split see readme.md', spans: ['50/50 split see readme.md'], why: 'a prose slash scans to a known extension: a false positive the rule allows' },
];

/** Negative: no span crosses a space — or there is no link at all. */
const STAYS: readonly Case[] = [
  { line: '/file 1', spans: ['/file'], why: 'maintainer example: the default' },
  { line: 'type /help for help', spans: ['/help'], why: 'maintainer decision: any rooted path counts, nothing checks it exists' },
  { line: String.raw`C:\Program Files`, spans: [String.raw`C:\Program`], why: 'no separator-ending or known-extension word follows' },
  { line: String.raw` Directory of C:\Program Files\Common Files`, spans: [String.raw`C:\Program`], why: '`dir` header: nothing terminates' },
  { line: String.raw`C:\Program Files (x86)`, spans: [String.raw`C:\Program`], why: 'nothing terminates; `(x86)` is not a path' },
  { line: String.raw`PS C:\my dir> `, spans: [String.raw`C:\my`], why: 'PowerShell prompt: `>` is trimmed, `dir` does not terminate' },
  { line: String.raw`PS C:\Program Files\Git> git status`, spans: [String.raw`C:\Program`], why: '`Files\\Git` neither ends in a separator nor carries an extension' },
  { line: String.raw`C:\my dir>dir`, spans: [String.raw`C:\my`], why: 'cmd prompt' },
  { line: 'cd /d/git/my dir/src', spans: ['/d/git/my'], why: '`dir/src` at end of line is not a terminator any more' },
  { line: String.raw`D:\temp and more words`, spans: [String.raw`D:\temp`], why: 'no terminator' },
  { line: String.raw`cd D:\src and run npm/yarn install`, spans: [String.raw`D:\src`], why: '`npm/yarn` has no extension' },
  { line: String.raw`D:\x.ts and/or foo.md`, spans: [String.raw`D:\x.ts`, 'and/or foo.md'], why: 'the token itself ends in a known extension; then `and/or` has a separator, so it scans to `foo.md`' },
  { line: String.raw`D:\x.ts and then foo.md`, spans: [String.raw`D:\x.ts`, 'foo.md'], why: 'the token ends at once; `foo.md` is bare rule C' },
  { line: String.raw`D:\x.ts:42 and then foo`, spans: [String.raw`D:\x.ts`], why: 'a positioned known extension ends it at once' },
  { line: String.raw`cd C:\temp\ and more.md`, spans: ['C:\\temp\\', 'more.md'], why: 'the token itself ends in a separator; `more.md` is bare rule C' },
  { line: String.raw`D:\notes draft.xyz`, spans: [String.raw`D:\notes`, 'draft.xyz'], why: '`.xyz` is plausible but not KNOWN, so no crossing; `draft.xyz` is bare rule C' },
  { line: String.raw`C:\a.txt C:\b.txt`, spans: [String.raw`C:\a.txt`, String.raw`C:\b.txt`], why: 'two anchored tokens' },
  { line: '/usr/bin and /etc', spans: ['/usr/bin', '/etc'], why: 'the scan never takes a word that begins an anchored path' },
  { line: String.raw`D:\temp https://example.com/x.md`, spans: [String.raw`D:\temp`], why: 'the scan never takes a URL, even one ending `.md`' },
  { line: String.raw`(see D:\temp here)`, spans: [String.raw`D:\temp`], why: '`(see …)` holds no path, so the default applies inside it' },
  { line: String.raw`(D:\a b\c`, spans: [String.raw`D:\a`], why: 'unbalanced `(`: no enclosure, no terminator' },
  { line: String.raw`D:\a b\c)`, spans: [String.raw`D:\a`], why: 'unbalanced `)`: no enclosure, no terminator' },
  { line: String.raw`"D:\a b\c`, spans: [String.raw`D:\a`], why: 'unpaired quote: no enclosure' },
  { line: String.raw`(D:\a b\c]`, spans: [String.raw`D:\a`], why: 'mismatched brackets are not a pair' },
  { line: String.raw`{C:\a b\c`, spans: [String.raw`C:\a`], why: 'unbalanced `{`: no enclosure, no terminator' },
  { line: String.raw`{C:\a b\c)`, spans: [String.raw`C:\a`], why: 'mismatched `{` and `)` are not a pair' },
  { line: '{"a": 1}', spans: [], why: 'JSON: `{…}` and `"a"` both hold no path' },
  { line: 'function f() { return 1; }', spans: [], why: 'code braces hold no path' },
  { line: '${HOME}/x', spans: [], why: 'template: `{HOME}` holds no path, and `${HOME}/x` has no extension' },
  { line: 'echo ${USER} and more', spans: [], why: 'template inside prose' },
  { line: String.raw`don't use D:\my dir\x, it's old`, spans: [String.raw`D:\my`], why: 'mid-word apostrophes never pair into a quote' },
  { line: String.raw`D:\a one two three four five six.md`, spans: [String.raw`D:\a`, 'six.md'], why: 'seven words: past MAX_PATH_SPACE_WORDS (6)' },
  { line: String.raw`D:\temp  two\a.md`, spans: [String.raw`D:\temp`, String.raw`two\a.md`], why: 'the scan crosses exactly one space, never two' },
  { line: 'D:\\a\tb.md', spans: [String.raw`D:\a`, 'b.md'], why: 'never across a tab' },
  { line: 'see test 1/test.md', spans: ['1/test.md'], why: '`test` has no separator so never scans; `1/test.md` is rule C alone' },
  { line: 'my file.ts', spans: ['file.ts'], why: 'no separator, no anchor: the default' },
  { line: 'src/my notes here', spans: [], why: 'relative scan finds no terminator; `src/my` alone has no extension' },
  { line: 'a/b testing is fun', spans: [], why: 'prose slash scans, finds nothing' },
  { line: 'I/O error on TCP/IP', spans: [], why: 'the scan stops at nothing and reaches no terminator' },
  { line: '"hello world"', spans: [], why: 'enclosed, but not a path' },
  { line: '`npm run build`', spans: [], why: 'enclosed, but not a path' },
  { line: '[WARN] disk full', spans: [], why: 'enclosed, but not a path' },
  { line: '"https://example.com/a b"', spans: [], why: 'a quoted URL is the web scanner\u2019s' },
  { line: ' 19/09/2026  10:00    <DIR>          test 1', spans: [], why: '`dir` folder row: `<DIR>` holds no path' },
  { line: 'and/or', spans: [], why: 'prose' },
  { line: '1/2 cup of flour', spans: [], why: 'fraction' },
  { line: 'an either/or choice', spans: [], why: 'prose slash' },
  { line: 'release v1.2.3 is out', spans: [], why: 'version' },
  { line: 'finished 2026/09/19', spans: [], why: 'date' },
  { line: 'at 00:12:03 it stopped', spans: [], why: 'time' },
  { line: 'e.g. this one', spans: [], why: 'one-letter extension' },
  { line: 'visit support.example.com today', spans: [], why: 'host name' },
  { line: 'the Program Files folder', spans: [], why: 'no anchor' },
];

/** No space involved: today's single-token behaviour, restated so the new function keeps it. */
const BASELINE: readonly Case[] = [
  { line: 'foo.ts', spans: ['foo.ts'], why: 'rule C' },
  { line: 'src/foo.ts:42:7 has an error', spans: ['src/foo.ts'], why: 'rule C with a position' },
  { line: String.raw`C:\x\foo.ts:42:7`, spans: [String.raw`C:\x\foo.ts`], why: 'no disk: the positioned reading always wins' },
];

/** Rule 5: the user's edited set, as detection receives it. */
const withFoo: ReadonlySet<string> = new Set([...KNOWN_FILE_EXTENSIONS, 'foo']);
const withoutLog: ReadonlySet<string> = new Set([...KNOWN_FILE_EXTENSIONS].filter((e) => e !== 'log'));
const empty: ReadonlySet<string> = new Set<string>();

const USER_EXTENSIONS: readonly OptionCase[] = [
  { knownExtensions: withFoo, line: String.raw`D:\my dir\a.foo`, spans: [String.raw`D:\my dir\a.foo`], why: 'a user-added extension terminates a scan' },
  { knownExtensions: withFoo, line: String.raw`D:\my dir\a.FOO`, spans: [String.raw`D:\my dir\a.FOO`], why: 'matching is case-insensitive' },
  { knownExtensions: withFoo, line: 'src/my dir/a.foo:3', spans: ['src/my dir/a.foo'], why: 'user-added, relative, with a position' },
  { knownExtensions: KNOWN_FILE_EXTENSIONS, line: String.raw`D:\my dir\a.foo`, spans: [String.raw`D:\my`, String.raw`dir\a.foo`], why: 'without the addition `.foo` is only rule C\u2019s plausible extension' },
  { knownExtensions: withoutLog, line: String.raw`D:\my logs\app.log`, spans: [String.raw`D:\my`, String.raw`logs\app.log`], why: 'a user-removed default no longer terminates; `logs\\app.log` is rule C alone' },
  { knownExtensions: KNOWN_FILE_EXTENSIONS, line: String.raw`D:\my logs\app.log`, spans: [String.raw`D:\my logs\app.log`], why: 'the same line with the shipped set' },
  { knownExtensions: withoutLog, line: String.raw`"D:\my logs\app.log"`, spans: [String.raw`D:\my logs\app.log`], why: 'removal does not affect enclosures, which need no extension' },
  { knownExtensions: empty, line: String.raw`D:\my dir\a.md`, spans: [String.raw`D:\my`, String.raw`dir\a.md`], why: 'an empty set: no extension terminates' },
  { knownExtensions: empty, line: 'D:\\my dir\\sub\\', spans: ['D:\\my dir\\sub\\'], why: 'an empty set leaves the trailing-separator rule intact' },
];

const label = (c: Case): string =>
  `${JSON.stringify(c.line)} \u2192 ${c.spans.length === 0 ? 'no link' : c.spans.map((s) => JSON.stringify(s)).join(' + ')}` +
  ` \u2014 ${c.why}`;

for (const [title, cases] of [
  ['FR-150 revised — a span crosses a space', CROSSES],
  ['FR-150 revised — no span crosses a space', STAYS],
  ['FR-150 revised — single-token behaviour is kept', BASELINE],
] as const) {
  describe(title, () => {
    for (const c of cases) {
      it(label(c), () => {
        expect(detectPathSpans(c.line)).toEqual(c.spans);
      });
    }
  });
}

describe('FR-150 revised — the known-extension set is an input', () => {
  for (const c of USER_EXTENSIONS) {
    it(label(c), () => {
      expect(detectPathSpans(c.line, { knownExtensions: c.knownExtensions })).toEqual(c.spans);
    });
  }

  it('defaults to the shipped KNOWN_FILE_EXTENSIONS', () => {
    const line = String.raw`D:\my logs\app.log and src/my dir/a.foo`;
    expect(detectPathSpans(line)).toEqual(
      detectPathSpans(line, { knownExtensions: KNOWN_FILE_EXTENSIONS }),
    );
  });
});

/**
 * The known-extension set (rule 3). Lower-case, no dot, matched case-insensitively. One or two
 * members per category are pinned here; the full shipped list is `core/src/links/known-extensions.ts`.
 */
describe('FR-150 revised — KNOWN_FILE_EXTENSIONS', () => {
  const expected: Record<string, readonly string[]> = {
    documents: ['txt', 'md', 'pdf', 'csv'],
    office: ['docx', 'xlsx', 'pptx'],
    images: ['png', 'jpg', 'svg'],
    archives: ['zip', '7z', 'gz'],
    code: ['ts', 'js', 'cs', 'py', 'c', 'h'],
    config: ['json', 'yaml', 'toml', 'xml'],
    logs: ['log', 'dmp'],
    executables: ['exe', 'dll', 'msi', 'ps1', 'bat', 'sh'],
  };
  for (const [category, members] of Object.entries(expected)) {
    it(`contains ${category}: ${members.join(', ')}`, () => {
      for (const ext of members) expect(KNOWN_FILE_EXTENSIONS.has(ext)).toBe(true);
    });
  }

  it('excludes words and host suffixes that would drag prose into a path (U8)', () => {
    for (const ext of ['com', 'net', 'org', 'local', 'folder', 'xyz', 'out', 'err']) {
      expect(KNOWN_FILE_EXTENSIONS.has(ext)).toBe(false);
    }
  });

  it('is lower-case with no leading dot', () => {
    for (const ext of KNOWN_FILE_EXTENSIONS) expect(ext).toMatch(/^[a-z0-9]+$/);
  });
});
