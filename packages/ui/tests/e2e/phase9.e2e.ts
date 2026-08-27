import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';

registerTempCleanup();
import type { ElectronApplication, Page } from '@playwright/test';
import { cleanupTemp, shutdownApp, DAEMON_READY_TIMEOUT_MS } from './harness.js';

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

interface Harness {
  daemon: ChildProcess;
  dataDir: string;
  pipeName: string;
}

function startDaemon(pipeName: string, dataDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [daemonEntry], {
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_DATABASE_PATH: join(dataDir, 'throng.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('daemon not ready')), DAEMON_READY_TIMEOUT_MS);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      if (c.includes('listening')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function stopDaemon(daemon: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    daemon.once('exit', () => resolve());
    daemon.kill();
    setTimeout(resolve, 3000);
  });
}

async function startHarness(): Promise<Harness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-p9-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-p9-${process.pid}-${Date.now()}`;
  const daemon = await startDaemon(pipeName, dataDir);
  return { daemon, dataDir, pipeName };
}

function launchApp(pipeName: string, userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      THRONG_PIPE_NAME: pipeName,
      THRONG_CONFIG_ROOT: tmpDir('throng-cfg-'),
      THRONG_TEST_SHELL_HISTORY: 'off',
    },
  });
}

async function createProject(win: Page, name: string): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill(name);
  await win.getByTestId('project-root-input').fill(`C:/code/${name}`);
  await win.getByTestId('project-save').click();
  await expect(win.locator('.project-item', { hasText: name })).toBeVisible();
}


async function run(fn: (win: Page, app: ElectronApplication, h: Harness) => Promise<void>): Promise<void> {
  const h = await startHarness();
  const userData = tmpDir('throng-ud-');
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName, userData);
    const win = await app.firstWindow();
    await fn(win, app, h);
  } finally {
    if (app) await shutdownApp(app);
    await stopDaemon(h.daemon);
    cleanupTemp(h.dataDir);
  }
}

/*
 * ── ONE REMOVED (035 T055) ──
 *
 * `:90` "confirms before deleting a project (FR-042)" → `packages/ui/tests/component/
 * projects-panel-form.test.ts`, which drives the same double confirmation — summary, then the wry
 * second — over the real `ConfirmProvider` and a fake daemon that really does unregister the
 * project.
 *
 * This file's `run()` starts its OWN daemon and its own data directory, so the launch it was paying
 * for is among the most expensive in the suite, and what it bought was: the dialog appears, Cancel
 * keeps the row, Accept twice empties the list. All three are renderer decisions.
 *
 * What the component test cannot say is that the daemon really unregisters the project and really
 * leaves its folder alone; `removal-verbs.e2e.ts` keeps that.
 */
test('shows the panel count on a Tab and confirms tab close (FR-045/043)', { tag: ['@extended', '@window'] }, async () => {
  await run(async (win) => {
    await createProject(win, 'Counter');
    // One panel → a pill reading 1. The square-bracket form went with FR-042 (031 US5).
    await expect(win.locator('.tab-chip__count').first()).toHaveText('1');

    const firstPanel = await win
      .locator('.panel-box')
      .first()
      .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
    await win.getByTestId(`panel-add-${firstPanel}`).click();
    // Commit the new panel's inline rename — but only once its input actually HAS focus
    // (017 FR-013a). A new panel opens in rename mode with an `autoFocus` input; pressing
    // Enter before that focus lands re-activates the add BUTTON, which silently adds a
    // panel nobody asked for and makes the count below [3]. Settling on the input being
    // focused is the real condition the bare `press('Enter')` was assuming.
    const panelRename = win.locator('[data-testid^="panel-rename-input-"]');
    await expect(panelRename).toBeFocused();
    await win.keyboard.press('Enter');
    await expect(panelRename).toHaveCount(0);
    await expect(win.locator('.tab-chip__count').first()).toHaveText('2');

    // Add a 2nd tab so Close is enabled, then close the first with confirmation.
    await win.getByTestId('tab-add').click();
    const tabRename = win.locator('[data-testid^="tab-rename-input-"]');
    await expect(tabRename).toBeFocused(); // same race, same guard
    await win.keyboard.press('Enter');
    await expect(tabRename).toHaveCount(0);
    await expect(win.locator('.tab-chip')).toHaveCount(2);
    await win.locator('.tab-chip').first().click({ button: 'right' });
    await win.getByTestId('menu-item-Destroy Tab').click();
    // Both panels are EMPTY (no confirmed terminal), so none has a running subprocess
    // → "0 of which are active" (005 wired real running-subprocess detection; a panel
    // is "active" only while it hosts a live terminal, not merely by existing).
    await expect(win.getByTestId('confirm-message')).toContainText(/2 panels, 0 of which are active/i);
    await win.getByTestId('confirm-accept').click();
    await win.getByTestId('confirm-accept').click(); // wry second confirmation
    await expect(win.locator('.tab-chip')).toHaveCount(1);
  });
});

test('reorders projects by dragging the grip (FR-046)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await run(async (win) => {
    await createProject(win, 'Alpha');
    await createProject(win, 'Beta');
    await createProject(win, 'Gamma');

    const names = () => win.locator('.project-item__name').allInnerTexts();
    expect(await names()).toEqual(['Alpha', 'Beta', 'Gamma']);

    // Drag Gamma's grip to the top (above Alpha).
    const grip = win.locator('.project-item', { hasText: 'Gamma' }).locator('.project-item__grip');
    const target = win.locator('.project-item', { hasText: 'Alpha' });
    const gbox = await grip.boundingBox();
    const tbox = await target.boundingBox();
    if (!gbox || !tbox) throw new Error('boxes missing');
    await win.mouse.move(gbox.x + gbox.width / 2, gbox.y + gbox.height / 2);
    await win.mouse.down();
    await win.mouse.move(gbox.x + gbox.width / 2, gbox.y - 8, { steps: 3 });
    await win.mouse.move(tbox.x + tbox.width / 2, tbox.y + 3, { steps: 8 });
    await win.mouse.up();

    await expect(async () => {
      expect(await names()).toEqual(['Gamma', 'Alpha', 'Beta']);
    }).toPass({ timeout: 5000 });
  });
});

test('enforces a 600x560 minimum window size (FR-048)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  await run(async (_win, app) => {
    const min = await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getMinimumSize(),
    );
    // Floor: both side panes collapse to rails (32 each), so only the two rails +
    // the workspace minimum (480) must fit horizontally; the three left-pane panel
    // minimums fit above the status bar vertically.
    expect(min).toEqual([600, 560]);
  });
});

test('restores window size and position across restarts (FR-047)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const h = await startHarness();
  const userData = tmpDir('throng-ud-shared-');
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName, userData);
    await app.firstWindow();
    await app.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ x: 120, y: 90, width: 1100, height: 700 });
    });
    await app.close();
    app = undefined;

    // Relaunch with the SAME userData → geometry restored.
    app = await launchApp(h.pipeName, userData);
    await app.firstWindow();
    const bounds = await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    expect(bounds.width).toBe(1100);
    expect(bounds.height).toBe(700);
    expect(bounds.x).toBe(120);
    expect(bounds.y).toBe(90);
  } finally {
    if (app) await shutdownApp(app);
    await stopDaemon(h.daemon);
    cleanupTemp(h.dataDir);
  }
});
