import 'reflect-metadata';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Container } from 'inversify';
import type { IConfigSettings, IConfigStore, IFileWatcher, IUiSettings } from '@throng/core';
import { UI_TYPES } from './tokens.js';
import { DaemonClient } from './daemon-client.js';
import { FileConfigStore } from './config-store.js';
import { NodeFileWatcher } from './node-file-watcher.js';

export { UI_TYPES } from './tokens.js';

/**
 * Composition root #2 (Principle IX / [Gap B]): the UI main process's single
 * IoC container. Object graphs are composed here and nowhere else; the rest of
 * the UI code remains unaware of the container.
 */

const DEFAULT_PIPE_NAME = '\\\\.\\pipe\\throng.daemon';
const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;
const DEFAULT_PING_TIMEOUT_MS = 2000;
const DEFAULT_HOTRELOAD_DEBOUNCE_MS = 150;

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reads UI settings from documented defaults, overridable via environment.
 * Environment access lives ONLY in the composition root (Principle X / [Gap C]);
 * the rest of the UI consumes the injected IUiSettings interface.
 */
function readUiSettings(env: NodeJS.ProcessEnv = process.env): IUiSettings {
  return {
    pipeName: env.THRONG_PIPE_NAME ?? DEFAULT_PIPE_NAME,
    window: {
      width: numberFromEnv(env.THRONG_WINDOW_WIDTH, DEFAULT_WINDOW_WIDTH),
      height: numberFromEnv(env.THRONG_WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT),
    },
    pingTimeoutMs: numberFromEnv(env.THRONG_PING_TIMEOUT_MS, DEFAULT_PING_TIMEOUT_MS),
  };
}

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
  container
    .bind<IConfigStore>(UI_TYPES.ConfigStore)
    .toConstantValue(new FileConfigStore(configSettings.configRoot));
  container
    .bind<IFileWatcher>(UI_TYPES.FileWatcher)
    .toConstantValue(new NodeFileWatcher(configSettings.hotReloadDebounceMs));
  return container;
}
