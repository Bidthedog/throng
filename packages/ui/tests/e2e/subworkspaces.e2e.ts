import { test, expect } from '@playwright/test';
import { openApp, runApp as runOwnApp, reloadWindow, daemonRpc, type OpenApp } from './harness.js';

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
 * ORDER IS LOAD-BEARING for test 1, so say it plainly. Test 1 opens with
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

test.afterAll(async () => {
  await shared?.close();
});

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

const seedTwo = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'swA', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 'ta', title: 'T', root: { type: 'panel', id: 'pa', originProjectId: 'x', title: 'P' } }] },
  { id: 'swB', ownerUser: 'u', name: 'Detached B', colour: '#6aa3ff',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 'tb', title: 'T', root: { type: 'panel', id: 'pb', originProjectId: 'x', title: 'P' } }] },
] }))()`;

test('lists, renames and deletes sub-workspaces', { tag: ['@core', '@window', '@reserve:window'] }, async () => {
  const win = shared.win;
  // FIRST IN THE FILE, and it has to be: this asserts the empty state of a store nothing has
  // written to yet, before any seed. See the file header.
  await expect(win.getByTestId('subworkspaces-panel')).toBeVisible();
  await expect(win.getByTestId('subworkspaces-empty')).toBeVisible();

  // Seed via the daemon, then reload so the lazy list picks it up.
  await win.evaluate(seedSub);
  await reloadWindow(win);
  await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

  // Rename (double-click → edit).
  await win.getByTestId('subworkspace-name-sw1').dblclick();
  const input = win.getByTestId('subworkspace-rename-input-sw1');
  await input.fill('Renamed SW');
  await input.press('Enter');
  await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Renamed SW');

  // Delete uses the configurable double confirmation (default) → summary + wry.
  await win.getByTestId('subworkspace-delete-sw1').click();
  await win.getByTestId('confirm-accept').click(); // summary
  await expect(win.getByTestId('confirm-dialog')).toContainText('absolutely sure');
  await win.getByTestId('confirm-accept').click(); // wry
  await expect(win.getByTestId('subworkspaces-empty')).toBeVisible();
});

// US7 feedback: deleting an OPEN sub-workspace closes its window too.
test('deleting an open sub-workspace closes its window', { tag: ['@core', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  // The seed REPLACES the list, so this starts from exactly `[sw1]` whatever ran before.
  await win.evaluate(seedSub);
  await reloadWindow(win);
  await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

  const [child] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('subworkspace-open-sw1').click(),
  ]);
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
  const [child] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('subworkspace-open-sw1').click(),
  ]);
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
test('closing the main window closes all sub-workspace windows', { tag: ['@core', '@window', '@reserve:window'] }, async () => {
  await runOwnApp(async (app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await expect(win.getByTestId('subworkspace-name-sw1')).toHaveText('Detached A');

    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
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
test('persists and restores a sub-workspace window size on reopen', { tag: ['@core', '@window', '@reserve:window'] }, async () => {
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
    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
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
    await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
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

// US7: the sub-workspace list reorders by dragging its grip (parity with the
// project list), and the new order persists across a restart (position column).
test('reorders sub-workspaces by dragging, and the order persists', { tag: ['@core', '@window', '@reserve:layout'] }, async () => {
  const win = shared.win;
  // Replaces the list with exactly these two, so the exact-equality assertions below mean the same
  // thing they meant against a pristine app.
  await win.evaluate(seedTwo);
  await reloadWindow(win);
  const names = () => win.locator('.subworkspace-item__name').allInnerTexts();
  await expect(async () => {
    expect(await names()).toEqual(['Detached A', 'Detached B']);
  }).toPass({ timeout: 5000 });

  // Drag B's grip above A.
  const grip = win.locator('.subworkspace-item', { hasText: 'Detached B' }).locator('.subworkspace-item__grip');
  const target = win.locator('.subworkspace-item', { hasText: 'Detached A' });
  /*
   * `hover()` rather than a move to a remembered box: it re-resolves the element's position at the
   * moment of the action, and waits for that box to be STABLE across consecutive frames first.
   *
   * The sidebar settles late. The sub-workspace list renders at y≈449 and ends up at y≈671 once
   * the panels above it finish loading, so a `boundingBox()` read before that is stale by ~222px
   * — and pressing at those coordinates puts the mouse-down on `.panel__body`, well clear of the
   * grip. No drag starts, and the only symptom is an order that never changed, which reads like a
   * product bug three steps from the actual fault.
   *
   * Measured, not reasoned about: a probe on `document.elementFromPoint` at the press coordinates
   * reported `DIV.panel__body` (y=449.5) in every failing run and `SPAN.subworkspace-item__grip`
   * (y=671.5) in every passing one. It survives 12/12 under load with this, against 2 failures in
   * 10 without. The bug only appears on a loaded machine because that is what makes the sidebar
   * slow to settle — it is not a timing subtlety in the drag itself.
   */
  await grip.hover();
  await win.mouse.down();
  const gbox = await grip.boundingBox();
  const tbox = await target.boundingBox();
  if (!gbox || !tbox) throw new Error('boxes missing');
  await win.mouse.move(gbox.x + gbox.width / 2, gbox.y - 8, { steps: 3 });
  /*
   * Assert the drag actually STARTED, so a press that misses fails HERE, naming its cause, rather
   * than surfacing later as "the order did not change" — which sent this investigation down a
   * dnd-kit rabbit hole the first time round.
   */
  await expect(win.locator('.subworkspace-item--dragging')).toHaveCount(1);
  await win.mouse.move(tbox.x + tbox.width / 2, tbox.y + 2, { steps: 8 });
  await win.mouse.up();

  await expect(async () => {
    expect(await names()).toEqual(['Detached B', 'Detached A']);
  }).toPass({ timeout: 5000 });

  // Reload → the reordered order survives (persisted via the position column).
  await reloadWindow(win);
  await expect(async () => {
    expect(await names()).toEqual(['Detached B', 'Detached A']);
  }).toPass({ timeout: 5000 });
});
