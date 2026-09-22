import 'reflect-metadata';
import { homedir } from 'node:os';
import { Container } from 'inversify';
import { app, clipboard as electronClipboard, ClipboardItem, shell } from 'electron';
import type {
  IClipboard,
  IConfigSettings,
  IConfigStore,
  IExecutableExtensions,
  IFileSystem,
  IFileWatcher,
  IFontEnumeration,
  IForegroundHandoff,
  IPathForms,
  IRefusedUriSchemes,
  IUiSettings,
  ShippedDefaults,
} from '@throng/core';
import { buildShippedDefaults, defaultPipeName, NoForegroundHandoff } from '@throng/core';
import {
  WindowsExecutableExtensions,
  WindowsFontEnumeration,
  NodeUserContext,
  WindowsForegroundHandoff,
  WindowsPathForms,
  WindowsRefusedUriSchemes,
  WindowsShellDetection,
} from '@throng/platform-windows';
import { NodeFileSystem } from './node-file-system.js';
import { restoreFromRecycleBin } from './recycle-bin-restore.js';
import { UI_TYPES } from './tokens.js';
import { ElectronClipboard } from './electron-clipboard.js';
import { MemoryClipboard } from './memory-clipboard.js';
import { ClipboardService } from './clipboard-service.js';
import { DaemonClient } from './daemon-client.js';
import { FileConfigStore } from './config-store.js';
import { ShippedDefaultsService } from './shipped-defaults-service.js';
import { NodeFileWatcher } from './node-file-watcher.js';
import { DEFAULT_CONFIG_WATCH_POLICY, type ConfigWatchPolicy } from './config-watcher.js';
import { numberFromEnv, readUiSettings } from './ui-settings.js';
import { instanceConfigRoot, instancePipeName } from './instance-paths.js';

export { UI_TYPES } from './tokens.js';

/**
 * Composition root #2 (Principle IX / [Gap B]): the UI main process's single
 * IoC container. Object graphs are composed here and nowhere else; the rest of
 * the UI code remains unaware of the container. The UI-settings reader lives in
 * `./ui-settings.ts` (pure, no OS imports) so its defaults/env overrides stay
 * unit-testable; environment access remains confined to this boundary.
 */

const DEFAULT_HOTRELOAD_DEBOUNCE_MS = 150;

/**
 * User-scoped config locations (003 / research D1). The config root defaults to
 * `%USERPROFILE%\.throng` — `%USERPROFILE%\.throng-dev` for an unpackaged run, so
 * developing throng never edits the installed app's settings, themes or icon packs —
 * and is overridable via `THRONG_CONFIG_ROOT` (e.g. a temp dir in tests). Environment
 * access stays in the composition root.
 */
function readConfigSettings(
  devMode: boolean,
  env: NodeJS.ProcessEnv = process.env,
): IConfigSettings {
  return {
    configRoot: instanceConfigRoot(homedir(), devMode, env),
    hotReloadDebounceMs: numberFromEnv(env.THRONG_HOTRELOAD_DEBOUNCE_MS, DEFAULT_HOTRELOAD_DEBOUNCE_MS),
  };
}

export function createUiContainer(): Container {
  const container = new Container({ defaultScope: 'Singleton' });
  // An unpackaged run is a DEV instance: its data lives beside — never inside — the installed
  // app's (see `instance-paths.ts`).
  const devMode = !app.isPackaged;
  // Per-user default pipe (020 FR-013): the endpoint is scoped to the current user so two
  // OS accounts on one machine never collide. The SID/username call sits behind the platform
  // abstraction (Principle II); `defaultPipeName` (core) is pure. `THRONG_PIPE_NAME` still overrides.
  //
  // A dev instance takes a suffixed endpoint so it can neither adopt nor RETIRE the installed
  // app's daemon — a build-id mismatch on a shared pipe would kill its terminals.
  const uiUserContext = new NodeUserContext();
  // The portable build takes its own endpoint too (#429): its daemon outlives the temp folder it
  // runs from, and must never be adopted by an installed throng.
  const uiDefaultPipe = instancePipeName(
    defaultPipeName(uiUserContext.currentUser().userId),
    devMode,
    process.env,
  );
  container
    .bind<IUiSettings>(UI_TYPES.UiSettings)
    .toConstantValue(readUiSettings(process.env, uiDefaultPipe));
  // The OS clipboard seam (016, FR-013a) — bound ONCE, here, at the boundary that owns Electron.
  //
  // Under E2E it is filled in-process instead, because Electron's clipboard DOES NOT WORK in the
  // Playwright-Electron harness: text written to it reads back empty and `availableFormats()` is
  // empty, so the app under test has no clipboard at all. The tests then prove the feature rather
  // than the OS, and two parallel workers stop fighting over the one global clipboard. The shipped
  // path is unchanged, and the real seam is covered by the clipboard CONTRACT suite.
  const clipboardSeam: IClipboard =
    process.env.THRONG_E2E_CLIPBOARD === 'memory'
      ? new MemoryClipboard()
      : new ElectronClipboard(electronClipboard, (payload) => new ClipboardItem(payload));
  container.bind<IClipboard>(UI_TYPES.Clipboard).toConstantValue(clipboardSeam);
  container
    .bind<ClipboardService>(UI_TYPES.ClipboardService)
    .toConstantValue(new ClipboardService(clipboardSeam));
  container.bind<DaemonClient>(UI_TYPES.DaemonClient).to(DaemonClient);
  /*
   * #199 — the foreground-handoff seam.
   *
   * Windows-only by nature: `AllowSetForegroundWindow` has no equivalent elsewhere, and every other
   * platform gets the no-op rather than a conditional at the call site (Principle II).
   *
   * OFF under E2E unless a spec asks for it. The grant lets ANY process take the foreground for a
   * moment, and a suite that runs several Electron windows would have them stealing focus from each
   * other — which is both a false negative for whatever the spec was testing and, since throng
   * closes menus on blur, a way to make an unrelated test flake. The spec that covers this feature
   * turns it on explicitly with `THRONG_E2E_FOREGROUND_HANDOFF`.
   *
   * `THRONG_E2E_CLIPBOARD` is the harness's marker for "this is a test run" — the same signal the
   * clipboard seam above reads, rather than a second env var meaning the same thing.
   */
  const underHarness = process.env.THRONG_E2E_CLIPBOARD === 'memory';
  const foregroundHandoff: IForegroundHandoff =
    underHarness && process.env.THRONG_E2E_FOREGROUND_HANDOFF !== '1'
      ? new NoForegroundHandoff()
      : new WindowsForegroundHandoff();
  container.bind<IForegroundHandoff>(UI_TYPES.ForegroundHandoff).toConstantValue(foregroundHandoff);

  const configSettings = readConfigSettings(devMode);
  container.bind<IConfigSettings>(UI_TYPES.ConfigSettings).toConstantValue(configSettings);
  const configStore = new FileConfigStore(configSettings.configRoot);
  container.bind<IConfigStore>(UI_TYPES.ConfigStore).toConstantValue(configStore);
  // 010: the authoritative shipped-defaults record (immutable/versioned, generated
  // from the core definitions) + the applier that seeds/upgrades/restores from it.
  const shippedDefaults = buildShippedDefaults();
  container.bind<ShippedDefaults>(UI_TYPES.ShippedDefaults).toConstantValue(shippedDefaults);
  container
    .bind<ShippedDefaultsService>(UI_TYPES.ShippedDefaultsService)
    .toConstantValue(new ShippedDefaultsService(configStore, shippedDefaults));
  container
    .bind<IFileWatcher>(UI_TYPES.FileWatcher)
    .toConstantValue(new NodeFileWatcher(configSettings.hotReloadDebounceMs));
  // 032 FR-008: the watcher's bounded re-read of an unreadable settings document. A tuning
  // constant, not an AppSettings key — no user and no machine has a reason to want a different
  // number, and a setting nobody should change is a setting somebody eventually will.
  container
    .bind<ConfigWatchPolicy>(UI_TYPES.ConfigWatchPolicy)
    .toConstantValue(DEFAULT_CONFIG_WATCH_POLICY);
  // 007: the installed-font enumeration OS seam (Windows impl for the first target).
  container
    .bind<IFontEnumeration>(UI_TYPES.FontEnumeration)
    .toConstantValue(new WindowsFontEnumeration());
  /*
   * 045 (#394) — the two new path/extension seams, on the #199 pattern.
   *
   * Both answer questions `@throng/core` refuses to hold an opinion about: how this platform spells
   * a drive form, a home folder and a `file:` URI, and which extensions it would EXECUTE. They are
   * bound at this boundary because main is the process that asks them — the renderer has no
   * filesystem and the daemon is not involved in a link at all.
   */
  //
  // FR-151: Git Bash's mount table needs Git's install root, which the shell detection already finds
  // (005 FR-024). Handed over as a function so that probe — a registry query at worst — runs on the
  // first rooted path a link asks about, not on the startup path.
  const gitDetection = new WindowsShellDetection();
  container
    .bind<IPathForms>(UI_TYPES.PathForms)
    .toConstantValue(new WindowsPathForms({ gitRoot: () => gitDetection.gitInstallRoot() }));
  container
    .bind<IExecutableExtensions>(UI_TYPES.ExecutableExtensions)
    .toConstantValue(new WindowsExecutableExtensions());
  // 045 FR-159 (round four): the schemes whose handlers on this platform no allowlist may reach.
  container
    .bind<IRefusedUriSchemes>(UI_TYPES.RefusedUriSchemes)
    .toConstantValue(new WindowsRefusedUriSchemes());
  /*
   * The filesystem, bound at last.
   *
   * `NodeFileSystem` has been built by hand in `main.ts` since 004, with no token — one of the
   * named items in 043's recorded Principle IX exception. 045 needs it in a second place
   * (`FileLinkResolver`), and the choice was between a second `new` and a binding. A second `new`
   * would mean two filesystems whose recycle-bin behaviour could drift apart, so it is a binding.
   *
   * Its two collaborators are why it was never bound before: both are Electron's or Windows's, and
   * this is the file that is allowed to know that. Recycle-bin RESTORE is Windows-only (PowerShell
   * `Shell.Application`); elsewhere the default rejecting implementation leaves delete-undo
   * unavailable and it degrades cleanly rather than throwing at startup (024 US3).
   */
  container
    .bind<IFileSystem>(UI_TYPES.FileSystem)
    .toConstantValue(
      new NodeFileSystem(
        (p) => shell.trashItem(p),
        process.platform === 'win32'
          ? (originalPath) => restoreFromRecycleBin(originalPath)
          : undefined,
      ),
    );
  return container;
}
