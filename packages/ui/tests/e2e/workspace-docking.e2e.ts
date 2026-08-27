import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';
import { cleanupTemp, commitPanelRename, commitTabRename, shutdownApp, DAEMON_READY_TIMEOUT_MS } from './harness.js';

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
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-dock-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-dock-${process.pid}-${Date.now()}`;
  const daemon = await startDaemon(pipeName, dataDir);
  return { daemon, dataDir, pipeName };
}

function launchApp(pipeName: string): Promise<ElectronApplication> {
  const userData = tmpDir('throng-ud-');
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

/*
 * TWO TESTS REMOVED (035) — now `packages/ui/tests/component/tab-strip.test.ts`.
 *
 * Each launched its OWN app — `startHarness`, `launchApp`, `shutdownApp`, `stopDaemon`, a temp data
 * directory — to count `.panel-box` elements and look for `split-node`. Neither seeded anything
 * before launch; the own-app was this file's convention rather than a requirement.
 *
 * FOUR ASSERTIONS THEY DID NOT MAKE:
 *
 *   - No split with ONE panel, asserted before the add — so the split appearing is a change rather
 *     than a state that was always there.
 *   - Both panels show the type-selection form, not just the first. The migrated test read
 *     `.panel-box__body` with `.first()`.
 *   - The panel that SURVIVES a close is the other one, not merely one of them. A count of 1 is
 *     satisfied by destroying the wrong panel.
 *   - Refusing to close the last panel asks NOTHING. The migrated test could not distinguish
 *     "refused" from "confirmed and then refused", and a dialog for an action that cannot happen is
 *     worse than no dialog.
 *
 * Red-proven three ways in core and the header: dropping the INV-3 collapse leaves a one-child
 * split, dropping `removePanel`'s FR-016 guard empties the workspace, and typing a newly added
 * panel as a terminal removes the selection form.
 *
 * What stays in this file drives a REAL DRAG (`@reserve:osdrag`) or reads a real layout.
 */

test('splits a Panel by dragging another onto its edge (no Panel lost)', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    const win = await app.firstWindow();
    await createProjectAndOpen(win);

    const first = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${first}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    // A newly added Panel opens in rename mode. Commit it before dragging — a panel with an open
    // rename input is not draggable, and a blind Enter here can fire before the input mounts.
    await commitPanelRename(win);

    const [a, b] = await panelIds(win);
    // Drag B onto A's bottom edge → a column split forms; both panels survive.
    await dragPanelToEdge(win, b, a, 'bottom');
    await expect(win.locator('.split--column')).toHaveCount(1);
    await expect(win.locator('.panel-box')).toHaveCount(2);
  } finally {
    if (app) await shutdownApp(app);
    await stopDaemon(h.daemon);
    cleanupTemp(h.dataDir);
  }
});


test('reorders Tabs by dragging', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  const h = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName);
    const win = await app.firstWindow();
    await createProjectAndOpen(win);

    // Each new Tab opens in rename mode; commit the default title before
    // reordering (a Tab being renamed isn't draggable).
    await win.getByTestId('tab-add').click();
    await commitTabRename(win);
    await win.getByTestId('tab-add').click();
    await commitTabRename(win);
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
    if (app) await shutdownApp(app);
    await stopDaemon(h.daemon);
    cleanupTemp(h.dataDir);
  }
});
