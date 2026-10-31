import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { commitTabRename, openApp, panelGrip, splitPanelViaMenu, type OpenApp } from './harness.js';

/*
 * ONE app for the file (test-suite audit): the two tests below each launched their own Electron app and
 * daemon — through a hand-rolled `startHarness` — to create one project and drag something. Neither seeds
 * anything before launch. Sharing is safe because only the ACTIVE project's layout renders, so
 * `.panel-box`, `.split--column` and `.tab-chip` read the workspace the test just made and no other;
 * the two projects have distinct names and distinct sibling roots, so FR-029's root exclusivity (which
 * refuses identical, ancestor AND descendant roots) is never engaged.
 *
 * No `mode: 'serial'`: `fullyParallel: false` already runs the file in order on one worker, and the two
 * drags are independent claims — one failing must not skip the other.
 */
let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

/**
 * Create a project and wait until it is the ACTIVE one with its workspace drawn. Settling on "listed"
 * would leave the previous project's panels on screen, which a shared app has.
 */
async function createProjectAndOpen(win: Page, name: string, root: string): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill(name);
  await win.getByTestId('project-root-input').fill(root);
  await win.getByTestId('project-save').click();
  const active = win.locator('.project-item[data-active="true"]');
  await expect(active).toHaveCount(1);
  await expect(active).toContainText(name);
  await expect(win.getByTestId('tab-strip')).toBeVisible();
  await expect(win.locator('.panel-box')).toHaveCount(1);
}

async function panelIds(win: Page): Promise<string[]> {
  await expect(win.locator('.panel-box').first()).toBeAttached();
  return win.locator('.panel-box').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
  );
}

/** Drag a Panel by its header onto an edge drop-zone of a target Panel. */
async function dragPanelToEdge(win: Page, sourceId: string, targetId: string, edge: string): Promise<void> {
  const handle = panelGrip(win, sourceId);
  const box = await handle.boundingBox();
  if (!box) throw new Error('source handle has no box');
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  // Pass the @dnd-kit activation distance so the drag starts and edge zones render.
  await win.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 3 });
  const zone = win.getByTestId(`edge-${edge}-${targetId}`);
  await zone.waitFor({ state: 'visible' });
  const zbox = await zone.boundingBox();
  if (!zbox) throw new Error('edge zone has no box');
  await win.mouse.move(zbox.x + zbox.width / 2, zbox.y + zbox.height / 2, { steps: 6 });
  await win.mouse.up();
}

/*
 * TWO TESTS REMOVED (035) — now `packages/ui/tests/component/tab-strip.test.ts`.
 *
 * Each launched its OWN app — `startHarness`, `launchApp`, `shutdownApp`, `stopDaemon`, a temp data
 * directory — to count `.panel-box` elements and look for `split-node`. Neither seeded anything
 * before launch; the own-app was this file's convention rather than a requirement.
 *
 * FOUR ASSERTIONS THEY DID NOT MAKE:
 *
 *   - No split with ONE panel, asserted before the add — so the split appearing is a change rather
 *     than a state that was always there.
 *   - Both panels show the type-selection form, not just the first. The migrated test read
 *     `.panel-box__body` with `.first()`.
 *   - The panel that SURVIVES a close is the other one, not merely one of them. A count of 1 is
 *     satisfied by destroying the wrong panel.
 *   - Refusing to close the last panel asks NOTHING. The migrated test could not distinguish
 *     "refused" from "confirmed and then refused", and a dialog for an action that cannot happen is
 *     worse than no dialog.
 *
 * Red-proven three ways in core and the header: dropping the INV-3 collapse leaves a one-child
 * split, dropping `removePanel`'s FR-016 guard empties the workspace, and typing a newly added
 * panel as a terminal removes the selection form.
 *
 * What stays in this file drives a REAL DRAG (`@reserve:osdrag`) or reads a real layout.
 */

test('splits a Panel by dragging another onto its edge (no Panel lost)', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  const win = shared.win;
  await createProjectAndOpen(win, 'DockingSplit', 'C:/c/dock-split');

  const first = (await panelIds(win))[0];
  await splitPanelViaMenu(win, first);
  await expect(win.locator('.panel-box')).toHaveCount(2);

  const [a, b] = await panelIds(win);
  // Drag B onto A's bottom edge → a column split forms; both panels survive.
  await dragPanelToEdge(win, b, a, 'bottom');
  await expect(win.locator('.split--column')).toHaveCount(1);
  await expect(win.locator('.panel-box')).toHaveCount(2);
});

test('reorders Tabs by dragging', { tag: ['@extended', '@window', '@reserve:osdrag'] }, async () => {
  const win = shared.win;
  await createProjectAndOpen(win, 'DockingTabs', 'C:/c/dock-tabs');

  // Each new Tab opens in rename mode; commit the default title before
  // reordering (a Tab being renamed isn't draggable).
  await win.getByTestId('tab-add').click();
  await commitTabRename(win);
  await win.getByTestId('tab-add').click();
  await commitTabRename(win);
  await expect(win.locator('.tab-chip')).toHaveCount(3);

  const before = await win.locator('.tab-chip').allInnerTexts();
  // Drag the last tab onto the left half of the first → it lands before it.
  const last = win.locator('.tab-chip').last();
  const first = win.locator('.tab-chip').first();
  const lbox = await last.boundingBox();
  const fbox = await first.boundingBox();
  if (!lbox || !fbox) throw new Error('tab boxes missing');
  await win.mouse.move(lbox.x + lbox.width / 2, lbox.y + lbox.height / 2);
  await win.mouse.down();
  await win.mouse.move(lbox.x + lbox.width / 2 - 8, lbox.y + lbox.height / 2, { steps: 3 });
  await win.mouse.move(fbox.x + 4, fbox.y + fbox.height / 2, { steps: 8 });
  await win.mouse.up();

  const after = await win.locator('.tab-chip').allInnerTexts();
  expect(after).not.toEqual(before);
  expect(after[0]).toBe(before[before.length - 1]);
});
