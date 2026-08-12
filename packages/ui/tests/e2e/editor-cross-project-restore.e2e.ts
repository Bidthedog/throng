/**
 * #228 — switching to a second project must not re-point its editors at the first project's file.
 *
 * The reported failure needs three things at once, which is why no existing spec catches it: a
 * RESTART (so every panel restores rather than being opened by hand), TWO projects with editors, and
 * a SWITCH between them in the one renderer. `switchProject` swaps the workspace in place — no
 * reload — so anything the editor layer holds outside React survives the switch.
 *
 * What the report says happens, and what each test below measures:
 *
 *  1. **Cross-project override.** Project A restores correctly — several editors in one tab, and a
 *     second tab too. Switch to project B and its editor flashes its own file, then loads the LAST
 *     file project A loaded. Where that path does not exist under B, the "Cannot open file" notice
 *     appears; where it does, B's panel is silently pointed at A's file.
 *  2. **A dirty buffer re-pointed at the wrong project.** With B's editor left dirty at close, open
 *     A first and then switch to B: the panel names a project-A path while the buffer still holds
 *     project B's unsaved content. Only the save-confinement guard stops that becoming data loss,
 *     and it stops firing the moment the two projects share a relative path.
 *
 * The controls the report calls "what works" (two editors in one tab; a second tab's editors) are
 * asserted in test 1 rather than in their own test: they are the same restart, they cost nothing
 * extra there, and if the fix ever narrows to "reload everything on switch" they are what notices.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, panelIds, cleanupTemp } from './harness.js';

/** A project root holding the named files, each with its own unmistakable content. */
function makeProject(prefix: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

/**
 * Open a project from the sidebar and wait for ITS OWN workspace to be on screen.
 *
 * `expectPanelId` is not a convenience — it is what makes the wait mean anything. A project switch
 * swaps the workspace behind an async layout load, so the sidebar row goes active (and the previous
 * project's `.panel-box` elements are still mounted) well before the incoming project's panels
 * exist. Waiting for "a panel" therefore settles on the OUTGOING project, and a panel id read at
 * that moment belongs to the project we just left — after which every locator built from it waits
 * out its whole budget for an element that will never exist. That is the same trap the harness's
 * `createProject` documents, and it is what made this spec flaky (1 run in ~20). Panel ids are
 * persisted in the layout, so the id captured before the restart is the honest thing to wait for.
 */
async function enterProject(win: Page, name: string, expectPanelId?: string): Promise<void> {
  const item = win.locator('.project-item', { hasText: name });
  await expect(item).toBeVisible({ timeout: 20_000 });
  const sw = item.locator('[data-testid^="project-switch-"]');
  if (await sw.isVisible().catch(() => false)) await sw.click();
  await expect(item).toHaveAttribute('data-active', 'true', { timeout: 20_000 });
  if (expectPanelId !== undefined) {
    await expect(win.getByTestId(`panel-${expectPanelId}`)).toBeVisible({ timeout: 20_000 });
  } else {
    await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 20_000 });
  }
}

/** Type the given panel as an editor and open `fileName` from the tree into it. */
async function openFileInPanel(win: Page, panelId: string, fileName: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${panelId}`).click();
  await expect(win.getByTestId(`editor-${panelId}`)).toBeVisible({ timeout: 15_000 });
  await win.getByTestId(`editor-${panelId}`).click();
  await win.getByTestId('file-explorer-tree').getByText(fileName, { exact: true }).click();
  await expect(win.getByTestId(`panel-title-${panelId}`)).toHaveText(fileName.replace(/\.[^.]+$/, ''), {
    timeout: 15_000,
  });
}

/** Every editor panel's file pill, as shown in the panel headers of the active tab. */
async function openFileNames(win: Page): Promise<string[]> {
  return win.locator('.panel-box__file-name').allTextContents();
}

test('switching to a second project restores ITS files, not the one the last project loaded (#228)', async () => {
  test.setTimeout(240_000);
  const rootA = makeProject('throng-x228-alpha-', {
    'alpha-one.txt': 'ALPHA-ONE\n',
    'alpha-two.txt': 'ALPHA-TWO\n',
    'alpha-three.txt': 'ALPHA-THREE\n',
  });
  const rootB = makeProject('throng-x228-beta-', { 'beta-one.txt': 'BETA-ONE\n' });
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-x228-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-x228-ud-'));
  // Project B's panel, captured in launch 1 and used in launch 2: a panel id is persisted in the
  // layout, so it survives the restart and names the panel this test is actually about.
  let betaPanel = '';
  try {
    // ── Launch 1: build the layout the report describes, then let it persist ──
    await runApp(
      async (_app, win) => {
        // Project A: two editors in tab 1, and a second tab with a third editor. These are the
        // report's "what works" cases — they must still work after the fix.
        await createProject(win, 'AlphaProj', rootA);
        const a1 = await firstPanelId(win);
        await openFileInPanel(win, a1, 'alpha-one.txt');

        await win.getByTestId(`panel-add-${a1}`).click();
        await expect(win.locator('.panel-box')).toHaveCount(2);
        const a2 = (await panelIds(win)).find((id) => id !== a1) ?? '';
        await win.keyboard.press('Escape'); // leave the new panel's rename box untouched
        await openFileInPanel(win, a2, 'alpha-two.txt');

        await win.getByTestId('tab-add').click();
        await win.keyboard.press('Escape'); // and the new tab's
        const a3 = await firstPanelId(win);
        await openFileInPanel(win, a3, 'alpha-three.txt');

        // Project B, created second so its layout is written after A's.
        await createProject(win, 'BetaProj', rootB);
        betaPanel = await firstPanelId(win);
        await openFileInPanel(win, betaPanel, 'beta-one.txt');

        await win.waitForTimeout(3000); // the debounced layout writes
      },
      { dataDir, userDataDir },
    );

    // ── Launch 2: open A first (as the report does), then switch to B ──
    await runApp(
      async (_app, win) => {
        await enterProject(win, 'AlphaProj');

        // A restores correctly. Only the ACTIVE tab's panels are rendered, and A reopens on the tab
        // it was last on (the second), so each tab is selected before it is read.
        await win.locator('.tab-chip').nth(1).click();
        await expect
          .poll(async () => await openFileNames(win), { timeout: 20_000 })
          .toEqual(['alpha-three.txt']);
        await win.locator('.tab-chip').nth(0).click();
        await expect
          .poll(async () => (await openFileNames(win)).sort(), { timeout: 20_000 })
          .toEqual(['alpha-one.txt', 'alpha-two.txt']);

        // THE DEFECT: switching projects re-points B's editor at the last file A loaded.
        await enterProject(win, 'BetaProj', betaPanel);
        const pid = betaPanel;
        await expect(win.getByTestId(`editor-${pid}`)).toBeVisible({ timeout: 20_000 });

        // Asserted over TIME, not once: the reported symptom is a flash of the right file followed
        // by the wrong one, so a single read taken early would pass while the defect was present.
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'BETA-ONE',
          { timeout: 20_000 },
        );
        await win.waitForTimeout(4000);
        expect(await openFileNames(win)).toEqual(['beta-one.txt']);
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('BETA-ONE');
        await expect(win.getByTestId(`panel-title-${pid}`)).toHaveText('beta-one');

        /*
         * Nothing about this is a missing file, so nothing may say so.
         *
         * 030 US3 / T052 — the consolidated notice is asserted ALONGSIDE the dialog, not instead of
         * it. The missing-file path stopped feeding `editor-notice-dialog` (FR-035), so this
         * assertion alone would now pass against a test id nothing raises: a silent false green on
         * the exact behaviour the test exists to guard. The dialog's line stays because the store is
         * still live for the file-changed and refused-save notices, and a regression there would
         * still be caught here.
         */
        await expect(win.getByTestId('editor-notice-dialog')).toHaveCount(0);
        await expect(win.getByTestId('panel-failure-notice')).toHaveCount(0);
        await expect(win.getByTestId(`editor-unloadable-${pid}`)).toHaveCount(0);
      },
      { dataDir, userDataDir },
    );
  } finally {
    for (const d of [rootA, rootB, dataDir, userDataDir]) cleanupTemp(d);
  }
});

test('a dirty buffer restored in another project keeps ITS OWN path (#228)', async () => {
  test.setTimeout(240_000);
  const rootA = makeProject('throng-x228d-alpha-', { 'alpha-only.txt': 'ALPHA-ONLY\n' });
  const rootB = makeProject('throng-x228d-beta-', { 'beta-only.txt': 'BETA-ONLY\n' });
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-x228d-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-x228d-ud-'));
  let betaPanel = ''; // captured in launch 1; see `enterProject`
  try {
    // ── Launch 1: A clean, B dirty ──
    await runApp(
      async (_app, win) => {
        await createProject(win, 'DirtyAlpha', rootA);
        const a1 = await firstPanelId(win);
        await openFileInPanel(win, a1, 'alpha-only.txt');

        await createProject(win, 'DirtyBeta', rootB);
        betaPanel = await firstPanelId(win);
        await openFileInPanel(win, betaPanel, 'beta-only.txt');

        // Unsaved work in B — the only copy of it, which is what makes this the worse half.
        const content = win.getByTestId(`editor-${betaPanel}`).locator('.cm-content');
        await content.click();
        await win.keyboard.type('BETA-UNSAVED-EDIT');
        await expect(win.getByTestId(`panel-unsaved-${betaPanel}`)).toBeVisible({ timeout: 15_000 });

        await win.waitForTimeout(3000);
      },
      { dataDir, userDataDir },
    );

    // ── Launch 2: open the CLEAN project first, then switch to the dirty one ──
    await runApp(
      async (_app, win) => {
        await enterProject(win, 'DirtyAlpha');
        await expect
          .poll(async () => await openFileNames(win), { timeout: 20_000 })
          .toEqual(['alpha-only.txt']);

        await enterProject(win, 'DirtyBeta', betaPanel);
        const pid = betaPanel;
        await expect(win.getByTestId(`editor-${pid}`)).toBeVisible({ timeout: 20_000 });
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'BETA-UNSAVED-EDIT',
          { timeout: 20_000 },
        );
        await win.waitForTimeout(4000);

        // The recovered buffer stays attached to the file it was edited FROM. A dirty document
        // wearing another project's path is unsaveable by the confinement guard — and saveable, over
        // the wrong file, the moment two projects share a relative path.
        expect(await openFileNames(win)).toEqual(['beta-only.txt']);
        await expect(win.getByTestId(`panel-title-${pid}`)).toHaveText('beta-only');
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
          'BETA-UNSAVED-EDIT',
        );
        await expect(win.getByTestId(`editor-unloadable-${pid}`)).toHaveCount(0);
        await expect(win.getByTestId('editor-notice-dialog')).toHaveCount(0);
        // 030 US3 / T052 — see the note on the first of these: the dialog alone no longer covers the
        // missing-file path, so the consolidated notice is asserted absent too.
        await expect(win.getByTestId('panel-failure-notice')).toHaveCount(0);
      },
      { dataDir, userDataDir },
    );
  } finally {
    for (const d of [rootA, rootB, dataDir, userDataDir]) cleanupTemp(d);
  }
});
