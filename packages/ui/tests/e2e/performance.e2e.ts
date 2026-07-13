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
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-perf-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-perf-${process.pid}-${Date.now()}`;
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
}

/**
 * Wait until the project is REALLY in the daemon's store (017 FR-013a, race class (c)).
 *
 * Replaces `await win.waitForTimeout(800)`. That sleep was doing nothing useful: it was
 * evidently meant to let the debounced workspace-layout save land before the app closed —
 * but a `workspace_layout` row is only written when the layout CHANGES, and this test never
 * changes it. (Proven: polling for that row here times out after 15s, every time. The
 * persistence specs, which DO mutate the layout, see the row appear immediately.)
 *
 * The condition this test actually depends on is the one asserted here: the PROJECT is on
 * disk, so the relaunch below has something to open. That write is a synchronous daemon RPC,
 * so this settles at once — no sleep, and no dependence on 800ms being "enough".
 *
 * NB: this means the relaunch restores a DEFAULT workspace, not a saved one — the spec's
 * name overstates what it measures. Flagged in e2e-audit.md rather than silently "fixed"
 * here, because seeding a real layout would change what the budget is measured against.
 */
async function expectProjectSaved(dataDir: string, projectName: string): Promise<void> {
  await expect
    .poll(
      () => {
        let db: InstanceType<typeof Database> | undefined;
        try {
          db = new Database(join(dataDir, 'throng.db'), { readonly: true });
          const row = db
            .prepare(`SELECT 1 AS ok FROM projects WHERE name = ?`)
            .get(projectName) as { ok?: number } | undefined;
          return row?.ok === 1;
        } catch {
          return false; // not written yet, or a transient read of a mid-write DB
        } finally {
          db?.close();
        }
      },
      { timeout: 15_000, message: `the project "${projectName}" was never persisted` },
    )
    .toBe(true);
}

test('restores a project workspace within the launch budget (NFR-002)', async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    // Seed a project so a real workspace must be loaded on next launch.
    app = await launchApp(h.pipeName);
    let win = await app.firstWindow();
    await createProject(win, 'Perf');
    await expect(win.getByTestId('tab-strip')).toBeVisible();
    await expectProjectSaved(h.dataDir, 'Perf');
    await app.close();

    // Measure cold-ish launch to a visible, restored workspace.
    const start = Date.now();
    app = await launchApp(h.pipeName);
    win = await app.firstWindow();
    // Lazy loading: open the project on demand, then its workspace restores.
    await win.locator('.project-item', { hasText: 'Perf' }).locator('[data-testid^="project-switch-"]').click();
    await win.getByTestId('tab-strip').waitFor({ state: 'visible' });
    await win.locator('.panel-box').first().waitFor({ state: 'visible' });
    expect(Date.now() - start).toBeLessThan(5000);
  } finally {
    if (app) await app.close();
    await stopDaemon(h.daemon);
    rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('shows drop-target feedback promptly once a Panel drag starts (NFR-001/SC-012)', async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    const win = await app.firstWindow();
    await createProject(win, 'Feedback');
    const firstId = await win
      .locator('.panel-box')
      .first()
      .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
    await win.getByTestId(`panel-add-${firstId}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    await win.keyboard.press('Enter'); // commit the new Panel's auto-rename

    const ids = await win
      .locator('.panel-box')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.panelId ?? ''));
    const [a, b] = ids;

    const handle = win.getByTestId(`panel-handle-${b}`);
    const box = await handle.boundingBox();
    if (!box) throw new Error('handle has no box');
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    // Pass the activation distance; edge drop-zones for the other panel must
    // appear quickly (NFR-001 target 100 ms; the bound absorbs polling overhead).
    await win.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 2 });
    await expect(win.getByTestId(`edge-right-${a}`)).toBeVisible({ timeout: 200 });
    await win.mouse.up();
  } finally {
    if (app) await app.close();
    await stopDaemon(h.daemon);
    rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
