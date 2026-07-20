import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';
import { skipIfElevated } from './admin.js';

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
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-ux-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-ux-${process.pid}-${Date.now()}`;
  const daemon = await startDaemon(pipeName, dataDir);
  return { daemon, dataDir, pipeName };
}

function launchApp(pipeName: string): Promise<ElectronApplication> {
  // Isolate Electron userData (and thus localStorage) per launch so renderer UI
  // state — e.g. persisted sidebar size — never leaks between tests.
  const userData = tmpDir('throng-ud-');
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_CONFIG_ROOT: tmpDir('throng-cfg-') },
  });
}

async function createProject(win: Page, name: string, root: string): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill(name);
  await win.getByTestId('project-root-input').fill(root);
  await win.getByTestId('project-save').click();
  await expect(win.locator('.project-item', { hasText: name })).toBeVisible();
}

async function panelIds(win: Page): Promise<string[]> {
  return win.locator('.panel-box').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
  );
}

async function run(fn: (app: ElectronApplication, win: Page, h: Harness) => Promise<void>): Promise<void> {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    const win = await app.firstWindow();
    await fn(app, win, h);
  } finally {
    if (app) await app.close();
    await stopDaemon(h.daemon);
    rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test('shows each project’s path under its name (FR-032)', async () => {
  await run(async (_app, win) => {
    await createProject(win, 'Pathy', 'C:/code/some/deep/path');
    await expect(win.getByTestId('project-path')).toContainText('C:/code/some/deep/path');
  });
});

test('uses a native folder picker for the project root (FR-034)', async () => {
  await run(async (app, win) => {
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: ['C:/picked/folder'] })) as never;
    });
    await win.getByTestId('project-new').click();
    await win.getByTestId('project-pick-folder').click();
    await expect(win.getByTestId('project-root-input')).toHaveValue('C:/picked/folder');
  });
});

test('renames and closes Tabs via the right-click menu (FR-036)', async () => {
  await run(async (_app, win) => {
    await createProject(win, 'TabsMenu', 'C:/c/tm');
    await win.getByTestId('tab-add').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);

    // Rename the first tab.
    await win.locator('.tab-chip').first().click({ button: 'right' });
    await expect(win.getByTestId('context-menu')).toBeVisible();
    await win.getByTestId('menu-item-Rename').click();
    const input = win.locator('[data-testid^="tab-rename-input-"]');
    await input.fill('Renamed Tab');
    await input.press('Enter');
    await expect(win.locator('.tab-chip', { hasText: 'Renamed Tab' })).toBeVisible();

    // Destroy other tabs → only the renamed one remains (double confirm).
    await win.locator('.tab-chip', { hasText: 'Renamed Tab' }).click({ button: 'right' });
    await win.getByTestId('menu-item-Destroy other tabs').click();
    await win.getByTestId('confirm-accept').click(); // summary…
    await win.getByTestId('confirm-accept').click(); // …then wry confirmation (FR-043)
    await expect(win.locator('.tab-chip')).toHaveCount(1);
  });
});

test('renames a Panel via the header right-click menu (FR-037)', async () => {
  await run(async (_app, win) => {
    await createProject(win, 'PanelMenu', 'C:/c/pm');
    const id = (await panelIds(win))[0];
    await win.getByTestId(`panel-handle-${id}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Rename').click();
    const input = win.getByTestId(`panel-rename-input-${id}`);
    await input.fill('Server Logs');
    await input.press('Enter');
    await expect(win.getByTestId(`panel-${id}`)).toContainText('Server Logs');
  });
});

test('resizes split cells by dragging a divider (FR-038)', async () => {
  await run(async (_app, win) => {
    await createProject(win, 'Resize', 'C:/c/rz');
    const first = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${first}`).click();
    await expect(win.locator('.split--row')).toHaveCount(1);

    const cell = win.locator('.split--row > .split__cell').first();
    const before = await cell.evaluate((el) => (el as HTMLElement).style.flexGrow);

    const divider = win.locator('[data-testid^="split-divider-"]').first();
    const box = await divider.boundingBox();
    if (!box) throw new Error('divider has no box');
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
    await win.mouse.up();

    const after = await cell.evaluate((el) => (el as HTMLElement).style.flexGrow);
    expect(after).not.toBe(before);
  });
});

test('renames a project, Tab, and Panel by double-clicking (FR-041)', async () => {
  await run(async (_app, win) => {
    await createProject(win, 'DblClick', 'C:/c/dc');

    // Project: double-click the entry → inline rename.
    await win.locator('[data-testid^="project-switch-"]').first().dblclick();
    const projInput = win.locator('[data-testid^="project-rename-input-"]');
    await projInput.fill('Renamed Project');
    await projInput.press('Enter');
    await expect(win.locator('.project-item', { hasText: 'Renamed Project' })).toBeVisible();

    // Tab: double-click the chip → inline rename.
    await win.locator('.tab-chip').first().dblclick();
    const tabInput = win.locator('[data-testid^="tab-rename-input-"]');
    await tabInput.fill('My Tab');
    await tabInput.press('Enter');
    await expect(win.locator('.tab-chip', { hasText: 'My Tab' })).toBeVisible();

    // Panel: double-click the header → inline rename.
    const id = (await panelIds(win))[0];
    await win.getByTestId(`panel-handle-${id}`).dblclick();
    const panelInput = win.getByTestId(`panel-rename-input-${id}`);
    await panelInput.fill('My Panel');
    await panelInput.press('Enter');
    await expect(win.getByTestId(`panel-${id}`)).toContainText('My Panel');
  });
});

test('resizes the sidebar horizontally by dragging its handle (FR-033)', async () => {
  await run(async (_app, win) => {
    await createProject(win, 'Sized', 'C:/c/sz');
    const shell = win.getByTestId('throng-shell');
    const before = await shell.evaluate((el) => (el as HTMLElement).style.gridTemplateColumns);

    const handle = win.getByTestId('sidebar-hresize');
    const box = await handle.boundingBox();
    if (!box) throw new Error('sidebar handle has no box');
    await win.mouse.move(box.x + box.width / 2, box.y + 100);
    await win.mouse.down();
    await win.mouse.move(box.x + 120, box.y + 100, { steps: 8 });
    await win.mouse.up();

    const after = await shell.evaluate((el) => (el as HTMLElement).style.gridTemplateColumns);
    expect(after).not.toBe(before);
  });
});

test('window title shows the active project + Tab · Panel, no path or totals (FR-040)', async () => {
  skipIfElevated(); // asserts no [ADMIN] marker; on an elevated runner the marker correctly appears
  await run(async (app, win) => {
    await createProject(win, 'TitleA', 'C:/c/a');
    await createProject(win, 'TitleB', 'C:/c/b'); // the newly created project becomes active
    const getTitle = (): Promise<string> =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());

    // Active project + its Tab · Panel context, nothing else (021 suffix form, FR-033).
    await expect.poll(getTitle, { timeout: 5000 }).toBe('TitleB · Tab 1 · Panel 1 — throng');
    const title = await getTitle();
    expect(title).not.toContain('C:/c/b'); // no path
    expect(title).not.toMatch(/\d+ (projects|tabs|panels)/); // no totals
    expect(title).not.toContain('[ADMIN]'); // not elevated
  });
});
