import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';

// Smoke E2E for the two-Pane docking shell (FR-008). The shell renders without a
// daemon (the project list simply loads empty), so these checks need no daemon;
// the daemon round-trip is exercised by projects.e2e.ts.
const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));

// Track every temp dir created so it is removed after each test (no %TEMP% leaks).
const tempDirs: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
test.afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  tempDirs.length = 0;
});

function launchApp(): Promise<ElectronApplication> {
  const userData = tmp('throng-ud-');
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, THRONG_CONFIG_ROOT: tmp('throng-cfg-') },
  });
}

test('opens the two-Pane shell within 5 seconds (NFR-002)', async () => {
  const start = Date.now();
  const app = await launchApp();
  try {
    const window = await app.firstWindow();
    await window.getByTestId('throng-shell').waitFor({ state: 'visible' });
    await expect(window.getByTestId('sidebar-pane')).toBeVisible();
    await expect(window.getByTestId('workspace-pane')).toBeVisible();
    await expect(window.getByTestId('projects-panel')).toBeVisible();
    await expect(window.locator('.sidebar-panel--subworkspaces')).toBeVisible();
    // Keep the strict 5s SLA on real hardware; a shared CI runner is slower even with
    // Electron pre-warmed in globalSetup, so allow generous headroom there (this still
    // catches a gross regression without being a cold-start canary).
    expect(Date.now() - start).toBeLessThan(process.env.CI ? 20_000 : 5000);
  } finally {
    await app.close();
  }
});

test('opens a resizable main window', async () => {
  const app = await launchApp();
  try {
    await app.firstWindow();
    const isResizable = await app.evaluate(async ({ BrowserWindow }) => {
      const [win] = BrowserWindow.getAllWindows();
      return win.isResizable();
    });
    expect(isResizable).toBe(true);
  } finally {
    await app.close();
  }
});

test('exposes only placeholder workspace content (no real product features)', async () => {
  const app = await launchApp();
  try {
    const window = await app.firstWindow();
    await window.getByTestId('throng-shell').waitFor({ state: 'visible' });
    // The sidebar hosts only Projects + Sub-workspaces (the Terminals panel was removed, FR-023).
    await expect(window.getByTestId('projects-panel')).toBeVisible();
    await expect(window.locator('.sidebar-panel--terminals')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('closes cleanly', async () => {
  const app = await launchApp();
  await app.firstWindow();
  await expect(app.close()).resolves.toBeUndefined();
});
