import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { cleanupTemp, createProject, reloadWindow, runApp } from './harness.js';
import { openSubWorkspaceWindow } from './helpers/subworkspace-open.js';

/**
 * #116 — a drop in a SUB-WORKSPACE WINDOW (018 FR-059, FR-062, SC-010).
 *
 * A sub-workspace window has no explorer: a drop is the only way a file gets into an editor there (FR-062). Until
 * this spec every drop test ran in the main window, and the one thing that makes a sub-workspace drop different —
 * `panel-body.tsx` judging a panel the sub-workspace owns as `rootless`, so main applies the sub-workspace's
 * confinement rule — was proven only by a pure function over a literal (`drop-confinement.test.ts`). Sending
 * `rootless: false` there left the whole suite green.
 *
 * WHY THE PATH SEAM, NOT A REAL DragEvent. A `File` made in a renderer has no path on disk (Electron removed
 * `File.path`; `webUtils.getPathForFile` answers ''), so a hand-built `DataTransfer` can only ever be refused as
 * "no file on disk" — it cannot open anything. Opening a real file takes the drop target's own path seam,
 * `throng:os-drop` (`editor/drop-target.tsx`), which is what the drop handler runs once the OS has named the path.
 * What only an E2E can show, and what this spec is for, is the rest: a REAL second window, its own renderer and
 * notice surface, the panel's ownership as that window derives it, and main's verdict on a real path.
 *
 * Both targets of FR-056 — the untyped panel (which a drop turns into an editor) and the existing editor — and both
 * sides of FR-059: a file outside every project opens; a file inside one is refused, visibly (SC-010).
 */

// One sub-workspace, one tab, one panel. `originProjectId: 'x'` names no project, so the panel is the
// sub-workspace's own — the case the window's `rootless` wiring exists for.
const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'swd', ownerUser: 'u', name: 'Drops', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 700, height: 500 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

/** What the OS hands the drop target once a file is dragged in: its path, for this panel. */
async function dropPath(page: Page, panelId: string, path: string): Promise<void> {
  await page.evaluate(
    ([id, p]) => window.dispatchEvent(new CustomEvent('throng:os-drop', { detail: { panelId: id, paths: [p] } })),
    [panelId, path] as const,
  );
}

test('a sub-workspace window opens a dropped file from outside every project, and visibly refuses one from inside a project (#116)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'throng-swdrop-proj-'));
  const outside = mkdtempSync(join(tmpdir(), 'throng-swdrop-out-'));
  const inProject = join(projectRoot, 'inside.txt');
  const first = join(outside, 'first.txt');
  const second = join(outside, 'second.txt');
  writeFileSync(inProject, 'INSIDE-A-PROJECT\n');
  writeFileSync(first, 'FIRST-FROM-OUTSIDE\n');
  writeFileSync(second, 'SECOND-FROM-OUTSIDE\n');
  try {
    await runApp(async (app, win) => {
      await win.evaluate(seedSub);
      await reloadWindow(win);
      // A project, so `inside.txt` is a file INSIDE one: the root main judges every drop against.
      await createProject(win, 'DropHost', projectRoot);

      const child = await openSubWorkspaceWindow(app, win, 'swd');
      await child.waitForLoadState('domcontentloaded');
      await expect(child.getByTestId('panel-type-select-p')).toBeVisible();

      // ── The UNTYPED panel ────────────────────────────────────────────────────────────────────────
      // A project's file is refused, and the refusal is a notice in THIS window, naming the file.
      await dropPath(child, 'p', inProject);
      await expect(child.getByTestId(`os-drop-error-${inProject}`)).toBeVisible();
      await expect(child.getByTestId(`os-drop-error-${inProject}`)).toContainText('inside.txt');
      await expect(child.getByTestId('editor-p')).toHaveCount(0);

      // A file outside every project opens, and the drop makes the panel an editor of it (FR-056).
      await dropPath(child, 'p', first);
      await expect(child.getByTestId('editor-p')).toContainText('FIRST-FROM-OUTSIDE');

      // ── The EXISTING editor ──────────────────────────────────────────────────────────────────────
      // A project's file is refused here too, and what the editor holds is untouched.
      await child.getByTestId(`os-drop-error-${inProject}-dismiss`).click();
      await expect(child.getByTestId(`os-drop-error-${inProject}`)).toHaveCount(0);
      await dropPath(child, 'p', inProject);
      await expect(child.getByTestId(`os-drop-error-${inProject}`)).toBeVisible();
      await expect(child.getByTestId('editor-p')).toContainText('FIRST-FROM-OUTSIDE');
      await expect(child.getByTestId('editor-p')).not.toContainText('INSIDE-A-PROJECT');

      // Another outside file opens in the editor it was dropped on.
      await dropPath(child, 'p', second);
      await expect(child.getByTestId('editor-p')).toContainText('SECOND-FROM-OUTSIDE');
    });
  } finally {
    cleanupTemp(projectRoot);
    cleanupTemp(outside);
  }
});
