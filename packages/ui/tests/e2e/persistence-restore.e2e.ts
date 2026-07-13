import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
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

function dbPath(dataDir: string): string {
  return join(dataDir, 'throng.db');
}

function startDaemon(pipeName: string, dataDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [daemonEntry], {
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_DATABASE_PATH: dbPath(dataDir) },
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
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-persist-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-persist-${process.pid}-${Date.now()}`;
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

async function createProject(win: Page, name: string): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill(name);
  await win.getByTestId('project-root-input').fill(`C:/code/${name}`);
  await win.getByTestId('project-save').click();
  await expect(win.locator('.project-item', { hasText: name })).toBeVisible();
}

const projectItem = (win: Page, name: string) => win.locator('.project-item', { hasText: name });

async function panelIds(win: Page): Promise<string[]> {
  return win.locator('.panel-box').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
  );
}

/**
 * Wait until the project's layout has ACTUALLY been persisted to the daemon's store,
 * in the shape we expect (017 FR-013a, race class (c)).
 *
 * This replaces `await win.waitForTimeout(SAVE_WAIT)` — an unconditional 800ms sleep
 * standing in for "the debounced save (400ms) plus its IPC round-trip has landed". A
 * sleep *asserts that 800ms is always enough*; under six-worker contention it is not,
 * and the app was then closed mid-save — so the restart these tests are ABOUT restored a
 * layout that had never been written, and the failure surfaced far from its cause.
 *
 * The condition is real and observable: the row is in SQLite. So poll for it. This is
 * strictly stronger than the sleep — it fails with "layout was never persisted" instead
 * of silently proceeding with a stale store.
 */
async function expectLayoutSaved(
  dataDir: string,
  projectName: string,
  predicate: (layoutJson: string) => boolean,
): Promise<void> {
  await expect
    .poll(
      () => {
        let db: InstanceType<typeof Database> | undefined;
        try {
          db = new Database(dbPath(dataDir), { readonly: true });
          const row = db
            .prepare(
              `SELECT w.layout_json AS json
                 FROM workspace_layout w
                 JOIN projects p ON p.id = w.project_id
                WHERE p.name = ?`,
            )
            .get(projectName) as { json?: string } | undefined;
          return row?.json !== undefined && predicate(row.json);
        } catch {
          return false; // not written yet, or a transient read of a mid-write DB
        } finally {
          db?.close();
        }
      },
      { timeout: 15_000, message: `the layout for "${projectName}" was never persisted` },
    )
    .toBe(true);
}

/** Panels in a persisted layout, counted shape-agnostically from its JSON. */
const savedPanels = (json: string): number => (json.match(/"type":"panel"/g) ?? []).length;
/** Tabs in a persisted layout. */
const savedTabs = (json: string): number =>
  ((JSON.parse(json) as { tabs?: unknown[] }).tabs ?? []).length;

test('restores each project’s own layout after a restart (SC-006)', async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    let win = await app.firstWindow();

    // Alpha: created → opens. Give it two Tabs.
    await createProject(win, 'Alpha');
    await expect(projectItem(win, 'Alpha')).toHaveAttribute('data-active', 'true');
    await win.getByTestId('tab-add').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);
    await expectLayoutSaved(h.dataDir, 'Alpha', (json) => savedTabs(json) === 2);

    // Beta: created → opens with one Tab. Split it into two Panels.
    await createProject(win, 'Beta');
    await expect(projectItem(win, 'Beta')).toHaveAttribute('data-active', 'true');
    await expect(win.locator('.tab-chip')).toHaveCount(1);
    const first = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${first}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    await expectLayoutSaved(h.dataDir, 'Beta', (json) => savedPanels(json) === 2);

    await app.close();
    app = undefined;

    // Restart daemon against the same DB, relaunch the app.
    await stopDaemon(h.daemon);
    h.daemon = await startDaemon(h.pipeName, h.dataDir);
    app = await launchApp(h.pipeName);
    win = await app.firstWindow();

    // Lazy loading: nothing opens at startup, even though Beta was last active.
    await expect(win.getByTestId('workspace-no-project')).toBeVisible();

    // Open Beta → its two-Panel split is restored.
    await projectItem(win, 'Beta').locator('[data-testid^="project-switch-"]').click();
    await expect(win.locator('.panel-box')).toHaveCount(2);

    // Open Alpha → its two Tabs are restored, no contamination.
    await projectItem(win, 'Alpha').locator('[data-testid^="project-switch-"]').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);
    await expect(win.locator('.panel-box')).toHaveCount(1);
  } finally {
    if (app) await app.close();
    await stopDaemon(h.daemon);
    rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('falls back to the default workspace and notifies on a corrupt layout (SC-011)', async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    let win = await app.firstWindow();

    await createProject(win, 'Gamma');
    await win.getByTestId('tab-add').click();
    await expect(win.locator('.tab-chip')).toHaveCount(2);
    // Settle on the layout being REALLY saved before corrupting it: corrupting a row that
    // was never written would make this test pass for the wrong reason (there would be no
    // layout to fail to restore), which is exactly the false green FR-013 exists to stop.
    await expectLayoutSaved(h.dataDir, 'Gamma', (json) => savedTabs(json) === 2);

    await app.close();
    app = undefined;
    await stopDaemon(h.daemon);

    // Corrupt the saved layout document directly in the store.
    const db = new Database(dbPath(h.dataDir));
    db.prepare('UPDATE workspace_layout SET layout_json = ?').run('{ not json');
    db.close();

    h.daemon = await startDaemon(h.pipeName, h.dataDir);
    app = await launchApp(h.pipeName);
    win = await app.firstWindow();

    // Lazy: open Gamma to trigger loading its (now corrupt) layout.
    await projectItem(win, 'Gamma').locator('[data-testid^="project-switch-"]').click();

    // Default empty workspace (one Tab) + the "could not restore" notice.
    await expect(win.getByTestId('restore-notice')).toBeVisible();
    await expect(win.locator('.tab-chip')).toHaveCount(1);
    await expect(win.locator('.panel-box')).toHaveCount(1);
  } finally {
    if (app) await app.close();
    await stopDaemon(h.daemon);
    rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
