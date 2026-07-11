import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { runApp } from './harness.js';

// 011 US3 (FR-040/041/043): the new-project folder picker opens at the resolved
// starting folder, and falls back to the profile/home folder when unresolvable. We
// stub the OS dialog to CAPTURE the defaultPath it is opened with, then assert on it.

async function captureDialog(app: ElectronApplication, picked: string): Promise<void> {
  await app.evaluate(({ dialog }, pick) => {
    (globalThis as unknown as { __lastDefaultPath?: string }).__lastDefaultPath = undefined;
    // showOpenDialog may be called as (options) or (window, options).
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const opts = (args.length === 2 ? args[1] : args[0]) as { defaultPath?: string } | undefined;
      (globalThis as unknown as { __lastDefaultPath?: string }).__lastDefaultPath = opts?.defaultPath;
      return { canceled: false, filePaths: [pick] };
    }) as typeof dialog.showOpenDialog;
  }, picked);
}

const lastDefault = (app: ElectronApplication): Promise<string | undefined> =>
  app.evaluate(() => (globalThis as unknown as { __lastDefaultPath?: string }).__lastDefaultPath);

const appHome = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ app: a }) => a.getPath('home'));

function withSettings(newProject: Record<string, unknown>): { cfgRoot: string; env: Record<string, string> } {
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-npf-cfg-'));
  writeFileSync(join(cfgRoot, 'settings.json'), JSON.stringify({ version: 1, newProject }), 'utf8');
  return { cfgRoot, env: { THRONG_CONFIG_ROOT: cfgRoot } };
}

test('lastViewed opens the picker at the last chosen folder', async () => {
  const lastFolder = mkdtempSync(join(tmpdir(), 'throng-lastviewed-'));
  const { cfgRoot, env } = withSettings({ startingFolder: 'lastViewed', lastProjectFolder: lastFolder });
  try {
    await runApp(
      async (app, win) => {
        await captureDialog(app, lastFolder);
        await win.getByTestId('project-new').click();
        await expect(win.getByTestId('project-form')).toBeVisible();
        await expect.poll(() => lastDefault(app)).toBe(lastFolder);
      },
      { env },
    );
  } finally {
    rmSync(lastFolder, { recursive: true, force: true });
    rmSync(cfgRoot, { recursive: true, force: true });
  }
});

test('profile opens the picker at the home folder', async () => {
  const picked = mkdtempSync(join(tmpdir(), 'throng-profile-'));
  const { cfgRoot, env } = withSettings({ startingFolder: 'profile' });
  try {
    await runApp(
      async (app, win) => {
        await captureDialog(app, picked);
        const home = await appHome(app);
        await win.getByTestId('project-new').click();
        await expect(win.getByTestId('project-form')).toBeVisible();
        await expect.poll(() => lastDefault(app)).toBe(home);
      },
      { env },
    );
  } finally {
    rmSync(picked, { recursive: true, force: true });
    rmSync(cfgRoot, { recursive: true, force: true });
  }
});

test('an unresolvable override cascades to the last-viewed folder before home', async () => {
  const lastFolder = mkdtempSync(join(tmpdir(), 'throng-cascade-last-'));
  const picked = mkdtempSync(join(tmpdir(), 'throng-cascade-pick-'));
  const { cfgRoot, env } = withSettings({
    startingFolder: 'override',
    overridePath: 'D:/throng-does-not-exist-xyz-123',
    lastProjectFolder: lastFolder,
  });
  try {
    await runApp(
      async (app, win) => {
        await captureDialog(app, picked);
        await win.getByTestId('project-new').click();
        await expect(win.getByTestId('project-form')).toBeVisible();
        // Override is unresolvable → silently cascade to the (existing) last-viewed
        // folder rather than jumping straight to home.
        await expect.poll(() => lastDefault(app)).toBe(lastFolder);
      },
      { env },
    );
  } finally {
    rmSync(lastFolder, { recursive: true, force: true });
    rmSync(picked, { recursive: true, force: true });
    rmSync(cfgRoot, { recursive: true, force: true });
  }
});

test('an unresolvable override with no last-viewed folder falls back to home', async () => {
  const picked = mkdtempSync(join(tmpdir(), 'throng-ovr-'));
  const { cfgRoot, env } = withSettings({
    startingFolder: 'override',
    overridePath: 'D:/throng-does-not-exist-xyz-123',
  });
  try {
    await runApp(
      async (app, win) => {
        await captureDialog(app, picked);
        const home = await appHome(app);
        await win.getByTestId('project-new').click();
        await expect(win.getByTestId('project-form')).toBeVisible();
        await expect.poll(() => lastDefault(app)).toBe(home);
      },
      { env },
    );
  } finally {
    rmSync(picked, { recursive: true, force: true });
    rmSync(cfgRoot, { recursive: true, force: true });
  }
});
