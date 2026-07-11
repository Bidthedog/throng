import 'reflect-metadata';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Container } from 'inversify';
import type {
  IConfigSettings,
  IConfigStore,
  IFileWatcher,
  IFontEnumeration,
  IUiSettings,
  ShippedDefaults,
} from '@throng/core';
import { buildShippedDefaults } from '@throng/core';
import { WindowsFontEnumeration } from '@throng/platform-windows';
import { UI_TYPES } from './tokens.js';
import { DaemonClient } from './daemon-client.js';
import { FileConfigStore } from './config-store.js';
import { ShippedDefaultsService } from './shipped-defaults-service.js';
import { NodeFileWatcher } from './node-file-watcher.js';
import { numberFromEnv, readUiSettings } from './ui-settings.js';

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
 * `%USERPROFILE%\.throng` and is overridable via `THRONG_CONFIG_ROOT` (e.g. a
 * temp dir in tests) — environment access stays in the composition root.
 */
function readConfigSettings(env: NodeJS.ProcessEnv = process.env): IConfigSettings {
  return {
    configRoot: env.THRONG_CONFIG_ROOT ?? join(homedir(), '.throng'),
    hotReloadDebounceMs: numberFromEnv(env.THRONG_HOTRELOAD_DEBOUNCE_MS, DEFAULT_HOTRELOAD_DEBOUNCE_MS),
  };
}

export function createUiContainer(): Container {
  const container = new Container({ defaultScope: 'Singleton' });
  container.bind<IUiSettings>(UI_TYPES.UiSettings).toConstantValue(readUiSettings());
  container.bind<DaemonClient>(UI_TYPES.DaemonClient).to(DaemonClient);

  const configSettings = readConfigSettings();
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
