import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';

registerTempCleanup();
import type { ElectronApplication, Page } from '@playwright/test';

// FR-027 (batch 2): dragging a Panel onto the New-Tab (+) button creates a new
// Tab containing ONLY that Panel (moved, not copied) and activates it.

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

async function startHarness(): Promise<{ daemon: ChildProcess; dataDir: string; pipeName: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-newtab-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-newtab-${process.pid}-${Date.now()}`;
  const daemon = await startDaemon(pipeName, dataDir);
  return { daemon, dataDir, pipeName };
}

function launchApp(pipeName: string): Promise<ElectronApplication> {
  const userData = tmpDir('throng-ud-');
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_CONFIG_ROOT: tmpDir('throng-cfg-') },
  });
}

async function createProjectAndOpen(win: Page): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill('NewTab');
  await win.getByTestId('project-root-input').fill('C:/code/newtab');
  await win.getByTestId('project-save').click();
  await expect(win.getByTestId('tab-strip')).toBeVisible();
  await expect(win.locator('.panel-box')).toHaveCount(1);
}

async function panelIds(win: Page): Promise<string[]> {
  return win.locator('.panel-box').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
  );
}

test('drag a Panel onto "+" → new active Tab containing only that Panel', async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    const win = await app.firstWindow();
    await createProjectAndOpen(win);

    // Split the tab into two Panels; commit the new Panel's rename.
    const first = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${first}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    await win.keyboard.press('Enter');
    await expect(win.locator('.tab-chip')).toHaveCount(1);

    const [a, b] = await panelIds(win);

    // Drag Panel B by its header onto the New-Tab (+) button.
    const handle = win.getByTestId(`panel-handle-${b}`);
    const box = await handle.boundingBox();
    if (!box) throw new Error('source handle has no box');
    const addBtn = win.getByTestId('tab-add');
    const add = await addBtn.boundingBox();
    if (!add) throw new Error('tab-add has no box');
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    // Exceed the @dnd-kit activation distance to start the drag.
    await win.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 3 });
    // Move onto the + button; it lights up as a drop target once we're over it.
    await win.mouse.move(add.x + add.width / 2, add.y + add.height / 2, { steps: 8 });
    await expect(addBtn).toHaveClass(/tab-strip__add--over/);
    await win.mouse.up();

    // A new Tab exists and is active, containing only Panel B.
    await expect(win.locator('.tab-chip')).toHaveCount(2);
    await expect(win.locator('.panel-box')).toHaveCount(1);
    expect((await panelIds(win))[0]).toBe(b);
    // The split is gone in the (now single-panel) active tab.
    await expect(win.getByTestId('split-node')).toHaveCount(0);

    // The source tab still holds Panel A (switch back to it). The tab-chip is a
    // @dnd-kit draggable, so its synthetic click can be swallowed as a zero-distance
    // tab drag on a loaded CI runner, leaving the new tab active. Re-fire the click
    // until the source tab actually reports active, then read its panel.
    const srcTab = win.locator('.tab-chip').first();
    await expect(async () => {
      await srcTab.click();
      await expect(srcTab).toHaveAttribute('data-active', 'true');
    }).toPass();
    await expect(win.locator('.panel-box')).toHaveCount(1);
    await expect.poll(async () => (await panelIds(win))[0]).toBe(a);
  } finally {
    if (app) await app.close();
    await stopDaemon(h.daemon);
    rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
