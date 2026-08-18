import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

// US6 / FR-006a (Delivery D; FR-107 refinement): a top-level "Open in OS File
// Explorer" reveal + an "Open In" submenu of editor targets (disabled for an
// already-open file), Send to Tab → New Tab, and the dirty-editor destroy prompt
// (save/discard/cancel; cancel is a no-op).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-menu-'));
  writeFileSync(join(root, 'a.txt'), 'A-BODY\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

const item = (win: Page, label: string) => win.getByTestId(`menu-item-${label}`);

test('Open In submenu holds editor targets; a top-level OS reveal; disables an open file', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MenuProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();

      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });

      // US5 (#158): the OS reveal is now the FIRST item INSIDE the "Open In" submenu, not top-level.
      await expect(item(win, 'OS File Explorer')).toHaveCount(0); // no longer top-level
      await item(win, 'Open In').click();
      await expect(item(win, 'OS File Explorer')).toBeVisible(); // first item of the submenu
      await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).toBeVisible();

      // Choose This editor → the file opens into the editor.
      await win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last().click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('A-BODY', {
        timeout: 8000,
      });

      // Re-open the menu → both targets are now disabled: "New Editor" because the
      // file is open anywhere (FR-072), and "This editor" because it is open in the
      // target editor itself (FR-082).
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await item(win, 'Open In').click();
      await expect(item(win, 'New Editor')).toHaveClass(/context-menu__item--disabled/);
      await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).toHaveClass(/context-menu__item--disabled/);
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * MOVED (034 FR-045): "Send to Tab offers New Tab on the panel menu".
 *
 * It launched Electron, a daemon and a window, created a project against a real temp folder and
 * typed an editor panel into existence — to right-click a panel handle and read one label out of
 * a flyout. Split in two, and both halves were already at the layer that owns them:
 *
 *   DATA → `packages/ui/tests/unit/menu-sections.test.ts`, new describe
 *          "Send to Tab offers New Tab first, then every other Tab (005 FR-027)".
 *   RENDERING → `packages/ui/tests/component/context-menu-lifecycle.test.ts:150`, which already
 *          clicks `menu-item-Send to Tab` open and asserts `submenu-Send to Tab` is visible with
 *          its children reachable — this exact row, in a real DOM.
 *
 * WHY THE GAP EXISTED AT ALL. `menu-sections.test.ts` has pinned `Send to Tab` as a ROW since 033,
 * but `shapeOf` walks `withDividers(actions)`, which is ONE level: it sees the parent and stops.
 * What the submenu actually offers was asserted nowhere below E2E.
 *
 * THE REPLACEMENT SAYS MORE THAN THIS TEST DID. The E2E read a label. The unit tests also fire the
 * rows and assert WHICH action each one calls — so `New Tab` wired to `sendToTab(otherTabs[0])`,
 * which draws an identical menu and silently drops the Panel into Tab 2, now reddens. They also
 * cover the empty-`otherTabs` case this test never reached, where a submenu built as a plain map
 * over the other Tabs would come out empty and the row would be dead.
 *
 * ANTI-VACUITY CONTROL: deleting the `New Tab` entry from the `submenu` array in
 * `panel-header-menu.ts` fails ALL THREE of the new tests (`red-editor-find.mjs --m1`). A second
 * mutation, `--m2`, keeps the label and rewires the action, and reddens exactly the one test the
 * E2E could never have caught.
 *
 * WHAT DID NOT MOVE, from this file: "Open In submenu holds editor targets" also opens the file
 * into a real editor and asserts on `.cm-content`, and the dirty-destroy prompt needs its own
 * config root and removes a real Panel. Both are FR-047 partials — the menu halves would move and
 * the rest would not, so the tests stay whole.
 */

test('destroying a dirty editor prompts save/discard/cancel; cancel is a no-op', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-menu-'));
  // No destroy-confirmation noise — isolate the dirty-close prompt.
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, confirmations: { destroyPanel: 'none' } }),
  );
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'MenuProj', root);
        const pid = await newEditor(win);
        // A second panel so the editor can actually be removed (workspace keeps ≥1).
        await win.getByTestId(`panel-add-${pid}`).click();

        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
        await win.keyboard.type('unsaved');
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

        // Destroy → the save/discard/cancel prompt appears.
        await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
        await item(win, 'Destroy Panel').click();
        await expect(win.getByTestId('dirty-close-dialog')).toBeVisible();

        // Cancel → nothing changes: the editor is still there and still dirty.
        await win.getByTestId('dirty-close-cancel').click();
        await expect(win.getByTestId('dirty-close-dialog')).toHaveCount(0);
        await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
        await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

        // Destroy again → Discard & close → the editor Panel is gone.
        await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
        await item(win, 'Destroy Panel').click();
        await win.getByTestId('dirty-close-discard').click();
        await expect(win.getByTestId(`editor-${pid}`)).toHaveCount(0, { timeout: 6000 });
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(cfgRoot);
  }
});
