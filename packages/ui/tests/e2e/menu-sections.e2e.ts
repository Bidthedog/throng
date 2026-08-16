/**
 * US5 / SC-010 — the check that ENUMERATES the menus (033, T055).
 *
 * SC-010 asks for "one check that enumerates the menus rather than a per-menu eyeball". This is it,
 * in the running app: every menu the app can draw is opened in turn, its rendered `<li>` order is
 * read straight out of the DOM, and `.context-menu__separator` is required to appear at **every**
 * section boundary and **nowhere else** (FR-048, FR-050).
 *
 * The sibling unit table (`packages/ui/tests/unit/menu-sections.test.ts`) drives the same builders
 * over far more fixtures, far more cheaply. What only THIS layer can answer is whether the derived
 * dividers actually reach the screen — the join happens inside `ContextMenu`, per level, and a
 * builder that groups correctly into a renderer that forgot to join would pass the unit table and
 * ship an ungrouped menu.
 *
 * Covers AS-1 to AS-8, and FR-027/G9 (Go To Line on the editor's content menu, showing its chord).
 *
 * This file drives context menus throughout and starts a real PowerShell terminal, so it belongs in
 * the SERIAL tier of `parallel-plan.json` (throng closes menus when its window loses focus, and a
 * real shell starves at high worker counts).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test. No test here seeds state before launch, so a shared app
 * saves eight Electron launches; serial mode is required because they share a window and database.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error('this file shares one app; a test needing launch options must open its own');
  }
  return fn(shared.app, shared.win);
};

let projectSeq = 0;
const createProject = (win: Page, name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-menusec-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'lines.txt'), 'alpha\nbeta\ngamma\n');
  return root;
}

/**
 * The rendered menu, one entry per direct `<li>` — a label, or `'—'` for a divider.
 *
 * Read from the DOM rather than from a locator count, because the QUESTION is about order and
 * adjacency: "how many separators are there" cannot distinguish a divider in the right place from
 * one in the wrong place, and that distinction is the whole of FR-050.
 */
async function menuShape(win: Page, testId = 'context-menu'): Promise<string[]> {
  return win.evaluate((id) => {
    const ul = document.querySelector(`[data-testid="${id}"]`);
    if (!ul) return [];
    return [...ul.children].map((li) =>
      li.classList.contains('context-menu__separator')
        ? '—'
        : (li.querySelector('.context-menu__label')?.textContent ?? '?'),
    );
  }, testId);
}

/** The invariants that hold for EVERY menu, whatever it contains (M5, FR-050). */
function expectWellFormed(shape: string[], where: string): void {
  expect(shape.length, `${where}: menu is empty`).toBeGreaterThan(0);
  expect(shape[0], `${where}: begins with a divider`).not.toBe('—');
  expect(shape.at(-1), `${where}: ends with a divider`).not.toBe('—');
  shape.forEach((entry, i) => {
    if (entry === '—') {
      expect(shape[i + 1], `${where}: two dividers in a row at ${i}`).not.toBe('—');
    }
  });
}

/**
 * Dismiss whatever menu is open, so the next right-click starts from nothing.
 *
 * Escape unwinds ONE LEVEL per press — inside a submenu it closes just that submenu and returns to
 * the parent, and only at the root does it close the whole menu (`context-menu.tsx`, the `Escape`
 * case). So a single press is not "close the menu", it is "go up one", and a test that has opened a
 * submenu is still holding an open menu afterwards. Bounded, and it asserts the outcome rather than
 * assuming it.
 */
async function closeMenu(win: Page): Promise<void> {
  for (let level = 0; level < 4; level += 1) {
    if ((await win.locator('.context-menu').count()) === 0) break;
    await win.keyboard.press('Escape');
  }
  await expect(win.locator('.context-menu')).toHaveCount(0);
}

/**
 * The labels the keyboard can actually reach, in order — dividers and DISABLED items excluded.
 *
 * Both exclusions are the component's (`enabled` in `context-menu.tsx` drops `separator` and
 * `disabled` alike), and the disabled half is easy to forget: on a fresh project the explorer menu
 * opens with Paste, Undo and Redo all greyed out, so "arrow through every row" and "arrow through
 * every row you can reach" are different sequences.
 */
async function focusableLabels(win: Page, testId = 'context-menu'): Promise<string[]> {
  return win.evaluate((id) => {
    const ul = document.querySelector(`[data-testid="${id}"]`);
    if (!ul) return [];
    return [...ul.children]
      .filter(
        (li) =>
          !li.classList.contains('context-menu__separator') &&
          li.getAttribute('aria-disabled') !== 'true',
      )
      .map((li) => li.querySelector('.context-menu__label')?.textContent ?? '?');
  }, testId);
}

async function openEditorWithFile(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('alpha', {
    timeout: 8000,
  });
  return pid;
}

// ---------------------------------------------------------------------------
// AS-1 — the Files & Folders menu: a divider between each pair of adjacent
// sections, and nowhere else.
// ---------------------------------------------------------------------------

test('AS-1 — a file row draws its four dividers exactly at the four section boundaries', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Sections', root);
      const tree = win.getByTestId('file-explorer-tree');

      await tree.getByText('lines.txt', { exact: true }).click({ button: 'right' });
      await expect(win.locator('.context-menu')).toBeVisible();

      const shape = await menuShape(win);
      expectWellFormed(shape, 'file row');
      /*
       * ZERO MOVEMENT (contracts/menu-sections.md §3.1). These four boundaries are where the four
       * hand-pushed separators sat before US5 derived them — which is the evidence that the section
       * vocabulary really was derived from this menu rather than imposed on it.
       */
      expect(shape).toEqual([
        'Rename',
        'Cut',
        'Copy',
        'Paste',
        'Undo',
        'Redo',
        '—',
        'New File',
        'New Folder',
        '—',
        'Delete',
        '—',
        'Open In',
        'Copy Path',
        '—',
        'Hide in this project',
      ]);
      await closeMenu(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('AS-1 — a folder row and the tree’s empty space are sectioned too', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Sections', root);
      const tree = win.getByTestId('file-explorer-tree');

      await tree.getByText('src', { exact: true }).click({ button: 'right' });
      await expect(win.locator('.context-menu')).toBeVisible();
      const folder = await menuShape(win);
      expectWellFormed(folder, 'folder row');
      // Content · Create · Destroy · Navigate · View & state — four boundaries, same as a file.
      expect(folder.filter((e) => e === '—')).toHaveLength(4);
      expect(folder.indexOf('Delete')).toBe(folder.indexOf('New Folder') + 2);
      await closeMenu(win);

      /*
       * The EMPTY SPACE targets the root, which has no Rename/Cut/Copy, no Delete and no Hide — so
       * its Destroy and View & state groups are empty. M5 says an empty group draws no divider, and
       * this is the case that proves it: two boundaries, not four, and none at either end.
       *
       * Asserted EXHAUSTIVELY, deliberately, and this is the one menu where that is worth the
       * maintenance. "No divider is drawn for an empty group" is a claim about what is ABSENT, and
       * absence cannot be checked by counting dividers or by naming the items you expect — only by
       * pinning the whole list. The folder row above is asserted generically for the opposite
       * reason: it grows, and a list that grows is a list that goes stale.
       *
       * Which this one just did. US4 (FR-038) appends Collapse/Expand All Children to the Navigate
       * group for any FOLDER — and the root is a folder, so the tree's empty space gets them too.
       * That is the behaviour the spec's own edge case describes ("Collapse All Children on the
       * project root — the root stays open, it is the tree"), which is only writable because the
       * item is drawn there. They land at the TAIL of an existing group, so both boundaries stayed
       * exactly where they were.
       */
      await tree.click({ button: 'right', position: { x: 20, y: 300 } });
      await expect(win.locator('.context-menu')).toBeVisible();
      const empty = await menuShape(win);
      expectWellFormed(empty, 'empty space');
      expect(empty).toEqual([
        'Paste',
        'Undo',
        'Redo',
        '—',
        'New File',
        'New Folder',
        '—',
        'Open In',
        'Copy Path',
        'Collapse All Children',
        'Expand All Children',
      ]);
      await closeMenu(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

// ---------------------------------------------------------------------------
// AS-2 / FR-027 / G9 — the editor's content menu.
// ---------------------------------------------------------------------------

test('AS-2 — the editor content menu is three sections, with Go To Line between them (FR-027)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Sections', root);
      const pid = await openEditorWithFile(win);

      await win
        .getByTestId(`editor-${pid}`)
        .locator('.cm-line')
        .filter({ hasText: 'beta' })
        .first()
        .click({ button: 'right' });
      await expect(win.locator('.context-menu')).toBeVisible();

      const shape = await menuShape(win);
      expectWellFormed(shape, 'editor content');
      // Content · Navigate · View & state. No existing item moves; two dividers appear and one item
      // is inserted between them.
      expect(shape.slice(0, 7)).toEqual(['Cut', 'Copy', 'Paste', 'Select All', 'Undo', 'Redo', '—']);
      expect(shape[7]).toBe('Go To Line…');
      expect(shape[8]).toBe('—');
      expect(shape[9]).toContain('Set Language…');
      expect(shape.at(-1)).toContain('Word Wrap');
      expect(shape.filter((e) => e === '—')).toHaveLength(2);

      // G9 — the item names the chord it is bound to RIGHT NOW, read live from the keybindings.
      await expect(win.getByTestId('menu-shortcut-Go To Line…')).toHaveText('(Ctrl+G)');
      await closeMenu(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

// ---------------------------------------------------------------------------
// AS-3 — the panel header menu, with the destructive item in a section of its own.
// ---------------------------------------------------------------------------

test('AS-3 — the panel header menu is sectioned and its destroy verb stands alone', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Sections', root);
      const pid = await firstPanelId(win);

      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await expect(win.locator('.context-menu')).toBeVisible();

      const shape = await menuShape(win);
      expectWellFormed(shape, 'panel header');

      // Content(Rename) · Destroy(Destroy Panel) · Navigate(Send to Tab, …) · View & state(…).
      const destroy = shape.findIndex((e) => e.endsWith(' Panel'));
      expect(destroy, 'the destroy verb is on the menu').toBeGreaterThan(0);
      // A section of its own: a divider on each side, and nothing else between them (AS-3).
      expect(shape[destroy - 1]).toBe('—');
      expect(shape[destroy + 1]).toBe('—');
      // Rename leads (Content), and Reset Name has left its side for View & state.
      expect(shape[0]).toBe('Rename');
      expect(shape.indexOf('Reset Name')).toBeGreaterThan(shape.indexOf('Send to Tab'));
      await closeMenu(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

// ---------------------------------------------------------------------------
// AS-4 — the tab context menu.
// ---------------------------------------------------------------------------

test('AS-4 — a tab’s destructive items are separated from the rest', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Sections', root);
      /*
       * `.tab-chip`, NOT `[data-testid^="tab-"]`.
       *
       * That prefix matches eight different things — `tab-strip`, `tab-body`, `tab-add`,
       * `tab-insert-indicator`, `tab-title-<id>`, `tab-unsaved-<id>`, `tab-count-<id>` and the tab
       * chip itself — so `.first()` took whichever came first in DOM order, which is a CONTAINER.
       * Right-clicking a container opens no menu at all, and the failure then looks like a broken
       * menu rather than a broken selector.
       *
       * `.tab-chip` is what the rest of the suite uses to reach a tab (`context-menu.e2e.ts:99`
       * opens this very menu that way), so this is the established driver rather than a new one.
       */
      const tab = win.locator('.tab-chip').first();
      await tab.click({ button: 'right' });
      await expect(win.locator('.context-menu')).toBeVisible();

      const shape = await menuShape(win);
      expectWellFormed(shape, 'tab menu');
      // Content(Rename) · Destroy(Destroy Tab, Destroy other tabs) · Navigate(Sync to). *Sync to*
      // moves from second to last — FR-047's fixed order; FR-053 protects order WITHIN a section.
      expect(shape).toEqual([
        'Rename',
        '—',
        'Destroy Tab',
        'Destroy other tabs',
        '—',
        'Sync to',
      ]);
      await closeMenu(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

// ---------------------------------------------------------------------------
// AS-5 / AS-6 — a menu whose items fall in one section carries no divider.
// ---------------------------------------------------------------------------

test('AS-5/AS-6 — the cog menu is one undivided Application section', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Sections', root);
      await win.getByTestId('title-bar-cog').click();
      await expect(win.getByTestId('cog-menu')).toBeVisible();

      const shape = await menuShape(win, 'cog-menu');
      expect(shape).toEqual([
        'Settings',
        'Key Bindings',
        'Themes',
        'Open Logs Folder',
        'About throng',
      ]);
      // Corrected 2026-08-15: all five are Application, and FR-050 permits a divider only at a real
      // boundary — so there is NO divider anywhere in this menu.
      // `await`ed. Without it this is a floating promise that gates nothing and passes whatever
      // the menu contains — the same vacuous-guard shape as the #244 defect this feature fixes.
      await expect(win.getByTestId('cog-menu').locator('.context-menu__separator')).toHaveCount(0);
      // The identifiers roughly ten preferences suites reach the window through (FR-053).
      await expect(win.getByTestId('cog-menu-settings')).toBeVisible();
      await expect(win.getByTestId('cog-menu-about')).toBeVisible();
      await closeMenu(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('AS-6 — a single-section SUBMENU carries no divider either (per level, M3)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Sections', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('lines.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Copy Path').click();

      const sub = win.getByTestId('submenu-Copy Path');
      await expect(sub).toBeVisible();
      // All four forms are Navigate — one group, no boundary. The join runs per LEVEL, so a submenu
      // that got the parent's dividers would show up here and nowhere else.
      await expect(sub.locator('.context-menu__separator')).toHaveCount(0);
      await expect(sub.locator('.context-menu__item')).toHaveCount(4);
      await closeMenu(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

// ---------------------------------------------------------------------------
// AS-7 — the terminal's contextual items lead the menu.
// ---------------------------------------------------------------------------

/** Open a PowerShell terminal in the first panel and wait for its prompt. */
async function openTerminal(win: Page, root: string): Promise<Locator> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
  const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(root.split(/[\\/]/).pop()!, { timeout: 25_000 });
  return term;
}

test('AS-7 — the terminal content menu: link items lead it, and the failure trio is undivided', async () => {
  const root = makeProject();
  const url = 'https://example.test/menu-sections';
  writeFileSync(join(root, 'lnk.ps1'), `Write-Host "${url}"\n`);
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Sections', root);
      const term = await openTerminal(win, root);

      // WITHOUT a link under the pointer: Content(Copy, Paste) · View & state(Refresh / redraw).
      // The failure trio is absent while the terminal is healthy, so one boundary, not two.
      await term.click({ button: 'right' });
      await expect(win.locator('.context-menu')).toBeVisible();
      const plain = await menuShape(win);
      expectWellFormed(plain, 'terminal content');
      expect(plain).toEqual(['Copy', 'Paste', '—', 'Refresh / redraw terminal']);
      await closeMenu(win);

      // WITH a link under the pointer. xterm is on its DOM renderer here, so the printed line is a
      // real element; xterm only resolves a link once the pointer RESTS on it, which is why this is
      // an explicit move-and-wait rather than a right-click at coordinates.
      await term.click();
      await win.keyboard.type('.\\lnk.ps1');
      await win.keyboard.press('Enter');
      await expect(term).toContainText(url, { timeout: 25_000 });

      const row = win.locator('.xterm-rows > div', { hasText: url }).last();
      await expect(row).toBeVisible({ timeout: 20_000 });
      const box = (await row.boundingBox())!;
      const cols = await win.evaluate(
        () => document.querySelectorAll('.xterm-rows > div')[0]?.textContent?.length ?? 80,
      );
      const x = box.x + (box.width / Math.max(cols, 40)) * 4;
      const y = box.y + box.height / 2;
      await win.mouse.move(x, y);
      await win.waitForTimeout(300);
      await win.mouse.click(x, y, { button: 'right' });

      await expect(win.getByTestId('menu-item-Open Link')).toBeVisible();
      const linked = await menuShape(win);
      expectWellFormed(linked, 'terminal content with link');
      // Contextual LEADS, separated from the rest — Assumption 8 records that demoting these below
      // Copy/Paste was rejected as a behaviour regression shipped under a grouping pass.
      expect(linked).toEqual([
        'Open Link',
        'Copy Link Address',
        '—',
        'Copy',
        'Paste',
        '—',
        'Refresh / redraw terminal',
      ]);
      await closeMenu(win);
    });
  } finally {
    cleanupTemp(root);
  }
});

// ---------------------------------------------------------------------------
// AS-8 — dividers are skipped by the keyboard and never take focus (FR-051).
// ---------------------------------------------------------------------------

test('AS-8 — arrowing through a menu with dividers never lands on one', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Sections', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('lines.txt', { exact: true }).click({ button: 'right' });
      await expect(win.locator('.context-menu')).toBeVisible();

      const shape = await menuShape(win);
      // Guard the guard: arrowing through a menu with NO dividers would pass this test while
      // proving nothing about FR-051. The file row has four.
      expect(shape.filter((e) => e === '—').length, 'nothing to step over').toBeGreaterThan(0);

      const reachable = await focusableLabels(win);
      expect(reachable.length, 'nothing to step onto').toBeGreaterThan(0);

      // Step onto every reachable row in turn. A divider taking focus would show up as a focused
      // element carrying the separator class; a divider that merely stalled navigation would show
      // up as a repeated label.
      const visited: string[] = [];
      for (let i = 0; i < reachable.length; i += 1) {
        await win.keyboard.press('ArrowDown');
        const focused = await win.evaluate(() => {
          const el = document.activeElement;
          return {
            separator: el?.classList.contains('context-menu__separator') ?? false,
            label: el?.querySelector('.context-menu__label')?.textContent ?? '',
          };
        });
        expect(focused.separator, `step ${i} landed on a divider`).toBe(false);
        visited.push(focused.label);
      }
      // Every reachable row, once, in order — so the arrows stepped OVER the dividers rather than
      // stopping at them.
      expect(visited).toEqual(reachable);
      await closeMenu(win);
    });
  } finally {
    cleanupTemp(root);
  }
});
