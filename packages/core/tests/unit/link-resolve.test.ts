import { describe, expect, it } from 'vitest';
import type { IPathForms } from '../../src/abstractions/path-forms.js';
import { resolveCandidate } from '../../src/links/resolve.js';
import type { LinkCandidate } from '../../src/links/types.js';

/**
 * 045 R1–R11 — `contracts/link-resolution.md` §2.
 *
 * `resolveCandidate` is pure: it returns the ORDERED list of absolute locations to try, and touches
 * no disk. "First that exists wins" is therefore a property of the ORDER, which is what these cases
 * assert; `existsFirst` below is the two-line walk main performs over the answer, written out here
 * so the ordering rules are stated as the outcomes they produce rather than as list indices.
 *
 * The fake `IPathForms` is Windows-shaped because that is the platform that ships, but nothing in
 * `resolve.ts` may know that — every drive letter and home folder below comes out of the fake.
 */

const HOME = 'C:\\Users\\dev';

const fakePathForms: IPathForms = {
  homeDirectory: () => HOME,
  fromDriveForm: (p) => {
    const m = /^\/(?:mnt\/)?([A-Za-z])(?:\/(.*))?$/.exec(p);
    return m ? `${m[1].toUpperCase()}:\\${(m[2] ?? '').replace(/\//g, '\\')}` : null;
  },
  fromFileUrl: (url) => {
    const m = /^file:\/\/([^/]*)\/(.*)$/i.exec(url);
    if (!m) return null;
    const rest = decodeURIComponent(m[2]).replace(/\//g, '\\');
    const host = m[1];
    if (host === '' || host.toLowerCase() === 'localhost') return rest;
    return `\\\\${host}\\${rest}`;
  },
  fromHomeForm: (p) => {
    if (p === '~') return HOME;
    const m = /^~[\\/](.*)$/.exec(p);
    return m ? `${HOME}\\${m[1].replace(/\//g, '\\')}` : null;
  },
  // 045 T205 / T209 — the four members platform-ports.md §6.1 adds. The port does not declare them
  // yet (T204), so they ride on the object as extra properties; resolve.ts reaches them through the
  // port once it does.
  ...({
    fromMountTable: (p: string): string | null => {
      if (!/^\//.test(p) || /^\/(?:mnt\/)?[A-Za-z](?:\/|$)/.test(p)) return null;
      if (/^\/tmp(?:\/|$)/.test(p)) return `${USER_TEMP}${p.slice('/tmp'.length).replace(/\//g, '\\')}`;
      if (/^\/bin(?:\/|$)/.test(p)) return `${GIT_ROOT}\\usr\\bin${p.slice('/bin'.length).replace(/\//g, '\\')}`;
      return `${GIT_ROOT}${p.replace(/\//g, '\\')}`;
    },
    qualifyRooted: (p: string, anchor: string): string | null => {
      const drive = /^([A-Za-z]:)[\\/]/.exec(anchor)?.[1];
      if (drive === undefined || !/^[\\/](?![\\/])/.test(p)) return null;
      return `${drive}${p.replace(/\//g, '\\')}`;
    },
    fileUrlLocalPath: (url: string): string | null => {
      const m = /^file:\/\/(localhost)?(\/.*)$/i.exec(url);
      if (!m) return null;
      const decoded = decodeURIComponent(m[2]);
      return /^\/[A-Za-z]:/.test(decoded) ? null : decoded;
    },
    loopbackFromFileUrl: (url: string): string | null => {
      const m = /^file:\/\/localhost\/([^/]+)(\/.*)?$/i.exec(url);
      if (!m || /^[A-Za-z]:$/.test(m[1])) return null;
      return `\\\\localhost\\${m[1]}${decodeURIComponent(m[2] ?? '').replace(/\//g, '\\')}`;
    },
  } as object),
};

/** Where the fake's Git for Windows lives, and the user's temp folder its `/tmp` maps to. */
const GIT_ROOT = 'C:\\Program Files\\Git';
const USER_TEMP = 'C:\\Users\\dev\\AppData\\Local\\Temp';

const candidate = (text: string, extra: Partial<LinkCandidate> = {}): LinkCandidate => ({
  text,
  start: 0,
  end: text.length,
  ...extra,
});

const ctx = (over: { baseDirectory?: string; projectRoot?: string | null } = {}) => ({
  baseDirectory: over.baseDirectory,
  projectRoot: 'projectRoot' in over ? (over.projectRoot ?? null) : 'C:\\throng',
  pathForms: fakePathForms,
});

/** What main does with the answer: walk it, take the first that exists (R1). */
const existsFirst = (paths: readonly string[], exists: (p: string) => boolean): string | null =>
  paths.find((p) => exists(p)) ?? null;

describe('resolveCandidate — R2: drive and UNC forms map to themselves', () => {
  // "To themselves", and literally so: a form the platform already understands is passed through as
  // the user wrote it, in EITHER separator. Core may not name a separator (FR-026), and there is no
  // question to ask `IPathForms` here — the form needs no mapping. The spellings that DO need one,
  // `/d/x` and `file:`, come back from the port already in the platform's own separators, which is
  // where R2's "normalised by IPathForms" bites.
  it('a drive form, either separator', () => {
    expect(resolveCandidate(candidate('D:\\x\\foo.ts'), ctx())).toEqual(['D:\\x\\foo.ts']);
    expect(resolveCandidate(candidate('D:/x/foo.ts'), ctx())).toEqual(['D:/x/foo.ts']);
  });

  it('a UNC form, either separator', () => {
    expect(resolveCandidate(candidate('\\\\s\\h\\foo.ts'), ctx())).toEqual(['\\\\s\\h\\foo.ts']);
    expect(resolveCandidate(candidate('//s/h/foo.ts'), ctx())).toEqual(['//s/h/foo.ts']);
  });
});

describe('resolveCandidate — R3/R4: the drive forms and the home form go through IPathForms', () => {
  it('R3: /d/x and /mnt/d/x both name drive d', () => {
    const list = resolveCandidate(candidate('/d/git/x.ts'), ctx());
    expect(list).toContain('D:\\git\\x.ts');
    const wsl = resolveCandidate(candidate('/mnt/d/git/x.ts'), ctx());
    expect(wsl).toContain('D:\\git\\x.ts');
  });

  it('R4: ~/x maps through fromHomeForm', () => {
    expect(resolveCandidate(candidate('~/foo.ts'), ctx())).toEqual([`${HOME}\\foo.ts`]);
  });

  it('resolve.ts itself names no drive letter — the fake supplies every one', () => {
    const noMapping: IPathForms = { ...fakePathForms, fromDriveForm: () => null };
    const list = resolveCandidate(candidate('/d/git/x.ts'), {
      projectRoot: 'C:\\throng',
      pathForms: noMapping,
    });
    expect(list).not.toContain('D:\\git\\x.ts');
  });
});

describe('resolveCandidate — R5: a relative path tries the base directory FIRST', () => {
  it('US1 scenario 8 — a terminal in packages/core printing src/x.ts opens the one beside it', () => {
    const list = resolveCandidate(
      candidate('src/x.ts'),
      ctx({ baseDirectory: 'C:\\throng\\packages\\core' }),
    );
    expect(list).toEqual(['C:\\throng\\packages\\core\\src\\x.ts', 'C:\\throng\\src\\x.ts']);
    // Both exist: the base directory's copy is the one that wins.
    expect(existsFirst(list, () => true)).toBe('C:\\throng\\packages\\core\\src\\x.ts');
    // Only the project root's copy exists: the second attempt is what saves it.
    expect(existsFirst(list, (p) => p === 'C:\\throng\\src\\x.ts')).toBe('C:\\throng\\src\\x.ts');
  });

  it('./ and ../ forms resolve against the base directory too', () => {
    expect(
      resolveCandidate(candidate('./b.md'), ctx({ baseDirectory: 'C:\\throng\\docs' }))[0],
    ).toBe('C:\\throng\\docs\\b.md');
    expect(
      resolveCandidate(candidate('../docs/x.md'), ctx({ baseDirectory: 'C:\\throng\\src' }))[0],
    ).toBe('C:\\throng\\docs\\x.md');
  });

  it('R10: an untitled buffer supplies no base directory, so the project root is tried alone', () => {
    expect(resolveCandidate(candidate('test.txt'), ctx())).toEqual(['C:\\throng\\test.txt']);
  });
});

describe('resolveCandidate — R6: a leading / tries the PROJECT ROOT first', () => {
  it("#394's own example: /test.txt is the project's test.txt", () => {
    const list = resolveCandidate(candidate('/test.txt'), ctx());
    expect(list[0]).toBe('C:\\throng\\test.txt');
    // *Third round (T205):* `toHaveLength(2)` withdrawn, as spec *Supersessions* permits — FR-151's
    // mount-table reading may now sit between the project root and the platform's meaning.
    expect(existsFirst(list, () => true)).toBe('C:\\throng\\test.txt');
  });

  it("the platform's own meaning of the path is tried second, not first", () => {
    const list = resolveCandidate(candidate('/test.txt'), ctx());
    expect(list[1]).not.toBe('C:\\throng\\test.txt');
    expect(existsFirst(list, (p) => p !== 'C:\\throng\\test.txt')).toBe(list[1]);
  });

  // *Round four (T253):* this case asserted the project-root reading FIRST (`list[0]` was
  // `C:\throng\d\git\x.ts`). FR-176 reverses it — a drive form maps to its drive only — which
  // tasks.md *Notes* permits; the FR-176 block below states the new rule.
  it('a drive form is NOT treated as a plain leading-slash path', () => {
    const list = resolveCandidate(candidate('/d/git/x.ts'), ctx());
    expect(list).toEqual(['D:\\git\\x.ts']);
  });
});

describe('T253 / FR-176 — a drive form resolves to that drive ONLY', () => {
  it('/d/git/x.ts is D:\\git\\x.ts even when the project holds d\\git\\x.ts', () => {
    const list = resolveCandidate(candidate('/d/git/x.ts'), ctx());
    expect(list).toEqual(['D:\\git\\x.ts']);
    // Main walks the list; with the project's copy existing too, the drive still decides.
    expect(existsFirst(list, (p) => p === 'D:\\git\\x.ts' || p === 'C:\\throng\\d\\git\\x.ts')).toBe('D:\\git\\x.ts');
  });

  it('/mnt/d/git/x.ts likewise', () => {
    expect(resolveCandidate(candidate('/mnt/d/git/x.ts'), ctx())).toEqual(['D:\\git\\x.ts']);
  });

  it('with no project, a drive form is still its drive', () => {
    expect(resolveCandidate(candidate('/d/x.ts'), ctx({ projectRoot: null }))).toEqual(['D:\\x.ts']);
  });

  it('a base directory adds no reading to a drive form', () => {
    expect(resolveCandidate(candidate('/c/x/foo.ts'), ctx({ baseDirectory: 'D:\\work' }))).toEqual(['C:\\x\\foo.ts']);
  });
});

describe('T253 / FR-174 note — a bare /<letter> is a rooted path, never a drive form', () => {
  it('/c is tried under the project root, then as a rooted path — never as C:\\', () => {
    const list = resolveCandidate(candidate('/c'), ctx({ baseDirectory: 'D:\\work' }));
    expect(list[0]).toBe('C:\\throng\\c');
    expect(list).not.toContain('C:\\');
    expect(list).not.toContain('C:');
  });

  it('/c/ with its separator IS the drive form', () => {
    expect(resolveCandidate(candidate('/c/'), ctx())).toEqual(['C:\\']);
  });

  it('in a WSL flavour too: /c is the project root reading only', () => {
    expect(resolveCandidate(candidate('/c'), wslCtx())).toEqual(['C:\\throng\\c']);
  });
});

describe('resolveCandidate — R7: the positioned reading is tried before the reading without', () => {
  it('detection emits both and the ORDER of the two candidates is what decides', () => {
    // Detection's two readings of `C:\x\foo.ts:42:7`, in the order it emits them.
    const positioned = candidate('C:\\x\\foo.ts', {
      position: { line: 42, column: 7 },
      positionText: ':42:7',
    });
    const plain = candidate('C:\\x\\foo.ts:42:7');
    const attempts = [
      ...resolveCandidate(positioned, ctx()),
      ...resolveCandidate(plain, ctx()),
    ];
    expect(attempts).toEqual(['C:\\x\\foo.ts', 'C:\\x\\foo.ts:42:7']);
    expect(existsFirst(attempts, () => true)).toBe('C:\\x\\foo.ts');
    expect(existsFirst(attempts, (p) => p.endsWith(':42:7'))).toBe('C:\\x\\foo.ts:42:7');
  });
});

describe('resolveCandidate — R8: a file: URI is decoded through IPathForms', () => {
  it('no host, percent-decoded', () => {
    expect(resolveCandidate(candidate('file:///D:/a%20b/c.txt'), ctx())).toEqual(['D:\\a b\\c.txt']);
  });

  it('a host becomes the network location', () => {
    expect(resolveCandidate(candidate('file://server/share/x.txt'), ctx())).toEqual([
      '\\\\server\\share\\x.txt',
    ]);
  });

  it('localhost is the same as no host', () => {
    expect(resolveCandidate(candidate('file://localhost/D:/x'), ctx())).toEqual(
      resolveCandidate(candidate('file:///D:/x'), ctx()),
    );
  });

  it('a file: URI the port cannot convert yields nothing to try', () => {
    const blind: IPathForms = { ...fakePathForms, fromFileUrl: () => null };
    expect(resolveCandidate(candidate('file:///D:/x'), { projectRoot: null, pathForms: blind })).toEqual(
      [],
    );
  });
});

describe('resolveCandidate — R9/R11: what is deliberately NOT mapped', () => {
  it('R9: a POSIX path that is not a drive form gets no WSL mapping', () => {
    const list = resolveCandidate(candidate('/etc/hosts'), ctx());
    // *Third round (T205):* was `['C:\\throng\\etc\\hosts', '/etc/hosts']`. FR-151 inserts Git's
    // mount-table reading and FR-152 drive-qualifies the last one (spec *Supersessions*).
    expect(list).toEqual(['C:\\throng\\etc\\hosts', `${GIT_ROOT}\\etc\\hosts`, 'C:\\etc\\hosts']);
    // This half MUST stay: still no WSL mapping.
    expect(list.some((p) => /mnt/i.test(p))).toBe(false);
  });

  it('R11: projectRoot === null still resolves the absolute forms', () => {
    const rootless = ctx({ projectRoot: null });
    expect(resolveCandidate(candidate('D:\\x\\foo.ts'), rootless)).toEqual(['D:\\x\\foo.ts']);
    expect(resolveCandidate(candidate('~/foo.ts'), rootless)).toEqual([`${HOME}\\foo.ts`]);
  });

  it('R11: with no project root the project-root attempt is simply absent', () => {
    // *Third round (T205):* was `['/test.txt']`. FR-152 — with no base directory and no project root
    // the platform step is not reached, but FR-151's mount-table reading (Git's `/` + `test.txt`)
    // still is: R13 is not gated on a base (settled 2026-09-18, the maintainer accepting FR-151).
    expect(resolveCandidate(candidate('/test.txt'), ctx({ projectRoot: null }))).toEqual([
      'C:\\Program Files\\Git\\test.txt',
    ]);
    expect(resolveCandidate(candidate('test.txt'), ctx({ projectRoot: null }))).toEqual([]);
  });

  it('R1: a candidate with nothing to try is a non-link, not an error', () => {
    expect(resolveCandidate(candidate(''), ctx())).toEqual([]);
  });
});

describe('resolveCandidate — purity', () => {
  it('returns the same list for the same inputs and never mutates the candidate', () => {
    const c = candidate('src/foo.ts');
    const frozen = JSON.stringify(c);
    const a = resolveCandidate(c, ctx({ baseDirectory: 'C:\\throng\\packages' }));
    const b = resolveCandidate(c, ctx({ baseDirectory: 'C:\\throng\\packages' }));
    expect(a).toEqual(b);
    expect(JSON.stringify(c)).toBe(frozen);
  });

  it('never returns the same location twice', () => {
    const list = resolveCandidate(candidate('src/x.ts'), ctx({ baseDirectory: 'C:\\throng' }));
    expect(new Set(list).size).toBe(list.length);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T205 — FR-151 / FR-152 (link-resolution.md §8.2, R13 / R14)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user sees today (O11's corpus rows 38 – 40): `/usr/bin/bash.exe` and `/etc/hosts` are not
 * Git Bash's files, and `/tmp` is followed to the CURRENT drive's `\tmp` — whatever drive throng's own
 * process happens to be on — with the text handed over as written.
 *
 * R13's order for a leading-`/` path that is not a drive form: project root, drive form, Git's mount
 * table, then the platform's own meaning qualified by R14's anchor (base directory, else project
 * root). With `wslFlavour`, only the first two remain.
 */
const wslCtx = (over: { baseDirectory?: string; projectRoot?: string | null } = {}) => ({
  ...ctx(over),
  wslFlavour: true as const,
});

/** A rooted path with no drive — `\tmp`, `/tmp` — but not a UNC `\\server\share`. */
const ROOTED_WITHOUT_DRIVE = /^[\\/](?![\\/])/;

describe('T205 / R13 — a non-drive leading-/ path: project root, drive form, mount table, qualified platform', () => {
  it('/usr/bin/bash.exe tries the project, then Git\u2019s install, then the drive-qualified meaning', () => {
    expect(resolveCandidate(candidate('/usr/bin/bash.exe'), ctx())).toEqual([
      'C:\\throng\\usr\\bin\\bash.exe',
      `${GIT_ROOT}\\usr\\bin\\bash.exe`,
      'C:\\usr\\bin\\bash.exe',
    ]);
  });

  it('/tmp reaches the user\u2019s temp folder through the mount table, before any \\tmp on a drive', () => {
    const list = resolveCandidate(candidate('/tmp'), ctx());
    expect(list).toEqual(['C:\\throng\\tmp', USER_TEMP, 'C:\\tmp']);
    expect(existsFirst(list, (p) => p !== 'C:\\throng\\tmp')).toBe(USER_TEMP);
  });

  it('R14: the platform reading is qualified by the BASE directory\u2019s drive first, then the project root\u2019s', () => {
    const list = resolveCandidate(candidate('/tmp'), ctx({ baseDirectory: 'D:\\work\\sub' }));
    expect(list[list.length - 1]).toBe('D:\\tmp');
    const rootOnly = resolveCandidate(candidate('/tmp'), ctx({ projectRoot: 'E:\\proj' }));
    expect(rootOnly[rootOnly.length - 1]).toBe('E:\\tmp');
  });

  it('a backslash-rooted path is qualified the same way', () => {
    const list = resolveCandidate(candidate('\\tmp\\x.log'), ctx({ baseDirectory: 'D:\\work' }));
    expect(list).toContain('D:\\tmp\\x.log');
    expect(list.some((p) => ROOTED_WITHOUT_DRIVE.test(p))).toBe(false);
  });

  it('with no Git install (the port answers null) the mount-table step is simply absent', () => {
    const noGit = { ...fakePathForms, fromMountTable: () => null } as IPathForms;
    expect(resolveCandidate(candidate('/etc/hosts'), { projectRoot: 'C:\\throng', pathForms: noGit })).toEqual([
      'C:\\throng\\etc\\hosts',
      'C:\\etc\\hosts',
    ]);
  });

  it('a drive form keeps R3\u2019s mapping and gains no mount-table reading', () => {
    const list = resolveCandidate(candidate('/d/git/x.ts'), ctx());
    expect(list).toContain('D:\\git\\x.ts');
    expect(list.some((p) => p.startsWith(GIT_ROOT))).toBe(false);
  });
});

describe('T205 / FR-152 — no list ever contains a rooted path without a drive', () => {
  const inputs = ['/test.txt', '/etc/hosts', '/tmp', '\\tmp', '/usr/bin/bash.exe', '/d/x', '/mnt/c/x', 'src/x.ts'];
  const contexts = [
    ['a project root', ctx()],
    ['a base directory and a root', ctx({ baseDirectory: 'D:\\work' })],
    ['a base directory, no root', ctx({ baseDirectory: 'D:\\work', projectRoot: null })],
    ['neither', ctx({ projectRoot: null })],
    ['a WSL flavour', wslCtx()],
  ] as const;

  for (const [label, c] of contexts) {
    it(`with ${label}`, () => {
      for (const text of inputs) {
        const list = resolveCandidate(candidate(text), c);
        expect(list.filter((p) => ROOTED_WITHOUT_DRIVE.test(p)), `${text} with ${label}`).toEqual([]);
      }
    });
  }

  it('with no base directory and no project root, /test.txt yields only the mount-table reading', () => {
    expect(resolveCandidate(candidate('/test.txt'), ctx({ projectRoot: null }))).toEqual([
      'C:\\Program Files\\Git\\test.txt',
    ]);
  });
});

describe('T205 / R13 — a WSL flavour skips the mount table and the platform step', () => {
  it('/etc/hosts in WSL tries the project root only — never Git\u2019s install', () => {
    expect(resolveCandidate(candidate('/etc/hosts'), wslCtx())).toEqual(['C:\\throng\\etc\\hosts']);
  });

  it('/tmp in WSL is not the Windows temp folder and not a drive\u2019s \\tmp', () => {
    expect(resolveCandidate(candidate('/tmp'), wslCtx({ baseDirectory: 'D:\\work' }))).toEqual(['C:\\throng\\tmp']);
  });

  // *Round four (T253):* expected the project-root reading first; FR-176 maps a drive form to its
  // drive only (tasks.md *Notes*).
  it('/mnt/c/x in WSL still maps through the drive form (FR-025)', () => {
    expect(resolveCandidate(candidate('/mnt/c/x.txt'), wslCtx())).toEqual(['C:\\x.txt']);
  });

  it('T231 / FR-177: in a WSL flavour /c/x and /mnt/c/x both map to C:\\x', () => {
    expect(resolveCandidate(candidate('/c/x'), wslCtx())).toEqual(['C:\\x']);
    expect(resolveCandidate(candidate('/mnt/c/x'), wslCtx())).toEqual(['C:\\x']);
  });

  it('WSL never ADDS a reading (I7): its list is a subset of the non-WSL list', () => {
    for (const text of ['/etc/hosts', '/tmp', '/usr/bin/bash.exe', '/mnt/c/x.txt', 'src/x.ts', 'D:\\x']) {
      const plain = resolveCandidate(candidate(text), ctx({ baseDirectory: 'D:\\work' }));
      const wsl = resolveCandidate(candidate(text), wslCtx({ baseDirectory: 'D:\\work' }));
      expect(wsl.every((p) => plain.includes(p)), text).toBe(true);
    }
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T209 — FR-153 (link-resolution.md §8.3, R15 / R16)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user sees today (O11 rows 5, 44, 45): `file:///c/Windows/win.ini` is not a link at all,
 * an OSC 8 `file:///mnt/c/…` is inert, and `file://localhost/C$/…` is underlined and does nothing —
 * because a hostless or localhost `file:` URI is handed to `fromFileUrl` alone, which reads a
 * POSIX-spelled path as a folder on the current drive.
 */
describe('T209 / R15 — a file: URI whose path is not drive-qualified resolves as the bare path', () => {
  const same = (url: string, bare: string, c = ctx()) =>
    expect(resolveCandidate(candidate(url), c), `${url} \u2261 ${bare}`).toEqual(resolveCandidate(candidate(bare), c));

  it('file:///c/Windows/win.ini is /c/Windows/win.ini', () => {
    same('file:///c/Windows/win.ini', '/c/Windows/win.ini');
    expect(resolveCandidate(candidate('file:///c/Windows/win.ini'), ctx())).toContain('C:\\Windows\\win.ini');
  });

  it('file:///mnt/c/Windows/win.ini is /mnt/c/Windows/win.ini', () => {
    same('file:///mnt/c/Windows/win.ini', '/mnt/c/Windows/win.ini');
  });

  it('file:///usr/bin/bash.exe is /usr/bin/bash.exe — Git\u2019s mount table included', () => {
    same('file:///usr/bin/bash.exe', '/usr/bin/bash.exe');
    expect(resolveCandidate(candidate('file:///usr/bin/bash.exe'), ctx())).toContain(`${GIT_ROOT}\\usr\\bin\\bash.exe`);
  });

  it('the same holds in a panel with no project (R11) and in a WSL flavour', () => {
    same('file:///c/Windows/win.ini', '/c/Windows/win.ini', ctx({ projectRoot: null }));
    same('file:///usr/bin/bash.exe', '/usr/bin/bash.exe', wslCtx());
  });
});

describe('T209 / R16 — a localhost URI whose first segment is not a drive also tries the loopback share', () => {
  it('file://localhost/C$/Windows/win.ini ends with \\\\localhost\\C$\\Windows\\win.ini, after its local readings', () => {
    const list = resolveCandidate(candidate('file://localhost/C$/Windows/win.ini'), ctx());
    expect(list[list.length - 1]).toBe('\\\\localhost\\C$\\Windows\\win.ini');
    expect(list.slice(0, -1)).toEqual(resolveCandidate(candidate('/C$/Windows/win.ini'), ctx()));
    expect(list.length).toBeGreaterThan(1);
  });
});

describe('T209 — the drive-qualified and hosted URIs are unchanged (FR-012)', () => {
  it('file:///C:/x, file://localhost/D:/x and file://server/share/x', () => {
    expect(resolveCandidate(candidate('file:///C:/x'), ctx())).toEqual(['C:\\x']);
    expect(resolveCandidate(candidate('file://localhost/D:/x'), ctx())).toEqual(['D:\\x']);
    expect(resolveCandidate(candidate('file://server/share/x'), ctx())).toEqual(['\\\\server\\share\\x']);
  });
});
