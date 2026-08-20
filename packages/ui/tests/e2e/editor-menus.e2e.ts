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

/**
 * ── THE DIALOG ITSELF MOVED (035 T055) ──
 *
 * `packages/ui/tests/component/dirty-close-dialog.test.ts` now owns what the prompt SAYS and what
 * each answer resolves to. `dirty-close-store.ts` had no test of any kind before that.
 *
 * The rule most worth having was asserted nowhere, and `dirty-close-dialog.tsx` states it plainly:
 *
 *   > A dismissal (overlay click / Escape) is a CANCEL — the safe answer. It must never be read as
 *   > consent to discard someone's unsaved work.
 *
 * That is the difference between a stray Escape closing a panel and a stray Escape doing nothing,
 * and it comes down to one `?? 'cancel'`. Red-proven by flipping it to `'discard'`.
 *
 * Two more went with it: Discard is marked DANGEROUS (nothing else on screen separates "close and
 * lose it" from "close and keep it"), and the file names are set APART rather than buried in the
 * sentence — they are what the user has to read before answering.
 *
 * ── WHAT STAYS HERE ──
 *
 * That the panel-header Destroy actually RAISES this prompt for a dirty editor, that Cancel leaves
 * the panel and its dirty state exactly as they were, and that Discard removes it. Those are the
 * workspace's, reached through a real menu on a real dirty CodeMirror.
 */
/*
 * ── ONE REMOVED (035 T056) ──
 *
 * `:28` "Open In submenu holds editor targets; a top-level OS reveal; disables an open file" — a
 * strict duplicate, four times over. It launched Electron, a daemon and a real project to make four
 * assertions that already had named homes:
 *
 *   the OS reveal is NOT top-level and leads the flyout
 *     → `component/menu-section-rendering.test.ts:204`
 *   "Last Active Editor" is offered, and names its panel
 *     → `component/explorer-open-in-target.test.ts:292`
 *   choosing it routes the file to the tab's last active editor
 *     → `component/editor-open-routing.test.ts:291`
 *   both targets then go quiet — New Editor by FR-011a, Last Active Editor by FR-082
 *     → `component/explorer-open-in-target.test.ts:382` and `:468`
 *
 * Each was red-proven against a mutation of the rule it names before this was deleted:
 * `fr082-never-disabled` (2 red), `fr011a-never-disabled` (1), `os-reveal-top-level` (3).
 * The last reddens a THIRD test nobody had cited — the section-rule count for a file row — because
 * moving the reveal out of the flyout changes where the dividers fall.
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
