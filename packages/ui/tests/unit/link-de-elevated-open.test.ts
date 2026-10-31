import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import { WindowsExecutableExtensions, WindowsPathForms } from '@throng/platform-windows';
import { FileLinkResolver } from '../../src/main/file-link-resolver.js';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import {
  DE_ELEVATED_LAUNCH_REPORT_MS,
  ElectronShellIntegration,
  type ElectronShellLike,
  type DeElevatingLauncher,
} from '../../src/main/electron-shell-integration.js';

/**
 * 045 SI4 / FR-038 — **an elevated throng must not start an ordinary program elevated.**
 *
 * Principle III's de-elevation rule, extended to the two OS actions a file link can perform. The
 * risk it guards is concrete: a link printed by a NON-elevated terminal, followed from an elevated
 * throng, would otherwise launch whatever it named with administrator rights.
 *
 * The ROUTING is a unit-level fact, because `isElevated` and the launcher are INJECTED fakes: which
 * launcher received which spec, and that Electron's `shell` was not called, are observable on an
 * ordinary machine. Only `fs.stat` touches disk. A de-elevated action answers after
 * DE_ELEVATED_LAUNCH_REPORT_MS of silence, so `settle` advances a fake clock through that window
 * rather than waiting it out (the pattern `shell-integration-wiring.test.ts` uses for the same
 * constant).
 *
 * What genuinely needs a REAL elevated host — that `WindowsElevation().isElevated()` reports true and
 * drives this same route — stays in `integration/link-de-elevated-open.integration.test.ts`
 * (`@admin`); the de-elevated child itself is `windows-de-elevated-launcher.contract.test.ts` and the
 * `@admin` E2E.
 */

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* a temp tree left behind is not worth failing a passing assertion over */
    }
  }
});

async function settle<T>(action: Promise<T>): Promise<T> {
  let done = false;
  void action.finally(() => (done = true)).catch(() => {});
  while (!done) await vi.advanceTimersByTimeAsync(DE_ELEVATED_LAUNCH_REPORT_MS);
  return action;
}

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

describe('SI4 — with an elevated host, neither OS action is performed directly', () => {
  it('reveals a file through the launcher, with explorer /select', async () => {
    const { shell, direct, launched } = subject(true);
    const { file } = tree();
    await settle(shell.revealInFileManager(file));
    expect(direct, 'the elevated process must not call Electron’s shell itself').toEqual([]);
    expect(launched).toHaveLength(1);
    expect(launched[0].file.toLowerCase()).toContain('explorer.exe');
    expect(launched[0].args).toEqual([`/select,${file}`]);
  });

  it('opens a folder through the launcher, with explorer and no /select', async () => {
    const { shell, direct, launched } = subject(true);
    const { folder } = tree();
    await settle(shell.openFolder(folder));
    expect(direct).toEqual([]);
    expect(launched).toHaveLength(1);
    expect(launched[0].file.toLowerCase()).toContain('explorer.exe');
    expect(launched[0].args).toEqual([folder]);
  });

  it('opens with the default program through the launcher, with rundll32 ShellExec_RunDLL', async () => {
    const { shell, direct, launched } = subject(true);
    const { file } = tree();
    await settle(shell.openWithDefaultProgram(file));
    expect(direct).toEqual([]);
    expect(launched).toHaveLength(1);
    expect(launched[0].file.toLowerCase()).toContain('rundll32.exe');
    expect(launched[0].args).toEqual(['shell32.dll,ShellExec_RunDLL', file]);
  });

  it('still refuses a folder and a missing path BEFORE reaching the launcher (SI1/SI2)', async () => {
    const { shell, direct, launched } = subject(true);
    const { folder } = tree();
    // *Round four (T259, platform-ports.md §7.2):* the refusals are resolved values now, not rejections.
    await expect(settle(shell.openWithDefaultProgram(folder))).resolves.toEqual({
      ok: false,
      osReason: expect.stringMatching(/folder/i),
    });
    await expect(settle(shell.openWithDefaultProgram(join(folder, 'gone.txt')))).resolves.toEqual({
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
      // The fake clock jumps 2 s at a time: a real-length existence timeout would fire under it
      // while the real stat is still in flight.
      readLinkSettings: () => ({ ...DEFAULT_APP_SETTINGS.editor.links, existenceCheckTimeoutMs: 600_000 }),
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

    await expect(settle(resolver.openWithDefaultProgram(request))).resolves.toEqual({ ok: true });
    expect(direct, 'the elevated process must not run the program itself').toEqual([]);
    expect(launched).toHaveLength(1);
    expect(launched[0].file.toLowerCase()).toContain('rundll32.exe');
    expect(launched[0].args).toEqual(['shell32.dll,ShellExec_RunDLL', exe]);
  });
});

/**
 * The other half of FR-038: "the overwhelming majority of runs are byte-for-byte unchanged" is a
 * claim about the non-elevated path.
 */
describe('a NON-elevated host keeps today’s behaviour verbatim', () => {
  it('reveals through Electron’s shell, and launches nothing', async () => {
    const { shell, direct, launched } = subject(false);
    const { file } = tree();
    await shell.revealInFileManager(file);
    expect(direct).toEqual([{ op: 'reveal', path: file }]);
    expect(launched).toEqual([]);
  });

  it('opens a folder and a file through Electron’s shell, and launches nothing', async () => {
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
    await settle(integration.revealInFileManager(file));
    expect(direct).toEqual([{ op: 'reveal', path: file }]);
  });
});
