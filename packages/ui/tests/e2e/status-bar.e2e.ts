import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject,
  commitTabRename,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/**
 * The main-window status bar — FR-003/004 **as narrowed by 026 / #166**.
 *
 * This spec used to assert the bar showed the active project (dot + name) on the left and the active
 * `Tab · Panel` context beside it. All of that was a second copy of what the frameless title bar
 * already shows from the same source, so #166 removed it. What remains is the project's ROOT FOLDER
 * PATH — the one thing the title bar deliberately does not carry.
 *
 * The identity assertions did not disappear; they moved to where the identity now lives. See
 * `title-statusbar.e2e.ts` and `status-bar-deduped.e2e.ts`.
 */

const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 2 launches -> 1.
 *
 * Nothing is seeded before launch. One temp root, one project (`Bartholomew`), removed in
 * `afterAll` rather than per test — under one app a per-test cleanup deletes a folder the
 * application is still watching.
 *
 * ORDER IS LOAD-BEARING, and nothing enforces it. Test 1's whole claim is *"shows nothing but the
 * bar itself when NO PROJECT is active"* — a STARTUP condition, which only the first test in an app
 * can make. It must remain the first test declared. Do not add a project-creating test above it.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed option does not fail,
 * it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional — one window and one daemon, so a failure SKIPS the rest rather than
 * running them against what it left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

test('shows nothing but the bar itself when no project is active', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    await expect(win.getByTestId('status-bar')).toBeVisible();
    // No project → no path, and none of the removed identity content.
    await expect(win.getByTestId('status-project-path')).toHaveCount(0);
    await expect(win.getByTestId('status-project-dot')).toHaveCount(0);
    await expect(win.getByTestId('status-context')).toHaveCount(0);
    await expect(win.getByTestId('status-bar')).not.toContainText('No project');
  });
});

test('shows the active project’s root folder path, and only that', { tag: ['@extended', '@window'] }, async () => {
  const root = own(mkdtempSync(join(tmpdir(), 'throng-statusbar-')));
  await runApp(async (_app, win) => {
    await createProject(win, 'Bartholomew', root);

    await expect(win.getByTestId('status-project-path')).toHaveText(`(${root})`);
    await expect(win.getByTestId('status-project-dot')).toHaveCount(0);
    await expect(win.getByTestId('status-context')).toHaveCount(0);
    await expect(win.getByTestId('status-bar')).not.toContainText('Bartholomew');

    // Changing the active tab used to move the status bar's context label. It no longer has one —
    // and the bar must not start echoing the tab by some other route.
    await win.getByTestId('tab-add').click();
    await commitTabRename(win);
    const activeTabTitle = await win.locator('.tab-chip--active').evaluate((el) => {
      const count = el.querySelector('.tab-chip__count');
      return (el.textContent ?? '').replace(count?.textContent ?? '', '').trim();
    });
    await expect(win.getByTestId('status-bar')).not.toContainText(activeTabTitle);
    // …while the path is unaffected by the tab change.
    await expect(win.getByTestId('status-project-path')).toHaveText(`(${root})`);
  });
});
