import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';
import { commitPanelRename, commitTabRename } from './harness.js';

registerTempCleanup();
import type { ElectronApplication, Page } from '@playwright/test';

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

function startDaemon(pipeName: string, dataDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [daemonEntry], {
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_DATABASE_PATH: join(dataDir, 'throng.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('daemon not ready')), 10_000);
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

function launchApp(pipeName: string): Promise<ElectronApplication> {
  const userData = tmpDir('throng-ud-');
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_CONFIG_ROOT: tmpDir('throng-cfg-') },
  });
}

async function run(fn: (app: ElectronApplication, win: Page) => Promise<void>): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-menu-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-menu-${process.pid}-${Date.now()}`;
  const daemon = await startDaemon(pipeName, dataDir);
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(pipeName);
    const win = await app.firstWindow();
    // Stub the native folder dialog so creating a project never opens a modal.
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await fn(app, win);
  } finally {
    if (app) await app.close();
    await stopDaemon(daemon);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function createProject(win: Page, name: string, root: string): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill(name);
  await win.getByTestId('project-root-input').fill(root);
  await win.getByTestId('project-save').click();
  await expect(win.getByTestId('tab-strip')).toBeVisible();
}

async function firstPanelId(win: Page): Promise<string> {
  return win
    .locator('.panel-box')
    .first()
    .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
}

test('only one context menu is open app-wide; right-clicking elsewhere replaces it', async () => {
  await run(async (_app, win) => {
    await createProject(win, 'Menus', 'C:/c/menus');

    // Open the panel menu.
    const panelId = await firstPanelId(win);
    await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
    await expect(win.getByTestId('context-menu')).toHaveCount(1);
    await expect(win.getByTestId('menu-item-Destroy Panel')).toBeVisible();

    // Right-click a tab → the panel menu is replaced; still exactly one menu.
    await win.locator('.tab-chip').first().click({ button: 'right' });
    await expect(win.getByTestId('context-menu')).toHaveCount(1);
    await expect(win.getByTestId('menu-item-Destroy Tab')).toBeVisible();
    await expect(win.getByTestId('menu-item-Destroy Panel')).toHaveCount(0);
  });
});

test('clicking outside the context menu closes it', async () => {
  await run(async (_app, win) => {
    await createProject(win, 'Close', 'C:/c/close');
    const panelId = await firstPanelId(win);
    await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
    await expect(win.getByTestId('context-menu')).toBeVisible();

    await win.getByTestId('tab-body').click({ position: { x: 5, y: 5 } });
    await expect(win.getByTestId('context-menu')).toHaveCount(0);
  });
});

test('"Send to Tab" submenu moves the panel to the chosen tab', async () => {
  await run(async (_app, win) => {
    await createProject(win, 'Send', 'C:/c/send');

    // Two panels in Tab 1 so moving one out doesn't prune the tab.
    const a = await firstPanelId(win);
    await win.getByTestId(`panel-add-${a}`).click();
    await commitPanelRename(win); // the new panel opens in rename mode
    await expect(win.locator('.panel-box')).toHaveCount(2);

    // A second tab to send into.
    await win.getByTestId('tab-add').click();
    await commitTabRename(win);
    await expect(win.locator('.tab-chip')).toHaveCount(2);
    await win.locator('.tab-chip').first().click(); // back to Tab 1

    // Send panel A to "Tab 2" via the submenu.
    await win.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Send to Tab').click(); // click opens the flyout
    await win.getByTestId('menu-item-Tab 2').click();

    // Tab 1 now has one panel; switching to Tab 2 shows the moved panel A.
    await expect(win.locator('.panel-box')).toHaveCount(1);
    await win.locator('.tab-chip').nth(1).click();
    await expect(win.getByTestId(`panel-${a}`)).toBeVisible();
  });
});
