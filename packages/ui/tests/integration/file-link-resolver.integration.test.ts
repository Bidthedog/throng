import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  LINK_ROOT_BACKOFF_MS,
  detectPathCandidates,
  SHIPPED_PREVIEW_PROVIDERS,
  type IFileSystem,
  type IShellIntegration,
  type PreviewSettings,
} from '@throng/core';
import {
  WindowsExecutableExtensions,
  WindowsPathForms,
  WindowsShellDetection,
} from '@throng/platform-windows';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { FileLinkResolver } from '../../src/main/file-link-resolver.js';

/**
 * 045 FR-006, FR-020 – FR-026, FR-030, FR-037, FR-039a — the ONE authority, against a real disk.
 *
 * The rules themselves are unit-tested in `packages/core/tests/unit/link-*.test.ts` against fakes.
 * What that cannot show is whether the ordered list core produces actually finds the right file
 * when walked over a real tree, with real `stat` results and a real `PATHEXT`. That is this file,
 * and it is why the tree below is copied from the shipped fixtures rather than invented: the
 * acceptance scenarios name those files.
 *
 * `projectRootFor` is a function rather than a service, which is the shape `PreviewService` and
 * `NavigationHistoryService` already take, and the reason the resolver is testable without Electron.
 * It is also the whole of I2: **the renderer names a project ID, and MAIN derives the ROOT from
 * it**. An id is a claim main can check against its own cache; a root would be one it could only
 * take on trust, and a renderer able to name a root could name `C:\`.
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/links', import.meta.url));
const OUTSIDE_FIXTURES = fileURLToPath(new URL('../fixtures/links-outside', import.meta.url));

let root = '';
let outside = '';
const roots: string[] = [];

/**
 * Main's own project cache: project ID to root. The renderer names an ID (`Panel.originProjectId`);
 * the ROOT is looked up here and nowhere else — the `authoritative()` precedent.
 */
const PROJECT_ROOTS = new Map<string, string>();

function makeResolver(
  over: {
    previewSettings?: Partial<PreviewSettings>;
    pathForms?: WindowsPathForms;
    /** 045 T255 — a filesystem whose `stat` calls a case counts (FR-158d's "no check"). */
    fs?: IFileSystem;
    /** 045 T293 — the existence-check timeout, for a case that hangs a root (FR-161). */
    timeoutMs?: number;
  } = {},
) {
  // The SHIPPED registry, not one invented here: FR-030's `preview` field has to mean what the app
  // means by it, and a hand-built registry would be a second opinion about which types previewable.
  const registry = SHIPPED_PREVIEW_PROVIDERS;
  const settings: PreviewSettings = {
    updateDelayMs: 300,
    maxWaitMs: 1000,
    copyFormat: 'rich',
    syncScroll: true,
    providers: { markdown: { enabled: true, defaultOpenAction: 'editor' } },
    ...over.previewSettings,
  };
  return new FileLinkResolver({
    fs: over.fs ?? new NodeFileSystem(async () => {}),
    pathForms: over.pathForms ?? new WindowsPathForms(),
    executables: new WindowsExecutableExtensions(),
    projectRootFor: (projectId) =>
      projectId === undefined ? null : (PROJECT_ROOTS.get(projectId) ?? null),
    previewRegistry: registry,
    readPreviewSettings: () => settings,
    ...(over.timeoutMs === undefined
      ? {}
      : {
          readLinkSettings: () => ({
            ...DEFAULT_APP_SETTINGS.editor.links,
            existenceCheckTimeoutMs: over.timeoutMs as number,
          }),
        }),
  });
}

const link = (
  text: string,
  over: {
    baseDirectory?: string;
    panelId?: string;
    originProjectId?: string | null;
    kind?: 'detectedPath' | 'fileHyperlink';
    /** 045 T207 — FR-151: set by a WSL terminal (settings-and-environment §7.1). */
    wslFlavour?: true;
  } = {},
) => ({
  text,
  kind: over.kind ?? ('detectedPath' as const),
  baseDirectory: over.baseDirectory,
  panelId: over.panelId ?? 'p1',
  // `null` means "a panel with no owning project" explicitly; omitted means the fixture project.
  originProjectId: over.originProjectId === null ? undefined : (over.originProjectId ?? 'proj-1'),
  ...(over.wslFlavour ? { wslFlavour: true as const } : {}),
});

/**
 * 045 T255 — `LinkResolution`'s failure arm with no `reason`: not found (data-model §16.14, §16.17).
 * It now also carries the by-extension fields the Link menu reads (FR-170a); their values are pinned by
 * the T255 cases below.
 */
const NOT_FOUND = {
  ok: false,
  // `toEqual` treats an undefined property as absent: this is "no `reason`", i.e. not `unreachable`.
  reason: undefined,
  executableByExtension: expect.any(Boolean) as boolean,
  previewByExtension: expect.any(String) as string,
};

/** 045 T255 — the real disk, with every `stat` counted, so "no check" (FR-158d) is observable. */
function countingFs(): { fs: IFileSystem; stats: string[] } {
  const real = new NodeFileSystem(async () => {});
  const stats: string[] = [];
  const fs = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'stat') {
        return (path: string) => {
          stats.push(path);
          return real.stat(path);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as IFileSystem;
  return { fs, stats };
}

/** 045 T255 — a shell recording what reached it, each call named by its seam. */
function recordingShell(): { shell: IShellIntegration; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    shell: {
      revealInFileManager: async (p) => void calls.push(`reveal:${p}`),
      openFolder: async (p) => void calls.push(`folder:${p}`),
      openExternal: async (u) => void calls.push(`external:${u}`),
      openWithDefaultProgram: async (p) => void calls.push(`open:${p}`),
    } as IShellIntegration,
  };
}

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'throng-link-resolver-'));
  roots.push(base);
  root = join(base, 'project');
  outside = join(base, 'elsewhere');
  cpSync(FIXTURES, root, { recursive: true });
  cpSync(OUTSIDE_FIXTURES, outside, { recursive: true });

  PROJECT_ROOTS.set('proj-1', root);
  // M4: a sub-workspace panel judges against its ORIGINAL project — it names that project's id, and
  // main looks up the same root it would for any other panel. There is no second root anywhere.
  PROJECT_ROOTS.set('other-project', outside);
});

afterAll(() => {
  for (const dir of roots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* a temp tree left behind is not worth failing a passing assertion over */
    }
  }
});

describe('FileLinkResolver.resolve — R1: the first location that exists wins', () => {
  it('a relative path in the project resolves', async () => {
    const answer = await makeResolver().resolve(link('test.txt'));
    expect(answer.ok).toBe(true);
    expect(answer.ok && answer.link.path).toBe(join(root, 'test.txt'));
  });

  it('FR-006: text that names nothing is a NON-link, not an error', async () => {
    await expect(makeResolver().resolve(link('nothing-here.txt'))).resolves.toEqual(NOT_FOUND);
    await expect(makeResolver().resolve(link('src/also-missing.ts'))).resolves.toEqual(NOT_FOUND);
  });

  it('a UNC-shaped path that does not exist answers a non-link rather than hanging', async () => {
    const answer = await makeResolver().resolve(link('\\\\throng-no-such-host\\share\\x.txt'));
    expect(answer).toEqual(NOT_FOUND);
  }, 20_000);
});

describe('FileLinkResolver.resolve — R5/R6: the orderings, over real files', () => {
  it('R5 / US1 scenario 8: the base directory beats the project root', async () => {
    // `src/x.ts` exists BOTH at `<root>/packages/core/src/x.ts` and nowhere else at the root, so
    // the discriminating case is the one where the base directory supplies the winner.
    const answer = await makeResolver().resolve(
      link('src/x.ts', { baseDirectory: join(root, 'packages', 'core') }),
    );
    expect(answer.ok && answer.link.path).toBe(join(root, 'packages', 'core', 'src', 'x.ts'));
  });

  it('R5: with no base directory the project root still resolves the same text', async () => {
    const answer = await makeResolver().resolve(link('src/foo.ts'));
    expect(answer.ok && answer.link.path).toBe(join(root, 'src', 'foo.ts'));
  });

  it("R6 / #394: a leading-slash path is the PROJECT's file", async () => {
    const answer = await makeResolver().resolve(link('/test.txt'));
    expect(answer.ok && answer.link.path).toBe(join(root, 'test.txt'));
  });

  it('R10: an untitled buffer supplies no base directory and still resolves', async () => {
    const answer = await makeResolver().resolve(link('docs/a.md', { baseDirectory: undefined }));
    expect(answer.ok && answer.link.path).toBe(join(root, 'docs', 'a.md'));
  });

  it('R11: a panel with no project resolves an ABSOLUTE form and nothing relative', async () => {
    const abs = join(root, 'test.txt');
    const resolver = makeResolver();
    expect((await resolver.resolve(link(abs, { originProjectId: null }))).ok).toBe(true);
    expect(await resolver.resolve(link('test.txt', { originProjectId: null }))).toEqual(NOT_FOUND);
  });
});

describe('FileLinkResolver.resolve — R7: the positioned reading is tried first', () => {
  it('src/foo.ts:42:7 resolves to the file, not to a name ending in :42:7', async () => {
    const answer = await makeResolver().resolve(link('src/foo.ts:42:7'));
    expect(answer.ok && answer.link.path).toBe(join(root, 'src', 'foo.ts'));
  });
});

describe('FileLinkResolver.resolve — R8: a file: URI, decoded', () => {
  it('a hostless file: URI naming a real file resolves', async () => {
    const target = join(root, 'docs', 'My File.md');
    const uri = `file:///${target.replace(/\\/g, '/').replace(/ /g, '%20')}`;
    const answer = await makeResolver().resolve(link(uri, { kind: 'fileHyperlink' }));
    expect(answer.ok && answer.link.path).toBe(target);
  });

  it('FR-013: a file: URI naming nothing is a non-link', async () => {
    const answer = await makeResolver().resolve(
      link('file:///D:/throng-no-such-file.txt', { kind: 'fileHyperlink' }),
    );
    expect(answer).toEqual(NOT_FOUND);
  });

  it('US2: a file: URI naming a FOLDER is a link, and its kind says so', async () => {
    const uri = `file:///${root.replace(/\\/g, '/')}`;
    const answer = await makeResolver().resolve(link(uri, { kind: 'fileHyperlink' }));
    expect(answer.ok && answer.link.kind).toBe('folder');
  });
});

describe('FileLinkResolver.resolve — FR-021 membership, from the RESOLVED path', () => {
  it('M2 / US1 scenario 3: every spelling of one file gives one verdict', async () => {
    const resolver = makeResolver();
    const spellings = [
      'test.txt',
      '/test.txt',
      './test.txt',
      join(root, 'test.txt'),
      join(root, 'test.txt').replace(/\\/g, '/'),
    ];
    for (const text of spellings) {
      const answer = await resolver.resolve(link(text));
      expect(answer.ok, text).toBe(true);
      expect(answer.ok && answer.link.inProject, text).toBe(true);
    }
  });

  it('a file outside the project is resolved, and judged outside', async () => {
    const answer = await makeResolver().resolve(link(join(outside, 'elsewhere.txt')));
    expect(answer.ok).toBe(true);
    expect(answer.ok && answer.link.inProject).toBe(false);
  });

  it('M3: a panel with no project judges EVERYTHING outside', async () => {
    const answer = await makeResolver().resolve(link(join(root, 'test.txt'), { originProjectId: null }));
    expect(answer.ok && answer.link.inProject).toBe(false);
  });

  it('M4: a sub-workspace panel judges against its origin project', async () => {
    const answer = await makeResolver().resolve(
      link(join(root, 'test.txt'), { originProjectId: 'proj-1' }),
    );
    expect(answer.ok && answer.link.inProject).toBe(true);
    const foreign = await makeResolver().resolve(
      link(join(root, 'test.txt'), { originProjectId: 'other-project' }),
    );
    expect(foreign.ok && foreign.link.inProject).toBe(false);
  });

  it('I2: a project ID main has never heard of gets no root, not a guessed one', async () => {
    const answer = await makeResolver().resolve(link(join(root, 'test.txt'), { originProjectId: 'invented' }));
    expect(answer.ok && answer.link.inProject).toBe(false);
  });

  it('M5: a symlink under the root is judged on the location it NAMES, not its destination', async () => {
    const target = join(outside, 'elsewhere.txt');
    const named = join(root, 'linked.txt');
    try {
      symlinkSync(target, named, 'file');
    } catch {
      // Creating a symlink needs a privilege a medium session may not hold. Skipping is honest;
      // asserting the non-symlink case instead would be a hollow baseline.
      return;
    }
    const answer = await makeResolver().resolve(link('linked.txt'));
    expect(answer.ok && answer.link.inProject, 'realpath must not be consulted').toBe(true);
  });
});

describe('FileLinkResolver.resolve — the answer\u2019s other three fields', () => {
  it('kind distinguishes a file from a folder', async () => {
    const file = await makeResolver().resolve(link('test.txt'));
    const folder = await makeResolver().resolve(link('docs'));
    expect(file.ok && file.link.kind).toBe('file');
    expect(folder.ok && folder.link.kind).toBe('folder');
  });

  it('FR-039a: executable comes from the platform, and a folder is never executable', async () => {
    const resolver = makeResolver();
    for (const name of ['setup.exe', 'build.bat', 'deploy.ps1', 'shortcut.lnk']) {
      const answer = await resolver.resolve(link(name));
      expect(answer.ok, name).toBe(true);
      expect(answer.ok && answer.link.executable, name).toBe(true);
    }
    const document = await resolver.resolve(link('test.txt'));
    expect(document.ok && document.link.executable).toBe(false);
    const folder = await resolver.resolve(link('docs'));
    expect(folder.ok && folder.link.kind === 'folder' && folder.link.executable).toBe(false);
  });

  it('FR-030: preview is enabled / disabled / none, from the registry AND the settings', async () => {
    const enabled = await makeResolver().resolve(link('README.md'));
    expect(enabled.ok && enabled.link.preview).toBe('enabled');

    const off = makeResolver({
      previewSettings: { providers: { markdown: { enabled: false, defaultOpenAction: 'editor' } } },
    });
    const disabled = await off.resolve(link('README.md'));
    expect(disabled.ok && disabled.link.preview).toBe('disabled');

    // No provider claims `.txt`, so the item is meaningless rather than unavailable.
    const none = await makeResolver().resolve(link('test.txt'));
    expect(none.ok && none.link.preview).toBe('none');
  });

  it('a folder never offers a preview, whatever a provider would say of its name', async () => {
    const answer = await makeResolver().resolve(link('docs'));
    expect(answer.ok && answer.link.preview).toBe('none');
  });
});

describe('FileLinkResolver — FR-037: the action re-checks, and a gone file says so ONCE', () => {
  it('revealInFileManager re-resolves and acts on a real file', async () => {
    const revealed: string[] = [];
    const resolver = makeResolver();
    resolver.setShell({
      revealInFileManager: async (p) => void revealed.push(p),
      openFolder: async (p) => void revealed.push(p),
      openExternal: async () => {},
      openWithDefaultProgram: async () => {},
    });
    await expect(resolver.revealInFileManager(link('test.txt'))).resolves.toEqual({ ok: true });
    expect(revealed).toEqual([join(root, 'test.txt')]);
  });

  // *Round four (T255, FR-158b / S10):* this case asserted that a reveal of a file deleted between the
  // hover and the follow answered `gone` and reached no OS call. FR-158b replaces the reveal's re-check
  // with FR-158a's file-or-folder check: a location that is not there is revealed on its PARENT, never
  // answered `gone`. FR-037's re-check stands for the actions that need the file itself.
  it('a file deleted between hover and follow: the reveal shows its parent; opening it answers gone', async () => {
    const doomed = join(root, 'doomed.txt');
    writeFileSync(doomed, 'x', 'utf8');
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    // It IS a link while it exists…
    expect((await resolver.resolve(link('doomed.txt'))).ok).toBe(true);
    rmSync(doomed);
    // …and the follow re-checks rather than trusting the earlier answer.
    await expect(resolver.revealInFileManager(link('doomed.txt'))).resolves.toEqual({ ok: true });
    expect(calls).toEqual([`folder:${root}`]);
    const opened = await resolver.openWithDefaultProgram(link('doomed.txt'));
    expect(opened).toEqual({ ok: false, reason: 'gone', path: 'doomed.txt' });
    expect(calls, 'nothing may be opened for a file that has gone').toEqual([`folder:${root}`]);
  });

  it('ONE outcome, not one per collaborator — the caller raises exactly one notice', async () => {
    const resolver = makeResolver();
    resolver.setShell({
      revealInFileManager: async () => {},
      openFolder: async () => {},
      openExternal: async () => {},
      openWithDefaultProgram: async () => {},
    });
    const outcome = await resolver.openWithDefaultProgram(link('not-a-real-file.txt'));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('gone');
    // The outcome is a VALUE, so there is one thing to report and one place reporting it.
    expect(Object.keys(outcome).sort()).toEqual(['ok', 'path', 'reason']);
  });

  it('openWithDefaultProgram refuses a folder, as a link action and not only at the shell', async () => {
    const resolver = makeResolver();
    resolver.setShell({
      revealInFileManager: async () => {},
      openFolder: async () => {},
      openExternal: async () => {},
      openWithDefaultProgram: async () => {
        throw new Error('the shell must not be reached for a folder');
      },
    });
    const outcome = await resolver.openWithDefaultProgram(link('docs'));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('refused');
  });

  it('a folder link reveals through openFolder, and a file through revealInFileManager', async () => {
    const calls: { op: string; path: string }[] = [];
    const resolver = makeResolver();
    resolver.setShell({
      revealInFileManager: async (p) => void calls.push({ op: 'reveal', path: p }),
      openFolder: async (p) => void calls.push({ op: 'openFolder', path: p }),
      openExternal: async () => {},
      openWithDefaultProgram: async () => {},
    });
    await resolver.revealInFileManager(link('docs'));
    await resolver.revealInFileManager(link('test.txt'));
    expect(calls).toEqual([
      { op: 'openFolder', path: join(root, 'docs') },
      { op: 'reveal', path: join(root, 'test.txt') },
    ]);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T201 — FR-150, SC-020: paths containing spaces, over a real tree
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The fixture tree now holds `with space/notes.md` (added for this task). What the user sees today
 * (O11 rows 28, 36, 43, 60): a path through a folder whose name has a space is never a link — the
 * text splits at the space and neither half names anything.
 *
 * Two routes are exercised, because they are the two a follow actually takes:
 *  - the TEXT of the whole path, as a surface sends it once detection has found it (`resolve`);
 *  - a whole LINE walked as the surfaces walk it — detect, ask about each candidate in order, the
 *    first that resolves is the link. That is where "and not further" (SC-020) is observable: the
 *    candidate that wins decides what gets underlined, and it must end at `notes.md`.
 */
const spacedPath = (): string => join(root, 'with space', 'notes.md');

/** `C:\a\b` as Git Bash (`/c/a/b`) or WSL (`/mnt/c/a/b`) spells it. */
const posix = (winPath: string, prefix: '' | '/mnt'): string =>
  `${prefix}/${winPath[0]!.toLowerCase()}${winPath.slice(2).replace(/\\/g, '/')}`;

/** The surfaces' walk: detection's candidates in order; the first that resolves is the link. */
async function firstLinkOn(line: string): Promise<{ text: string; path: string } | null> {
  const resolver = makeResolver();
  for (const candidate of detectPathCandidates(line, [])) {
    const answer = await resolver.resolve(link(candidate.text));
    if (answer.ok) return { text: candidate.text, path: answer.link.path };
  }
  return null;
}

describe('T201 / FR-150 — each spelling of a spaced path resolves to it', () => {
  it('a drive path', async () => {
    const answer = await makeResolver().resolve(link(spacedPath()));
    expect(answer.ok && answer.link.path).toBe(spacedPath());
  });

  it('the Git Bash /x/… form', async () => {
    const answer = await makeResolver().resolve(link(posix(spacedPath(), '')));
    expect(answer.ok && answer.link.path).toBe(spacedPath());
  });

  it('the WSL /mnt/x/… form', async () => {
    const answer = await makeResolver().resolve(link(posix(spacedPath(), '/mnt')));
    expect(answer.ok && answer.link.path).toBe(spacedPath());
  });

  it('a file: URI with %20', async () => {
    const uri = `file:///${spacedPath().replace(/\\/g, '/').replace(/ /g, '%20')}`;
    const answer = await makeResolver().resolve(link(uri));
    expect(answer.ok && answer.link.path).toBe(spacedPath());
  });

  it('the WSL form with a position, as corpus row 43 prints it', async () => {
    const answer = await makeResolver().resolve(link(`${posix(spacedPath(), '/mnt')}:3`));
    expect(answer.ok && answer.link.path).toBe(spacedPath());
  });

  it('T242: an enclosed span with no terminator (`"<root>\\with space"`) resolves as sent, not cut at its space', async () => {
    // FR-173b takes a quoted path whole with no separator or known extension at its end, so the
    // surface sends `<root>\with space`. Re-detecting that bare text under FR-173 stops at the space;
    // main must not answer for `<root>\with` instead.
    const folder = join(root, 'with space');
    const answer = await makeResolver().resolve(link(folder));
    expect(answer.ok && answer.link.path).toBe(folder);
  });
});

describe('T201 / SC-020 — a spaced path inside a sentence is the link, and the sentence is not', () => {
  it('see <root>\\with space\\notes.md for details → notes.md, and the link ends there', async () => {
    const found = await firstLinkOn(`see ${spacedPath()} for details`);
    expect(found?.path).toBe(spacedPath());
    expect(found?.text, 'the winning reading must not swallow "for details"').toBe(spacedPath());
  });

  it('the same line in Git Bash\u2019s spelling', async () => {
    const found = await firstLinkOn(`see ${posix(spacedPath(), '')} for details`);
    expect(found?.path).toBe(spacedPath());
    expect(found?.text).toBe(posix(spacedPath(), ''));
  });

  it('a spaced reading that names nothing leaves the unextended token\u2019s answer unchanged', async () => {
    const target = join(root, 'docs', 'a.md');
    const found = await firstLinkOn(`opened ${target} and more words after it`);
    expect(found?.path).toBe(target);
    expect(found?.text).toBe(target);
    const direct = await makeResolver().resolve(link(join(root, 'test.txt')));
    expect(direct.ok && direct.link.path).toBe(join(root, 'test.txt'));
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T207 — FR-151, SC-019: Git Bash's own paths, against the REAL Git for Windows on this machine
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user sees today (O11 rows 38 – 40): `/usr/bin/bash.exe` and `/etc/hosts` are not links,
 * and `/tmp` follows to the current drive's `\tmp` with the text handed over as written.
 *
 * The install is found the way the app finds it — `WindowsShellDetection`, which already locates Git
 * Bash (005 FR-024) — and its root is `bash.exe`'s `bin\` folder's parent. `WindowsPathForms` is
 * assumed to take that root by constructor as `{ gitRoot }` (data-model §15.2; the shape is T204's,
 * and the same assumption as `windows-path-forms.contract.test.ts`). Where Git for Windows is not
 * installed every case skips, and SAYS so.
 */
let gitRoot: string | null = null;

beforeAll(async () => {
  const shells = await new WindowsShellDetection().detectInstalledShells();
  const bash = shells.find((s) => s.id === 'git-bash')?.file;
  gitRoot = bash === undefined ? null : dirname(dirname(bash));
  if (gitRoot === null) {
    console.warn('T207 skipped: Git for Windows is not installed on this machine, so there is no mount table to resolve through.');
  }
});

type GitCtor = new (options: { gitRoot: string | null }) => WindowsPathForms;
const withRealGit = (): WindowsPathForms =>
  new (WindowsPathForms as unknown as GitCtor)({ gitRoot });

const under = (child: string, parent: string): boolean =>
  child.toLowerCase().startsWith(`${parent.replace(/[\\/]+$/, '').toLowerCase()}\\`);

describe('T207 / FR-151 — Git Bash\u2019s rooted paths resolve through the real install', () => {
  it('/usr/bin/bash.exe is a file under the detected install', async (ctx) => {
    if (gitRoot === null) return ctx.skip();
    const answer = await makeResolver({ pathForms: withRealGit() }).resolve(link('/usr/bin/bash.exe'));
    expect(answer.ok, 'a link').toBe(true);
    expect(answer.ok && under(answer.link.path, gitRoot), answer.ok ? answer.link.path : '').toBe(true);
    expect(answer.ok && answer.link.kind).toBe('file');
  });

  it('/etc/hosts is a file under the detected install', async (ctx) => {
    if (gitRoot === null) return ctx.skip();
    const answer = await makeResolver({ pathForms: withRealGit() }).resolve(link('/etc/hosts'));
    expect(answer.ok, 'a link').toBe(true);
    expect(answer.ok && under(answer.link.path, gitRoot), answer.ok ? answer.link.path : '').toBe(true);
  });

  it('/tmp resolves to a folder — the user\u2019s temp folder, as Git\u2019s fstab maps it', async (ctx) => {
    if (gitRoot === null) return ctx.skip();
    const answer = await makeResolver({ pathForms: withRealGit() }).resolve(link('/tmp'));
    expect(answer.ok && answer.link.kind).toBe('folder');
    expect(answer.ok && answer.link.path.toLowerCase()).toBe(tmpdir().toLowerCase());
  });

  it('a WSL-flavour request for /etc/hosts does NOT resolve through Git', async (ctx) => {
    if (gitRoot === null) return ctx.skip();
    const answer = await makeResolver({ pathForms: withRealGit() }).resolve(link('/etc/hosts', { wslFlavour: true }));
    expect(answer.ok && under(answer.link.path, gitRoot), answer.ok ? answer.link.path : '(no link)').toBe(false);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T141 (`@admin`) — FR-003c, FR-012, FR-022 – FR-024, SC-014: a REAL network spelling
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * No UNC location can live in a fixture tree, so this spells the temp tree through the loopback
 * administrative share — `\\localhost\<drive>$\<temp>\…` — which is a real SMB path to real files.
 * Both separators, and the `file://127.0.0.1/<drive>$/…` URI. Claimed here: an absolute UNC file and
 * folder resolve; a relative name against a UNC BASE DIRECTORY resolves (D1); a project ROOTED on the
 * share judges its files in-project (M7).
 *
 * The administrative share ordinarily answers only an elevated token — UAC's filtered token is
 * refused at loopback — which is why this is `@admin` and runs on the hosted gate, whose runners are
 * elevated. The gate is REACHABILITY rather than elevation, measured, because the two are not the
 * same fact: a workstation whose policy lets a filtered token through (a domain or Microsoft account,
 * `LocalAccountTokenFilterPolicy`) reaches the share without elevation, and skipping there would hide
 * a check that can run. Where the share does not answer, every case is SKIPPED WITH THE REASON
 * PRINTED, never passed.
 */

/** `C:\a\b` as the loopback administrative share spells it: `\\localhost\C$\a\b`. */
const unc = (winPath: string, host = 'localhost'): string =>
  `\\\\${host}\\${winPath[0]!.toUpperCase()}$${winPath.slice(2)}`;

function runnerElevated(): boolean {
  try {
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'net.exe'), ['session'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

const ADMIN = process.platform === 'win32' && /^[a-z]:/i.test(tmpdir()) && existsSync(unc(tmpdir()));
if (!ADMIN) {
  console.warn(
    `T141 (@admin) skipped: the loopback administrative share does not answer here (${unc(tmpdir())}; ` +
      `elevated: ${runnerElevated()}). It runs on the hosted gate, whose runners are elevated.`,
  );
}

(ADMIN ? describe : describe.skip)('T141 (@admin) — the temp tree through \\\\localhost\\<drive>$', () => {
  it('an absolute UNC file and folder resolve, in both separators', async () => {
    const resolver = makeResolver();
    const file = unc(join(root, 'test.txt'));
    const folder = unc(join(root, 'docs'));
    for (const text of [file, file.replace(/\\/g, '/')]) {
      const answer = await resolver.resolve(link(text));
      expect(answer.ok, text).toBe(true);
      expect(answer.ok && answer.link.kind, text).toBe('file');
    }
    for (const text of [folder, folder.replace(/\\/g, '/')]) {
      const answer = await resolver.resolve(link(text));
      expect(answer.ok && answer.link.kind, text).toBe('folder');
    }
  }, 30_000);

  it('file://127.0.0.1/<drive>$/… resolves to the same file', async () => {
    const target = join(root, 'test.txt');
    const uri = `file://127.0.0.1/${target[0]!.toUpperCase()}$${target.slice(2).replace(/\\/g, '/')}`;
    const answer = await makeResolver().resolve(link(uri, { kind: 'fileHyperlink' }));
    expect(answer.ok, uri).toBe(true);
    expect(answer.ok && answer.link.kind).toBe('file');
  }, 30_000);

  it('D1: a relative name against a UNC base directory resolves', async () => {
    const answer = await makeResolver().resolve(
      link('src/x.ts', { baseDirectory: unc(join(root, 'packages', 'core')) }),
    );
    expect(answer.ok, 'a relative path in a terminal sitting on a share').toBe(true);
    expect(answer.ok && answer.link.path.toLowerCase()).toContain('\\packages\\core\\src\\x.ts');
  }, 30_000);

  it('M7: a project ROOTED on the share judges its files in-project', async () => {
    PROJECT_ROOTS.set('proj-unc', unc(root));
    try {
      const resolver = makeResolver();
      const relative = await resolver.resolve(link('test.txt', { originProjectId: 'proj-unc' }));
      expect(relative.ok && relative.link.inProject, 'a relative name in a share-rooted project').toBe(true);
      const absolute = await resolver.resolve(link(unc(join(root, 'test.txt')), { originProjectId: 'proj-unc' }));
      expect(absolute.ok && absolute.link.inProject, 'the same file, spelled on the share').toBe(true);
    } finally {
      PROJECT_ROOTS.delete('proj-unc');
    }
  }, 30_000);
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T255 — round four: resolution only at a follow and a menu opening (FR-156, FR-158a – d,
 * FR-160, FR-160a, FR-170a), against a real disk
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

describe('T255 / FR-160 — an in-project first reading with nothing behind it', () => {
  it('resolve answers the failure arm with NO reason (not found), and the by-extension fields', async () => {
    const answer = await makeResolver().resolve(link('missing.md'));
    expect(answer).toMatchObject({ ok: false, previewByExtension: 'enabled', executableByExtension: false });
    expect(answer).not.toHaveProperty('reason');
  });

  it('FR-170a: the unresolved reply says what the menu would offer by extension', async () => {
    const resolver = makeResolver();
    expect(await resolver.resolve(link('missing.exe'))).toMatchObject({
      ok: false,
      executableByExtension: true,
      previewByExtension: 'none',
    });
    expect(await resolver.resolve(link('missing.txt'))).toMatchObject({
      ok: false,
      executableByExtension: false,
      previewByExtension: 'none',
    });
    const off = makeResolver({
      previewSettings: { providers: { markdown: { enabled: false, defaultOpenAction: 'editor' } } },
    });
    expect(await off.resolve(link('missing.md'))).toMatchObject({ ok: false, previewByExtension: 'disabled' });
  });

  it('a file: URI in the project opens in throng — it resolves to an in-project file', async () => {
    const uri = `file:///${join(root, 'test.txt').replace(/\\/g, '/')}`;
    const answer = await makeResolver().resolve(link(uri, { kind: 'fileHyperlink' }));
    expect(answer).toMatchObject({ ok: true, link: { path: join(root, 'test.txt'), kind: 'file', inProject: true } });
  });
});

describe('T255 / FR-158a — an out-of-project location goes to OS Explorer, file or folder', () => {
  it('an existing folder with no trailing separator opens AS ITSELF', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(resolver.revealInFileManager(link(outside))).resolves.toEqual({ ok: true });
    expect(calls).toEqual([`folder:${outside}`]);
  });

  it('an existing file opens its parent with it selected', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    const file = join(outside, 'elsewhere.txt');
    await expect(resolver.revealInFileManager(link(file))).resolves.toEqual({ ok: true });
    expect(calls).toEqual([`reveal:${file}`]);
  });

  it('an absent one goes to its parent, with no notice', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(resolver.revealInFileManager(link(join(outside, 'no-such.txt')))).resolves.toEqual({ ok: true });
    expect(calls).toEqual([`folder:${outside}`]);
  });

  it('a trailing-separator location opens as a folder with NO stat call', async () => {
    const { fs, stats } = countingFs();
    const resolver = makeResolver({ fs });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(resolver.revealInFileManager(link(`${outside}\\`))).resolves.toEqual({ ok: true });
    expect(calls).toEqual([`folder:${outside}`]);
    expect(stats, 'a folder by grammar is never checked (FR-158d)').toEqual([]);
  });

  it('an OSC 8 target ending in a separator opens as a folder with NO stat call', async () => {
    const { fs, stats } = countingFs();
    const resolver = makeResolver({ fs });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    const uri = `file:///${outside.replace(/\\/g, '/')}/`;
    await expect(resolver.revealInFileManager(link(uri, { kind: 'fileHyperlink' }))).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.replace(/[\\/]+$/, '')).toBe(`folder:${outside}`);
    expect(stats).toEqual([]);
  });

  it('FR-158c: a relative sub\\dir\\ from a working directory outside the project reveals the FIRST reading, unchecked', async () => {
    const { fs, stats } = countingFs();
    const resolver = makeResolver({ fs });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    // `<root>\sub\dir` does not exist either; neither is asked about.
    await resolver.revealInFileManager(link('sub\\dir\\', { baseDirectory: outside }));
    expect(calls).toEqual([`folder:${join(outside, 'sub', 'dir')}`]);
    expect(stats).toEqual([]);
  });
});

describe('T255 / FR-160a, FR-158d — folders open as themselves, and the root needs no check', () => {
  it('an existing in-project folder that is not the root opens as itself after ONE stat', async () => {
    const { fs, stats } = countingFs();
    const resolver = makeResolver({ fs });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await resolver.revealInFileManager(link(join(root, 'src')));
    expect(calls).toEqual([`folder:${join(root, 'src')}`]);
    expect(stats).toHaveLength(1);
  });

  it('the project root itself (file:///<root>, no trailing slash) opens as itself with 0 stat calls', async () => {
    const { fs, stats } = countingFs();
    const resolver = makeResolver({ fs });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    const uri = `file:///${root.replace(/\\/g, '/')}`;
    await resolver.revealInFileManager(link(uri, { kind: 'fileHyperlink' }));
    expect(calls).toEqual([`folder:${root}`]);
    expect(stats).toEqual([]);
  });

  it('the Link menu opening on the project root makes no check either, and answers a folder', async () => {
    const { fs, stats } = countingFs();
    const answer = await makeResolver({ fs }).resolve(link(`file:///${root.replace(/\\/g, '/')}`, { kind: 'fileHyperlink' }));
    expect(answer).toMatchObject({ ok: true, link: { kind: 'folder', inProject: true, executable: false, preview: 'none' } });
    expect(stats).toEqual([]);
  });
});

describe('T255 / FR-160 note — the mixed list: the first reading that EXISTS decides', () => {
  let fakeGit = '';
  beforeAll(() => {
    fakeGit = join(roots[0]!, 'fake-git');
    mkdirSync(join(fakeGit, 'etc'), { recursive: true });
    writeFileSync(join(fakeGit, 'etc', 'hosts'), '127.0.0.1 localhost\n', 'utf8');
  });

  it('/etc/hosts with <root>\\etc\\hosts absent and Git\u2019s etc\\hosts present reveals Git\u2019s file', async () => {
    const resolver = makeResolver({ pathForms: new WindowsPathForms({ gitRoot: fakeGit }) });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(resolver.revealInFileManager(link('/etc/hosts'))).resolves.toEqual({ ok: true });
    expect(calls).toEqual([`reveal:${join(fakeGit, 'etc', 'hosts')}`]);
  });

  it('/help with nothing behind it answers not found — the one notice is the renderer\u2019s', async () => {
    const answer = await makeResolver({ pathForms: new WindowsPathForms({ gitRoot: fakeGit }) }).resolve(link('/help'));
    expect(answer).toEqual(NOT_FOUND);
  });
});

describe('T259 / FR-036 — the OS’s reason reaches the outcome (T229)', () => {
  const refusing = (osReason: string): IShellIntegration =>
    ({
      revealInFileManager: async () => ({ ok: false, osReason }),
      openFolder: async () => {
        throw new Error(osReason);
      },
      openExternal: async () => {},
      openWithDefaultProgram: async () => ({ ok: false, osReason }),
    }) as unknown as IShellIntegration;

  it('Open in OS Default Program: refused, with the OS’s words as osReason', async () => {
    const resolver = makeResolver();
    resolver.setShell(refusing('No application is associated with this file'));
    await expect(resolver.openWithDefaultProgram(link('test.txt'))).resolves.toEqual({
      ok: false,
      reason: 'refused',
      path: join(root, 'test.txt'),
      osReason: 'No application is associated with this file',
    });
  });

  it('Open in OS Explorer on a file, and on a folder: refused, with the OS’s words', async () => {
    const resolver = makeResolver();
    resolver.setShell(refusing('Access is denied.'));
    await expect(resolver.revealInFileManager(link('test.txt'))).resolves.toMatchObject({
      ok: false,
      reason: 'refused',
      osReason: 'Access is denied.',
    });
    await expect(resolver.revealInFileManager(link('docs'))).resolves.toMatchObject({
      ok: false,
      reason: 'refused',
      osReason: 'Access is denied.',
    });
  });
});

describe('T255 / FR-156 — main re-sanitises every request (SC-024)', () => {
  const NUL = String.fromCharCode(0);

  it('a quoted path with a trailing flag is reduced to the one path, on every route', async () => {
    const target = join(root, 'test.txt');
    const crafted = `"${target}" --flag`;
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    expect(await resolver.resolve(link(crafted))).toMatchObject({ ok: true, link: { path: target } });
    await resolver.revealInFileManager(link(crafted));
    await resolver.openWithDefaultProgram(link(crafted));
    expect(calls).toEqual([`reveal:${target}`, `open:${target}`]);
  });

  for (const crafted of [
    `${'C:\\x.txt'}%00.exe`,
    `test.txt${NUL}.exe`,
    `test.txt${String.fromCharCode(0x0a)}calc`,
    `test.txt${String.fromCharCode(0x9b)}x`,
  ]) {
    it(`${JSON.stringify(crafted)} is refused on every route, and nothing reaches the OS`, async () => {
      const resolver = makeResolver();
      const { shell, calls } = recordingShell();
      resolver.setShell(shell);
      expect(await resolver.resolve(link(crafted))).toMatchObject({ ok: false });
      expect(await resolver.revealInFileManager(link(crafted))).toMatchObject({ ok: false, reason: 'refused' });
      expect(await resolver.openWithDefaultProgram(link(crafted))).toMatchObject({ ok: false, reason: 'refused' });
      expect(calls).toEqual([]);
    });
  }

  it('a crafted file: URI OSC 8 target is refused too', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    const uri = `file:///${join(root, 'test.txt').replace(/\\/g, '/')}%00.exe`;
    expect(await resolver.revealInFileManager(link(uri, { kind: 'fileHyperlink' }))).toMatchObject({ ok: false, reason: 'refused' });
    expect(calls).toEqual([]);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T293 — `FileLinkResolver.follow`: ONE request per Ctrl+click (plan *Corrections, tenth pass*;
 * data-model §16.18, §16.21, §16.22)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user meets today: a follow is two round trips — `resolve`, then `reveal` or `open` — each
 * with its own bounded pass, so a link on an offline share can take two timeouts to answer, and the
 * reveal re-checks what the resolve just found. `follow` resolves under ONE deadline, performs the
 * reveal itself when that is the outcome (the same `stat`, not a second), and answers what the
 * renderer should do. T255's follow-shaped cases are re-asserted through it.
 */
type FollowOutcome = { kind: string; path?: string; link?: unknown; osReason?: string };
const follow = (resolver: FileLinkResolver, request: ReturnType<typeof link>): Promise<FollowOutcome> =>
  (resolver as unknown as { follow(r: ReturnType<typeof link>): Promise<FollowOutcome> }).follow(request);

/** A filesystem where every `stat` under one of `prefixes` hangs until `settle()` (an offline share). */
function hangingFs(prefixes: readonly string[]): { fs: IFileSystem; stats: string[]; settle(): void } {
  const real = new NodeFileSystem(async () => {});
  const stats: string[] = [];
  const stuck: (() => void)[] = [];
  const fs = {
    stat: (path: string) => {
      stats.push(path);
      if (prefixes.some((p) => path.toLowerCase().startsWith(p.toLowerCase()))) {
        return new Promise((_resolve, reject) => stuck.push(() => reject(new Error('ENOENT'))));
      }
      return real.stat(path);
    },
  } as unknown as IFileSystem;
  return { fs, stats, settle: () => stuck.splice(0).forEach((s) => s()) };
}

async function outcomeAfter<T>(running: Promise<T>, ms: number): Promise<T | 'pending'> {
  let settled: { value: T } | undefined;
  void running.then((value) => {
    settled = { value };
  });
  await vi.advanceTimersByTimeAsync(ms);
  return settled === undefined ? 'pending' : settled.value;
}

describe('T293 — follow: an in-project file opens in throng, and nothing touches the shell', () => {
  it('an existing in-project file answers openInThrong with the resolved link', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(follow(resolver, link('test.txt'))).resolves.toEqual({
      kind: 'openInThrong',
      link: { path: join(root, 'test.txt'), kind: 'file', inProject: true, executable: false, preview: 'none' },
    });
    expect(calls).toEqual([]);
  });

  it('a file: URI in the project opens in throng too (M3)', async () => {
    const uri = `file:///${join(root, 'test.txt').replace(/\\/g, '/')}`;
    await expect(follow(makeResolver(), link(uri, { kind: 'fileHyperlink' }))).resolves.toMatchObject({
      kind: 'openInThrong',
      link: { path: join(root, 'test.txt'), inProject: true },
    });
  });

  it('FR-160: an in-project first reading with nothing behind it answers notFound, naming it — no shell', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(follow(resolver, link('missing.md'))).resolves.toEqual({
      kind: 'notFound',
      path: join(root, 'missing.md'),
    });
    expect(calls).toEqual([]);
  });
});

describe('T293 — follow performs the reveal itself and answers `revealed` (FR-158a, FR-158b, FR-160a)', () => {
  it('an existing out-of-project folder opens AS ITSELF', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(follow(resolver, link(outside))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`folder:${outside}`]);
  });

  it('an existing out-of-project file opens its parent with it selected', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    const file = join(outside, 'elsewhere.txt');
    await expect(follow(resolver, link(file))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`reveal:${file}`]);
  });

  it('an absent out-of-project one goes to its parent, with no notice', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(follow(resolver, link(join(outside, 'no-such.txt')))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`folder:${outside}`]);
  });

  it('FR-160a: an existing in-project folder that is not the root opens as itself after ONE stat', async () => {
    const { fs, stats } = countingFs();
    const resolver = makeResolver({ fs });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(follow(resolver, link(join(root, 'src')))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`folder:${join(root, 'src')}`]);
    expect(stats).toHaveLength(1);
  });

  it('FR-158d: the project root itself (file:///<root>) opens as itself with 0 stat calls', async () => {
    const { fs, stats } = countingFs();
    const resolver = makeResolver({ fs });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    const uri = `file:///${root.replace(/\\/g, '/')}`;
    await expect(follow(resolver, link(uri, { kind: 'fileHyperlink' }))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`folder:${root}`]);
    expect(stats).toEqual([]);
  });

  it('a trailing-separator location opens as a folder with NO stat call', async () => {
    const { fs, stats } = countingFs();
    const resolver = makeResolver({ fs });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(follow(resolver, link(`${outside}\\`))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`folder:${outside}`]);
    expect(stats).toEqual([]);
  });

  it('FR-158c: a relative sub\\dir\\ from a working directory outside the project reveals the FIRST reading, unchecked', async () => {
    const { fs, stats } = countingFs();
    const resolver = makeResolver({ fs });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(follow(resolver, link('sub\\dir\\', { baseDirectory: outside }))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`folder:${join(outside, 'sub', 'dir')}`]);
    expect(stats).toEqual([]);
  });

  it('the OS refusing answers `refused` with its words (FR-036)', async () => {
    const resolver = makeResolver();
    resolver.setShell({
      revealInFileManager: async () => ({ ok: false, osReason: 'Access is denied.' }),
      openFolder: async () => ({ ok: false, osReason: 'Access is denied.' }),
      openExternal: async () => {},
      openWithDefaultProgram: async () => ({ ok: true }),
    } as unknown as IShellIntegration);
    await expect(follow(resolver, link(join(outside, 'elsewhere.txt')))).resolves.toEqual({
      kind: 'refused',
      path: join(outside, 'elsewhere.txt'),
      osReason: 'Access is denied.',
    });
  });
});

describe('T293 / FR-160 note — through follow, the first reading that EXISTS decides', () => {
  let fakeGit = '';
  beforeAll(() => {
    fakeGit = join(roots[0]!, 'fake-git-follow');
    mkdirSync(join(fakeGit, 'etc'), { recursive: true });
    writeFileSync(join(fakeGit, 'etc', 'hosts'), '127.0.0.1 localhost\n', 'utf8');
  });

  it('/etc/hosts with <root>\\etc\\hosts absent and Git\u2019s etc\\hosts present reveals Git\u2019s file', async () => {
    const resolver = makeResolver({ pathForms: new WindowsPathForms({ gitRoot: fakeGit }) });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(follow(resolver, link('/etc/hosts'))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`reveal:${join(fakeGit, 'etc', 'hosts')}`]);
  });

  it('/help with nothing behind it answers notFound — the one notice is the renderer\u2019s', async () => {
    const resolver = makeResolver({ pathForms: new WindowsPathForms({ gitRoot: fakeGit }) });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(follow(resolver, link('/help'))).resolves.toMatchObject({ kind: 'notFound' });
    expect(calls).toEqual([]);
  });
});

describe('T293 / FR-161, FR-122a — one deadline per follow, and the back-off, through follow', () => {
  const SHARE = '\\\\fileserver\\home\\';
  const TIMEOUT_MS = 2000;

  afterEach(() => {
    vi.useRealTimers();
    PROJECT_ROOTS.delete('proj-share');
  });

  it('an in-project follow on a hanging share answers unreachable AT the timeout, and touches no shell', async () => {
    vi.useFakeTimers();
    PROJECT_ROOTS.set('proj-share', `${SHARE}proj`);
    const { fs } = hangingFs([SHARE]);
    const resolver = makeResolver({ fs, timeoutMs: TIMEOUT_MS });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    const running = follow(resolver, link('notes.txt', { originProjectId: 'proj-share', baseDirectory: `${SHARE}proj` }));
    expect(await outcomeAfter(running, TIMEOUT_MS - 1)).toBe('pending');
    expect(await outcomeAfter(running, 1)).toEqual({ kind: 'unreachable', path: `${SHARE}proj\\notes.txt` });
    expect(calls).toEqual([]);
  });

  it('an out-of-project follow on a hanging share reveals its parent AT the timeout — every reading shares it', async () => {
    vi.useFakeTimers();
    const { fs } = hangingFs([SHARE]);
    const resolver = makeResolver({ fs, timeoutMs: TIMEOUT_MS });
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    const running = follow(resolver, link(`${SHARE}dir\\notes.txt:42`));
    expect(await outcomeAfter(running, TIMEOUT_MS - 1)).toBe('pending');
    expect(await outcomeAfter(running, 1)).toEqual({ kind: 'revealed' });
    expect(calls.map((c) => c.replace(/\\+$/, ''))).toEqual([`folder:${SHARE}dir`]);
  });

  it('after the stuck stat settles, a follow under that root answers at once with no stat (LINK_ROOT_BACKOFF_MS)', async () => {
    vi.useFakeTimers();
    PROJECT_ROOTS.set('proj-share', `${SHARE}proj`);
    const disk = hangingFs([SHARE]);
    const resolver = makeResolver({ fs: disk.fs, timeoutMs: TIMEOUT_MS });
    resolver.setShell(recordingShell().shell);
    await outcomeAfter(follow(resolver, link('a.txt', { originProjectId: 'proj-share', baseDirectory: `${SHARE}proj` })), TIMEOUT_MS);
    disk.settle();
    await vi.advanceTimersByTimeAsync(LINK_ROOT_BACKOFF_MS - 1);
    const before = disk.stats.length;
    expect(
      await outcomeAfter(follow(resolver, link('b.txt', { originProjectId: 'proj-share', baseDirectory: `${SHARE}proj` })), 0),
    ).toEqual({ kind: 'unreachable', path: `${SHARE}proj\\b.txt` });
    expect(disk.stats.length, 'left alone during the back-off').toBe(before);
  });
});

describe('T293 / FR-156, I2 — what follow refuses, and what it does not', () => {
  const NUL = String.fromCharCode(0);

  it('SC-024: a quoted path with a trailing flag is reduced to the one path', async () => {
    const target = join(outside, 'elsewhere.txt');
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    await expect(follow(resolver, link(`"${target}" --flag`))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`reveal:${target}`]);
  });

  for (const crafted of [`${'C:\\x.txt'}%00.exe`, `test.txt${NUL}.exe`, `test.txt${String.fromCharCode(0x0a)}calc`]) {
    it(`${JSON.stringify(crafted)} is answered { kind: 'rejected' }, and nothing reaches the OS`, async () => {
      const resolver = makeResolver();
      const { shell, calls } = recordingShell();
      resolver.setShell(shell);
      await expect(follow(resolver, link(crafted))).resolves.toEqual({ kind: 'rejected' });
      expect(calls).toEqual([]);
    });
  }

  it('M3 / I2: an UNKNOWN originProjectId is judged out-of-project and reveals — never `rejected`', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    const file = join(root, 'test.txt');
    await expect(follow(resolver, link(file, { originProjectId: 'no-such-project' }))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`reveal:${file}`]);
  });

  it('M3: an ABSENT originProjectId is judged out-of-project and reveals too', async () => {
    const resolver = makeResolver();
    const { shell, calls } = recordingShell();
    resolver.setShell(shell);
    const file = join(root, 'test.txt');
    await expect(follow(resolver, link(file, { originProjectId: null }))).resolves.toEqual({ kind: 'revealed' });
    expect(calls).toEqual([`reveal:${file}`]);
  });
});
