import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { openApp, createProject, firstPanelId, type OpenApp, panelGrip, splitPanelViaMenu, runTypedCommand, TEST_SHELL } from './harness.js';

// Batch 3 (2026-07-01):
//  • FR-028 — a Panel created INSIDE a sub-workspace (owned; no project) can open a
//    terminal; it launches at the user's home directory (no project root needed).
//  • FR-029 — closing the LAST Panel of a sub-workspace closes the whole
//    sub-workspace (the record is deleted and the window closes). A cloned project
//    Panel closed this way is removed only from the sub-workspace (one-directional).

/*
 * ══ ONE APP FOR THE FILE (034 FR-045) — 3 launches → 1 ══
 *
 * Three tests, three `runApp()` calls, three Electron launches and three daemons. Nothing seeds
 * state before the app starts; each test creates its own project under its own root and its own
 * sub-workspace. Almost everything here is already scoped to the window or the panel it made:
 * the `.panel-box` counts are read inside the CHILD window, and the ghost probe finds the drag
 * ghost by the `#ghost-hint` element only it carries, so a longer window list does not confuse it.
 *
 * THE ONE BLOCKER was test 3's opening and closing counts:
 *
 *     await expect(win.locator('[data-testid^="subworkspace-item-"]')).toHaveCount(1);
 *     …
 *     await expect(win.locator('[data-testid^="subworkspace-item-"]')).toHaveCount(0);
 *
 * The sub-workspace list is WINDOW-wide, not per-project — it is a first-class sidebar record,
 * unaffected by which project is active — so the "only the ACTIVE project renders" property that
 * saves the panel counts does not apply. Tests 1 and 2 never delete the sub-workspaces they
 * create, so test 3 would have seen 3 and then 2, and `toHaveCount(0)` — the assertion that
 * FR-029 actually destroyed the record — would have failed for a reason unrelated to FR-029.
 *
 * THE FIX, and why it is not a weakening. `toHaveCount(1)` / `toHaveCount(0)` in a pristine app
 * mean two things at once: "the one I made is there / gone", and "nothing else changed". Both are
 * kept, separately and explicitly: the count is now taken against a baseline captured at the start
 * of this test (`before + 1`, then `before`), which is the "nothing else changed" half; and the
 * sub-workspace this test created is now named by ID and asserted present, then absent, which is
 * the "the one I made is gone" half — and is STRICTER than the original, because a count of zero
 * could in principle be reached by destroying somebody else's record.
 *
 * Tests 1 and 2 now also close the sub-workspace window they opened, in a `finally`. That is
 * hygiene rather than a fix: under `runApp` each left exactly one open and its own teardown
 * collected it, whereas one shared app would have carried three simultaneously into a single
 * `shutdownApp`. The RECORDS deliberately survive — which is exactly why test 3 needs its
 * baseline.
 *
 * Deliberately NOT `mode: 'serial'`. Three independent FRs (028, 030, 029); a first failure that
 * skipped the rest would answer one question instead of three. `fullyParallel: false` already
 * keeps a file to one worker in declaration order, and the `finally` blocks mean a failed test
 * still hands the next one a bounded window count. Test 3's baseline is deliberately read at run
 * time rather than assumed, so it is correct whatever tests 1 and 2 left behind — including
 * nothing, if they were skipped.
 */
let shared: OpenApp;

/** An absolute folder that is never there, as these projects' roots: a bare `C:/…` is relative off Windows. */
const NOWHERE = process.platform === 'win32' ? 'C:/c' : '/c';

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

/** Right-click the panel handle and sync it into a brand-new sub-workspace window. */
async function syncToNewSubWorkspace(
  app: ElectronApplication,
  win: Page,
  panelId: string,
): Promise<Page> {
  await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Sync to').click();
  const [child] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('menu-item-New Sub-workspace').click(),
  ]);
  await child.waitForLoadState('domcontentloaded');
  return child;
}

/** The ids currently listed in the sidebar's Sub-workspaces panel. */
async function subWorkspaceIds(win: Page): Promise<string[]> {
  await expect(win.getByTestId('subworkspaces-panel')).toBeVisible();
  return win
    .locator('[data-testid^="subworkspace-item-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('subworkspace-item-', '')),
    );
}

test('a sub-workspace-owned Panel can open a terminal (launches at home, no project) — FR-028', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  // The project root is irrelevant to an owned Panel — it launches at home.
  await createProject(win, 'Owned', `${NOWHERE}/owned`);
  const a = await firstPanelId(win);
  const child = await syncToNewSubWorkspace(app, win, a);
  try {
    // Add a NEW Panel inside the sub-workspace — this one is owned by the
    // sub-workspace (no origin project), so it should still be able to open a
    // terminal.
    await splitPanelViaMenu(child, a);
    await expect(child.locator('.panel-box')).toHaveCount(2);
    const owned = (
      await child.locator('.panel-box').evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
      )
    ).find((id) => id !== a)!;

    // Its form allows confirming Terminal despite there being no project root.
    const form = child.getByTestId(`panel-type-form-${owned}`);
    await form.getByTestId(`panel-type-select-${owned}`).selectOption('terminal');
    await form.getByTestId('terminal-flavour').selectOption(TEST_SHELL);
    await child.getByTestId(`panel-type-confirm-${owned}`).click();

    // The inline terminal launches (rooted at home, not blocked by "no project").
    const term = child.getByTestId(`terminal-${owned}`);
    await expect(term).toBeVisible({ timeout: 15000 });
    // The shell answers — the session is live, so the kill below has one to end. Killed while the view had only just
    // drawn, the session was not yet there to end in 2 of 5 Linux stress rounds, and the Panel never reverted.
    await runTypedCommand(child, term, 'echo OWNED_LIVE', { echoed: 'echo OWNED_LIVE', output: 'OWNED_LIVE' });

    /*
     * Terminate the session before teardown so the app-close warning can't block it. The kill IPC
     * resolving only means the daemon accepted the request — the Panel reverting to its type-select
     * form (the same observable `terminal-revert.e2e.ts` and friends assert on) is the renderer's own
     * confirmation that the session is actually gone, which is what the close-warning check depends on.
     */
    await child.evaluate((id) => window.throng?.terminal?.kill?.(id), owned);
    await expect(child.getByTestId(`panel-type-form-${owned}`)).toBeVisible({ timeout: 15000 });
  } finally {
    // Shared app: close the WINDOW (the record stays, which is what test 3's baseline counts).
    if (!child.isClosed()) await child.close();
  }
});

test('a sub-workspace-owned Panel cannot be dragged out; the ghost shows a warning — FR-030', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  await createProject(win, 'NoDragOut', `${NOWHERE}/nodragout`);
  const a = await firstPanelId(win);
  const child = await syncToNewSubWorkspace(app, win, a);
  try {
    // Add an OWNED Panel (belongs to the sub-workspace, not a project).
    await splitPanelViaMenu(child, a);
    await expect(child.locator('.panel-box')).toHaveCount(2);
    const owned = (
      await child.locator('.panel-box').evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
      )
    ).find((id) => id !== a)!;

    // Drag the owned Panel by its header and move the pointer beyond the window.
    const handle = panelGrip(child, owned);
    const box = await handle.boundingBox();
    if (!box) throw new Error('owned handle has no box');
    const size = await child.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    /*
     * Diagnostics, reported only if the warning never shows. This spec failed on the Linux
     * pipeline (Xvfb + xfwm4) while passing on Windows and on a local X11 session, and the bare
     * `Received: false` could not say which link broke: no pointer events beyond the edge, a drag
     * dnd-kit cancelled (it cancels on window `resize` and `visibilitychange`), or a ghost with no
     * hint. The probe records exactly those, so the next red run answers it.
     */
    await child.evaluate(() => {
      const log: unknown[] = [];
      (window as unknown as { __fr030: unknown[] }).__fr030 = log;
      const add = (e: Event): void => {
        const p = e as PointerEvent;
        if (log.length < 60) log.push([e.type, Math.round(p.clientX ?? -1), Math.round(p.clientY ?? -1), p.buttons, Math.round(e.timeStamp)]);
      };
      for (const t of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) window.addEventListener(t, add, true);
      for (const t of ['resize', 'blur', 'focus']) window.addEventListener(t, add);
      document.addEventListener('visibilitychange', add);
    });
    await child.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await child.mouse.down();
    await child.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 3 });
    await child.mouse.move(size.w + 120, Math.floor(size.h / 2), { steps: 10 });

    // The app-global drag ghost (a main-process OS window) shows a red WARNING that
    // this drop is invalid. Read it from the main process (the ghost has no test page).
    //
    // Shared app: the iteration is over a longer window list than it used to be, but only the
    // ghost carries `#ghost-hint`, so the probe still identifies exactly one window. Anything
    // else answers `null` and is skipped.
    const readHint = (): Promise<{ text: string; warn: boolean; show: boolean } | null> =>
      app.evaluate(async ({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) {
          try {
            const res = await w.webContents.executeJavaScript(
              "(()=>{const h=document.getElementById('ghost-hint');return h?{text:h.textContent,warn:h.classList.contains('warn'),show:h.classList.contains('show')}:null})()",
            );
            if (res) return res as { text: string; warn: boolean; show: boolean };
          } catch {
            /* not the ghost window */
          }
        }
        return null;
      });

    /*
     * The hint update is throttled to one per 120ms of the pointer event's OWN `timeStamp` — real
     * dispatch time, not anything a test can fake — so a single nudge immediately after the move
     * above can land inside a still-throttled window and never fire at all. Rather than guess how
     * many throttle windows that takes, keep nudging (each `mouse.move` is itself a real pointer
     * event, so every attempt is a fresh chance for the throttle to have cleared) and read the hint
     * after each one, until it reports the warning.
     */
    // Asserted, not annotated: an annotated `= null` narrows `hint` to null, and the closure that assigns it
    // leaves it `never` after the poll.
    let hint = null as { text: string; warn: boolean; show: boolean } | null;
    try {
      await expect
        .poll(
          async () => {
            const to = { x: size.w + 130 + (hint ? 20 : 0), y: Math.floor(size.h / 2) + 6 };
            await child.mouse.move(to.x, to.y, { steps: 2 });
            if (process.platform === 'linux') {
              // Under Xvfb, Playwright's synthetic pointer stops at the window's edge: measured, the last move the
              // page saw was x=869 of a 900px window, and none beyond it arrived. The drag itself started through
              // real input above; the move past the edge is delivered to the same window-level listener throng's
              // drag uses (tab-group.tsx), so throng's own handler, IPC and ghost still decide the warning.
              await child.evaluate(
                ({ x, y }) =>
                  window.dispatchEvent(
                    new PointerEvent('pointermove', { clientX: x, clientY: y, buttons: 1, pointerType: 'mouse', bubbles: true }),
                  ),
                to,
              );
            }
            hint = await readHint();
            return hint?.warn === true && hint?.show === true;
          },
          { timeout: 5000, message: 'the ghost hint never showed the invalid-drop warning' },
        )
        .toBe(true);
    } catch (error) {
      const events = await child.evaluate(() => (window as unknown as { __fr030?: unknown[] }).__fr030 ?? []);
      const windows = await app.evaluate(({ BrowserWindow, screen }) => ({
        cursor: screen.getCursorScreenPoint(),
        workArea: screen.getPrimaryDisplay().workArea,
        windows: BrowserWindow.getAllWindows().map((w) => ({ id: w.id, visible: w.isVisible(), bounds: w.getBounds(), url: w.webContents.getURL().slice(0, 24) })),
      }));
      const diag = JSON.stringify({ size, box, hint, events, ...windows });
      await test.info().attach('fr030-diagnostics', { body: diag, contentType: 'application/json' });
      throw new Error(`${(error as Error).message}\n\nFR-030 diagnostics: ${diag}`, { cause: error });
    }
    await child.mouse.up();

    expect(hint?.warn).toBe(true);
    expect(hint?.show).toBe(true);
    expect(hint?.text ?? '').toContain('sub-workspace panel');

    // The Panel was NOT moved out — both Panels remain in the sub-workspace.
    await expect(child.locator('.panel-box')).toHaveCount(2);
  } finally {
    if (!child.isClosed()) await child.close();
  }
});

test('closing the last Panel of a sub-workspace closes the sub-workspace — FR-029', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const app = shared.app;
  const win = shared.win;
  /*
   * The sub-workspace list is window-wide and earlier tests do not delete theirs, so this test
   * counts against what it found rather than against zero. `before` is read here, before anything
   * is created, so it is right whatever ran before — including nothing.
   */
  const before = await subWorkspaceIds(win);

  await createProject(win, 'LastPanel', `${NOWHERE}/lastpanel`);
  const a = await firstPanelId(win);
  const child = await syncToNewSubWorkspace(app, win, a);
  await expect(child.getByTestId(`panel-${a}`)).toBeVisible();
  // The sub-workspace shows in the main window's sidebar list: one MORE than there was.
  await expect(win.locator('[data-testid^="subworkspace-item-"]')).toHaveCount(before.length + 1);
  // …and this is the one it added. Naming it is what keeps the closing assertion about FR-029
  // rather than about an empty list — a count alone could be satisfied by the wrong record going.
  const created = (await subWorkspaceIds(win)).find((id) => !before.includes(id));
  expect(created, 'no new sub-workspace appeared in the sidebar').toBeTruthy();
  await expect(win.getByTestId(`subworkspace-item-${created!}`)).toHaveCount(1);

  // Close the sub-workspace's only Panel → a warning confirm appears; accept it.
  await child.getByTestId(`panel-close-${a}`).click();
  await expect(child.getByTestId('confirm-warning')).toContainText('destroys the sub-workspace');
  await Promise.all([
    child.waitForEvent('close'),
    child.getByTestId('confirm-accept').click(),
  ]);

  // The sub-workspace is gone from the sidebar…
  await expect(win.getByTestId(`subworkspace-item-${created!}`)).toHaveCount(0);
  // …and nothing else went with it (the original `toHaveCount(0)`'s other half).
  await expect(win.locator('[data-testid^="subworkspace-item-"]')).toHaveCount(before.length);
  // …but the project keeps its Panel (one-directional — the clone left, the
  // original stayed).
  await expect(win.getByTestId(`panel-${a}`)).toBeVisible();
});
