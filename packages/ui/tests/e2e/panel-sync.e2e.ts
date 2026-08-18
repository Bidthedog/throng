import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, createProject, firstPanelId, commitPanelRename, cleanupTemp, type OpenApp } from './harness.js';

// FR-027a (batch 2, revised 2026-07-02): a cloned Panel (same id in the project +
// its sub-workspaces) syncs its CONTENT across windows — the type-selection form
// draft (selected type + inputs) and the confirmed type mirror live (the terminal
// session already mirrors via FR-021). The active/selected Panel is deliberately
// NOT mirrored: sub-workspace focus is independent of the main window's selection.

/*
 * ══ ONE APP FOR THE FILE (034 FR-045) — 3 launches → 1 ══
 *
 * Three tests, three `runApp()` calls, three Electron launches and three daemons. Nothing seeds
 * state before the app starts, each test makes its own project under its own root, and every
 * locator in tests 1 and 2 is scoped to a panel id or to the child window it just opened.
 *
 * THE ONE BLOCKER was an ORDINAL in test 3:
 *
 *     await win.getByTestId('menu-item-Sub-workspace 1').click();
 *
 * `Sub-workspace 1` is not a name test 3 chose — it is the auto-name the FIRST sub-workspace in
 * the store happens to carry (`nextSubWorkspaceName`, packages/core/src/workspace/sub-workspace.ts:
 * highest existing index + 1). Under `runApp` that is necessarily the one test 3 just made, because
 * the app is brand new. Under one app, tests 1 and 2 have each left a sub-workspace behind — this
 * file never deletes them — so `Sub-workspace 1` is TEST 1's, panel `b` would be mirrored into the
 * wrong window, and the assertion that follows would wait out its budget against a window that
 * never received it, blaming the drag/selection machinery for a menu click.
 *
 * THE FIX. Test 3 now reads the name of the sub-workspace it created — the row the sidebar gained,
 * found by id delta, read from `subworkspace-name-<id>` — and clicks the menu entry with THAT
 * label. It targets the thing it made rather than counting to it, so it is right whether it is the
 * first sub-workspace in the list or the thirtieth. No assertion changed; only how the test reaches
 * its own subject.
 *
 * `menu-item-Sub-workspace Tab 1` is left exactly as it was, and that is deliberate rather than an
 * oversight: Tab names are generated PER SUB-WORKSPACE (`nextSubWorkspaceTabName` scans that
 * sub-workspace's own tabs), so a freshly created sub-workspace's only tab is always
 * `Sub-workspace Tab 1`. It is a name, not a position.
 *
 * Each test now also closes the sub-workspace window it opened, in a `finally`. Hygiene, not a
 * fix: under `runApp` each left one open and its own teardown collected it; one shared app would
 * otherwise carry three into a single `shutdownApp`, every one of them holding a live clone of a
 * panel in a project that is no longer active. The sub-workspace RECORDS survive, which is why the
 * ordinal had to go regardless.
 *
 * Deliberately NOT `mode: 'serial'`. Three separate claims about FR-027a — the form draft, the
 * confirmed type, and selection NOT mirroring — and a first failure that skipped the rest would
 * collapse three answers into one. `fullyParallel: false` already keeps a file to one worker in
 * declaration order, so the shared window is never driven by two tests at once, and test 3 derives
 * its target at run time rather than assuming what came before it.
 */
let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

/** The ids currently listed in the sidebar's Sub-workspaces panel. */
async function subWorkspaceIds(win: Page): Promise<string[]> {
  await expect(win.getByTestId('subworkspaces-panel')).toBeVisible();
  return win
    .locator('[data-testid^="subworkspace-item-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('subworkspace-item-', '')),
    );
}

test('the type-selection form syncs live across the project and sub-workspace windows', { tag: ['@extended', '@window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  await createProject(win, 'FormSync', 'C:/c/formsync');
  const a = await firstPanelId(win);

  // Clone the untyped Panel into a new sub-workspace window.
  await win.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Sync to').click();
  const [child] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('menu-item-New Sub-workspace').click(),
  ]);
  await child.waitForLoadState('domcontentloaded');
  try {
    await expect(child.getByTestId(`panel-type-form-${a}`)).toBeVisible();

    // Select "terminal" in the MAIN window → the child's form mirrors it.
    await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
    await expect(child.getByTestId(`panel-type-select-${a}`)).toHaveValue('terminal');
    await expect(child.getByTestId('terminal-inputs')).toBeVisible();

    // Edit Shell Arguments in the CHILD → the main window reflects it…
    await child.getByTestId('terminal-shell-arguments').fill('--login --sync');
    await expect(win.getByTestId('terminal-shell-arguments')).toHaveValue('--login --sync');
    // …and back the other way (main → child).
    await win.getByTestId('terminal-shell-arguments').fill('--other');
    await expect(child.getByTestId('terminal-shell-arguments')).toHaveValue('--other');
  } finally {
    // Shared app: close the WINDOW. The sub-workspace record stays, which is why test 3 names its
    // own sub-workspace rather than counting to it.
    if (!child.isClosed()) await child.close();
  }
});

test('confirming a Panel type in one window types the clone in the other', { tag: ['@extended', '@window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  // A real project root so the terminal can actually launch (else it reverts to the form).
  const root = mkdtempSync(join(tmpdir(), 'throng-confirmsync-'));
  let child: Page | undefined;
  try {
    await createProject(win, 'ConfirmSync', root);
    const a = await firstPanelId(win);

    await win.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    const [opened] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    child = opened;
    await child.waitForLoadState('domcontentloaded');

    // Choose Terminal + a known flavour, then confirm in the MAIN window.
    await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('cmd');
    await win.getByTestId(`panel-type-confirm-${a}`).click();

    // Both windows leave the form and show the inline terminal for the same Panel
    // (one shared session, FR-021).
    await expect(win.getByTestId(`terminal-${a}`)).toBeVisible({ timeout: 15000 });
    await expect(child.getByTestId(`panel-type-form-${a}`)).toHaveCount(0);
    await expect(child.getByTestId(`terminal-${a}`)).toBeVisible({ timeout: 15000 });

    // Terminate the shared session before teardown so the app-close "terminals
    // still running" warning (FR-015e) doesn't block the automated close — the
    // convention every terminal-spawning E2E follows.
    await win.evaluate((id) => window.throng?.terminal?.kill?.(id), a);
    // sleep-justified: `terminal.kill` returns once the daemon has dropped the session from its
    // map, not once the OS process it signalled has actually exited — and nothing observable in
    // this window marks that reap completing before the shared app's later close.
    await win.waitForTimeout(1200);
  } finally {
    if (child && !child.isClosed()) await child.close();
    cleanupTemp(root);
  }
});

test('panel selection is INDEPENDENT across windows (not mirrored)', { tag: ['@extended', '@window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  await createProject(win, 'ActiveSync', 'C:/c/activesync');
  const a = await firstPanelId(win);
  await win.getByTestId(`panel-add-${a}`).click();
  await commitPanelRename(win);
  await expect(win.locator('.panel-box')).toHaveCount(2);
  const b = (await win.locator('.panel-box').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
  )).find((id) => id !== a)!;

  // Mirror BOTH panels into one sub-workspace: a into a new one, then b into it.
  //
  // Which sub-workspaces already exist is recorded first, so the one this test creates can be
  // told from the ones tests 1 and 2 left behind.
  const before = await subWorkspaceIds(win);
  await win.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Sync to').click();
  const [child] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('menu-item-New Sub-workspace').click(),
  ]);
  await child.waitForLoadState('domcontentloaded');
  try {
    /*
     * THE FIX (034 FR-045). This used to click `menu-item-Sub-workspace 1` — the FIRST entry in
     * the "Sync to" submenu, which is only this test's sub-workspace while the app is brand new.
     * Name the one just created instead: find the row the sidebar gained, and read its label.
     */
    await expect(win.locator('[data-testid^="subworkspace-item-"]')).toHaveCount(before.length + 1);
    const created = (await subWorkspaceIds(win)).find((id) => !before.includes(id));
    expect(created, 'no new sub-workspace appeared in the sidebar').toBeTruthy();
    const createdName = (
      (await win.getByTestId(`subworkspace-name-${created!}`).textContent()) ?? ''
    ).trim();
    expect(createdName).not.toBe('');

    await win.getByTestId(`panel-handle-${b}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    await win.getByTestId(`menu-item-${createdName}`).click();
    // Unchanged, and deliberately: Tab names are generated per sub-workspace, so a brand-new
    // sub-workspace's only Tab is always `Sub-workspace Tab 1`. That is a name, not a position.
    await win.getByTestId('menu-item-Sub-workspace Tab 1').click();
    await expect(child.getByTestId(`panel-${b}`)).toBeVisible();

    // Select a in the CHILD, then b in the MAIN window: the child's selection must
    // NOT follow the main window's (sub-workspace focus is independent).
    await child.getByTestId(`panel-${a}`).click({ position: { x: 5, y: 5 } });
    await expect(child.getByTestId(`panel-${a}`)).toHaveAttribute('data-active', 'true');
    await win.getByTestId(`panel-${b}`).click({ position: { x: 5, y: 5 } });
    await expect(win.getByTestId(`panel-${b}`)).toHaveAttribute('data-active', 'true');
    // sleep-justified: proving selection did NOT mirror means giving an unwanted broadcast a
    // chance to arrive, and there is no positive event marking "no broadcast is coming" — the
    // absence itself is what is under test.
    await win.waitForTimeout(400);
    await expect(child.getByTestId(`panel-${a}`)).toHaveAttribute('data-active', 'true');
    await expect(child.getByTestId(`panel-${b}`)).toHaveAttribute('data-active', 'false');

    // And the reverse: selecting in the CHILD must not move the main window's focus.
    await win.getByTestId(`panel-${a}`).click({ position: { x: 5, y: 5 } });
    await expect(win.getByTestId(`panel-${a}`)).toHaveAttribute('data-active', 'true');
    await child.getByTestId(`panel-${b}`).click({ position: { x: 5, y: 5 } });
    await expect(child.getByTestId(`panel-${b}`)).toHaveAttribute('data-active', 'true');
    // sleep-justified: same as above, reversed — no fence exists for "the broadcast that would
    // carry the main window's selection over did not arrive".
    await child.waitForTimeout(400);
    await expect(win.getByTestId(`panel-${a}`)).toHaveAttribute('data-active', 'true');
    await expect(win.getByTestId(`panel-${b}`)).toHaveAttribute('data-active', 'false');
  } finally {
    if (!child.isClosed()) await child.close();
  }
});
