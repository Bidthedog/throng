import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shellIntegrationModule from '../../src/main/electron-shell-integration.js';
import type { DeElevatingLauncher, ElectronShellLike, PathKind } from '../../src/main/electron-shell-integration.js';

/**
 * 045 T217 — D4: FR-038's de-elevation is not wired into the app (platform-ports.md §6.3, SI5).
 *
 * What the user meets today: run throng as administrator, Ctrl+click a link that reveals a file or
 * opens it in its default program, and Explorer (or that program) starts ELEVATED — inheriting the
 * app's administrator token — because `ElectronShellIntegration` de-elevates only when a launcher is
 * supplied, and the one production construction, `main.ts:934`, `new ElectronShellIntegration(shell)`,
 * supplies none. Nothing under `packages/ui/src` constructs a `WindowsDeElevatedLauncher` at all.
 *
 * `link-de-elevated-open.integration.test.ts` (@admin) passes throughout, because it builds its OWN
 * integration with a launcher injected. It proves the ROUTE; this file proves the WIRING — the app's
 * integration as the composition builds it, not as a test builds it. That file MUST NOT change.
 *
 * ══ TWO HALVES, BECAUSE THE SEAM DOES NOT EXIST YET ══
 *
 * 1. Structural, over `main.ts`'s source (the `links-no-os-names.test.ts` pattern): no construction of
 *    the app's integration without de-elevation options, and a `WindowsDeElevatedLauncher` built
 *    somewhere under `packages/ui/src`. This is what can fail TODAY without a seam.
 * 2. Behavioural, over the factory T218 extracts (data-model §15.4: "the shape of any factory T218
 *    extracts … is T218's to choose"). This file names it `createAppShellIntegration`, exported beside
 *    the class, taking Electron's `shell` and optional overrides; with NO overrides it must supply the
 *    real `WindowsDeElevatedLauncher` and `() => new WindowsElevation().isElevated()`. Looked up by
 *    name so the structural half runs while the export is absent; if T218 chooses another name or
 *    home, it changes the lookup and nothing else.
 *
 * `@throng/platform-windows` is mocked so the default launcher and probe are observable and nothing
 * real is launched: an elevated probe with the real launcher would start Explorer.
 */

const platform = vi.hoisted(() => ({
  launches: [] as { file: string; args: string[] }[],
  elevated: true,
}));

vi.mock('@throng/platform-windows', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class WindowsDeElevatedLauncher {
    isAvailable(): boolean {
      return true;
    }
    launch(file: string, args: string[]): void {
      platform.launches.push({ file, args });
    }
  }
  class WindowsElevation {
    isElevated(): boolean {
      return platform.elevated;
    }
  }
  return { ...actual, WindowsDeElevatedLauncher, WindowsElevation };
});

const MAIN_DIR = fileURLToPath(new URL('../../src/main/', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));

/** Block and line comments removed, so a comment naming the defect is not mistaken for code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourcesUnder(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourcesUnder(full));
    else if (/\.(ts|tsx|cts|mts)$/.test(entry.name)) out.push({ file: full, text: code(readFileSync(full, 'utf8')) });
  }
  return out;
}

describe('T217 / D4 — structural: the app never builds its shell integration without de-elevation', () => {
  it('main.ts has no single-argument `new ElectronShellIntegration(shell)`', () => {
    const main = code(readFileSync(join(MAIN_DIR, 'main.ts'), 'utf8'));
    const bare = main.match(/new\s+ElectronShellIntegration\(\s*[\w.]+\s*\)/g) ?? [];
    expect(bare, 'FR-038: the composition must hand the integration a launcher and a probe').toEqual([]);
  });

  it('no file in packages/ui/src/main constructs one without options, the class\u2019s own file aside', () => {
    const offenders = sourcesUnder(MAIN_DIR)
      .filter((s) => !s.file.endsWith('electron-shell-integration.ts'))
      .filter((s) => /new\s+ElectronShellIntegration\(\s*[\w.]+\s*\)/.test(s.text))
      .map((s) => s.file.slice(SRC_DIR.length));
    expect(offenders).toEqual([]);
  });

  it('something under packages/ui/src constructs a WindowsDeElevatedLauncher', () => {
    const constructing = sourcesUnder(SRC_DIR)
      .filter((s) => /new\s+WindowsDeElevatedLauncher\(/.test(s.text))
      .map((s) => s.file.slice(SRC_DIR.length));
    expect(constructing.length, 'nothing supplies the launcher FR-038 routes through').toBeGreaterThan(0);
  });
});

type AppShellFactory = (
  shell: ElectronShellLike,
  overrides?: {
    readonly statKind?: (path: string) => Promise<PathKind>;
    readonly launcher?: DeElevatingLauncher;
    readonly isElevated?: () => boolean;
  },
  env?: Record<string, string | undefined>,
) => shellIntegrationModule.ElectronShellIntegration;

function factory(): AppShellFactory {
  const found = (shellIntegrationModule as Record<string, unknown>).createAppShellIntegration;
  expect(
    typeof found,
    'electron-shell-integration.ts exports createAppShellIntegration — the function the composition builds the app\u2019s integration with',
  ).toBe('function');
  return found as AppShellFactory;
}

function recordingShell(): ElectronShellLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    showItemInFolder: (p) => void calls.push(`showItemInFolder ${p}`),
    openPath: async (p) => {
      calls.push(`openPath ${p}`);
      return '';
    },
    openExternal: async (u) => void calls.push(`openExternal ${u}`),
  };
}

const FILE = 'C:\\Users\\dev\\notes\\a.txt';
const FOLDER = 'C:\\Users\\dev\\notes';

beforeEach(() => {
  platform.launches.length = 0;
  platform.elevated = true;
});

describe('T217 / SI5 — behavioural: the app\u2019s integration, as the composition builds it', () => {
  it('with NO overrides and an elevated host, all three actions go through the de-elevating launcher', async () => {
    const shell = recordingShell();
    const integration = factory()(shell, { statKind: async (p) => (p === FOLDER ? 'folder' : 'file') });

    await integration.revealInFileManager(FILE);
    await integration.openFolder(FOLDER);
    await integration.openWithDefaultProgram(FILE);

    expect(platform.launches.map((l) => l.file.toLowerCase().split('\\').pop())).toEqual([
      'explorer.exe',
      'explorer.exe',
      'rundll32.exe',
    ]);
    expect(shell.calls, 'never through Electron\u2019s shell while elevated').toEqual([]);
  });

  it('with a fake launcher and a probe answering elevated, nothing reaches shell.*', async () => {
    const shell = recordingShell();
    const launched: string[] = [];
    const integration = factory()(shell, {
      statKind: async () => 'file',
      launcher: { isAvailable: () => true, launch: (file) => void launched.push(file) },
      isElevated: () => true,
    });

    await integration.revealInFileManager(FILE);
    await integration.openFolder(FOLDER);
    await integration.openWithDefaultProgram(FILE);

    expect(launched).toHaveLength(3);
    expect(shell.calls).toEqual([]);
  });

  it('not elevated: the ordinary Electron route, and the launcher is not used', async () => {
    platform.elevated = false;
    const shell = recordingShell();
    const integration = factory()(shell, { statKind: async () => 'file' });

    await integration.revealInFileManager(FILE);

    expect(platform.launches).toEqual([]);
    expect(shell.calls).toEqual([`showItemInFolder ${FILE}`]);
  });
});

/**
 * Gate run 35381378387 — `terminal-link-once.e2e.ts:322` failed 4/4 on the hosted runner and passes
 * here, and the only difference that matters is that every GitHub runner is ELEVATED.
 *
 * The E2E harness keeps real file-manager windows off the desktop by stubbing Electron's
 * `shell.showItemInFolder` / `shell.openPath` and recording what reached them (`stubShellOpen`,
 * `__throngOpenedPaths`). Once T218 wired the de-elevating launcher in, an elevated app stopped
 * calling either: it started a real `explorer.exe` through the launcher instead, so the recorder
 * stayed `[]` and the spec timed out — and every elevated run that follows a file link or reveals
 * from the explorer put a real, focus-stealing Explorer window on the runner's desktop.
 *
 * So under the harness marker the app has no de-elevated launch, exactly as it has no OS clipboard
 * and no foreground handoff there (composition-root.ts). The class's own documented fallback then
 * applies — an unavailable launcher proceeds through Electron's shell — which is the seam the harness
 * stubs. FR-038's routing is still proved where it can be: by the cases above, and on a really
 * elevated host by `link-de-elevated-open.integration.test.ts`.
 */
describe('gate 35381378387 — under the E2E harness an elevated app opens through the stubbed shell', () => {
  const HARNESS = { THRONG_E2E_CLIPBOARD: 'memory' };

  it('elevated, under the harness marker: all three actions reach shell.*, and nothing is launched', async () => {
    const shell = recordingShell();
    const integration = factory()(shell, { statKind: async () => 'file' }, HARNESS);

    await integration.revealInFileManager(FILE);
    await integration.openFolder(FOLDER);
    await integration.openWithDefaultProgram(FILE);

    expect(platform.launches, 'a real explorer.exe / rundll32.exe was started under the harness').toEqual([]);
    expect(shell.calls).toEqual([`showItemInFolder ${FILE}`, `openPath ${FOLDER}`, `openPath ${FILE}`]);
  });

  it('ANTI-VACUITY: the same elevated host WITHOUT the marker still de-elevates', async () => {
    const shell = recordingShell();
    const integration = factory()(shell, { statKind: async () => 'file' }, {});

    await integration.revealInFileManager(FILE);

    expect(platform.launches).toHaveLength(1);
    expect(shell.calls).toEqual([]);
  });
});
