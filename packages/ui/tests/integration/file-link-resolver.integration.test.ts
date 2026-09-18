import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectPathCandidates, SHIPPED_PREVIEW_PROVIDERS, type PreviewSettings } from '@throng/core';
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
  over: { previewSettings?: Partial<PreviewSettings>; pathForms?: WindowsPathForms } = {},
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
    fs: new NodeFileSystem(async () => {}),
    pathForms: over.pathForms ?? new WindowsPathForms(),
    executables: new WindowsExecutableExtensions(),
    projectRootFor: (projectId) =>
      projectId === undefined ? null : (PROJECT_ROOTS.get(projectId) ?? null),
    previewRegistry: registry,
    readPreviewSettings: () => settings,
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
    await expect(makeResolver().resolve(link('nothing-here.txt'))).resolves.toEqual({ ok: false });
    await expect(makeResolver().resolve(link('src/also-missing.ts'))).resolves.toEqual({ ok: false });
  });

  it('a UNC-shaped path that does not exist answers a non-link rather than hanging', async () => {
    const answer = await makeResolver().resolve(link('\\\\throng-no-such-host\\share\\x.txt'));
    expect(answer).toEqual({ ok: false });
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
    expect(await resolver.resolve(link('test.txt', { originProjectId: null }))).toEqual({ ok: false });
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
    expect(answer).toEqual({ ok: false });
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

  it('a file deleted between hover and follow answers { ok:false, reason:"gone", path }', async () => {
    const doomed = join(root, 'doomed.txt');
    writeFileSync(doomed, 'x', 'utf8');
    const resolver = makeResolver();
    const calls: string[] = [];
    resolver.setShell({
      revealInFileManager: async (p) => void calls.push(p),
      openFolder: async (p) => void calls.push(p),
      openExternal: async () => {},
      openWithDefaultProgram: async (p) => void calls.push(p),
    });
    // It IS a link while it exists…
    expect((await resolver.resolve(link('doomed.txt'))).ok).toBe(true);
    rmSync(doomed);
    // …and the follow re-checks rather than trusting the earlier answer.
    const outcome = await resolver.revealInFileManager(link('doomed.txt'));
    expect(outcome).toEqual({ ok: false, reason: 'gone', path: 'doomed.txt' });
    expect(calls, 'nothing may reach the OS for a path that has gone').toEqual([]);
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
