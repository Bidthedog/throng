import 'reflect-metadata';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Container } from 'inversify';
import {
  app,
  BrowserWindow,
  clipboard as electronClipboard,
  ClipboardItem,
  nativeImage,
  Notification as ElectronNotification,
  shell,
} from 'electron';
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
  ISystemNotifier,
  ITaskbarBadge,
  IUiSettings,
  ShippedDefaults,
} from '@throng/core';
import {
  buildShippedDefaults,
  defaultPipeName,
  NoForegroundHandoff,
  NoSystemNotifier,
  NoTaskbarBadge,
} from '@throng/core';
import { NodeUserContext, selectPlatform } from '@throng/platform';
import { NodeFileSystem } from './node-file-system.js';
import { restoreFromRecycleBin } from './recycle-bin-restore.js';
import { UI_TYPES } from './tokens.js';
import { ElectronClipboard } from './electron-clipboard.js';
import { MemoryClipboard } from './memory-clipboard.js';
import { ClipboardService } from './clipboard-service.js';
import { ElectronSystemNotifier } from './electron-system-notifier.js';
import { ElectronTaskbarBadge, windowsWithTaskbarButton } from './electron-taskbar-badge.js';
import { isGhostWindow } from './ghost-window.js';
import { RecordingSystemNotifier, RecordingTaskbarBadge, type OsCall } from './recording-attention-os.js';
import { DaemonClient } from './daemon-client.js';
import { FileConfigStore } from './config-store.js';
import { ShippedDefaultsService } from './shipped-defaults-service.js';
import { NodeFileWatcher } from './node-file-watcher.js';
import { DEFAULT_CONFIG_WATCH_POLICY, type ConfigWatchPolicy } from './config-watcher.js';
import { numberFromEnv } from './ui-settings.js';
import { configRootFor, instancePipeName } from './instance-paths.js';

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
    configRoot: configRootFor(selectPlatform(process.platform).userDirectories(), devMode, env),
    hotReloadDebounceMs: numberFromEnv(env.THRONG_HOTRELOAD_DEBOUNCE_MS, DEFAULT_HOTRELOAD_DEBOUNCE_MS),
  };
}

/**
 * This instance's default daemon pipe — its NAMESPACE (058 contracts/instance-lock.md).
 *
 * Exported because `main.ts` resolves the UI settings from it BEFORE `app.whenReady()` — the
 * instance guard's lock is derived from the result — and hands that same value to
 * `createUiContainer`. `THRONG_PIPE_NAME` overrides it in `readUiSettings`.
 */
export function uiDefaultPipeName(devMode: boolean): string {
  // Per-user (020 FR-013): two OS accounts on one machine never collide. The SID/username call sits
  // behind the platform abstraction (Principle II); `defaultPipeName` (core) is pure. A dev instance
  // takes a suffixed endpoint so it can neither adopt nor RETIRE the installed app's daemon. Every
  // installed or extracted copy — portable included — shares the unsuffixed one (058 D6).
  return instancePipeName(defaultPipeName(new NodeUserContext().currentUser().userId), devMode);
}

/**
 * @param uiSettings resolved ONCE by `main.ts` (`readUiSettings` over `uiDefaultPipeName`), before
 *   `app.whenReady()`, because the instance guard's lock is derived from the same `pipeName`. Taking
 *   the value rather than resolving it again here is what keeps the lock and the daemon in one
 *   namespace by construction (058 review A4).
 */
export function createUiContainer(uiSettings: IUiSettings): Container {
  const container = new Container({ defaultScope: 'Singleton' });
  // main.ts has already started the platform: its host traits are set before the first module reads a path.
  const platform = selectPlatform(process.platform);
  // An unpackaged run is a DEV instance: its data lives beside — never inside — the installed
  // app's (see `instance-paths.ts`).
  const devMode = !app.isPackaged;
  container.bind<IUiSettings>(UI_TYPES.UiSettings).toConstantValue(uiSettings);
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
      : platform.foregroundHandoff();
  container.bind<IForegroundHandoff>(UI_TYPES.ForegroundHandoff).toConstantValue(foregroundHandoff);
  /*
   * 057 — the two OS seams attention marks reach the desktop through.
   *
   * Under E2E (`THRONG_E2E_ATTENTION_OS=record`) Electron's Notification and overlay icon cannot be
   * observed from Playwright, so recorders stand in and append each effective call to a JSONL log the
   * harness reads. The shipped path is the Electron adapters, and a spec that does not ask for the
   * recorder gets the no-ops, so a suite never raises real notifications on the developer's desktop.
   */
  const attentionOsLog =
    process.env.THRONG_E2E_ATTENTION_OS_LOG ?? join(app.getPath('userData'), 'attention-os.jsonl');
  const recordOsCall = (call: OsCall): void => {
    try {
      appendFileSync(attentionOsLog, `${JSON.stringify(call)}\n`);
    } catch {
      // A harness log that cannot be written must not break the app under test.
    }
  };
  let systemNotifier: ISystemNotifier;
  let taskbarBadge: ITaskbarBadge;
  if (process.env.THRONG_E2E_ATTENTION_OS === 'record') {
    systemNotifier = new RecordingSystemNotifier(recordOsCall);
    taskbarBadge = new RecordingTaskbarBadge(recordOsCall);
  } else if (underHarness) {
    systemNotifier = new NoSystemNotifier();
    taskbarBadge = new NoTaskbarBadge();
  } else {
    systemNotifier = new ElectronSystemNotifier((o) => new ElectronNotification(o));
    taskbarBadge = new NoTaskbarBadge();
  }
  if (!underHarness && process.env.THRONG_E2E_ATTENTION_OS !== 'record' && platform.hasTaskbarOverlay) {
    const electronBadge = new ElectronTaskbarBadge(
      () => windowsWithTaskbarButton(BrowserWindow.getAllWindows(), isGhostWindow),
      (dataUrl) => nativeImage.createFromDataURL(dataUrl),
    );
    taskbarBadge = electronBadge;
    // FR-039: a window that gets its taskbar button after the badge was set (a tear-off, a reopened
    // main window) shows the same count once it is on screen — an overlay set before then is lost.
    app.on('browser-window-created', (_event, win) => {
      win.once('show', () => {
        if (windowsWithTaskbarButton([win], isGhostWindow).length > 0) electronBadge.reapply(win);
      });
    });
  }
  container.bind<ISystemNotifier>(UI_TYPES.SystemNotifier).toConstantValue(systemNotifier);
  container.bind<ITaskbarBadge>(UI_TYPES.TaskbarBadge).toConstantValue(taskbarBadge);

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
    .toConstantValue(platform.fontEnumeration());
  /*
   * 045 (#394) — the two new path/extension seams, on the #199 pattern.
   *
   * Both answer questions `@throng/core` refuses to hold an opinion about: how this platform spells
   * a drive form, a home folder and a `file:` URI, and which extensions it would EXECUTE. They are
   * bound at this boundary because main is the process that asks them — the renderer has no
   * filesystem and the daemon is not involved in a link at all.
   */
  container.bind<IPathForms>(UI_TYPES.PathForms).toConstantValue(platform.pathForms());
  container
    .bind<IExecutableExtensions>(UI_TYPES.ExecutableExtensions)
    .toConstantValue(platform.executableExtensions());
  // 045 FR-159 (round four): the schemes whose handlers on this platform no allowlist may reach.
  container
    .bind<IRefusedUriSchemes>(UI_TYPES.RefusedUriSchemes)
    .toConstantValue(platform.refusedUriSchemes());
  /*
   * The filesystem, bound at last.
   *
   * `NodeFileSystem` has been built by hand in `main.ts` since 004, with no token — one of the
   * named items in 043's recorded Principle IX exception. 045 needs it in a second place
   * (`FileLinkResolver`), and the choice was between a second `new` and a binding. A second `new`
   * would mean two filesystems whose recycle-bin behaviour could drift apart, so it is a binding.
   *
   * Its two collaborators are why it was never bound before: one is Electron's and one the platform's.
   * RESTORE is per-platform (062 FR-024): PowerShell `Shell.Application` on Windows, the freedesktop
   * trash on Linux.
   */
  const trashRestore = platform.trashRestore((originalPath) => restoreFromRecycleBin(originalPath));
  container
    .bind<IFileSystem>(UI_TYPES.FileSystem)
    .toConstantValue(
      new NodeFileSystem(
        (p) => shell.trashItem(p),
        (originalPath, deletedAt) => trashRestore.restore(originalPath, deletedAt),
      ),
    );
  return container;
}
