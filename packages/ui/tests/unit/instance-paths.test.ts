import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  DEV_CONFIG_DIR_NAME,
  DEV_DATA_DIR_NAME,
  hasUserDataDirSwitch,
  instanceConfigRoot,
  instanceDatabasePath,
  instancePipeName,
  instanceUserDataDir,
  PROD_CONFIG_DIR_NAME,
  PROD_DATA_DIR_NAME,
} from '../../src/main/instance-paths.js';

/**
 * Dev-instance isolation. An UNPACKAGED run (`npm start`) develops throng while a PACKAGED
 * throng is installed and in daily use on the same account. The two must share NOTHING
 * writable: not the config root, not the SQLite database, not Electron's userData, and — the
 * one that actually destroys work — not the daemon's named pipe, because a build-id mismatch
 * makes one instance retire the other's daemon and kill every terminal it owns.
 *
 * These are the pure path/name decisions; the composition roots wire them.
 */

const APPDATA = 'C:\\Users\\dev\\AppData\\Roaming';
const HOME = 'C:\\Users\\dev';
const BASE_PIPE = '\\\\.\\pipe\\throng.dev.deadbeef.daemon';

describe('instance paths: packaged (installed) defaults', () => {
  it('keeps the documented production locations', () => {
    expect(instanceUserDataDir(APPDATA, false)).toBe(`${APPDATA}\\${PROD_DATA_DIR_NAME}`);
    expect(instanceConfigRoot(HOME, false, {})).toBe(`${HOME}\\${PROD_CONFIG_DIR_NAME}`);
    expect(instancePipeName(BASE_PIPE, false)).toBe(BASE_PIPE);
  });
});

describe('instance paths: unpackaged (dev) defaults', () => {
  it('moves userData, the config root and the pipe aside', () => {
    expect(instanceUserDataDir(APPDATA, true)).toBe(`${APPDATA}\\${DEV_DATA_DIR_NAME}`);
    expect(instanceConfigRoot(HOME, true, {})).toBe(`${HOME}\\${DEV_CONFIG_DIR_NAME}`);
    expect(instancePipeName(BASE_PIPE, true)).toBe(`${BASE_PIPE}.dev`);
  });

  it('shares nothing with the packaged instance', () => {
    expect(instanceUserDataDir(APPDATA, true)).not.toBe(instanceUserDataDir(APPDATA, false));
    expect(instanceConfigRoot(HOME, true, {})).not.toBe(instanceConfigRoot(HOME, false, {}));
    expect(instancePipeName(BASE_PIPE, true)).not.toBe(instancePipeName(BASE_PIPE, false));
    expect(instanceDatabasePath(instanceUserDataDir(APPDATA, true), {})).not.toBe(
      instanceDatabasePath(instanceUserDataDir(APPDATA, false), {}),
    );
  });

  it('keeps the dev database beside the dev userData, mirroring production', () => {
    expect(instanceDatabasePath(instanceUserDataDir(APPDATA, true), {})).toBe(
      `${APPDATA}\\${DEV_DATA_DIR_NAME}\\throng.db`,
    );
    expect(instanceDatabasePath(instanceUserDataDir(APPDATA, false), {})).toBe(
      `${APPDATA}\\${PROD_DATA_DIR_NAME}\\throng.db`,
    );
  });
});

describe('instance paths: explicit overrides still win', () => {
  it('honours THRONG_CONFIG_ROOT in both modes (the E2E harness depends on it)', () => {
    const env = { THRONG_CONFIG_ROOT: 'C:\\tmp\\cfg' };
    expect(instanceConfigRoot(HOME, true, env)).toBe('C:\\tmp\\cfg');
    expect(instanceConfigRoot(HOME, false, env)).toBe('C:\\tmp\\cfg');
  });

  it('honours THRONG_DATABASE_PATH in both modes', () => {
    const env = { THRONG_DATABASE_PATH: 'C:\\tmp\\data\\throng.db' };
    expect(instanceDatabasePath(instanceUserDataDir(APPDATA, true), env)).toBe(
      'C:\\tmp\\data\\throng.db',
    );
    expect(instanceDatabasePath(instanceUserDataDir(APPDATA, false), env)).toBe(
      'C:\\tmp\\data\\throng.db',
    );
  });
});

describe('instance paths: an explicit --user-data-dir is left alone', () => {
  it('detects the switch in both spellings', () => {
    expect(hasUserDataDirSwitch(['electron', 'main.js', '--user-data-dir=C:\\tmp\\ud'])).toBe(true);
    expect(hasUserDataDirSwitch(['electron', 'main.js', '--user-data-dir', 'C:\\tmp\\ud'])).toBe(true);
  });

  it('does not fire on unrelated arguments', () => {
    expect(hasUserDataDirSwitch(['electron', 'main.js'])).toBe(false);
    expect(hasUserDataDirSwitch(['electron', '--user-data-dir-ish=x'])).toBe(false);
  });
});

/**
 * Ordering guard. Electron resolves `userData` — and the single-instance lock keyed to it —
 * the first time either is touched, so the dev redirection MUST happen before both. A future
 * edit that moves `app.setPath('userData', …)` below the lock would silently put the dev
 * instance back on the installed app's lock (and its window-state/recovery files).
 */
describe('main.ts wires the dev redirection early enough', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/main/main.ts', import.meta.url)),
    'utf8',
  );

  it("sets userData before acquiring the single-instance lock", () => {
    const setPath = source.indexOf("app.setPath('userData'");
    const lock = source.indexOf('acquireSingleInstance(');
    expect(setPath).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(-1);
    expect(setPath).toBeLessThan(lock);
  });

  it('gates the redirection on the app being unpackaged', () => {
    expect(source).toMatch(/isPackaged/);
  });
});
