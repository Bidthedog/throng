/**
 * ElectronShellIntegration — the UI-main concrete {@link IShellIntegration}
 * (004, T045, research D10). Uses Electron's built-in `shell` to reveal a file
 * (selected in its parent) or open a folder (showing its contents) (FR-035).
 * The shell calls are injected so this stays testable without the Electron
 * runtime; the OS detail stays behind the IShellIntegration abstraction.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { shouldDeElevate, type IShellIntegration } from '@throng/core';
import { WindowsDeElevatedLauncher, WindowsElevation } from '@throng/platform-windows';

/** The slice of Electron's `shell` this impl needs. */
export interface ElectronShellLike {
  showItemInFolder(fullPath: string): void;
  openPath(path: string): Promise<string>; // resolves '' on success, else an error message
  /** Opens `url` in the OS default handler (a browser, or the default mail client for `mailto:`). */
  openExternal(url: string): Promise<void>;
}

/** What is at a path, as far as `openWithDefaultProgram` needs to care (045 SI1/SI2). */
export type PathKind = 'file' | 'folder' | null;

/**
 * 045 FR-038 — the seam that starts a process at the interactive user's privilege from an elevated
 * host. `WindowsDeElevatedLauncher` satisfies it.
 *
 * **Not `IDeElevator`**, and that is a finding rather than an oversight (Open item O2). `IDeElevator`
 * offers `wrap(spec)`, which rewrites a launch spec for something ELSE to spawn — `NodePtyHost`
 * spawns the wrapped spec through node-pty. A reveal has no spawner on the other side, so a wrapped
 * spec would be built and dropped. It also has no concrete implementation anywhere in this
 * repository: the only value of that type is `passthroughDeElevator`, whose `isAvailable()` is
 * `false` by construction, so routing FR-038 through it would have left the requirement permanently
 * inert while looking implemented.
 */
export interface DeElevatingLauncher {
  isAvailable(): boolean;
  launch(file: string, args: string[], report?: (reason: string) => void): void;
}

/** 045 FR-038. Supplied by the composition root; absent means "never de-elevate". */
export interface DeElevationOptions {
  readonly launcher?: DeElevatingLauncher;
  /** Injected so the ROUTING is provable without a real high-integrity process. */
  readonly isElevated?: () => boolean;
}

async function statKindOnDisk(path: string): Promise<PathKind> {
  try {
    const info = await stat(path);
    return info.isDirectory() ? 'folder' : 'file';
  } catch {
    return null;
  }
}

function system32(exe: string): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', exe);
}

export class ElectronShellIntegration implements IShellIntegration {
  constructor(
    private readonly shell: ElectronShellLike,
    /**
     * 045 SI1/SI2. Injected so a test can drive the two refusals without staging a real tree; the
     * default is the real disk, so a caller that does not care gets the real check rather than none.
     */
    private readonly statKind: (path: string) => Promise<PathKind> = statKindOnDisk,
    private readonly deElevation: DeElevationOptions = {},
  ) {}

  async revealInFileManager(path: string): Promise<void> {
    // FR-035: a FILE is selected in its folder. `/select,<path>` is one argument, comma included —
    // that is explorer's own syntax and not a typo (see Open item O3 for the cases it strains).
    if (this.deElevate(system32('explorer.exe'), [`/select,${path}`])) return;
    this.shell.showItemInFolder(path);
  }

  async openFolder(path: string): Promise<void> {
    if (this.deElevate(system32('explorer.exe'), [path])) return;
    const error = await this.shell.openPath(path);
    if (error) throw new Error(error);
  }

  async openExternal(url: string): Promise<void> {
    // Deliberately NOT de-elevated. This opens a URL in the default browser, and 024's policy
    // already confines it to schemes that cannot name a local program; adding a de-elevated
    // `rundll32` route here would widen that surface for no requirement.
    await this.shell.openExternal(url);
  }

  /**
   * 045 FR-036 — open a FILE in the application the OS associates with it.
   *
   * The two refusals are the requirement, not defensive coding. A path that has gone between the
   * hover and the click must produce one notice naming it (SI1/SI3, FR-037), and a folder must be
   * refused rather than quietly opened in the file manager (SI2) — a link menu offers
   * `Open in OS Explorer` for that, and silently doing the neighbouring thing is how a user learns
   * not to trust either item.
   *
   * Both rejections carry the path AND a reason, because the notice that reports them names both.
   * They happen BEFORE the de-elevation decision, so de-elevating cannot weaken either.
   */
  async openWithDefaultProgram(path: string): Promise<void> {
    const kind = await this.statKind(path);
    if (kind === null) throw new Error(`${path} no longer exists`);
    if (kind === 'folder') {
      throw new Error(`${path} is a folder, and Open in OS Default Program opens a file`);
    }
    // FR-038. `rundll32 shell32.dll,ShellExec_RunDLL <path>` is the OS's own "open this the way a
    // double-click would" entry point, which is what `shell.openPath` does from inside the app —
    // except that this one runs as the interactive user rather than as the elevated host.
    if (this.deElevate(system32('rundll32.exe'), ['shell32.dll,ShellExec_RunDLL', path])) return;
    const error = await this.shell.openPath(path);
    if (error) throw new Error(`${path} could not be opened: ${error}`);
  }

  /**
   * FR-038's gate. `true` when the work was handed to the de-elevating launcher and the caller must
   * do nothing further.
   *
   * Three conditions, and the third is the one worth stating: when the host is elevated but the
   * launcher is NOT available, this returns `false` and the action proceeds through Electron's
   * shell. A de-elevation that cannot happen must not become a silent no-op — the user asked for
   * something to open, and refusing to open it at all would be a worse answer than opening it with
   * the privilege the app happens to hold. `node-pty-host.ts:99` takes the same view for a terminal.
   */
  private deElevate(file: string, args: string[]): boolean {
    const launcher = this.deElevation.launcher;
    if (launcher === undefined) return false;
    const elevated = (this.deElevation.isElevated ?? (() => false))();
    // `runAsAdmin` is false: no link action has ever been asked to run elevated, and none may be.
    if (!shouldDeElevate(false, elevated)) return false;
    if (!launcher.isAvailable()) return false;
    launcher.launch(file, args);
    return true;
  }
}

/** What a caller of {@link createAppShellIntegration} may replace — a test's seams, nothing more. */
export interface AppShellIntegrationOverrides extends DeElevationOptions {
  readonly statKind?: (path: string) => Promise<PathKind>;
}

/**
 * 045 FR-038 / D4 — the app's `ElectronShellIntegration`, as the composition builds it.
 *
 * The class de-elevates only when handed a launcher, and for a while the one production construction
 * handed it none: an elevated throng then revealed and opened files ELEVATED, while the @admin
 * integration test — which builds its own integration with a launcher injected — stayed green. This
 * is where the real launcher and the real probe are supplied, so "the app's integration" is one
 * function a test can call rather than a line in `main.ts` it can only read.
 *
 * Elevation cannot change during a process's life, so the probe is asked once, on first use, and
 * remembered — it is a token query, and there is no reason to repeat it per click.
 *
 * **Under the E2E harness there is no de-elevated launch.** The harness keeps real file-manager
 * windows off the desktop by stubbing Electron's `shell.showItemInFolder` / `shell.openPath` and
 * recording what reached them. A de-elevated launch goes around that stub and starts a real
 * `explorer.exe` — so on an elevated host (every GitHub runner is one) the recorder saw nothing and
 * a focus-stealing Explorer window appeared instead; gate run 35381378387 failed 4/4 on exactly that.
 * With the launcher unavailable, the class's own documented fallback routes through `shell`, as it
 * does for a non-elevated app. `THRONG_E2E_CLIPBOARD=memory` is the harness's marker, read here for
 * the same reason `composition-root.ts` reads it for the clipboard and the foreground handoff.
 */
export function createAppShellIntegration(
  shell: ElectronShellLike,
  overrides: AppShellIntegrationOverrides = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): ElectronShellIntegration {
  let elevated: boolean | undefined;
  const probe = overrides.isElevated ?? (() => new WindowsElevation().isElevated());
  const underHarness = env.THRONG_E2E_CLIPBOARD === 'memory';
  return new ElectronShellIntegration(shell, overrides.statKind ?? statKindOnDisk, {
    launcher: overrides.launcher ?? (underHarness ? NO_DE_ELEVATED_LAUNCH : new WindowsDeElevatedLauncher()),
    isElevated: () => (elevated ??= probe()),
  });
}

/** The harness's launcher: never available, so every action takes the (stubbed) Electron route. */
const NO_DE_ELEVATED_LAUNCH: DeElevatingLauncher = {
  isAvailable: () => false,
  launch: () => {
    throw new Error('no de-elevated launch under the E2E harness');
  },
};
