/**
 * Notices STACK, and each one says what the user was trying to do (024 follow-up).
 *
 * Two failures are two things the user needs to know. The model used to drop any live notice sharing
 * the incoming one's test id, so a second failure REPLACED the first and the surface silently chose
 * which of the user's two problems to report. And the message was the raw failure alone — accurate
 * about what went wrong, silent about what was being attempted, which is the half a user can act on.
 *
 * Driven through real file operations: two moves into a folder that already holds a file of that
 * name, which the daemon refuses by name.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { runApp, createProject, cleanupTemp} from './harness.js';

/**
 * Select a row and do not return until the SELECTION has actually landed on it (#239).
 *
 * `cut` and `paste` read `selectedRelPaths`, and three separate things sit between `row.click()` and
 * that state being right — each of which a chord sent in the same beat can outrun:
 *
 *   - **DOM focus.** `useExplorerKeybindings` is attached to the tree, so a chord only fires while
 *     something inside the tree is the active element, and the click's focus call lands
 *     asynchronously. The element to test is the TREE, not the row: react-arborist uses roving focus
 *     and keeps `document.activeElement` on the container (see tree-node.tsx). That is also why the
 *     precedent in `menu-keyboard.e2e.ts` — polling `activeElement.textContent` for the row's name —
 *     passes vacuously here: the container's text contains every row.
 *   - **React selection state**, set from react-arborist's `onSelect` a render later.
 *     `tree-row--selected` is that same selection reaching the DOM, so it is the honest signal.
 *   - **A click that missed.** The one this spec actually hits. Each refused move raises a notice
 *     INSIDE the explorer, which shrinks the tree body and shifts every row; a notice arriving
 *     between Playwright's stability check and its dispatch puts the click on whichever row has
 *     moved under the point. Nothing is then selected, no chord can act, and the spec fails at
 *     `explorer-error` count 0 — pointing at the notice code, which is the wrong place to look.
 *     Measured at ~1 run in 20 locally at six workers, reproducing the CI failure exactly.
 *
 * A missed click is recoverable and re-clicking is the recovery — selecting a row is idempotent, so
 * the loop costs nothing on the runs where the first click landed.
 */
async function select(win: Page, relPath: string): Promise<Locator> {
  const row = win.locator(`.tree-row[data-rel-path="${relPath}"]`);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await row.click();
    await expect
      .poll(
        () =>
          win.evaluate(
            () => document.activeElement?.closest('[data-testid="file-explorer-tree"]') != null,
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    const landed = await win
      .waitForFunction(
        (rp) =>
          document
            .querySelector(`.tree-row[data-rel-path="${rp}"]`)
            ?.classList.contains('tree-row--selected') === true,
        relPath,
        { timeout: 2_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (landed) return row;
  }
  throw new Error(`the ${relPath} row would not take a selection after 5 clicks`);
}

/** Cut `name` at the root and paste it into the `dst` folder — a move the daemon will refuse. */
async function moveIntoDst(win: Page, name: string): Promise<void> {
  const src = await select(win, name);
  await win.keyboard.press('Control+x');
  // The cut MARK is the proof the chord landed and acted on this row — the one thing the paste
  // depends on. Asserting it here turns "the notice never appeared" into "the cut never happened",
  // at the step that actually failed.
  await expect(src).toHaveClass(/tree-row--cut/, { timeout: 10_000 });
  await select(win, 'dst');
  await win.keyboard.press('Control+v');
}

test('two different failures show as two notices, each naming what was attempted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-notices-'));
  mkdirSync(join(root, 'dst'));
  for (const name of ['a.txt', 'b.txt']) {
    writeFileSync(join(root, name), 'root\n');
    writeFileSync(join(root, 'dst', name), 'already here\n');
  }
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NoticeProj', root);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree.getByText('a.txt', { exact: true }).first()).toBeVisible({ timeout: 8000 });

      const notices = win.getByTestId('explorer-error');
      await moveIntoDst(win, 'a.txt');
      await expect(notices).toHaveCount(1, { timeout: 8000 });

      // The second failure JOINS the first rather than replacing it.
      await moveIntoDst(win, 'b.txt');
      await expect(notices).toHaveCount(2, { timeout: 8000 });

      // Each names what the user was doing, above its own failure.
      await expect(notices.first()).toContainText('An error occurred when you tried to move these items');
      await expect(notices.first()).toContainText('a.txt');
      await expect(notices.last()).toContainText('An error occurred when you tried to move these items');
      await expect(notices.last()).toContainText('b.txt');

      // The SAME failure again is one event seen twice, not a third notice — a watcher re-reporting
      // an unchanged error must not pile up copies of it.
      await moveIntoDst(win, 'a.txt');
      await win.waitForTimeout(500);
      await expect(notices).toHaveCount(2);

      // COPY. A failure message is the thing a user most needs somewhere else — an issue, a message
      // to us — and the raw error string is precisely the part they cannot accurately retype.
      await win.getByTestId('explorer-error-copy').first().click();
      const copied = await win.evaluate(() => window.throng?.clipboard?.paste());
      expect(copied?.text).toContain('An error occurred when you tried to move these items');
      expect(copied?.text).toContain('a.txt');
      // The whole notice, in the order it reads on screen: context line, then the failure itself.
      expect((copied?.text ?? '').split('\n').length).toBeGreaterThanOrEqual(2);

      // Dismissing one leaves the other standing.
      await win.getByTestId('explorer-error-dismiss').first().click();
      await expect(notices).toHaveCount(1);
      await expect(notices).toContainText('b.txt');
    });
  } finally {
    cleanupTemp(root);
  }
});
