import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import {
  WindowsElevation,
  WindowsExecutableExtensions,
  WindowsPathForms,
} from '@throng/platform-windows';
import { FileLinkResolver } from '../../src/main/file-link-resolver.js';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import {
  ElectronShellIntegration,
  type ElectronShellLike,
  type DeElevatingLauncher,
} from '../../src/main/electron-shell-integration.js';

/**
 * 045 SI4 / FR-038 (`@admin`) — **an elevated throng must not start an ordinary program elevated.**
 *
 * Principle III's de-elevation rule, extended to the two OS actions a file link can perform. The
 * risk it guards is concrete: a link printed by a NON-elevated terminal, followed from an elevated
 * throng, would otherwise launch whatever it named with administrator rights.
 *
 * ══ WHAT IS `@admin` HERE, AND WHAT TURNED OUT NOT TO BE ══
 *
 * The task that asked for this file assumed the whole of it needed a real elevated host. It does
 * not, and the distinction is worth being exact about, because getting it wrong in either direction
 * costs something:
 *
 *  - **The ROUTING is testable everywhere**, because `isElevated` is INJECTED. Which launcher
 *    received which spec, and that Electron's `shell` was not called, are observable on an ordinary
 *    developer machine. Deferring them to CI would mean the one decision FR-038 turns on went
 *    unproven on every local run — and the first version of this file did exactly that, passing
 *    green while asserting nothing, which is the hollow baseline Principle V forbids.
 *  - **What genuinely needs elevation** is whether a de-elevated launch, from a real high-integrity
 *    process, produces a real medium-integrity child. That is `@admin`, it is answered by
 *    `windows-de-elevated-launcher.contract.test.ts` and the `@admin` E2E, and the case at the foot
 *    of this file checks the one thing those cannot: that a REALLY elevated host routes away from
 *    the shell. When this process is not elevated it is skipped with a reason, never softened.
 *
 * The de-elevating launcher is injected in the routing cases, and that is the point rather than a
 * shortcut: what FR-038 requires is that the elevated process hand the work OVER, and the
 * observable of "handed over" is which launcher received which spec.
 */

function runnerElevated(): boolean {
  if (process.platform !== 'win32') return false;
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

const ELEVATED = runnerElevated();
/** Only the case that needs a REAL high-integrity process. The routing cases need no such thing. */
const whenReallyElevated = ELEVATED ? describe : describe.skip;

const roots: string[] = [];

function tree(): { file: string; folder: string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-deelev-'));
  roots.push(root);
  const folder = join(root, 'sub');
  mkdirSync(folder, { recursive: true });
  const file = join(root, 'notes.txt');
  writeFileSync(file, 'fixture\n', 'utf8');
  return { file, folder };
}

afterAll(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* a temp tree left behind is not worth failing a passing assertion over */
    }
  }
});

type Launched = { file: string; args: readonly string[] };

function subject(hostElevated: boolean) {
  const direct: { op: string; path: string }[] = [];
  const launched: Launched[] = [];
  const shell: ElectronShellLike = {
    showItemInFolder: (p) => direct.push({ op: 'reveal', path: p }),
    openPath: async (p) => {
      direct.push({ op: 'open', path: p });
      return '';
    },
    openExternal: async () => {},
  };
  const launcher: DeElevatingLauncher = {
    isAvailable: () => true,
    launch: (file, args) => void launched.push({ file, args: [...args] }),
  };
  return {
    shell: new ElectronShellIntegration(shell, undefined, {
      launcher,
      isElevated: () => hostElevated,
    }),
    direct,
    launched,
  };
}

describe('SI4 \u2014 with an elevated host, neither OS action is performed directly', () => {
  it('reveals a file through the launcher, with explorer /select', async () => {
    const { shell, direct, launched } = subject(true);
    const { file } = tree();
    await shell.revealInFileManager(file);
    expect(direct, 'the elevated process must not call Electron\u2019s shell itself').toEqual([]);
    expect(launched).toHaveLength(1);
    expect(launched[0].file.toLowerCase()).toContain('explorer.exe');
    expect(launched[0].args).toEqual([`/select,${file}`]);
  });

  it('opens a folder through the launcher, with explorer and no /select', async () => {
    const { shell, direct, launched } = subject(true);
    const { folder } = tree();
    await shell.openFolder(folder);
    expect(direct).toEqual([]);
    expect(launched).toHaveLength(1);
    expect(launched[0].file.toLowerCase()).toContain('explorer.exe');
    expect(launched[0].args).toEqual([folder]);
  });

  it('opens with the default program through the launcher, with rundll32 ShellExec_RunDLL', async () => {
    const { shell, direct, launched } = subject(true);
    const { file } = tree();
    await shell.openWithDefaultProgram(file);
    expect(direct).toEqual([]);
    expect(launched).toHaveLength(1);
    expect(launched[0].file.toLowerCase()).toContain('rundll32.exe');
    expect(launched[0].args).toEqual(['shell32.dll,ShellExec_RunDLL', file]);
  });

  it('still refuses a folder and a missing path BEFORE reaching the launcher (SI1/SI2)', async () => {
    const { shell, direct, launched } = subject(true);
    const { folder } = tree();
    // *Round four (T259, platform-ports.md §7.2):* the refusals are resolved values now, not rejections.
    await expect(shell.openWithDefaultProgram(folder)).resolves.toEqual({
      ok: false,
      osReason: expect.stringMatching(/folder/i),
    });
    await expect(shell.openWithDefaultProgram(join(folder, 'gone.txt'))).resolves.toEqual({
      ok: false,
      osReason: expect.stringMatching(/exist/i),
    });
    expect(launched, 'de-elevation must not weaken the two refusals').toEqual([]);
    expect(direct).toEqual([]);
  });
});

/**
 * 045 T255 — **Open Program** (FR-170, S8; plan *Corrections after analysis*, fifth pass) is
 * `IShellIntegration.openWithDefaultProgram` on an EXECUTABLE, sent through `FileLinkResolver` like every
 * file action — so from an elevated host it goes out through the same de-elevating launcher (FR-038's
 * extension), never from the elevated process.
 */
describe('T255 — Open Program on an executable goes through openWithDefaultProgram and the launcher', () => {
  it('the resolver answers executable, and the open is handed to the launcher with rundll32', async () => {
    const { shell, direct, launched } = subject(true);
    const { file } = tree();
    const exe = join(dirname(file), 'tool.exe');
    writeFileSync(exe, 'MZ', 'utf8');
    const resolver = new FileLinkResolver({
      fs: new NodeFileSystem(async () => {}),
      pathForms: new WindowsPathForms(),
      executables: new WindowsExecutableExtensions(),
      projectRootFor: () => dirname(file),
      previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
      readPreviewSettings: () => ({
        updateDelayMs: 300,
        maxWaitMs: 1000,
        copyFormat: 'rich',
        syncScroll: true,
        providers: {},
      }),
    });
    resolver.setShell(shell);
    const request = { text: 'tool.exe', kind: 'detectedPath' as const, panelId: 'p1', originProjectId: 'proj' };

    const resolved = await resolver.resolve(request);
    expect(resolved).toMatchObject({ ok: true, link: { path: exe, executable: true } });

    await expect(resolver.openWithDefaultProgram(request)).resolves.toEqual({ ok: true });
    expect(direct, 'the elevated process must not run the program itself').toEqual([]);
    expect(launched).toHaveLength(1);
    expect(launched[0].file.toLowerCase()).toContain('rundll32.exe');
    expect(launched[0].args).toEqual(['shell32.dll,ShellExec_RunDLL', exe]);
  });
});

/**
 * The other half of FR-038, and it runs EVERYWHERE — because "the overwhelming majority of runs are
 * byte-for-byte unchanged" is a claim about the non-elevated path, which a non-elevated machine is
 * exactly the right place to check.
 */
describe('a NON-elevated host keeps today\u2019s behaviour verbatim', () => {
  it('reveals through Electron\u2019s shell, and launches nothing', async () => {
    const { shell, direct, launched } = subject(false);
    const { file } = tree();
    await shell.revealInFileManager(file);
    expect(direct).toEqual([{ op: 'reveal', path: file }]);
    expect(launched).toEqual([]);
  });

  it('opens a folder and a file through Electron\u2019s shell, and launches nothing', async () => {
    const { shell, direct, launched } = subject(false);
    const { file, folder } = tree();
    await shell.openFolder(folder);
    await shell.openWithDefaultProgram(file);
    expect(direct).toEqual([
      { op: 'open', path: folder },
      { op: 'open', path: file },
    ]);
    expect(launched).toEqual([]);
  });

  it('falls back to the shell when the host is elevated but the launcher is unavailable', async () => {
    // A de-elevation that cannot happen must not become a silent no-op: the action still has to
    // occur, and doing it directly is the honest failure. `node-pty-host.ts:99` takes the same
    // view for a terminal.
    const direct: { op: string; path: string }[] = [];
    const shell: ElectronShellLike = {
      showItemInFolder: (p) => direct.push({ op: 'reveal', path: p }),
      openPath: async (p) => {
        direct.push({ op: 'open', path: p });
        return '';
      },
      openExternal: async () => {},
    };
    const launcher: DeElevatingLauncher = { isAvailable: () => false, launch: () => {} };
    const integration = new ElectronShellIntegration(shell, undefined, {
      launcher,
      isElevated: () => true,
    });
    const { file } = tree();
    await integration.revealInFileManager(file);
    expect(direct).toEqual([{ op: 'reveal', path: file }]);
  });
});

whenReallyElevated('@admin — a REALLY elevated process reads its own elevation and routes away', () => {
  it('uses the REAL elevation probe, not a literal true, and still does not call the shell', async () => {
    // The one thing the injected cases above cannot prove: that the probe main actually wires —
    // `WindowsElevation().isElevated()` — reports this process elevated and drives the same route.
    // Without this, the routing only ever works because a test said `true`.
    const direct: { op: string; path: string }[] = [];
    const launched: Launched[] = [];
    const shell: ElectronShellLike = {
      showItemInFolder: (p) => direct.push({ op: 'reveal', path: p }),
      openPath: async (p) => {
        direct.push({ op: 'open', path: p });
        return '';
      },
      openExternal: async () => {},
    };
    const launcher: DeElevatingLauncher = {
      isAvailable: () => true,
      launch: (file, args) => void launched.push({ file, args: [...args] }),
    };
    const elevation = new WindowsElevation();
    expect(elevation.isElevated(), 'this case only runs on a really elevated process').toBe(true);
    const integration = new ElectronShellIntegration(shell, undefined, {
      launcher,
      isElevated: () => elevation.isElevated(),
    });
    const { file } = tree();
    await integration.revealInFileManager(file);
    expect(direct).toEqual([]);
    expect(launched).toHaveLength(1);
  });
});

describe('SI4 coverage note', () => {
  it('says out loud whether the elevated half actually ran', () => {
    // Printed on every run so the gap is reported rather than assumed — the same reason
    // `admin-reminder.reporter.ts` exists for the E2E lane.
    console.log(
      ELEVATED
        ? '[045 SI4] elevated run: the real-elevation case executed'
        : '[045 SI4] NOT elevated: the real-elevation case was skipped, not softened. The ROUTING cases ran.',
    );
    expect(typeof ELEVATED).toBe('boolean');
  });
});
