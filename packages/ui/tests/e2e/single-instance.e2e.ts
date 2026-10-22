import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { cleanupTemp, mkdtempSync, openApp, tmpdir, type OpenApp } from './harness.js';

/**
 * 058 FR-018 — one running throng per user (contracts/instance-lock.md, research D5, D5a).
 *
 * What only a running application can show: that a SECOND REAL PROCESS, launched with a different
 * `--user-data-dir`, opens no window and exits while the first window comes forward — process and
 * window lifecycle across two Electron instances (@reserve:window). The lock's logic is pinned on real
 * pipes in integration/instance-guard.test.ts and the notice's rendering in
 * component/different-copy-notice.test.ts; this file proves main, the pipe, the relay and the
 * renderer are wired end to end.
 *
 * A different COPY cannot be built in a test, so the spec writes the launch message to
 * `<pipe>.instance` itself (no product seam) — the exact line a different copy's guard would send.
 *
 * One app for both declarations (serial): neither seeds state before launch.
 */
test.describe.configure({ mode: 'serial' });

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const productVersion = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../../package.json', import.meta.url)), 'utf8')) as {
    version: string;
  }
).version;

let h: OpenApp;
const scratch: string[] = [];
test.beforeAll(async () => {
  h = await openApp();
});
test.afterAll(async () => {
  await h?.close();
  for (const dir of scratch) cleanupTemp(dir);
});

/**
 * The main window's state, after minimising it when asked. Self-contained because `evaluate` ships
 * only the function's source into the app; the main window is the one whose URL names no other kind.
 */
function mainWindow(action: 'minimize' | 'state'): Promise<{ minimized: boolean; visible: boolean } | null> {
  return h.app.evaluate(({ BrowserWindow }, act) => {
    const w = BrowserWindow.getAllWindows().find((x) => !/[?&](sw|prefs|about)=/.test(x.webContents.getURL()));
    if (!w) return null;
    if (act === 'minimize') w.minimize();
    return { minimized: w.isMinimized(), visible: w.isVisible() };
  }, action);
}

/** The environment a launch in the shared app's namespace gets — no Claude Code variables. */
function namespaceEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (/^(CLAUDE|ANTHROPIC)/i.test(key)) delete env[key];
  delete env.ELECTRON_RUN_AS_NODE;
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  scratch.push(cfg);
  return { ...env, THRONG_PIPE_NAME: h.pipeName, THRONG_CONFIG_ROOT: cfg };
}

test('a second launch opens no window, exits, and brings the running window forward', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const exe = await h.app.evaluate(() => process.execPath);
  const windowsBefore = h.app.windows().length;
  await mainWindow('minimize');
  await expect.poll(async () => (await mainWindow('state'))?.minimized).toBe(true);

  // A DIFFERENT userData: before 058 this alone started a second, independent instance.
  const userData = mkdtempSync(join(tmpdir(), 'throng-ud-'));
  scratch.push(userData);
  const second = spawn(exe, [mainEntry, `--user-data-dir=${userData}`], { env: namespaceEnv(), stdio: 'ignore' });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error('the second launch did not exit within 20 s — it started a second instance'));
    }, 20_000);
    second.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  expect(exitCode).toBe(0);
  expect(h.app.windows()).toHaveLength(windowsBefore);
  // Brought forward: restored and shown. (Which window the OS lets hold the FOREGROUND is Windows'
  // focus-stealing policy, not throng's, so it is not asserted.)
  await expect.poll(() => mainWindow('state')).toEqual({ minimized: false, visible: true });
  // The same copy: no notice (FR-018 — "a launch of the same copy only brings the window forward").
  await expect(h.win.getByTestId('different-copy-notice')).toHaveCount(0);
});

test('a launch of a different copy shows the notice naming the running copy', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const runningRoot = dirname(await h.app.evaluate(() => process.execPath));
  const launchedExe = join(tmpdir(), 'another-throng-copy', 'throng.exe');

  await new Promise<void>((resolve, reject) => {
    const socket = connect(`${h.pipeName}.instance`);
    socket.once('error', reject);
    socket.once('close', () => resolve());
    socket.end(`${JSON.stringify({ execPath: launchedExe, version: '99.0.0' })}\n`);
  });

  const notice = h.win.getByTestId('different-copy-notice');
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText(
    `throng is already running from ${runningRoot} (version ${productVersion}). ` +
      `To open the copy at ${dirname(launchedExe)}, close this one first.`,
  );
});
