import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { runApp, createProject, geom } from './harness.js';

// The middle (workspace) pane must never be squeezed away when the window narrows
// while the side panes are wide. The side panes are NOT shrunk — they keep the
// user's set width and COLLAPSE (Explorer/right first) to preserve the workspace
// minimum.

test('the workspace keeps its minimum; side panes collapse (not shrink), Explorer first', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await runApp(async (app: ElectronApplication, win) => {
    // A project activates the right Explorer pane so all three columns are present.
    await createProject(win, 'Alpha', 'C:/code/alpha');
    await expect(win.getByTestId('file-explorer-pane')).toBeVisible();

    const measure = () =>
      win.evaluate(() => {
        const w = (sel: string): number =>
          Math.round((document.querySelector(sel) as HTMLElement).getBoundingClientRect().width);
        return {
          side: w('.pane--sidebar'),
          mid: w('.pane--workspace'),
        };
      });

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 800));
    // Wait for the workspace pane — the one under test — to stop moving before measuring, rather
    // than assuming a fixed duration is always enough for the resize to propagate.
    await geom(win.locator('.pane--workspace'));
    const wide = await measure();
    expect(wide.mid).toBeGreaterThan(480); // plenty of room — middle is large

    // Narrow below the both-shown threshold: the Explorer collapses to a rail; the
    // sidebar keeps its width (not shrunk) and the workspace stays above its min.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1030, 800));
    await expect(win.getByTestId('pane-rail-right')).toBeVisible(); // Explorer collapsed first
    await expect(win.getByTestId('pane-hide-left')).toBeVisible(); // sidebar still expanded

    /*
     * POLL THE WIDTH ITSELF, not a proxy for it (035).
     *
     * This read used to be a single non-retrying `expect` taken after `geom('.pane--workspace')`
     * had reported the pane "settled" — and it went flaky under load, failing twice at exactly
     * 450 before passing on a second retry.
     *
     * Measured, not guessed: deleting the settle entirely and reading immediately reproduces the
     * identical value, `mid = 450`. So 450 is the width DURING the narrowing, before the Explorer
     * collapse has redistributed the space — the same fingerprint the failing run left.
     *
     * The subtler half is why the settle was not enough. The same probe showed the width at
     * **453** even after both rail assertions above had passed: the pane keeps moving well past
     * the point where the collapse is observable, so every proxy this test could wait on — the
     * pane's own geometry, the rail appearing, the sidebar button — becomes true while the number
     * under test is still changing. A proxy that settles before its subject is not a
     * synchronisation point, however carefully it is chosen.
     *
     * So wait for the assertion itself to hold. `expect.poll` re-reads until the invariant is true
     * or the timeout expires, which is both correct under load and faster than any fixed sleep
     * that would have to assume the worst case.
     */
    await expect
      .poll(async () => (await measure()).mid, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(470); // workspace minimum preserved

    const narrow = await measure();
    expect(narrow.side).toBe(wide.side); // sidebar NOT shrunk — same width
  });
});
