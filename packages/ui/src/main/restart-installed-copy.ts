import type { InstalledCopy } from '@throng/core';

/**
 * 063 FR-010 — the installed-version notice's Restart: start the installed copy, once this one has gone.
 *
 * ══ WHY NOT `app.relaunch` ON LINUX (#610) ══
 *
 * Electron's Linux relauncher starts the new process with Chromium's `LaunchProcess` default, which sets
 * `no_new_privs`, and the flag can never be cleared. Everything throng then starts carries it, and the
 * kernel ignores file capabilities and setuid bits for all of them: a snap browser's `snap-confine` refuses
 * to run, so every Ctrl+click was logged as opened and no browser appeared. Started from the desktop none
 * of this happens, which is why only a restart showed it.
 *
 * So Linux starts the launcher itself. It waits for this process to go because 058 FR-018 makes a second
 * launch hand over to the running instance and exit, which is the wait Electron's relauncher also does. A
 * zombie counts as gone: it holds no instance lock, and may never be reaped.
 */
export const WAIT_THEN_START = `while [ -d "/proc/$1" ] && ! grep -q '^State:.*Z' "/proc/$1/status" 2>/dev/null; do sleep 0.1; done; exec "$2"`;

/** The slice of a started process this needs. */
export interface StartedProcess {
  on(event: 'error', listener: (error: Error) => void): unknown;
  unref(): void;
}

export interface RestartDeps {
  readonly platform: NodeJS.Platform;
  readonly pid: number;
  relaunch(launcher: string): void;
  quit(): void;
  spawnDetached(file: string, args: readonly string[]): StartedProcess;
  log(line: string): void;
}

export function restartIntoInstalledCopy(copy: InstalledCopy, deps: RestartDeps): void {
  if (deps.platform === 'linux') {
    const started = deps.spawnDetached('/bin/sh', ['-c', WAIT_THEN_START, 'throng-restart', String(deps.pid), copy.launcher]);
    // A restart with the flag still beats no restart at all, and the failure is left in the log.
    started.on('error', (error) => {
      deps.log(`restart: could not start the installed copy's launcher, using Electron's relaunch: ${error.message}`);
      deps.relaunch(copy.launcher);
    });
    started.unref();
  } else {
    deps.relaunch(copy.launcher);
  }
  deps.quit();
}
