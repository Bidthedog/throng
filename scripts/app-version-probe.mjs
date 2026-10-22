// What version does an installed throng REPORT? (058 manual test MT-08.)
//
//   node scripts/app-version-probe.mjs <path to throng.exe>
//
// Launches that copy under Playwright with its own pipe and data, and asks the RUNNING app for
// `app.getVersion()` — the value its About dialog shows — and the title of its window. Prints one JSON
// line. A version read from a manifest on disk proves what was installed; this proves what runs.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const exe = process.argv[2];
if (!exe) {
  console.log(JSON.stringify({ ok: false, error: 'usage: app-version-probe.mjs <throng.exe>' }));
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'throng-version-'));
let app;
let result;
try {
  const { _electron: electron } = await import('@playwright/test');
  app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${dir}`],
    env: {
      ...process.env,
      THRONG_PIPE_NAME: `\\\\.\\pipe\\throng-version-${process.pid}`,
      THRONG_CONFIG_ROOT: join(dir, 'config'),
      THRONG_DATABASE_PATH: join(dir, 'throng.db'),
    },
    timeout: 45000,
  });
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  const window = await app.firstWindow({ timeout: 30000 });
  result = { ok: true, version, title: await window.title() };
} catch (error) {
  result = { ok: false, error: error instanceof Error ? error.message : String(error) };
} finally {
  if (app) await Promise.race([app.close().catch(() => {}), delay(10000)]);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a daemon may still hold it */
  }
}
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
