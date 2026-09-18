import type { IPathForms } from '../abstractions/path-forms.js';

/**
 * Reusable contract suite for any `IPathForms` implementation (045 PF1–PF12,
 * `contracts/platform-ports.md` §1).
 *
 * Pure-throw, in the style of `platform-info-contract.ts`: it imports nothing and throws on the
 * first violation, so `@throng/core` stays free of a test-runner dependency and any layer — or a
 * future macOS or Linux package — can run it.
 *
 * ══ SHAPE AND RELATIONSHIP, NEVER A LITERAL PLATFORM PATH ══
 *
 * Nothing below asserts `D:\git\x.ts`. It asserts that the answer is absolute, that it ends in the
 * segments the input named, that `/mnt/d/…` and `/d/…` agree, and that `localhost` and no-host
 * agree — properties any correct implementation has, on any platform. A suite that pinned the
 * Windows spelling would have to be rewritten by the first person to add a second platform, which
 * is exactly the outcome Principle II exists to prevent. The Windows-only spellings are asserted
 * where they belong: in `platform-windows/tests/contract/windows-path-forms.contract.test.ts`.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`IPathForms contract violation: ${message}`);
}

/**
 * The two shapes an absolute path takes across the platforms this project targets and the ones it
 * may target later: a leading separator (POSIX, and a UNC share), or a drive designator. Stated
 * here as a SHAPE so neither answer below has to name a platform.
 */
const ABSOLUTE = /^(?:[\\/]|[A-Za-z]:[\\/])/;

const SEPARATOR = /[\\/]/;

function endsWithSegments(path: string, segments: readonly string[]): boolean {
  const parts = path.split(SEPARATOR).filter((p) => p.length > 0);
  if (parts.length < segments.length) return false;
  return segments.every((s, i) => parts[parts.length - segments.length + i] === s);
}

export function runPathFormsContract(makeSubject: () => IPathForms): void {
  const subject = makeSubject();

  // ── PF1 ──────────────────────────────────────────────────────────────────────────────────────
  const home = subject.homeDirectory();
  assert(
    typeof home === 'string' && home.length > 0,
    `homeDirectory() must return a non-empty string; got ${JSON.stringify(home)}`,
  );
  assert(
    ABSOLUTE.test(home),
    `homeDirectory() must be absolute; got ${JSON.stringify(home)}`,
  );
  assert(
    subject.homeDirectory() === home,
    'homeDirectory() must be stable across calls',
  );

  // ── PF2 ──────────────────────────────────────────────────────────────────────────────────────
  const drive = subject.fromDriveForm('/d/git/x.ts');
  assert(
    typeof drive === 'string' && drive.length > 0,
    `fromDriveForm('/d/git/x.ts') must convert, not refuse; got ${JSON.stringify(drive)}`,
  );
  assert(
    ABSOLUTE.test(drive),
    `fromDriveForm('/d/git/x.ts') must return an absolute path; got ${JSON.stringify(drive)}`,
  );
  assert(
    endsWithSegments(drive, ['git', 'x.ts']),
    `fromDriveForm('/d/git/x.ts') must keep the trailing segments git and x.ts; got ${JSON.stringify(drive)}`,
  );
  assert(
    /d/i.test(drive.split(SEPARATOR).filter((p) => p.length > 0)[0] ?? ''),
    `fromDriveForm('/d/git/x.ts') must name drive d in its root; got ${JSON.stringify(drive)}`,
  );

  // ── PF3 ──────────────────────────────────────────────────────────────────────────────────────
  const wsl = subject.fromDriveForm('/mnt/d/git/x.ts');
  assert(
    wsl === drive,
    `fromDriveForm('/mnt/d/git/x.ts') must equal fromDriveForm('/d/git/x.ts'); got ${JSON.stringify(wsl)} and ${JSON.stringify(drive)}`,
  );

  // ── PF4 ──────────────────────────────────────────────────────────────────────────────────────
  for (const notADriveForm of ['/etc/hosts', 'x', '', '/', '/dd/x', 'd/x']) {
    assert(
      subject.fromDriveForm(notADriveForm) === null,
      `fromDriveForm(${JSON.stringify(notADriveForm)}) must be null; got ${JSON.stringify(subject.fromDriveForm(notADriveForm))}`,
    );
  }

  // ── PF5 ──────────────────────────────────────────────────────────────────────────────────────
  assert(
    subject.fromDriveForm('/D/git/x.ts') === drive,
    'fromDriveForm must be case-insensitive on the drive letter: /D/… and /d/… must agree',
  );

  // ── PF6 ──────────────────────────────────────────────────────────────────────────────────────
  const spaced = subject.fromFileUrl('file:///D:/a%20b/c.txt');
  assert(
    typeof spaced === 'string' && spaced.length > 0,
    `fromFileUrl('file:///D:/a%20b/c.txt') must convert; got ${JSON.stringify(spaced)}`,
  );
  assert(
    spaced.includes('a b'),
    `fromFileUrl must percent-decode: expected 'a b' inside ${JSON.stringify(spaced)}`,
  );
  assert(
    !spaced.includes('%20'),
    `fromFileUrl must not leave a percent-escape behind; got ${JSON.stringify(spaced)}`,
  );
  assert(
    endsWithSegments(spaced, ['a b', 'c.txt']),
    `fromFileUrl must keep the segments the URI named; got ${JSON.stringify(spaced)}`,
  );

  // ── PF7 ──────────────────────────────────────────────────────────────────────────────────────
  const hosted = subject.fromFileUrl('file://server/share/x.txt');
  assert(
    typeof hosted === 'string' && hosted.length > 0,
    `fromFileUrl('file://server/share/x.txt') must convert; got ${JSON.stringify(hosted)}`,
  );
  assert(
    endsWithSegments(hosted, ['server', 'share', 'x.txt']),
    `a hosted file: URI must name the host, the share and the file, in order; got ${JSON.stringify(hosted)}`,
  );
  assert(
    hosted !== subject.fromFileUrl('file:///share/x.txt'),
    'a hosted file: URI must not resolve the same as a hostless one — the host is part of the location',
  );

  // ── PF8 ──────────────────────────────────────────────────────────────────────────────────────
  assert(
    subject.fromFileUrl('file://localhost/D:/x') === subject.fromFileUrl('file:///D:/x'),
    'file://localhost/… must equal file:///…',
  );

  // ── PF9 ──────────────────────────────────────────────────────────────────────────────────────
  for (const notAFileUrl of ['http://x/y', 'https://x/y', 'javascript:0', 'mailto:a@b', '', 'x']) {
    assert(
      subject.fromFileUrl(notAFileUrl) === null,
      `fromFileUrl(${JSON.stringify(notAFileUrl)}) must be null; got ${JSON.stringify(subject.fromFileUrl(notAFileUrl))}`,
    );
  }

  // ── PF10 ─────────────────────────────────────────────────────────────────────────────────────
  assert(
    subject.fromHomeForm('~') === home,
    `fromHomeForm('~') must equal homeDirectory(); got ${JSON.stringify(subject.fromHomeForm('~'))}`,
  );
  const underHome = subject.fromHomeForm('~/x.ts');
  assert(
    typeof underHome === 'string' && underHome.length > 0,
    `fromHomeForm('~/x.ts') must convert; got ${JSON.stringify(underHome)}`,
  );
  assert(
    endsWithSegments(underHome, ['x.ts']),
    `fromHomeForm('~/x.ts') must end in x.ts; got ${JSON.stringify(underHome)}`,
  );
  assert(
    underHome.length > home.length && underHome.startsWith(home),
    `fromHomeForm('~/x.ts') must lie under homeDirectory(); got ${JSON.stringify(underHome)} for home ${JSON.stringify(home)}`,
  );

  // ── PF11 ─────────────────────────────────────────────────────────────────────────────────────
  for (const otherUser of ['~user/x', '~root', '~~/x', 'x~/y']) {
    assert(
      subject.fromHomeForm(otherUser) === null,
      `fromHomeForm(${JSON.stringify(otherUser)}) must be null — throng does not resolve another user's home; got ${JSON.stringify(subject.fromHomeForm(otherUser))}`,
    );
  }

  // ── PF12 ─────────────────────────────────────────────────────────────────────────────────────
  // A NUL is built rather than written: a literal one in a source file makes git treat the file as
  // binary, so every later change to it becomes invisible to review.
  const nul = String.fromCharCode(0);
  const hostile = [
    '',
    ' ',
    '/',
    '\\',
    ':',
    '~',
    '//',
    'C:',
    `a${nul}b`,
    `file:///D:/a${nul}b`,
    'x'.repeat(40_000),
    'C:/mixed\\separators/here\\x.ts',
    'file:///D:/%ZZ',
    'file://',
  ];
  for (const input of hostile) {
    for (const [name, call] of [
      ['fromDriveForm', () => subject.fromDriveForm(input)],
      ['fromFileUrl', () => subject.fromFileUrl(input)],
      ['fromHomeForm', () => subject.fromHomeForm(input)],
    ] as const) {
      let answer: string | null | undefined;
      let threw: unknown;
      try {
        answer = call();
      } catch (e) {
        threw = e;
      }
      assert(
        threw === undefined,
        `${name} must be total and must not throw; it threw ${String(threw)} for ${JSON.stringify(input)}`,
      );
      assert(
        answer === null || typeof answer === 'string',
        `${name} must return a string or null; got ${typeof answer} for ${JSON.stringify(input)}`,
      );
    }
  }
}
