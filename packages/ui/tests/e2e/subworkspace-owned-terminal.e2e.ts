import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createProject, firstPanelId, runApp } from './harness.js';

// Batch 3 (2026-07-01):
//  • FR-028 — a Panel created INSIDE a sub-workspace (owned; no project) can open a
//    terminal; it launches at the user's home directory (no project root needed).
//  • FR-029 — closing the LAST Panel of a sub-workspace closes the whole
//    sub-workspace (the record is deleted and the window closes). A cloned project
//    Panel closed this way is removed only from the sub-workspace (one-directional).

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

test('a sub-workspace-owned Panel can open a terminal (launches at home, no project) — FR-028', async () => {
  await runApp(async (app, win) => {
    // The project root is irrelevant to an owned Panel — it launches at home.
    await createProject(win, 'Owned', 'C:/c/owned');
    const a = await firstPanelId(win);
    const child = await syncToNewSubWorkspace(app, win, a);

    // Add a NEW Panel inside the sub-workspace — this one is owned by the
    // sub-workspace (no origin project), so it should still be able to open a
    // terminal. Commit the auto-rename that a new Panel opens in.
    await child.getByTestId(`panel-add-${a}`).click();
    await expect(child.locator('.panel-box')).toHaveCount(2);
    await child.keyboard.press('Enter');
    const owned = (
      await child.locator('.panel-box').evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
      )
    ).find((id) => id !== a)!;

    // Its form allows confirming Terminal despite there being no project root.
    const form = child.getByTestId(`panel-type-form-${owned}`);
    await form.getByTestId(`panel-type-select-${owned}`).selectOption('terminal');
    await form.getByTestId('terminal-flavour').selectOption('cmd');
    await child.getByTestId(`panel-type-confirm-${owned}`).click();

    // The inline terminal launches (rooted at home, not blocked by "no project").
    await expect(child.getByTestId(`terminal-${owned}`)).toBeVisible({ timeout: 15000 });

    // Terminate the session before teardown so the app-close warning can't block it.
    await child.evaluate((id) => window.throng?.terminal?.kill?.(id), owned);
    await child.waitForTimeout(1200);
  });
});

test('a sub-workspace-owned Panel cannot be dragged out; the ghost shows a warning — FR-030', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'NoDragOut', 'C:/c/nodragout');
    const a = await firstPanelId(win);
    const child = await syncToNewSubWorkspace(app, win, a);

    // Add an OWNED Panel (belongs to the sub-workspace, not a project).
    await child.getByTestId(`panel-add-${a}`).click();
    await expect(child.locator('.panel-box')).toHaveCount(2);
    await child.keyboard.press('Enter');
    const owned = (
      await child.locator('.panel-box').evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
      )
    ).find((id) => id !== a)!;

    // Drag the owned Panel by its header and move the pointer beyond the window.
    const handle = child.getByTestId(`panel-handle-${owned}`);
    const box = await handle.boundingBox();
    if (!box) throw new Error('owned handle has no box');
    const size = await child.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await child.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await child.mouse.down();
    await child.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 3 });
    await child.mouse.move(size.w + 120, Math.floor(size.h / 2), { steps: 10 });
    // The hint update is throttled (~120 ms); rapid interpolated steps get
    // coalesced, so nudge the pointer once more (while still outside) after the
    // throttle window so a fresh onMove lands at an outside position.
    await child.waitForTimeout(160);
    await child.mouse.move(size.w + 150, Math.floor(size.h / 2) + 6, { steps: 2 });
    await child.waitForTimeout(300);

    // The app-global drag ghost (a main-process OS window) shows a red WARNING that
    // this drop is invalid. Read it from the main process (the ghost has no test page).
    const hint = await app.evaluate(async ({ BrowserWindow }) => {
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
    await child.mouse.up();

    expect(hint?.warn).toBe(true);
    expect(hint?.show).toBe(true);
    expect(hint?.text ?? '').toContain('sub-workspace panel');

    // The Panel was NOT moved out — both Panels remain in the sub-workspace.
    await expect(child.locator('.panel-box')).toHaveCount(2);
  });
});

test('closing the last Panel of a sub-workspace closes the sub-workspace — FR-029', async () => {
  await runApp(async (app, win) => {
    await createProject(win, 'LastPanel', 'C:/c/lastpanel');
    const a = await firstPanelId(win);
    const child = await syncToNewSubWorkspace(app, win, a);
    await expect(child.getByTestId(`panel-${a}`)).toBeVisible();
    // The sub-workspace shows in the main window's sidebar list.
    await expect(win.locator('[data-testid^="subworkspace-item-"]')).toHaveCount(1);

    // Close the sub-workspace's only Panel → a warning confirm appears; accept it.
    await child.getByTestId(`panel-close-${a}`).click();
    await expect(child.getByTestId('confirm-warning')).toContainText('close the sub-workspace');
    await Promise.all([
      child.waitForEvent('close'),
      child.getByTestId('confirm-accept').click(),
    ]);

    // The sub-workspace is gone from the sidebar…
    await expect(win.locator('[data-testid^="subworkspace-item-"]')).toHaveCount(0);
    // …but the project keeps its Panel (one-directional — the clone left, the
    // original stayed).
    await expect(win.getByTestId(`panel-${a}`)).toBeVisible();
  });
});
