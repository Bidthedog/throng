import 'reflect-metadata';
import { homedir } from 'node:os';
import { Container } from 'inversify';
import { app, clipboard as electronClipboard } from 'electron';
import type {
  IClipboard,
  IConfigSettings,
  IConfigStore,
  IFileWatcher,
  IFontEnumeration,
  IUiSettings,
  ShippedDefaults,
} from '@throng/core';
import { buildShippedDefaults, defaultPipeName } from '@throng/core';
import { WindowsFontEnumeration, NodeUserContext } from '@throng/platform-windows';
import { UI_TYPES } from './tokens.js';
import { ElectronClipboard } from './electron-clipboard.js';
import { MemoryClipboard } from './memory-clipboard.js';
import { ClipboardService } from './clipboard-service.js';
import { DaemonClient } from './daemon-client.js';
import { FileConfigStore } from './config-store.js';
import { ShippedDefaultsService } from './shipped-defaults-service.js';
import { NodeFileWatcher } from './node-file-watcher.js';
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
  const uiDefaultPipe = instancePipeName(defaultPipeName(uiUserContext.currentUser().userId), devMode);
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
      : new ElectronClipboard(electronClipboard);
  container.bind<IClipboard>(UI_TYPES.Clipboard).toConstantValue(clipboardSeam);
  container
    .bind<ClipboardService>(UI_TYPES.ClipboardService)
    .toConstantValue(new ClipboardService(clipboardSeam));
  container.bind<DaemonClient>(UI_TYPES.DaemonClient).to(DaemonClient);

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
  // 007: the installed-font enumeration OS seam (Windows impl for the first target).
  container
    .bind<IFontEnumeration>(UI_TYPES.FontEnumeration)
    .toConstantValue(new WindowsFontEnumeration());
  return container;
}
