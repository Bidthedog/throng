import { chmodSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron } from '@playwright/test';

/**
 * #610 — after the installed-version notice's Restart, Ctrl+click opened nothing on Linux.
 *
 * Layer: E2E. The defect is what a real Electron main process passes to the throng it starts: the flag
 * cannot be seen from any layer that stubs `app.relaunch` or the OS opener, and a stub is exactly what
 * hid it. The Restart handler runs here for real, in a real Electron whose executable sits in a package's
 * folder layout; the only stand-in is the launcher, which records instead of starting a second app.
 *
 * Why this flag is the link bug: a process with `no_new_privs` set hands it to everything it starts and
 * the kernel then ignores file capabilities. Ubuntu's default browser is a snap, and `snap-confine` needs
 * those capabilities, so `xdg-open` reaches it and it refuses: *"snap-confine is packaged without
 * necessary permissions and cannot continue"*. The link was logged as opened, a snap scope started, and
 * no browser appeared, on every surface, until throng was next started from the desktop.
 */
test.skip(process.platform !== 'linux', 'no_new_privs and the snap opener are Linux-only');

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const electronBinary = createRequire(import.meta.url)('electron') as unknown as string;
const RESTART_CHANNEL = 'throng:instance:restartInstalled';

const noNewPrivs = (status: string): string => /^NoNewPrivs:\s*(\d)/m.exec(status)?.[1] ?? 'unknown';
const ownFlag = (): string => noNewPrivs(readFileSync('/proc/self/status', 'utf8'));

/** Electron's own folder, hard-linked: a real copy is 250 MB, and the files are only ever read. */
function linkTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    const target = join(to, name);
    if (statSync(source).isDirectory()) linkTree(source, target);
    else linkSync(source, target);
  }
}

/** `<root>/throng-versions/<old>/throng-bin` and a `current` pointing at a newer folder, as a package lays them out. */
function packageLayout(root: string, recordTo: string): string {
  const versions = join(root, 'throng-versions');
  const running = join(versions, '9.9.8');
  linkTree(dirname(electronBinary), running);
  linkSync(join(running, 'electron'), join(running, 'throng-bin'));

  const newer = join(versions, '9.9.9');
  mkdirSync(join(newer, 'resources', 'app'), { recursive: true });
  writeFileSync(join(newer, 'resources', 'app', 'package.json'), JSON.stringify({ version: '9.9.9' }));
  const launcher = join(newer, 'throng');
  writeFileSync(launcher, `#!/bin/sh\ncat /proc/self/status > '${recordTo}'\n`);
  chmodSync(launcher, 0o755);
  symlinkSync('9.9.9', join(versions, 'current'));
  return join(running, 'throng-bin');
}

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern for the first argument
test('what the Restart action starts can still start a browser installed as a snap', { tag: ['@linux', '@extended', '@window', '@reserve:process'] }, async ({}, info) => {
  // A runner already under the flag passes it to everything, so the result would say nothing about throng.
  test.skip(ownFlag() !== '0', 'this test process already runs under no_new_privs');

  const root = info.outputPath('package');
  const record = info.outputPath('restarted-status');
  const executablePath = packageLayout(root, record);

  const app = await electron.launch({
    executablePath,
    // The AppArmor profile that lets Electron's sandbox start names node_modules' copy, not this one, so
    // this copy runs unsandboxed. The relauncher under test belongs to the main process, which never was.
    chromiumSandbox: false,
    args: [mainEntry, `--user-data-dir=${info.outputPath('user-data')}`],
    env: {
      ...(process.env as Record<string, string>),
      THRONG_TEST_SHELL_HISTORY: 'off',
      THRONG_CONFIG_ROOT: info.outputPath('config'),
      THRONG_PIPE_NAME: `throng-e2e-restart-${process.pid}-${Date.now()}`,
      THRONG_E2E_CLIPBOARD: 'memory',
      THRONG_NO_ORPHAN_REAP: '1',
    },
  });

  // The channel the notice's Restart button sends. The handler reads the layout above, so this is the real route.
  await app.evaluate(({ ipcMain }, channel) => {
    ipcMain.emit(channel, {});
  }, RESTART_CHANNEL);

  await expect.poll(() => existsSync(record), { timeout: 20_000 }).toBe(true);
  await app.close().catch(() => {});

  expect(
    noNewPrivs(readFileSync(record, 'utf8')),
    'NoNewPrivs of the process Restart started (1: its children cannot gain the capabilities snap-confine needs, so no browser opens)',
  ).toBe('0');
});
