import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  copyExecPath,
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
import * as instancePaths from '../../src/main/instance-paths.js';
import { readUiSettings } from '../../src/main/ui-settings.js';

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

/**
 * 058 research D6 — the portable build joins the user's namespace. It used to take a pipe of its
 * own (#429's fix); that left a portable copy and an installed one running side by side with two
 * daemons, which FR-018 and FR-021 forbid. #429's orphan is now handled by `ensureDaemon`'s
 * deleted-entry check on any pipe (`daemon-deleted-entry.test.ts`).
 */
describe('instance paths: the portable build shares the user namespace (058 D6)', () => {
  // electron-builder's portable launcher sets this for the app it unpacks and starts.
  const PORTABLE_ENV = { PORTABLE_EXECUTABLE_DIR: 'C:\\Users\\dev\\Downloads' };

  it('resolves the same pipe as an installed launch — the pipe no longer reads the environment', () => {
    expect(instancePipeName(BASE_PIPE, false)).toBe(BASE_PIPE);
    // The suffix and the portable branch are gone, not merely unused.
    expect(Object.keys(instancePaths)).not.toContain('PORTABLE_PIPE_SUFFIX');
    expect(instancePipeName.length).toBe(2);
  });

  it('a dev run keeps .dev', () => {
    expect(instancePipeName(BASE_PIPE, true)).toBe(`${BASE_PIPE}.dev`);
  });

  it('THRONG_PIPE_NAME still wins over the resolved default, portable or not', () => {
    const env = { ...PORTABLE_ENV, THRONG_PIPE_NAME: '\\\\.\\pipe\\throng-e2e-1' };
    expect(readUiSettings(env, instancePipeName(BASE_PIPE, false)).pipeName).toBe('\\\\.\\pipe\\throng-e2e-1');
    expect(readUiSettings(env, instancePipeName(BASE_PIPE, true)).pipeName).toBe('\\\\.\\pipe\\throng-e2e-1');
  });
});

/**
 * Review A3 — which executable IS this copy (058 FR-018's "the copy that is running (its location)").
 *
 * The portable build runs from a temp folder its self-extractor creates per launch, so
 * `process.execPath` would name a different, throwaway folder every time: two launches of the same
 * portable exe would read as two different copies, and the notice would send the user to a path
 * that is deleted when throng exits. The extractor says where the real exe is.
 */
describe('copyExecPath: the executable that identifies this copy (058 review A3)', () => {
  const TEMP_EXE = 'C:\\Users\\dev\\AppData\\Local\\Temp\\2xYz\\throng.exe';

  it('is process.execPath for an installed or extracted copy', () => {
    expect(copyExecPath(TEMP_EXE, {})).toBe(TEMP_EXE);
  });

  it('is the portable exe itself when the self-extractor names it', () => {
    expect(
      copyExecPath(TEMP_EXE, {
        PORTABLE_EXECUTABLE_FILE: 'D:\\tools\\throng-portable.exe',
        PORTABLE_EXECUTABLE_DIR: 'D:\\tools',
      }),
    ).toBe('D:\\tools\\throng-portable.exe');
  });

  it('falls back to the portable folder when only that is named', () => {
    expect(copyExecPath(TEMP_EXE, { PORTABLE_EXECUTABLE_DIR: 'D:\\tools' })).toBe('D:\\tools\\throng.exe');
  });

  it('ignores empty values', () => {
    expect(copyExecPath(TEMP_EXE, { PORTABLE_EXECUTABLE_FILE: '', PORTABLE_EXECUTABLE_DIR: '' })).toBe(TEMP_EXE);
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

  it('sets userData before the instance guard, and the guard runs before app.whenReady (058 T028)', () => {
    const setPath = source.indexOf("app.setPath('userData'");
    // The guard takes Electron's lock (keyed to userData) on its primary path, so the dev
    // redirection must already have happened.
    const guard = source.indexOf('createInstanceGuard(');
    const ready = source.indexOf('app.whenReady().then(');
    expect(setPath).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(setPath).toBeLessThan(guard);
    expect(guard).toBeLessThan(ready);
    // The old bare lock is gone — it is what let `--user-data-dir` start a second instance.
    expect(source).not.toContain('acquireSingleInstance(');
  });

  it('resolves the namespace ONCE and hands that value to the container (058 review A4)', () => {
    // The lock and the daemon must be in the same namespace by construction, not by two calls that
    // happen to agree today. One resolution in main, one bound value in the container.
    expect(source.match(/uiDefaultPipeName\(/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/createUiContainer\(\s*instanceUiSettings\s*\)/);
    expect(source).toMatch(/instanceLockName\(\s*instanceUiSettings\.pipeName\s*\)/);
    const root = readFileSync(fileURLToPath(new URL('../../src/main/composition-root.ts', import.meta.url)), 'utf8');
    expect(root).not.toMatch(/readUiSettings\(/);
  });

  it('gates the redirection on the app being unpackaged', () => {
    expect(source).toMatch(/isPackaged/);
  });
});
