import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';

registerTempCleanup();
import type { ElectronApplication, Page } from '@playwright/test';

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

async function startHarness(): Promise<Harness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-dock-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-dock-${process.pid}-${Date.now()}`;
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
  await win.getByTestId('project-name-input').fill('Docking');
  await win.getByTestId('project-root-input').fill('C:/code/docking');
  await win.getByTestId('project-save').click();
  await expect(win.getByTestId('tab-strip')).toBeVisible();
  await expect(win.locator('.panel-box')).toHaveCount(1);
}

async function panelIds(win: Page): Promise<string[]> {
  return win.locator('.panel-box').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
  );
}

/** Drag a Panel by its header onto an edge drop-zone of a target Panel. */
async function dragPanelToEdge(win: Page, sourceId: string, targetId: string, edge: string): Promise<void> {
  const handle = win.getByTestId(`panel-handle-${sourceId}`);
  const box = await handle.boundingBox();
  if (!box) throw new Error('source handle has no box');
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  // Pass the @dnd-kit activation distance so the drag starts and edge zones render.
  await win.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 3 });
  const zone = win.getByTestId(`edge-${edge}-${targetId}`);
  await zone.waitFor({ state: 'visible' });
  const zbox = await zone.boundingBox();
  if (!zbox) throw new Error('edge zone has no box');
  await win.mouse.move(zbox.x + zbox.width / 2, zbox.y + zbox.height / 2, { steps: 6 });
  await win.mouse.up();
}

test('adds Tabs and Panels, never showing a typed Panel', async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    const win = await app.firstWindow();
    await createProjectAndOpen(win);

    // One tab to start; add another → two tab chips.
    await win.getByTestId('tab-add').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);

    // Add a Panel into the active tab → two panels, split node present.
    const firstPanel = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${firstPanel}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    await expect(win.getByTestId('split-node')).toBeVisible();

    // An untyped Panel shows the extensible type-selection form (005 / FR-001) —
    // its type is chosen via the Panel Type dropdown — not a live typed body.
    await expect(win.locator('.panel-box__body').first()).toContainText(/panel type/i);
    await expect(win.locator('[data-testid^="panel-terminal-"]')).toHaveCount(0);
  } finally {
    if (app) await app.close();
    await stopDaemon(h.daemon);
    rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('splits a Panel by dragging another onto its edge (no Panel lost)', async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    const win = await app.firstWindow();
    await createProjectAndOpen(win);

    const first = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${first}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    // A newly added Panel opens in rename mode; commit it before dragging.
    await win.keyboard.press('Enter');

    const [a, b] = await panelIds(win);
    // Drag B onto A's bottom edge → a column split forms; both panels survive.
    await dragPanelToEdge(win, b, a, 'bottom');
    await expect(win.locator('.split--column')).toHaveCount(1);
    await expect(win.locator('.panel-box')).toHaveCount(2);
  } finally {
    if (app) await app.close();
    await stopDaemon(h.daemon);
    rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('collapses a split when a Panel is closed and never empties the workspace', async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    const win = await app.firstWindow();
    await createProjectAndOpen(win);

    const first = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${first}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);

    // Close one → empty Panels destroy immediately (no terminal, no confirm) →
    // the split collapses back to a single Panel.
    const [a] = await panelIds(win);
    await win.getByTestId(`panel-close-${a}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(1);
    await expect(win.getByTestId('split-node')).toHaveCount(0);

    // Closing the last Panel is refused — removal is a no-op (the workspace never
    // empties), so the count stays at 1.
    const lastId = (await panelIds(win))[0];
    await win.getByTestId(`panel-close-${lastId}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(1);
  } finally {
    if (app) await app.close();
    await stopDaemon(h.daemon);
    rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('reorders Tabs by dragging', async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    const win = await app.firstWindow();
    await createProjectAndOpen(win);

    // Each new Tab opens in rename mode; commit the default title before
    // reordering (a Tab being renamed isn't draggable).
    await win.getByTestId('tab-add').click();
    await win.keyboard.press('Enter');
    await win.getByTestId('tab-add').click();
    await win.keyboard.press('Enter');
    await expect(win.locator('.tab-chip')).toHaveCount(3);

    const before = await win.locator('.tab-chip').allInnerTexts();
    // Drag the last tab onto the left half of the first → it lands before it.
    const last = win.locator('.tab-chip').last();
    const first = win.locator('.tab-chip').first();
    const lbox = await last.boundingBox();
    const fbox = await first.boundingBox();
    if (!lbox || !fbox) throw new Error('tab boxes missing');
    await win.mouse.move(lbox.x + lbox.width / 2, lbox.y + lbox.height / 2);
    await win.mouse.down();
    await win.mouse.move(lbox.x + lbox.width / 2 - 8, lbox.y + lbox.height / 2, { steps: 3 });
    await win.mouse.move(fbox.x + 4, fbox.y + fbox.height / 2, { steps: 8 });
    await win.mouse.up();

    const after = await win.locator('.tab-chip').allInnerTexts();
    expect(after).not.toEqual(before);
    expect(after[0]).toBe(before[before.length - 1]);
  } finally {
    if (app) await app.close();
    await stopDaemon(h.daemon);
    rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
