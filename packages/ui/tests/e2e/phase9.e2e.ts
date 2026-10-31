import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';

registerTempCleanup();
import type { ElectronApplication } from '@playwright/test';
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
/*
 * MOVED DOWN (test-suite audit) — "shows the panel count on a Tab and confirms tab close (FR-045/043)".
 * The count pill is `component/tab-chip-attention.test.ts` ("a tab chip's panel-count pill"); the
 * "N panels, M of which are active" summary and the double confirmation are
 * `component/tab-strip.test.ts` ("says how many panels the tab holds…", "destroys it only after BOTH
 * dialogs"). The summary test was red-proven against a hard-coded 0.
 *
 * DELETED — "reorders projects by dragging the grip (FR-046)". Held by
 * `component/projects-panel-drag-categories.test.ts` ("a drop within the source category calls
 * reorderProjects", "a drag starting on the name moves the project") and the daemon's
 * `projects-ipc.integration` reorder test.
 *
 * MERGED — "enforces a 600x560 minimum window size (FR-048)" is the first assertion of the restore
 * test below: same launch, one fewer Electron + daemon pair.
 */

test('enforces a 600x560 minimum window size (FR-048) and restores window size and position across restarts (FR-047)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const h = await startHarness();
  const userData = tmpDir('throng-ud-shared-');
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(h.pipeName, userData);
    await app.firstWindow();
    // FR-048 — the floor: both side panes collapse to rails (32 each), so only the two rails + the
    // workspace minimum (480) must fit horizontally; the three left-pane panel minimums fit above the
    // status bar vertically.
    const min = await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getMinimumSize(),
    );
    expect(min).toEqual([600, 560]);
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
