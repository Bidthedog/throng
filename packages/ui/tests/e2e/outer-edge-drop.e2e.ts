import { cpSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  cleanupTemp,
  createProject,
  firstPanelId,
  focusEditor,
  openApp,
  panelIds,
  runApp,
  splitPanelViaMenu,
  type OpenApp,
  type SplitDirectionName,
} from './harness.js';

/*
 * 048 US4 — dropping a panel on a tab's OUTER edge makes it run along the whole edge at one third of the
 * axis, while the rest of the tab keeps its arrangement (SC-005).
 *
 * WHAT ONLY A REAL WINDOW CAN SHOW: a real pointer crossing real bands, the preview drawn while it is
 * over one (distinct from the solid split highlight of a panel's own edge), and the resulting geometry.
 * jsdom has no layout, so `pointerWithin` finds nothing there. The pure parts — ids, which band wins at a
 * corner, the stylesheet — are `unit/outer-edge-zones.test.ts`; the store wrapper and the drag lifecycle
 * are `component/drag-cancel.test.ts`.
 */

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxes(win: Page): Promise<Record<string, Rect>> {
  return win.locator('.panel-box').evaluateAll((els) => {
    const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const el of els) {
      const r = el.getBoundingClientRect();
      out[(el as HTMLElement).dataset.panelId ?? ''] = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    return out;
  });
}

async function tabBody(win: Page): Promise<Rect> {
  const box = await win.getByTestId('tab-body').boundingBox();
  if (!box) throw new Error('the tab body has no box');
  return box;
}

async function splitAndFind(win: Page, panelId: string, direction: SplitDirectionName): Promise<string> {
  const before = await panelIds(win);
  await splitPanelViaMenu(win, panelId, direction);
  await expect(win.locator('.panel-box')).toHaveCount(before.length + 1);
  const added = (await panelIds(win)).find((id) => !before.includes(id));
  if (!added) throw new Error('the split added no panel');
  return added;
}

/** A 2x2 (p1 over p3 | p2 over p4) plus a fifth panel p5 to the right of p4. */
async function buildGridPlusOne(win: Page): Promise<{ p1: string; p2: string; p3: string; p4: string; p5: string }> {
  const p1 = await firstPanelId(win);
  const p2 = await splitAndFind(win, p1, 'right');
  const p3 = await splitAndFind(win, p1, 'down');
  const p4 = await splitAndFind(win, p2, 'down');
  const p5 = await splitAndFind(win, p4, 'right');
  return { p1, p2, p3, p4, p5 };
}

/** Drag a panel by its header to the centre of the target element, stopping short of the drop. */
async function dragOnto(win: Page, sourceId: string, target: () => ReturnType<Page['getByTestId']>): Promise<void> {
  const handle = win.getByTestId(`panel-handle-${sourceId}`);
  const box = await handle.boundingBox();
  if (!box) throw new Error('source handle has no box');
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  // Past the @dnd-kit activation distance, so the drag starts and the zones render.
  await win.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 3 });
  const zone = target();
  await zone.waitFor({ state: 'visible' });
  const zbox = await zone.boundingBox();
  if (!zbox) throw new Error('drop target has no box');
  await win.mouse.move(zbox.x + zbox.width / 2, zbox.y + zbox.height / 2, { steps: 6 });
}

async function dropOnOuterEdge(win: Page, sourceId: string, edge: 'left' | 'right' | 'top' | 'bottom'): Promise<void> {
  await dragOnto(win, sourceId, () => win.getByTestId(`outer-edge-${edge}`));
  // FR-065 — the preview is showing, and it is not the solid split highlight of a panel's own edge zone.
  await expect(win.getByTestId(`outer-edge-preview-${edge}`)).toBeVisible();
  await expect(win.locator('.edge-zone--over')).toHaveCount(0);
  await win.mouse.up();
  await expect(win.getByTestId('outer-edge-zones')).toHaveCount(0);
}

function near(actual: number, expected: number, tolerance: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${actual} is not within ${tolerance} of ${expected}`).toBeLessThanOrEqual(tolerance);
}

test('a panel dropped on the left band becomes a full-height third beside the unchanged grid (SC-005, FR-068)', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  test.setTimeout(180_000);
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-outer-left-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-outer-left-ud-'));
  try {
    let p5 = '';
    await runApp(
      async (_app, win) => {
        await createProject(win, 'OuterLeft', 'C:/c/outerleft');
        const ids = await buildGridPlusOne(win);
        p5 = ids.p5;
        const gridBefore = await boxes(win);
        const body = await tabBody(win);

        await dropOnOuterEdge(win, p5, 'left');

        const after = await boxes(win);
        await expect(win.locator('.panel-box')).toHaveCount(5);
        // p5: the whole height, the left edge, a third of the width.
        near(after[p5]!.x, body.x, body.width * 0.05, 'p5 starts at the left edge');
        near(after[p5]!.height, body.height, body.height * 0.06, 'p5 spans the whole height');
        near(after[p5]!.width, body.width / 3, body.width * 0.05, 'p5 is a third of the width');
        // The grid: same rows (heights unchanged), all of it now to the right of p5.
        for (const id of [ids.p1, ids.p2, ids.p3, ids.p4]) {
          near(after[id]!.height, gridBefore[id]!.height, 2, `${id} kept its height`);
          expect(after[id]!.x, `${id} is right of p5`).toBeGreaterThanOrEqual(after[p5]!.x + after[p5]!.width - 2);
        }

        // The layout is written behind a debounce; wait for the saved document, not a duration.
        await expect
          .poll(
            () => {
              let db: InstanceType<typeof Database> | undefined;
              try {
                db = new Database(join(dataDir, 'throng.db'), { readonly: true });
                const row = db
                  .prepare(
                    `SELECT w.layout_json AS json FROM workspace_layout w
                       JOIN projects p ON p.id = w.project_id WHERE p.name = ?`,
                  )
                  .get('OuterLeft') as { json?: string } | undefined;
                // The root is a row whose FIRST child is p5 — the drop's shape, not just five panels.
                const layout = row?.json ? (JSON.parse(row.json) as { tabs: { root: { children?: { id?: string }[] } }[] }) : null;
                return layout?.tabs[0]?.root.children?.[0]?.id === p5;
              } catch {
                return false;
              } finally {
                db?.close();
              }
            },
            { timeout: 15_000, message: 'the outer-edge layout was never persisted' },
          )
          .toBe(true);
      },
      { dataDir, userDataDir },
    );

    await runApp(
      async (_app, win) => {
        const item = win.locator('.project-item', { hasText: 'OuterLeft' });
        await expect(item).toBeVisible({ timeout: 20_000 });
        const sw = item.locator('[data-testid^="project-switch-"]');
        if (await sw.isVisible().catch(() => false)) await sw.click();
        await expect(win.locator('.panel-box')).toHaveCount(5, { timeout: 20_000 });
        const restored = await boxes(win);
        const body = await tabBody(win);
        near(restored[p5]!.width, body.width / 3, body.width * 0.05, 'p5 is still a third after a restart');
        near(restored[p5]!.height, body.height, body.height * 0.06, 'p5 still spans the whole height after a restart');
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});

test('a panel dropped on the bottom band becomes a full-width third row (SC-005)', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  const win = shared.win;
  await createProject(win, 'OuterBottom', 'C:/c/outerbottom');
  const { p1, p2, p3, p4, p5 } = await buildGridPlusOne(win);
  const gridBefore = await boxes(win);
  const body = await tabBody(win);

  await dropOnOuterEdge(win, p5, 'bottom');

  const after = await boxes(win);
  await expect(win.locator('.panel-box')).toHaveCount(5);
  near(after[p5]!.width, body.width, body.width * 0.05, 'p5 spans the whole width');
  near(after[p5]!.height, body.height / 3, body.height * 0.06, 'p5 is a third of the height');
  near(after[p5]!.y + after[p5]!.height, body.y + body.height, body.height * 0.05, 'p5 sits on the bottom edge');
  // p1–p3 keep their widths. p4 was halved to make room for p5, so with p5 gone it takes back the
  // whole column — the width p2 has above it.
  for (const id of [p1, p2, p3]) near(after[id]!.width, gridBefore[id]!.width, 2, `${id} kept its width`);
  near(after[p4]!.width, gridBefore[p2]!.width, 2, `${p4} took back its column`);
  for (const id of [p1, p2, p3, p4]) {
    expect(after[id]!.y + after[id]!.height, `${id} is above p5`).toBeLessThanOrEqual(after[p5]!.y + 2);
  }
});

test('a drop on a panel\'s own edge zone, outside the band, splits that panel as before', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  const win = shared.win;
  await createProject(win, 'OuterControl', 'C:/c/outercontrol');
  const { p1, p5 } = await buildGridPlusOne(win);

  await dragOnto(win, p5, () => win.getByTestId(`edge-top-${p1}`));
  // The panel's own zone is the highlighted one; the outer preview is NOT showing.
  await expect(win.locator('.edge-zone--over')).toHaveCount(1);
  await expect(win.locator('[data-testid^="outer-edge-preview-"]')).toHaveCount(0);
  await win.mouse.up();

  await expect(win.locator('.panel-box')).toHaveCount(5);
  const after = await boxes(win);
  // p5 went above p1, sharing p1's column — not out to an edge of the tab.
  expect(after[p5]!.y).toBeLessThan(after[p1]!.y + 2);
  near(after[p5]!.x, after[p1]!.x, 2, 'p5 shares p1\'s column');
  near(after[p5]!.width, after[p1]!.width, 2, 'p5 is as wide as p1');
});

/**
 * Press the find bar's own Next or Previous until the count reads `expected`.
 *
 * Retried, not slept: a click in the first moments after a drop can be lost — dnd-kit keeps a capturing click
 * guard up for 50 ms after a drag ends, and the moved panel's find bar is rebuilt around the same time. A lost
 * click steps nothing, so pressing again is idempotent; a delivered one reads `expected` at once.
 */
async function stepFind(win: Page, button: 'find-next' | 'find-previous', expected: string): Promise<void> {
  await expect(async () => {
    await win.getByTestId(button).click();
    await expect(win.getByTestId('find-count')).toHaveText(expected, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test('an editor with an open find, dropped on another tab, shows that tab, has focus and still reads 2 of 5 (049 FR-000, FR-000b)', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  const win = shared.win;
  // A real folder: a project root that does not exist raises a "could not be found" notice over the panel's controls.
  const root = mkdtempSync(join(tmpdir(), 'throng-dropfind-'));
  await createProject(win, 'DropFind', root);
  const first = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${first}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${first}`).click();
  const editor = win.getByTestId(`editor-${first}`);
  await expect(editor).toBeVisible();
  await focusEditor(win, first);
  await win.keyboard.type('foo\nfoo\nfoo\nfoo\nfoo');
  await win.keyboard.press('Control+f');
  await win.getByTestId('find-input').fill('foo');
  await expect(win.getByTestId('find-count')).toHaveText('1 of 5');
  await win.getByTestId('find-next').click();
  await expect(win.getByTestId('find-count')).toHaveText('2 of 5');

  // Keep the first tab alive after the editor leaves it, and make a second tab to drop on.
  await splitPanelViaMenu(win, first);
  await expect(win.locator('.panel-box')).toHaveCount(2);
  await win.getByTestId('tab-add').click();
  await expect(win.locator('.tab-chip')).toHaveCount(2);
  const firstTab = win.locator('.tab-chip').first();
  await expect(async () => {
    await firstTab.click();
    await expect(firstTab).toHaveAttribute('data-active', 'true');
  }).toPass();
  await expect(editor).toBeVisible();

  await dragOnto(win, first, () => win.locator('.tab-chip').nth(1));
  // Linger over the chip as a person does, until its dwell has switched to it mid-drag (600 ms by default).
  await expect(win.locator('.tab-chip').nth(1)).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  await win.mouse.up();

  // The second tab is the one shown, the editor is in it, focused, and its find is exactly where it was.
  await expect(win.locator('.tab-chip').nth(1)).toHaveAttribute('data-active', 'true');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.cm-editor.cm-focused')).toBeVisible({ timeout: 10_000 });
  await expect(win.getByTestId('find-count')).toHaveText('2 of 5');
  await expect(editor.locator('.throng-search-match')).toHaveCount(5);

  // …and it still steps: the find bar's own Next and Previous act on the moved editor.
  await stepFind(win, 'find-next', '3 of 5');
  await stepFind(win, 'find-previous', '2 of 5');
});

test('a file-backed editor with an open find, dropped on a panel edge in its own tab, still steps with Next and Previous (049 FR-000)', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  const win = shared.win;
  const root = mkdtempSync(join(tmpdir(), 'throng-dropfind-same-'));
  cpSync(join(fileURLToPath(new URL('../fixtures/preview/', import.meta.url)), 'links'), root, { recursive: true });
  await createProject(win, 'DropFindSame', root);
  const first = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${first}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${first}`).click();
  const editor = win.getByTestId(`editor-${first}`);
  await expect(editor).toBeVisible();
  await win.getByTestId('file-explorer-tree').getByText('README.md', { exact: true }).click();
  await expect(editor.locator('.cm-content')).toContainText('Links fixture', { timeout: 8000 });
  await focusEditor(win, first);
  await win.keyboard.press('Control+f');
  await win.getByTestId('find-input').fill('e');
  await expect(win.getByTestId('find-count')).toHaveText(/^1 of \d+$/);
  await win.getByTestId('find-input').press('Enter');
  await expect(win.getByTestId('find-count')).toHaveText(/^2 of \d+$/);
  const before = (await win.getByTestId('find-count').textContent()) ?? '';
  const total = before.split(' of ')[1];

  // Splitting makes the new panel the active one, so the editor's bar is hidden; the drag's own press on the
  // editor's header makes it active again, as it does for a person.
  const second = await splitAndFind(win, first, 'right');
  await dragOnto(win, first, () => win.getByTestId(`edge-bottom-${second}`));
  await win.mouse.up();
  const moved = await boxes(win);
  expect(moved[first]!.y, 'the editor is now below the other panel').toBeGreaterThan(moved[second]!.y);

  await expect(win.getByTestId('find-count')).toHaveText(before);
  await stepFind(win, 'find-next', `3 of ${total}`);
  await stepFind(win, 'find-previous', `2 of ${total}`);
});

for (const target of ['a panel edge in its own tab', 'another tab'] as const) {
  test(`a preview with an open find, dropped on ${target}, still steps with Next and Previous (049 FR-000)`, { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
    const win = shared.win;
    const root = mkdtempSync(join(tmpdir(), 'throng-dropfind-pv-'));
    cpSync(join(fileURLToPath(new URL('../fixtures/preview/', import.meta.url)), 'links'), root, { recursive: true });
    await createProject(win, 'DropFindPreview', root);
    const tree = win.getByTestId('file-explorer-tree');
    await expect(tree.getByText('README.md', { exact: true })).toBeVisible();
    await expect(win.locator('.panel-box')).toHaveCount(1);
    const known = await panelIds(win);
    await tree.getByText('README.md', { exact: true }).click({ button: 'right' });
    await win.getByTestId('menu-item-Open In').click();
    await win.getByTestId('menu-item-New Preview Panel').click();
    await expect(win.locator('.panel-box')).toHaveCount(known.length + 1);
    const preview = (await panelIds(win)).find((id) => !known.includes(id))!;
    await expect(win.getByTestId(`preview-markdown-${preview}`)).toContainText('Links fixture');
    await win.getByTestId(`preview-markdown-${preview}`).getByText('Links fixture').first().click();
    await win.keyboard.press('Control+f');
    await win.getByTestId('find-input').fill('e');
    await expect(win.getByTestId('find-count')).toHaveText(/^1 of \d+$/);
    await win.getByTestId('find-input').press('Enter');
    await expect(win.getByTestId('find-count')).toHaveText(/^2 of \d+$/);
    const before = (await win.getByTestId('find-count').textContent()) ?? '';
    const total = before.split(' of ')[1];

    const other = (await panelIds(win)).find((id) => id !== preview)!;
    if (target === 'another tab') {
      await win.getByTestId('tab-add').click();
      await expect(win.locator('.tab-chip')).toHaveCount(2);
      const firstTab = win.locator('.tab-chip').first();
      await expect(async () => {
        await firstTab.click();
        await expect(firstTab).toHaveAttribute('data-active', 'true');
      }).toPass();
      await win.getByTestId(`panel-handle-${preview}`).click();
      await dragOnto(win, preview, () => win.locator('.tab-chip').nth(1));
      // Linger over the chip as a person does, until its dwell has switched to it mid-drag (600 ms by default).
      await expect(win.locator('.tab-chip').nth(1)).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
    } else {
      await win.getByTestId(`panel-handle-${preview}`).click();
      await dragOnto(win, preview, () => win.getByTestId(`edge-bottom-${other}`));
    }
    await win.mouse.up();

    await expect(win.getByTestId('find-count')).toHaveText(before);
    await stepFind(win, 'find-next', `3 of ${total}`);
    await stepFind(win, 'find-previous', `2 of ${total}`);
  });
}

async function syncToNewSubWorkspace(app: ElectronApplication, win: Page, panelId: string): Promise<Page> {
  await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Sync to').click();
  const [child] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('menu-item-New Sub-workspace').click(),
  ]);
  await child.waitForLoadState('domcontentloaded');
  return child;
}

test('the same drop in a sub-workspace window leaves the main window unchanged (SC-009)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  // Its own app: it opens a second window, and on the shared one the earlier tests' state could
  // leave the main window unable to open the New Project form.
  await runApp(async (app, win) => {
    await createProject(win, 'OuterSub', 'C:/c/outersub');
    const a = await firstPanelId(win);

    const child = await syncToNewSubWorkspace(app, win, a);
    try {
      await expect(child.locator('.panel-box')).toHaveCount(1);
      const c1 = await child.locator('.panel-box').first().evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
      const c2 = await splitAndFind(child, c1, 'right');
      const c3 = await splitAndFind(child, c2, 'right');

      // Measured once the sub-workspace exists: creating it lists it in the main window's sidebar,
      // which may shift the panel area. SC-009 is about the DROP, so the baseline is taken just before it.
      const mainBefore = await boxes(win);
      await dropOnOuterEdge(child, c3, 'left');
      const inChild = await boxes(child);
      const body = await tabBody(child);
      near(inChild[c3]!.width, body.width / 3, body.width * 0.05, 'the dropped panel is a third of the child window');
      expect(inChild[c3]!.x, 'and it is the leftmost').toBeLessThan(inChild[c1]!.x);

      const mainAfter = await boxes(win);
      expect(Object.keys(mainAfter).sort()).toEqual(Object.keys(mainBefore).sort());
      for (const id of Object.keys(mainBefore)) {
        near(mainAfter[id]!.x, mainBefore[id]!.x, 1, `main-window panel ${id} x`);
        near(mainAfter[id]!.width, mainBefore[id]!.width, 1, `main-window panel ${id} width`);
      }
    } finally {
      await child.close().catch(() => undefined);
    }
  });
});
