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
    env: {
      ...process.env,
      THRONG_PIPE_NAME: pipeName,
      THRONG_DATABASE_PATH: join(dataDir, 'throng.db'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('daemon did not become ready')), 10_000);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (chunk.includes('listening')) {
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
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-projects-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-projects-${process.pid}-${Date.now()}`;
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

async function createProject(win: Page, name: string, root: string, colour?: string): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill(name);
  await win.getByTestId('project-root-input').fill(root);
  if (colour) {
    // Drive the React-controlled colour input via the native value setter so
    // React's value tracker registers the change and fires onChange.
    await win.getByTestId('project-colour-input').evaluate((el, value) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, colour);
  }
  await win.getByTestId('project-save').click();
  await expect(win.locator('.project-item', { hasText: name })).toBeVisible();
}

const projectItem = (win: Page, name: string) => win.locator('.project-item', { hasText: name });

test('creates a project, makes it active, and opens its workspace', async () => {
  const harness = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(harness.pipeName);
    const win = await app.firstWindow();
    await expect(win.getByTestId('projects-empty')).toBeVisible();

    await createProject(win, 'Subnet Vault', 'C:/code/subnet');

    await expect(projectItem(win, 'Subnet Vault')).toHaveAttribute('data-active', 'true');
    // The active project's workspace (tab group) opens in the Workspace Pane.
    await expect(win.getByTestId('tab-strip')).toBeVisible();
    await expect(win.locator('.panel-box')).toHaveCount(1);
  } finally {
    if (app) await app.close();
    await stopDaemon(harness.daemon);
    rmSync(harness.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('switches the active project and swaps the workspace + accent', async () => {
  const harness = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(harness.pipeName);
    const win = await app.firstWindow();

    await createProject(win, 'Alpha', 'C:/code/alpha', '#ff0000');
    await createProject(win, 'Beta', 'C:/code/beta', '#00ff00');

    // Creating a project opens it: Beta (most recent) is active.
    await expect(projectItem(win, 'Beta')).toHaveAttribute('data-active', 'true');

    // Switching to Alpha swaps the Workspace Pane + the accent colour.
    await projectItem(win, 'Alpha').locator('[data-testid^="project-switch-"]').click();
    await expect(projectItem(win, 'Alpha')).toHaveAttribute('data-active', 'true');
    await expect(projectItem(win, 'Beta')).toHaveAttribute('data-active', 'false');
    await expect(win.getByTestId('workspace-pane')).toHaveAttribute('data-project', /.+/);
    await expect(win.getByTestId('tab-strip')).toBeVisible();

    const accent = await win.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    );
    expect(accent.toLowerCase()).toBe('#ff0000');
  } finally {
    if (app) await app.close();
    await stopDaemon(harness.daemon);
    rmSync(harness.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('edits and deletes a project, leaving a valid state', async () => {
  const harness = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(harness.pipeName);
    const win = await app.firstWindow();

    await createProject(win, 'Working Title', 'C:/code/wt');
    await projectItem(win, 'Working Title').locator('[data-testid^="project-edit-"]').click();
    await win.getByTestId('project-name-input').fill('Renamed Project');
    await win.getByTestId('project-save').click();
    await expect(projectItem(win, 'Renamed Project')).toBeVisible();

    await projectItem(win, 'Renamed Project').locator('[data-testid^="project-delete-"]').click();
    await win.getByTestId('confirm-accept').click(); // Destroy Project: summary…
    await win.getByTestId('confirm-accept').click(); // …then the wry confirmation (FR-024)
    await expect(win.getByTestId('projects-empty')).toBeVisible();
    await expect(win.getByTestId('workspace-no-project')).toBeVisible();
  } finally {
    if (app) await app.close();
    await stopDaemon(harness.daemon);
    rmSync(harness.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('restores the project list and active project after a restart', async () => {
  const harness = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    // Session 1: create two projects, leave Beta active.
    app = await launchApp(harness.pipeName);
    let win = await app.firstWindow();
    await createProject(win, 'Alpha', 'C:/code/alpha');
    await createProject(win, 'Beta', 'C:/code/beta');
    await projectItem(win, 'Beta').locator('[data-testid^="project-switch-"]').click();
    await expect(projectItem(win, 'Beta')).toHaveAttribute('data-active', 'true');
    await app.close();
    app = undefined;

    // Restart the daemon against the SAME database to prove SQLite durability.
    await stopDaemon(harness.daemon);
    harness.daemon = await startDaemon(harness.pipeName, harness.dataDir);

    // Session 2: relaunch the app; both projects + active Beta restored.
    app = await launchApp(harness.pipeName);
    win = await app.firstWindow();
    await expect(projectItem(win, 'Alpha')).toBeVisible();
    await expect(projectItem(win, 'Beta')).toBeVisible();
    // Lazy loading: nothing is opened at startup; open Beta on demand.
    await expect(win.getByTestId('workspace-no-project')).toBeVisible();
    await projectItem(win, 'Beta').locator('[data-testid^="project-switch-"]').click();
    await expect(projectItem(win, 'Beta')).toHaveAttribute('data-active', 'true');
  } finally {
    if (app) await app.close();
    await stopDaemon(harness.daemon);
    rmSync(harness.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
