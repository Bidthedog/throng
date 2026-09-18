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

/**
 * 045 T203 / T210 — the four members `contracts/platform-ports.md` §6.1 adds (FR-151 – FR-153).
 *
 * Declared here as OPTIONAL and looked up at run time, because the port does not carry them yet
 * (T204 adds them to `abstractions/path-forms.ts` and then folds this type away). Written that way so
 * `@throng/core` still type-checks while the suite is red: a missing member fails as a contract
 * violation naming the member, not as a compile error that stops every other package building.
 */
interface ThirdRoundPathForms {
  fromMountTable?: (posixPath: string) => string | null;
  qualifyRooted?: (rootedPath: string, anchor: string) => string | null;
  fileUrlLocalPath?: (url: string) => string | null;
  loopbackFromFileUrl?: (url: string) => string | null;
}

type ThirdRoundMember = keyof ThirdRoundPathForms;

/** The member, bound to its subject — or a contract violation naming the one that is missing. */
function member<K extends ThirdRoundMember>(
  subject: IPathForms,
  name: K,
): NonNullable<ThirdRoundPathForms[K]> {
  const found = (subject as IPathForms & ThirdRoundPathForms)[name];
  assert(
    typeof found === 'function',
    `IPathForms.${name} must exist (platform-ports.md §6.1); the subject has no such member`,
  );
  return (found as (...args: never[]) => unknown).bind(subject) as NonNullable<ThirdRoundPathForms[K]>;
}

/**
 * What PF13 – PF15 need that the other cases do not: a subject told where Git for Windows is
 * installed, and one told it is not installed at all. Git's install root reaches the implementation
 * by constructor (platform-ports §6.1, "Where Git's install root comes from"), so only the caller can
 * build these two — the suite cannot.
 *
 * `gitRoot` must be an absolute folder holding `etc/fstab` that maps `/tmp` somewhere other than
 * under the root — the shape Git for Windows ships (`none /tmp usertemp …`), which PF14 depends on.
 * A platform with no Git Bash omits the fixture, and PF13 – PF15 are then not its to answer.
 */
export interface PathFormsGitFixture {
  readonly gitRoot: string;
  readonly withGitRoot: (gitRoot: string) => IPathForms;
  readonly withoutGit: () => IPathForms;
}

function isUnder(child: string, parent: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  const c = norm(child);
  const p = norm(parent);
  return c.length > p.length && c.startsWith(`${p}/`);
}

function driveOf(path: string): string | null {
  return /^([A-Za-z]):/.exec(path)?.[1]?.toUpperCase() ?? null;
}

export function runPathFormsContract(makeSubject: () => IPathForms, git?: PathFormsGitFixture): void {
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

  // ══ Third round (045 T203 / T210; platform-ports.md §6.1) ══════════════════════════════════════

  // ── PF13 – PF15: Git Bash's mount table (FR-151) ─────────────────────────────────────────────
  if (git !== undefined) {
    const withGit = member(git.withGitRoot(git.gitRoot), 'fromMountTable');

    // PF13
    const bash = withGit('/usr/bin/bash.exe');
    assert(
      typeof bash === 'string' && isUnder(bash, git.gitRoot) && endsWithSegments(bash, ['usr', 'bin', 'bash.exe']),
      `fromMountTable('/usr/bin/bash.exe') must lie under the Git root ${JSON.stringify(git.gitRoot)} and end in usr/bin/bash.exe; got ${JSON.stringify(bash)}`,
    );
    const hosts = withGit('/etc/hosts');
    assert(
      typeof hosts === 'string' && isUnder(hosts, git.gitRoot) && endsWithSegments(hosts, ['etc', 'hosts']),
      `fromMountTable('/etc/hosts') must lie under the Git root and end in etc/hosts; got ${JSON.stringify(hosts)}`,
    );

    // PF14
    const tmp = withGit('/tmp');
    assert(
      typeof tmp === 'string' && ABSOLUTE.test(tmp),
      `fromMountTable('/tmp') must be absolute; got ${JSON.stringify(tmp)}`,
    );
    assert(
      !isUnder(tmp, git.gitRoot),
      `fromMountTable('/tmp') must follow the mount table's /tmp mapping, not the Git root; got ${JSON.stringify(tmp)} under ${JSON.stringify(git.gitRoot)}`,
    );

    // PF15
    for (const notMounted of ['/c/x', '/mnt/c/x', 'x', '']) {
      assert(
        withGit(notMounted) === null,
        `fromMountTable(${JSON.stringify(notMounted)}) must be null — a drive form is fromDriveForm's, and a relative path is not rooted; got ${JSON.stringify(withGit(notMounted))}`,
      );
    }
    const noGit = member(git.withoutGit(), 'fromMountTable');
    for (const any of ['/usr/bin/bash.exe', '/etc/hosts', '/tmp', '/', '/c/x']) {
      assert(
        noGit(any) === null,
        `with no Git for Windows installed, fromMountTable(${JSON.stringify(any)}) must be null; got ${JSON.stringify(noGit(any))}`,
      );
    }
  }

  // ── PF16: drive qualification (FR-152) ──────────────────────────────────────────────────────
  const qualify = member(subject, 'qualifyRooted');
  for (const rooted of ['/tmp', '\\tmp']) {
    const q = qualify(rooted, home);
    assert(
      typeof q === 'string' && ABSOLUTE.test(q),
      `qualifyRooted(${JSON.stringify(rooted)}, ${JSON.stringify(home)}) must be absolute; got ${JSON.stringify(q)}`,
    );
    assert(
      driveOf(q) === driveOf(home),
      `qualifyRooted(${JSON.stringify(rooted)}, anchor) must be on the anchor's drive; got ${JSON.stringify(q)} for anchor ${JSON.stringify(home)}`,
    );
    assert(
      endsWithSegments(q, ['tmp']),
      `qualifyRooted(${JSON.stringify(rooted)}, anchor) must keep the path it was given; got ${JSON.stringify(q)}`,
    );
  }
  for (const notAbsolute of ['relative/dir', '', 'x']) {
    assert(
      qualify('/tmp', notAbsolute) === null,
      `qualifyRooted('/tmp', ${JSON.stringify(notAbsolute)}) must be null — an anchor that is not absolute has no drive to lend; got ${JSON.stringify(qualify('/tmp', notAbsolute))}`,
    );
  }

  // ── PF17: the local path inside a file: URI, when it is not drive-qualified (FR-153) ────────
  const localPath = member(subject, 'fileUrlLocalPath');
  assert(
    localPath('file:///c/Windows/win.ini') === '/c/Windows/win.ini',
    `fileUrlLocalPath('file:///c/Windows/win.ini') must be '/c/Windows/win.ini'; got ${JSON.stringify(localPath('file:///c/Windows/win.ini'))}`,
  );
  assert(
    localPath('file://localhost/mnt/c/x') === '/mnt/c/x',
    `fileUrlLocalPath('file://localhost/mnt/c/x') must be '/mnt/c/x'; got ${JSON.stringify(localPath('file://localhost/mnt/c/x'))}`,
  );
  assert(
    localPath('file:///usr/bin/a%20b') === '/usr/bin/a b',
    `fileUrlLocalPath must percent-decode, as FR-012 does; got ${JSON.stringify(localPath('file:///usr/bin/a%20b'))}`,
  );
  for (const notLocal of ['file:///D:/x', 'file://localhost/D:/x', 'file://server/share/x', 'http://x/y', '', 'x']) {
    assert(
      localPath(notLocal) === null,
      `fileUrlLocalPath(${JSON.stringify(notLocal)}) must be null — drive-qualified, hosted, or not a file: URI; got ${JSON.stringify(localPath(notLocal))}`,
    );
  }

  // ── PF18: the loopback share a localhost URI may name (FR-153) ─────────────────────────────
  const loopback = member(subject, 'loopbackFromFileUrl');
  const share = loopback('file://localhost/C$/Windows/win.ini');
  assert(
    typeof share === 'string' && endsWithSegments(share, ['localhost', 'C$', 'Windows', 'win.ini']),
    `loopbackFromFileUrl('file://localhost/C$/Windows/win.ini') must name host localhost, share C$, and end in win.ini; got ${JSON.stringify(share)}`,
  );
  assert(
    typeof share === 'string' && share.split(SEPARATOR).filter((p) => p.length > 0)[0] === 'localhost',
    `the loopback location must BEGIN with the host — it is a network location, not a local one; got ${JSON.stringify(share)}`,
  );
  for (const notLoopback of ['file://localhost/D:/x', 'file:///C$/x', 'file://server/C$/x', 'http://localhost/C$/x', '']) {
    assert(
      loopback(notLoopback) === null,
      `loopbackFromFileUrl(${JSON.stringify(notLoopback)}) must be null; got ${JSON.stringify(loopback(notLoopback))}`,
    );
  }

  // ── PF19: PF7 and PF8 above run unchanged — the hosted and localhost-drive readings of
  // fromFileUrl are not moved by FR-153. Nothing to add here; they are asserted where they stand.

  // ── PF12′: the four new members are total ────────────────────────────────────────────────────
  for (const input of hostile) {
    for (const [name, call] of [
      ['fromMountTable', () => member(subject, 'fromMountTable')(input)],
      ['qualifyRooted(input, home)', () => qualify(input, home)],
      ['qualifyRooted(/tmp, input)', () => qualify('/tmp', input)],
      ['fileUrlLocalPath', () => localPath(input)],
      ['loopbackFromFileUrl', () => loopback(input)],
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
