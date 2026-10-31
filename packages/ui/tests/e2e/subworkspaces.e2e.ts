import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  createProject,
  reloadWindow,
  daemonRpc,
  cleanupTemp,
  type OpenApp,
} from './harness.js';
import { openSubWorkspaceWindow } from './helpers/subworkspace-open.js';

// US7: the Sub-workspaces panel lists the user's first-class sub-workspaces and
// lets them be renamed and deleted (delete warns then destroys). Detach (which
// creates them) isn't built yet, so we seed one via the daemon and reload — which
// also exercises the lazy "listed at startup" behaviour.

/*
 * ══ PARTIAL CONVERSION (034 FR-045) — 6 launches → 2 ══
 *
 * Five of the six tests share one app; test 4 keeps its own, and there is no fixing that: it calls
 * `win.close()` on the main window, which is the whole point of the test ("closing the main window
 * closes every sub-workspace window"). A shared app has one main window and every later test drives
 * it, so the test that destroys it must own the app it destroys.
 *
 * WHY THE OTHER FIVE ARE SAFE, and it turns on one fact about the seam they all use.
 * `workspace.persistSubWorkspaces` REPLACES the owner's whole list — `workspace-repository.ts` does
 * a `DELETE … WHERE owner_user = ?` inside the transaction before inserting. So `seedSub` does not
 * add `sw1` to whatever is there; it makes the list be exactly `[sw1]`. Every test here seeds and
 * then reloads the renderer, which means each one NORMALISES the record set it is about to assert
 * on, and the whole-list assertions (`subworkspaces-empty`, `names()).toEqual([...])`) keep their
 * original meaning verbatim. That is why this file needs cleanup rather than a rewrite.
 *
 * WHAT LEAKS ACROSS A SHARED APP is not records but WINDOWS, and two tests leaked one each:
 *
 *   • Test 3 ends with `expect(app.windows().length).toBe(2)` — main plus the one it opened — and
 *     then leaves that window open. Under `runApp` its own teardown collected it. It now closes it
 *     in a `finally`, AFTER the count. Without that, test 5's lookup
 *     (`BrowserWindow.getAllWindows().find(w => …includes('sw=sw1'))`) would match test 3's window
 *     as readily as its own, and "reopen at the saved size" would silently become "raise the window
 *     that was already open at the default size".
 *   • Test 5 leaves the reopened window open, for the same reason and with the same fix — using the
 *     main-process close it already performs mid-test.
 *
 * Test 3's `toBe(2)` is therefore still an absolute count of every window in the application, and
 * still correct: tests 1 and 2 open no window that survives them (test 2's is closed BY the delete
 * it is asserting), and test 4 runs in a different Electron process entirely.
 *
 * (Test-suite audit: the list/rename/delete test that used to be first moved down to a component test, so no test here asserts the virgin empty state any more; the notes on order below describe the file as it was. ORDER IS NOW LOAD-BEARING for the LAST test only.)
 *
 * ORDER WAS LOAD-BEARING for test 1, so say it plainly. Test 1 opens with
 * `expect(subworkspaces-empty).toBeVisible()` BEFORE it seeds anything — a claim about a virgin
 * store, which only the first test in the app is entitled to make. It is declared first and must
 * stay first. Everything after it seeds, and a seed is a replace, so nothing else depends on order.
 *
 * Deliberately NOT `mode: 'serial'`. These are six independent US7 claims — listing, cascade
 * delete, lazy reopen, lifecycle group, bounds persistence, reordering — and a first failure that
 * skipped the rest would turn five answers into none. `fullyParallel: false` already keeps the file
 * to one worker in declaration order, so the shared window is never driven by two tests at once,
 * and the `finally` blocks mean a test that fails part-way still hands the next one a bounded
 * window count. The seed-is-a-replace property does the rest: a failed test cannot leave a record
 * set that changes what the next test sees.
 */
let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

/** Project roots made by the merged-in rename test; removed once the shared app has closed. */
const ownedRoots: string[] = [];

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
});

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

// MOVED DOWN (test-suite audit) — "lists, renames and deletes sub-workspaces" is
// `component/subworkspaces-panel.test.ts` (empty state, list with counts, double-click rename with Enter and
// Escape, the double confirmation before a delete), each red-proven against the line it names. The window
// half of deleting stays below.

// US7 feedback: deleting an OPEN sub-workspace closes its window too.
test('deleting an open sub-workspace closes its window', { tag: ['@core', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  // The seed REPLACES the list, so this starts from exactly `[sw1]` whatever ran before.
  await win.evaluate(seedSub);
  await reloadWindow(win);
  await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

  const child = await openSubWorkspaceWindow(app, win, 'sw1');
  await child.waitForLoadState('domcontentloaded');

  // Delete (double confirm) → the open window closes and the list empties.
  // No `finally` close needed: the window closing IS the assertion.
  const childClosed = child.waitForEvent('close');
  await win.getByTestId('subworkspace-delete-sw1').click();
  await win.getByTestId('confirm-accept').click();
  await win.getByTestId('confirm-accept').click();
  await childClosed;
  expect(child.isClosed()).toBe(true);
  await expect(win.getByTestId('subworkspaces-empty')).toBeVisible();
});

// US7 (T075/T078): clicking a listed sub-workspace opens a detached window that
// renders its tabs/panels by reusing the workspace renderer (lazy reopen, FR-013).
test('opens a sub-workspace window that renders its panels (lazy reopen)', { tag: ['@core', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  await win.evaluate(seedSub);
  await reloadWindow(win);
  await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

  // The Open button → a NEW window opens, mounting the sub-workspace shell.
  const child = await openSubWorkspaceWindow(app, win, 'sw1');
  await child.waitForLoadState('domcontentloaded');
  try {
    // Opening marks it "loaded" for the session (green dot in the list).
    await expect(win.getByTestId('subworkspace-loaded-sw1')).toBeVisible();

    // It is the sub-workspace variant for sw1, and the seeded tab "T"/panel "P"
    // render through the same TabGroup the main workspace uses.
    await expect(child.getByTestId('subworkspace-window')).toHaveAttribute(
      'data-subworkspace',
      'sw1',
    );
    await expect(child.getByTestId('tab-t')).toBeVisible();
    await expect(child.locator('.panel-box')).toHaveCount(1);

    // The window adopts the sub-workspace's colour as its dominant accent (FR-004),
    // not the default blue.
    await expect
      .poll(() =>
        child.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        ),
      )
      .toBe('#3fb950');
    // Each Panel is labelled with its owner; the seeded panel has no real project,
    // so it shows the sub-workspace's name.
    await expect(child.getByTestId('panel-project-p')).toHaveText('Detached A');

    // Lazy guard: clicking again raises the SAME window — no second window opens.
    // Still an ABSOLUTE count of every window in the app, and still correct: nothing before this
    // leaves a window open, and the own-app test below runs in a different Electron process.
    await win.getByTestId('subworkspace-open-sw1').click();
    // sleep-justified: the "already open" branch of `throng:subworkspace:open` (main.ts) is an
    // sleep-justified: `ipcMain.on` — fire-and-forget, no reply — and its one effect, `win.focus()`,
    // sleep-justified: is a no-op with no observable event when the window is already the OS-focused
    // sleep-justified: one, which it may well be here; there is nothing to poll that distinguishes
    // sleep-justified: "handled" from "not yet delivered" for this specific path.
    await win.waitForTimeout(300);
    expect(app.windows().length).toBe(2); // main + the one sub-workspace window
  } finally {
    /*
     * Shared app: this window would otherwise still be open when the bounds test below looks for
     * "the window whose URL contains sw=sw1" — and would be found instead of its own, turning
     * "reopened at the saved size" into "raised at the default size". After the count above, so
     * the assertion is untouched.
     */
    if (!child.isClosed()) await child.close();
  }
});

/*
 * OWN APP, and it cannot be otherwise: this test CLOSES THE MAIN WINDOW, which is the window every
 * other test in this file drives. `runOwnApp` gives it one it is allowed to destroy.
 */
// US7 / T078 / Constitution XI: closing the main window closes every
// sub-workspace window (the focus/raise group is also a lifecycle group).
test('closing the main window closes all sub-workspace windows', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  await runOwnApp(async (app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

    const child = await openSubWorkspaceWindow(app, win, 'sw1');
    await child.waitForLoadState('domcontentloaded');

    // Close the main window → the sub-workspace window closes with it.
    const childClosed = child.waitForEvent('close');
    await win.close();
    await childClosed;
    expect(child.isClosed()).toBe(true);
  });
});

// US7 / T079 / FR-017a: a sub-workspace window's bounds are persisted on
// move/resize/close and restored (clamped onto a visible display) on reopen.
test('persists and restores a sub-workspace window size on reopen', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  await win.evaluate(seedSub);
  await reloadWindow(win);
  await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

  const urlMatch = 'sw=sw1';
  try {
    // A target size that fits the primary display and respects the 600x560 minimum.
    const target = await app.evaluate(({ screen }) => {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      return { x: 40, y: 40, width: Math.min(720, width - 80), height: Math.min(600, height - 80) };
    });

    // Open, resize, then close (close persists the bounds immediately).
    const child = await openSubWorkspaceWindow(app, win, 'sw1');
    await child.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }, { urlMatch, target }) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(urlMatch));
      w?.setBounds(target);
    }, { urlMatch, target });
    // `setBounds` asks the OS to resize a native window; that resize is not synchronous with the
    // call returning, so read the bounds back until they actually match rather than guessing how
    // long the OS takes. Closing before they land would persist the PRE-resize bounds below.
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }, urlMatch) => {
          const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(urlMatch));
          return w?.getBounds();
        }, urlMatch),
      )
      .toEqual(target);
    await app.evaluate(({ BrowserWindow }, urlMatch) => {
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(urlMatch))?.close();
    }, urlMatch);
    /*
     * The close handler's `persistBounds()` (main.ts) fires the daemon write without the renderer
     * ever being told it landed — `void daemonClient.call(...).catch(...)`, best-effort by design.
     * So poll the artefact it writes to, through the same `workspace.loadSubWorkspaces` RPC the
     * reopen path itself reads from, rather than guessing how long the round trip takes.
     *
     * ASKED OF THE DAEMON DIRECTLY, and the first attempt at this is why. It went through
     * `win.evaluate(() => window.throng?.invoke?.('workspace.loadSubWorkspaces', {}))` from the MAIN
     * window, and that read `undefined` on every poll — for the full ten seconds, reporting a
     * persistence failure that had not happened. The window reopens at the saved size immediately
     * afterwards, which is the proof the write had in fact landed.
     *
     * What exactly the renderer route returned was NOT established, and the comment says so rather
     * than inventing a cause: `window.throng.invoke` plainly exists (several specs seed sub-workspaces
     * through it), so "the API is missing" is not the answer. What IS certain is the shape of the
     * mistake — every hop in `window.throng?.invoke?.(...)?.subWorkspaces?.find(...)?.bounds` is
     * optional, so a wrong assumption anywhere along it yields `undefined`, which is
     * indistinguishable from "the write has not landed yet". A wait that can never succeed and a
     * wait that always succeeds are the same defect wearing different clothes.
     *
     * `daemonRpc` asks the process that owns the data, with no optional hops to swallow a mistake.
     */
    await expect
      .poll(
        async () => {
          const loaded = (await daemonRpc(shared.pipeName, 'workspace.loadSubWorkspaces', {})) as {
            subWorkspaces?: Array<{ id: string; bounds?: typeof target }>;
          } | null;
          return loaded?.subWorkspaces?.find((s) => s.id === 'sw1')?.bounds;
        },
        { timeout: 10_000, message: 'sw1’s resized bounds were never persisted' },
      )
      .toEqual(target);

    // Reopen → the window comes back at the saved size, not the default.
    await openSubWorkspaceWindow(app, win, 'sw1');
    const restored = await app.evaluate(({ BrowserWindow }, urlMatch) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(urlMatch));
      return w?.getBounds() ?? null;
    }, urlMatch);
    expect(restored?.width).toBe(target.width);
    expect(restored?.height).toBe(target.height);
  } finally {
    // Shared app: leave no sub-workspace window open. Same main-process close the test already
    // uses mid-flight, so it is a no-op if the test failed before reopening anything.
    await app.evaluate(({ BrowserWindow }, urlMatch) => {
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(urlMatch))?.close();
    }, urlMatch);
  }
});

// MOVED DOWN (test-suite audit) — "reorders sub-workspaces by dragging, and the order persists": the drop and
// the RPC it produces are `component/subworkspaces-panel.test.ts` ("drag-to-reorder by the grip"); the order
// surviving a restart is the daemon's `subworkspace.reorder` persistence, held by its integration tests.

// MERGED IN (test-suite audit) from project-rename-subworkspace.e2e.ts, which launched its own app and daemon
// to watch one cross-window update. Renaming a project updates that project's name shown in OTHER windows —
// specifically the owner text on sub-workspace panels — without needing a reload.
//
// LAST IN THE FILE, and it has to be: it creates a project, which the whole-list assertions above must not
// see. The seed replaces the sub-workspace list, so nothing before it is disturbed either way.
test('renaming a project updates its name on sub-workspace panels live', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  const root = mkdtempSync(join(tmpdir(), 'throng-rensub-'));
  ownedRoots.push(root);
  await createProject(win, 'OldName', root);
  const pid = (
    (await win.locator('[data-testid^="project-switch-"]').first().getAttribute('data-testid')) ?? ''
  ).replace('project-switch-', '');

  // Seed a sub-workspace whose panel is OWNED by that project, then reload so it appears, and open its window.
  await win.evaluate((originProjectId) => {
    return window.throng!.invoke!('workspace.persistSubWorkspaces', {
      subWorkspaces: [
        {
          id: 'sw1',
          ownerUser: 'u',
          name: 'SubA',
          colour: '#3fb950',
          bounds: { x: 0, y: 0, width: 700, height: 460 },
          tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId, title: 'P' } }],
        },
      ],
    });
  }, pid);
  await reloadWindow(win);

  const child = await openSubWorkspaceWindow(app, win, 'sw1');
  await child.waitForLoadState('domcontentloaded');
  try {
    // The panel's owner text shows the project's CURRENT name.
    const owner = child.getByTestId('panel-project-p');
    await expect(owner).toContainText('OldName', { timeout: 10000 });

    // Rename the project in the MAIN window (inline).
    await win.getByTestId(`project-switch-${pid}`).dblclick();
    const rename = win.getByTestId(`project-rename-input-${pid}`);
    await rename.fill('BrandNewName');
    await rename.press('Enter');
    await expect(win.locator('.project-item', { hasText: 'BrandNewName' })).toBeVisible();

    // The sub-workspace window's panel owner text updates WITHOUT a reload.
    await expect(owner).toContainText('BrandNewName', { timeout: 10000 });
    await expect(owner).not.toContainText('OldName');
  } finally {
    // Shared app: leave no sub-workspace window open.
    if (!child.isClosed()) await child.close();
  }
});
