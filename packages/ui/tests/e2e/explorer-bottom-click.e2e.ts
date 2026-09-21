/**
 * #419 — a click at the bottom of a tree that shows BOTH scrollbars leaves the tree where it is.
 *
 * With a horizontal and a vertical scrollbar showing and the list scrolled all the way down, the
 * first click on a row nudged the tree up, and the reporter's double-click then missed the row.
 *
 * ══ WHAT WAS MEASURED ══
 *
 * The nudge, every time: on the unfixed build one click on the last row moved the scroller from
 * 797 to 785 — the horizontal scrollbar's height. Selecting asks react-window to reveal the row, and
 * react-window clamps with the list's full height rather than its client height, so a list at its
 * true bottom sits past what it thinks is the last offset. The fix leaves a row already in full
 * view alone (`visible-row-scroll.ts`, decision pinned in `visible-row-scroll.test.ts`).
 *
 * Why that costs the double-click: for 150 ms after ANY scroll react-window sets
 * `pointer-events: none` on its rows. Observed here when Playwright's own scroll-into-view preceded
 * the gesture — the second press landed on a container with no row under it. With a real-paced
 * gesture and no other scroll, synthetic input does NOT reproduce the lost double-click on the
 * unfixed build (5/5 passed), so the double-click assertion below is a statement of intent, not a
 * reproduction. The scroll assertion is the reproduction.
 *
 * The gesture is driven by coordinates, at a human's pace, after the list has settled: a locator
 * click would first scroll the (over-wide) row into view horizontally, which no user does.
 *
 * Why this layer: two real scrollbars and react-window's clamp exist only with a real layout.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, cleanupTemp } from './harness.js';

const FOLDERS = 60;
const LONG = 'a-folder-name-long-enough-to-be-wider-than-the-file-explorer-pane';
const folderName = (i: number): string => `f${String(i).padStart(2, '0')}-${LONG}`;

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-bottom-click-'));
  for (let i = 0; i < FOLDERS; i++) {
    const folder = join(root, folderName(i));
    mkdirSync(folder);
    writeFileSync(join(folder, 'inside.txt'), 'x\n');
  }
  return root;
}

interface ScrollerState {
  top: number;
  max: number;
  hBar: boolean;
  vBar: boolean;
  /** react-window's isScrolling state: the rows ignore the pointer while it is set. */
  settled: boolean;
}

/** The tree's own scroller: the first element under the body that scrolls vertically. */
function scroller(win: Page, scrollToBottom = false): Promise<ScrollerState> {
  return win.evaluate((toBottom) => {
    const body = document.querySelector('[data-testid="file-explorer-tree"] .explorer__body');
    const el = [...(body?.querySelectorAll<HTMLElement>('*') ?? [])].find((e) =>
      /(auto|scroll)/.test(getComputedStyle(e).overflowY),
    );
    if (!el) throw new Error('no scrolling element in the explorer body');
    if (toBottom) el.scrollTop = el.scrollHeight;
    // react-window marks its ROWS container `pointer-events: none` while scrolling. It is not the
    // scroller's first child: react-arborist puts its drop-cursor layer ahead of it.
    const scrolling = [...el.children].some((c) => (c as HTMLElement).style.pointerEvents === 'none');
    return {
      top: el.scrollTop,
      max: el.scrollHeight - el.clientHeight,
      hBar: el.scrollWidth > el.clientWidth,
      vBar: el.scrollHeight > el.clientHeight,
      settled: !scrolling,
    };
  }, scrollToBottom);
}

/** A point on the part of the row the user can see: a little in from the pane's left, mid-height. */
async function visiblePointOn(win: Page, rel: string): Promise<{ x: number; y: number }> {
  return win.evaluate((relPath) => {
    const body = document
      .querySelector('[data-testid="file-explorer-tree"] .explorer__body')!
      .getBoundingClientRect();
    const row = document
      .querySelector(`.tree-row[data-rel-path="${relPath}"]`)!
      .getBoundingClientRect();
    return { x: Math.max(row.left, body.left) + 60, y: row.top + row.height / 2 };
  }, rel);
}

test('a click at the bottom of a two-scrollbar tree leaves the tree where it is (#419)', { tag: ['@extended', '@explorer', '@reserve:layout'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'BottomClick', root);
      const tree = win.getByTestId('file-explorer-tree');
      const rowFor = (rel: string) => tree.locator(`.tree-row[data-rel-path="${rel}"]`);
      const opened = (rel: string) => rowFor(rel).locator('.tree-twisty');
      await expect(rowFor(folderName(0))).toBeVisible({ timeout: 8000 });

      // Control: the same double-click at the TOP of the list expands the folder, so a failure below
      // is about where the row sits, not about the gesture.
      const first = folderName(0);
      await expect.poll(async () => (await scroller(win)).settled).toBe(true);
      const top = await visiblePointOn(win, first);
      await win.mouse.click(top.x, top.y, { clickCount: 2, delay: 70 });
      await expect(opened(first)).toHaveClass(/tree-twisty--open/);
      await opened(first).click();
      await expect(opened(first)).not.toHaveClass(/tree-twisty--open/);

      const last = folderName(FOLDERS - 1);
      await scroller(win, true);
      await expect(rowFor(last)).toBeVisible();
      // The user has stopped scrolling before they double-click.
      await expect.poll(async () => (await scroller(win)).settled).toBe(true);
      const before = await scroller(win);
      expect(before.hBar, 'precondition: a horizontal scrollbar').toBe(true);
      expect(before.vBar, 'precondition: a vertical scrollbar').toBe(true);
      expect(before.top, 'precondition: scrolled to the bottom').toBeGreaterThanOrEqual(before.max - 1);

      const bottom = await visiblePointOn(win, last);
      // One click selects the row. Measured on the unfixed build: 797 -> 785, every run — the tree
      // rose by the horizontal scrollbar's height.
      await win.mouse.click(bottom.x, bottom.y);
      await expect.poll(async () => (await scroller(win)).settled).toBe(true);
      expect((await scroller(win)).top, 'a click on a row in full view moved the tree').toBe(before.top);

      // And the double-click on it expands it. Measured: this half PASSES on the unfixed build too once
      // the gesture is a real one — synthetic input does not reproduce the lost double-click, only the
      // scroll beneath it. It stays as the user-facing statement of what the fix is for.
      // At a human's pace: ~70 ms held per press, so the second press lands ~140 ms after the first.
      await win.mouse.click(bottom.x, bottom.y, { clickCount: 2, delay: 70 });

      // Its child lands below the viewport, which a virtualised list does not render — so the
      // folder's own open state is what says the double-click landed.
      await expect(opened(last), 'the double-click did not expand the folder').toHaveClass(
        /tree-twisty--open/,
        { timeout: 2000 },
      );
    });
  } finally {
    cleanupTemp(root);
  }
});
