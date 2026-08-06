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
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, cleanupTemp} from './harness.js';

/** Cut `name` at the root and paste it into the `dst` folder — a move the daemon will refuse. */
async function moveIntoDst(win: Page, name: string): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await tree.getByText(name, { exact: true }).first().click();
  await win.keyboard.press('Control+x');
  await tree.getByText('dst', { exact: true }).click();
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
