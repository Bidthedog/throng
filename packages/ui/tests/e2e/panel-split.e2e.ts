import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  cleanupTemp,
  createProject,
  firstPanelId,
  openApp,
  panelIds,
  runApp,
  splitPanelViaMenu,
  type OpenApp,
  type SplitDirectionName,
} from './harness.js';

/*
 * 048 US1/US2 — the **+** button splits its own panel, in any of four directions.
 *
 * WHAT ONLY A REAL WINDOW CAN SHOW: that a split changes ONLY the panel it was asked of. A component test
 * sees the layout tree; it cannot see that three neighbours did not move by a pixel (SC-001, SC-002), that
 * the arrangement is what a restart restores (SC-009), or that a sub-workspace window's split stays in
 * that window (FR-004). Geometry and windows are the reserve entries.
 *
 * Every split goes through the menu, as a user does (`splitPanelViaMenu`): the **+** opens a four-way menu
 * and nothing exists until an item is chosen.
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

/** Every panel's rendered box, by id. */
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

/** Split `panelId` and return the id of the panel that appeared. */
async function splitAndFind(win: Page, panelId: string, direction: SplitDirectionName): Promise<string> {
  const before = await panelIds(win);
  await splitPanelViaMenu(win, panelId, direction);
  await expect(win.locator('.panel-box')).toHaveCount(before.length + 1);
  const added = (await panelIds(win)).find((id) => !before.includes(id));
  if (!added) throw new Error('the split added no panel');
  return added;
}

function expectSameBox(actual: Rect | undefined, expected: Rect, what: string): void {
  expect(actual, `${what} disappeared`).toBeDefined();
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual![k] - expected[k]), `${what}: ${k} moved`).toBeLessThanOrEqual(1);
  }
}

test('each direction splits only the panel whose + was used (SC-001, SC-002)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  const win = shared.win;
  await createProject(win, 'SplitGrid', 'C:/c/splitgrid');
  const p1 = await firstPanelId(win);

  // A 2x2: p1 over p3 on the left, p2 over p4 on the right.
  const p2 = await splitAndFind(win, p1, 'right');
  const p3 = await splitAndFind(win, p1, 'down');
  const p4 = await splitAndFind(win, p2, 'down');
  expect(new Set([p1, p2, p3, p4]).size).toBe(4);

  // Split p1 every way. Each time, every panel that is neither p1 nor the new one must not move.
  const created: string[] = [];
  for (const direction of ['down', 'up', 'right', 'left'] as const) {
    const others = await boxes(win);
    delete others[p1];
    for (const id of created) delete others[id];
    const before = Object.keys(others);
    expect(before.sort(), 'the bystanders are the other three of the 2x2').toEqual([p2, p3, p4].sort());

    const added = await splitAndFind(win, p1, direction);
    created.push(added);

    const after = await boxes(win);
    for (const id of before) expectSameBox(after[id], others[id]!, `${id} after Split ${direction}`);

    // The new panel is on the requested side of the one it was split from, sharing its space.
    const from = after[p1]!;
    const into = after[added]!;
    if (direction === 'down') expect(into.y).toBeGreaterThan(from.y);
    if (direction === 'up') expect(into.y).toBeLessThan(from.y);
    if (direction === 'right') expect(into.x).toBeGreaterThan(from.x);
    if (direction === 'left') expect(into.x).toBeLessThan(from.x);
  }

  // Four panels plus four splits is eight; nothing was lost.
  await expect(win.locator('.panel-box')).toHaveCount(8);
});

test('a split survives a restart (SC-009)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  test.setTimeout(180_000);
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-split-restart-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-split-restart-ud-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'SplitRestart', 'C:/c/splitrestart');
        const p1 = await firstPanelId(win);
        const p2 = await splitAndFind(win, p1, 'right');
        await splitAndFind(win, p2, 'down');
        await expect(win.locator('.panel-box')).toHaveCount(3);

        // The layout is written behind a debounce; the window closing before it lands would restore a
        // workspace without the split, so wait for the saved document itself.
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
                  .get('SplitRestart') as { json?: string } | undefined;
                return (row?.json?.match(/"type":"panel"/g) ?? []).length;
              } catch {
                return 0;
              } finally {
                db?.close();
              }
            },
            { timeout: 15_000, message: 'the split layout was never persisted' },
          )
          .toBe(3);
      },
      { dataDir, userDataDir },
    );

    await runApp(
      async (_app, win) => {
        const item = win.locator('.project-item', { hasText: 'SplitRestart' });
        await expect(item).toBeVisible({ timeout: 20_000 });
        const sw = item.locator('[data-testid^="project-switch-"]');
        if (await sw.isVisible().catch(() => false)) await sw.click();
        await expect(win.locator('.panel-box')).toHaveCount(3, { timeout: 20_000 });
        // The arrangement, not just the count: a row split holding a column split.
        await expect(win.locator('.split--row')).toHaveCount(1);
        await expect(win.locator('.split--column')).toHaveCount(1);
      },
      { dataDir, userDataDir },
    );
  } finally {
    cleanupTemp(dataDir);
    cleanupTemp(userDataDir);
  }
});

/** Right-click the panel handle and sync it into a brand-new sub-workspace window. */
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

test('a split in a sub-workspace window changes only that window (FR-004)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const { app, win } = shared;
  await createProject(win, 'SplitSub', 'C:/c/splitsub');
  const a = await firstPanelId(win);
  const mainBefore = await boxes(win);
  const mainLayoutPanels = Object.keys(mainBefore);

  const child = await syncToNewSubWorkspace(app, win, a);
  try {
    await expect(child.locator('.panel-box')).toHaveCount(1);
    const childPanel = await child.locator('.panel-box').first().evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');

    await splitPanelViaMenu(child, childPanel, 'down');
    await expect(child.locator('.panel-box')).toHaveCount(2);

    // The main window is exactly as it was: the same panels, in the same boxes.
    const mainAfter = await boxes(win);
    expect(Object.keys(mainAfter).sort()).toEqual(mainLayoutPanels.sort());
    for (const id of mainLayoutPanels) expectSameBox(mainAfter[id], mainBefore[id]!, `main-window panel ${id}`);
  } finally {
    await child.close().catch(() => undefined);
  }
});
