/**
 * US4 (#114, spec 024): dragging a file from Files & Folders onto an untyped panel opens it as an
 * editor; a folder or multi-select is rejected (the panel stays untyped). Driven through the
 * throng:tree-drop seam (a real react-dnd → native drop is not scriptable).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openApp, createProject, firstPanelId, cleanupTemp, type OpenApp } from './harness.js';

function treeDrop(win: Page, panelId: string, paths: string[], singleFile: boolean): Promise<void> {
  return win.evaluate(
    ([id, list, single]) => {
      window.dispatchEvent(
        new CustomEvent('throng:tree-drop', {
          detail: { panelId: id, paths: list, singleFile: single },
        }),
      );
    },
    [panelId, paths, singleFile] as const,
  );
}

/** The same seam, aimed at a TAB CHIP rather than a panel (024 US4 follow-up). */
function treeDropOnTab(win: Page, tabId: string, paths: string[], singleFile: boolean): Promise<void> {
  return win.evaluate(
    ([id, list, single]) => {
      window.dispatchEvent(
        new CustomEvent('throng:tree-drop', {
          detail: { tabId: id, paths: list, singleFile: single },
        }),
      );
    },
    [tabId, paths, singleFile] as const,
  );
}


/*
 * ONE APP FOR THE FILE (034 FR-045).
 *
 * Five tests, five `runApp()` calls, five Electron launches and five daemons. Nothing here seeds
 * state before the app starts — every project is created in-app — so the file shares one.
 *
 * Sharing is safe here for a reason worth naming, because it is what has to be checked before any
 * other file is converted: each test creates its OWN project under its own temp root, and only the
 * ACTIVE project renders. So the window-wide locators below — the untyped panel it picks, the count
 * of editors showing a document — see this test’s project and no other, and every document body is
 * unique to the test that wrote it.
 *
 * Each test still makes and cleans up its own temp root; that never depended on the app launch.
 */
let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

test('a single tree file dropped on an untyped panel opens it as an editor (#114)', { tag: ['@extended', '@explorer'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-treeopen-'));
  writeFileSync(join(root, 'hello.txt'), 'HELLO-FROM-TREE\n');
  try {
    const win = shared.win;
    await createProject(win, 'TreeOpenProj', root);
    const pid = await firstPanelId(win);
    // The first panel is untyped (type-selection form).
    await expect(win.getByTestId(`panel-type-select-${pid}`)).toBeVisible();

    // A single file → becomes an editor showing the file.
    await treeDrop(win, pid, [join(root, 'hello.txt')], true);
    await expect(win.getByTestId(`editor-${pid}`)).toBeVisible({ timeout: 8000 });
    await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
      'HELLO-FROM-TREE',
      { timeout: 8000 },
    );
    // The panel titles itself from the dropped file — a drop is not a lesser way to open one
    // (024 US5 follow-up).
    await expect(win.getByTestId(`panel-title-${pid}`)).toHaveText('hello', { timeout: 8000 });
  } finally {
    cleanupTemp(root);
  }
});

test('dropping an already-open file focuses the existing editor, not a second view (#114)', { tag: ['@extended', '@explorer'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-treeopen2-'));
  writeFileSync(join(root, 'shared.txt'), 'SHARED-DOC\n');
  try {
    const win = shared.win;
    await createProject(win, 'SharedProj', root);
    const p1 = await firstPanelId(win);
    // Panel 1 opens the file as an editor.
    await win.getByTestId(`panel-type-select-${p1}`).selectOption('editor');
    await win.getByTestId(`panel-type-confirm-${p1}`).click();
    await win.getByTestId(`editor-${p1}`).click();
    await win.getByTestId('file-explorer-tree').getByText('shared.txt', { exact: true }).click();
    await expect(win.getByTestId(`editor-${p1}`).locator('.cm-content')).toContainText('SHARED-DOC', {
      timeout: 8000,
    });

    // A second, untyped panel.
    await win.getByTestId(`panel-add-${p1}`).click();
    const ids = await win.locator('[data-testid^="panel-type-select-"]').evaluateAll((els) =>
      els.map((e) => (e.getAttribute('data-testid') ?? '').replace('panel-type-select-', '')),
    );
    const p2 = ids[0];
    expect(p2).toBeTruthy();

    // Dropping the already-open file on the untyped panel → it stays untyped (no second view).
    await treeDrop(win, p2, [join(root, 'shared.txt')], true);
    // The real effect of "already open elsewhere" is p1 — the panel already showing it — being
    // refocused (FR-011b, `acceptTreeDrop` in panel-body.tsx). Wait for that rather than a fixed
    // duration; it is also this test's own name for what the drop does.
    await expect(win.getByTestId(`panel-${p1}`)).toHaveAttribute('data-active', 'true');
    await expect(win.getByTestId(`panel-type-select-${p2}`)).toBeVisible();
    await expect(win.getByTestId(`editor-${p2}`)).toHaveCount(0);
    // Exactly one editor still shows the doc.
    expect(await win.locator('.cm-content', { hasText: 'SHARED-DOC' }).count()).toBe(1);
  } finally {
    cleanupTemp(root);
  }
});

test('a tree file dropped on an EXISTING editor opens it in that editor (#114 follow-up)', { tag: ['@extended', '@explorer'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-treeeditor-'));
  writeFileSync(join(root, 'first.txt'), 'FIRST-DOC\n');
  writeFileSync(join(root, 'second.txt'), 'SECOND-DOC\n');
  try {
    const win = shared.win;
    await createProject(win, 'TreeEditorProj', root);
    const pid = await firstPanelId(win);
    // An editor already holding a file — the drop must land HERE, not in a new panel.
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();
    await win.getByTestId(`editor-${pid}`).click();
    await win.getByTestId('file-explorer-tree').getByText('first.txt', { exact: true }).click();
    await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
      'FIRST-DOC',
      { timeout: 8000 },
    );

    await treeDrop(win, pid, [join(root, 'second.txt')], true);
    await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
      'SECOND-DOC',
      { timeout: 8000 },
    );
    // The same rules as any other open: one editor, not a second panel for the same file.
    expect(await win.locator('.cm-content', { hasText: 'SECOND-DOC' }).count()).toBe(1);
    // …and it names itself from the dropped file, exactly as a click would (024 US5).
    await expect(win.getByTestId(`panel-title-${pid}`)).toHaveText('second', { timeout: 8000 });
  } finally {
    cleanupTemp(root);
  }
});

test('a tree file dropped on a TAB CHIP opens it in that tab and brings the tab forward (#114 follow-up)', { tag: ['@extended', '@explorer'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-treetab-'));
  writeFileSync(join(root, 'other.txt'), 'OTHER-TAB-DOC\n');
  try {
    const win = shared.win;
    await createProject(win, 'TreeTabProj', root);
    const p1 = await firstPanelId(win);

    // A second tab, which then becomes the BACKGROUND tab (adding one activates it, so switch back).
    await win.getByTestId('tab-add').click();
    await win.keyboard.press('Escape'); // a new tab opens in rename mode
    const tabIds = await win
      .locator('.tab-strip .tab-chip')
      .evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice(4)));
    expect(tabIds.length).toBe(2);
    const [firstTab, secondTab] = tabIds;
    await win.getByTestId(`tab-${firstTab}`).click();
    await expect(win.getByTestId(`tab-${firstTab}`)).toHaveAttribute('data-active', 'true');
    // The first tab's panel is still untyped, so nothing here can claim the file.
    await expect(win.getByTestId(`panel-type-select-${p1}`)).toBeVisible();

    // Dropping the file on the OTHER tab's chip activates that tab and opens the file there.
    await treeDropOnTab(win, secondTab, [join(root, 'other.txt')], true);
    await expect(win.getByTestId(`tab-${secondTab}`)).toHaveAttribute('data-active', 'true', {
      timeout: 8000,
    });
    await expect(win.locator('.cm-content', { hasText: 'OTHER-TAB-DOC' })).toHaveCount(1, {
      timeout: 8000,
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a folder or multi-select dropped on an untyped panel is rejected (#114)', { tag: ['@extended', '@explorer'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-treereject-'));
  writeFileSync(join(root, 'a.txt'), 'A\n');
  writeFileSync(join(root, 'b.txt'), 'B\n');
  try {
    const win = shared.win;
    await createProject(win, 'RejectProj', root);
    const pid = await firstPanelId(win);
    await expect(win.getByTestId(`panel-type-select-${pid}`)).toBeVisible();

    // Multi-select (singleFile false) → rejected, panel stays untyped.
    await treeDrop(win, pid, [join(root, 'a.txt'), join(root, 'b.txt')], false);
    // sleep-justified: acceptTreeDrop's rejection is a bare early return (panel-body.tsx) — no
    // sleep-justified: state changes, so there is nothing to become visible/absent/active to wait
    // sleep-justified: on; a fixed pause is the only way to let a wrongly-accepted drop have had
    // sleep-justified: time to show itself before asserting the panel is still untyped.
    await win.waitForTimeout(400);
    await expect(win.getByTestId(`panel-type-select-${pid}`)).toBeVisible();
    await expect(win.getByTestId(`editor-${pid}`)).toHaveCount(0);
  } finally {
    cleanupTemp(root);
  }
});
