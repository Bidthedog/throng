import { basename, join } from 'node:path';

/**
 * Dev-instance isolation: where THIS instance keeps its data.
 *
 * throng is developed on the same account that RUNS an installed throng, so an unpackaged
 * run (`npm start`) and the packaged app must share nothing writable. Four things are at
 * stake, and the last one is the destructive one:
 *
 *   - Electron `userData` — window-state.json, the editor recovery temps, fonts.json
 *   - the config root      — settings, keybindings, themes, icon packs
 *   - the SQLite database  — projects, layouts, per-document state
 *   - the daemon's PIPE    — an instance that finds a daemon on its pipe running a different
 *                            build RETIRES it (see `daemon-lifecycle.ensureDaemon`), which
 *                            kills every terminal that daemon owns. A shared pipe therefore
 *                            means a dev rebuild destroys the running app's terminals.
 *
 * Pure by design (no `electron`, no OS calls): the boundaries pass in `devMode`
 * (`!app.isPackaged`), the base directories and the environment, so the decision itself stays
 * unit-testable. Explicit overrides — `THRONG_CONFIG_ROOT`, `THRONG_DATABASE_PATH`,
 * `THRONG_PIPE_NAME`, `--user-data-dir` — still win in BOTH modes; the E2E harness depends on
 * that, and so does `start:admin`.
 */

/** `%APPDATA%\throng` — the packaged app's userData + database directory. */
export const PROD_DATA_DIR_NAME = 'throng';
/** `%APPDATA%\throng-dev` — the same, for an unpackaged run. */
export const DEV_DATA_DIR_NAME = 'throng-dev';
/** `%USERPROFILE%\.throng` — the packaged app's config root. */
export const PROD_CONFIG_DIR_NAME = '.throng';
/** `%USERPROFILE%\.throng-dev` — the same, for an unpackaged run. */
export const DEV_CONFIG_DIR_NAME = '.throng-dev';
/** Appended to the per-user default pipe so a dev daemon never answers for the installed one. */
export const DEV_PIPE_SUFFIX = '.dev';

/** Electron's `userData` for this instance, under `appDataDir` (`%APPDATA%`). */
export function instanceUserDataDir(appDataDir: string, devMode: boolean): string {
  return join(appDataDir, devMode ? DEV_DATA_DIR_NAME : PROD_DATA_DIR_NAME);
}

/** The user-scoped config root for this instance, under `homeDir` (`%USERPROFILE%`). */
export function instanceConfigRoot(
  homeDir: string,
  devMode: boolean,
  env: NodeJS.ProcessEnv,
): string {
  return (
    env.THRONG_CONFIG_ROOT ?? join(homeDir, devMode ? DEV_CONFIG_DIR_NAME : PROD_CONFIG_DIR_NAME)
  );
}

/**
 * The daemon database for this instance — beside its userData, exactly as production has
 * always laid it out (`%APPDATA%\throng\throng.db`).
 */
export function instanceDatabasePath(userDataDir: string, env: NodeJS.ProcessEnv): string {
  return env.THRONG_DATABASE_PATH ?? join(userDataDir, 'throng.db');
}

/**
 * The default pipe for this instance — its NAMESPACE (058 contracts/instance-lock.md): the
 * per-user default for every installed or extracted copy, whatever its kind, and that plus
 * `.dev` for an unpackaged run. `THRONG_PIPE_NAME` overrides it in `readUiSettings`.
 *
 * The portable build no longer takes a pipe of its own (058 research D6). It did for #429 — its
 * daemon outlived the temp folder the launcher deletes, and an installed launch adopted the
 * orphan — but `ensureDaemon` now retires a daemon whose entry is gone on any pipe, and a
 * separate pipe let a portable and an installed copy run side by side (058 FR-018, FR-021).
 */
export function instancePipeName(basePipeName: string, devMode: boolean): string {
  return devMode ? `${basePipeName}${DEV_PIPE_SUFFIX}` : basePipeName;
}

/**
 * The executable that identifies THIS COPY — its install root and the path a launch message
 * carries (058 FR-018, contracts/instance-lock.md).
 *
 * `process.execPath` for every copy but one. The portable build runs from a temp folder its
 * self-extractor creates per launch and deletes on exit, so its `execPath` names a different,
 * throwaway folder every time; the extractor sets `PORTABLE_EXECUTABLE_FILE` (the portable exe) and
 * `PORTABLE_EXECUTABLE_DIR` (its folder), and those are where the user's copy actually is.
 */
export function copyExecPath(execPath: string, env: NodeJS.ProcessEnv): string {
  if (env.PORTABLE_EXECUTABLE_FILE) return env.PORTABLE_EXECUTABLE_FILE;
  if (env.PORTABLE_EXECUTABLE_DIR) return join(env.PORTABLE_EXECUTABLE_DIR, basename(execPath));
  return execPath;
}

/**
 * True when the launch supplied its own `--user-data-dir` (either spelling). Electron has
 * already honoured it, so the dev redirection must stand aside — this is how the E2E harness
 * gives every spec its own throwaway userData.
 */
export function hasUserDataDirSwitch(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === '--user-data-dir' || arg.startsWith('--user-data-dir='));
}
