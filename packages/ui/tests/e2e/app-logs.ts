/**
 * The app's own logs, kept when an E2E app will not close or a test fails.
 *
 * The 15 s shutdown stall has now been seen three times on the Linux gate (2026-11-16 run 43980893270, release gate
 * 44049202192, run 44889368543). Each time the harness could say only that the main process took the whole grace to
 * exit after `app.close()`, never which step it was on, because `main.log` and `daemon.log` live in the app's
 * user-data folder (`<user-data>/logs`; main hands the daemon it spawns the same folder through `THRONG_LOG_DIR`), and
 * teardown deletes that folder. This reads them before it goes.
 *
 * Lives beside `process-tree.ts`, free of Playwright, so `e2e-app-logs.integration.test.ts` proves it on real files.
 */
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The folder holding the app's logs, inside its user-data folder (`LOG_DIR_NAME` in `main/diagnostics.ts`). */
const LOGS = 'logs';

/** The most of one log kept: its end, where a stall's last steps are. */
export const KEPT_LOG_BYTES = 512 * 1024;

/** The user-data folder Electron was launched with, from its arguments (`--user-data-dir=<dir>`). */
export function userDataDirOf(args: readonly string[]): string | undefined {
  const flag = '--user-data-dir=';
  const arg = args.find((a) => a.startsWith(flag));
  return arg === undefined ? undefined : arg.slice(flag.length);
}

function logFiles(userDataDir: string): string[] {
  const dir = join(userDataDir, LOGS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.log'))
    .sort();
}

/** The last `maxBytes` of a file, without reading the rest. */
function tailBytes(path: string, maxBytes: number): Buffer {
  const size = statSync(path).size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer;
}

/** The last `lines` lines of every log the app wrote, each under its name — for the console, where CI keeps it. */
export function appLogTails(userDataDir: string, lines = 40): string {
  const files = logFiles(userDataDir);
  if (files.length === 0) return `(no app logs in ${join(userDataDir, LOGS)})`;
  return files
    .map((name) => {
      const text = tailBytes(join(userDataDir, LOGS, name), 64 * 1024).toString('utf8');
      const tail = text.replace(/\n+$/, '').split('\n').slice(-lines).join('\n');
      return `--- ${name} (last ${lines} lines) ---\n${tail}`;
    })
    .join('\n');
}

/** Copy every log the app wrote into `dest`, each capped to its last `maxBytes`. Returns the names copied. */
export function keepAppLogs(userDataDir: string, dest: string, maxBytes = KEPT_LOG_BYTES): string[] {
  const files = logFiles(userDataDir);
  if (files.length === 0) return [];
  mkdirSync(dest, { recursive: true });
  for (const name of files) writeFileSync(join(dest, name), tailBytes(join(userDataDir, LOGS, name), maxBytes));
  return files;
}
