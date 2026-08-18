import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  reloadWindow,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
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
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

// A sub-workspace seeded with one Panel it OWNS (originProjectId names no real project,
// so it is not a mirrored project view).
const seedOwnedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Owned', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 500, height: 400 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

// 011 US2 (FR-030..037): the four removal verbs (Close / Destroy / Remove / Delete)
// are applied per target+location. A project is REMOVED (unregistered; no files
// deleted). This spec walks the parts of the verb matrix reachable without a live
// terminal; the session-termination-vs-keeps-running rows are covered by the
// destroy/destroy-cascade specs (behaviour unchanged) plus the assertions here.

test('a project uses the Remove verb and states no files are deleted', { tag: ['@extended', '@explorer'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Verbs', 'C:/c/verbs');

    const del = win.locator('[data-testid^="project-delete-"]').first();
    // Control tooltip/aria uses "Remove".
    await expect(del).toHaveAttribute('title', /remove/i);

    await del.click();
    const dialog = win.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    // Confirmation names the Remove verb AND states no files on disk are deleted.
    await expect(dialog).toContainText(/remove/i);
    await expect(dialog).toContainText(/no files/i);
    // No forbidden verb leaks in.
    await expect(dialog).not.toContainText(/destroy/i);
    await win.getByTestId('confirm-cancel').click();
  });
});

/*
 * DELETED, ALREADY COVERED (034 FR-045/FR-046a) — "a tab uses the Destroy verb".
 *
 * It created a project, added a tab, right-clicked the first chip and asserted that
 * `menu-item-Destroy Tab` was VISIBLE. `destroy.e2e.ts:133-136` does the same three steps and then
 * CLICKS that item:
 *
 *     const firstTab = win.locator(‘.tab-chip’).first();
 *     await firstTab.click();
 *     await firstTab.click({ button: ‘right’ });
 *     await win.getByTestId(‘menu-item-Destroy Tab’).click();
 *
 * A click is strictly stronger than a visibility check on the same locator — the verb has to be
 * right for the click to land at all, and that test then goes on to prove the confirmation the
 * item raises. So the row of the FR-030..037 verb matrix this test held is still walked end to end;
 * it is walked once instead of twice.
 *
 * WHAT DID NOT MOVE, and why the other three tests in this file stay:
 *
 *   - "a project uses the Remove verb" is the rendered CONFIRMATION DIALOG reached through the real
 *     projects sidebar. Mounting `ProjectsPanel` needs five providers (`ProjectsProvider`,
 *     `ConfirmProvider`, the workspace store, the notification host and dnd-kit), and a source-scan
 *     for the sentence is a claim about a string literal, not about what the user is shown.
 *   - "a project-owned panel in the MAIN window uses Destroy" reads the header × button’s tooltip.
 *     `panelVerb` is computed inline in `panel-placeholder.tsx` and rendered into a `title`
 *     attribute; there is no seam below the component. The cheapest real improvement is extracting
 *     that ternary into `@throng/core` with a unit test, which is a PRODUCTION change and out of
 *     scope here.
 *   - "a sub-workspace-OWNED panel uses Destroy in its sub-workspace window" needs a SECOND real
 *     Electron window (Principle V, window lifecycle). Faking the sub-workspace context at the
 *     component layer would make the test assert its own fixture — `subWin !== null` IS the claim.
 *
 * The other file in this batch, `context-menu-sections.e2e.ts`, was deleted whole: its one test
 * moved to `packages/ui/tests/component/menu-section-rendering.test.ts`, which asserts all four
 * separator INDICES rather than the first separator’s visibility, asserts that a rule carries
 * role="separator" and is not one of the role="menuitem" rows (a claim NO test at any layer made
 * before — `menu-sections.test.ts` drives the pure `withDividers` and never renders), and pins the
 * whole "Open In" flyout in order rather than only its first row. Anti-vacuity control: replacing
 * `withDividers(actions)` with `[]` in `context-menu.tsx` renders an empty <ul> and fails all six.
 */

test('a project-owned panel in the MAIN window uses Destroy', { tag: ['@extended', '@explorer'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'PanelVerbs', 'C:/c/panelverbs');
    const pid = await win
      .locator('.panel-box')
      .first()
      .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
    await expect(win.getByTestId(`panel-close-${pid}`)).toHaveAttribute('title', /destroy/i);
  });
});

test('a sub-workspace-OWNED panel uses Destroy in its sub-workspace window', { tag: ['@extended', '@explorer'] }, async () => {
  await runApp(async (app, win) => {
    await win.evaluate(seedOwnedSub);
    await reloadWindow(win);
    await createProject(win, 'HostProj', 'C:/c/hostproj');

    const [child] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('subworkspace-open-sw1').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');

    // The sub-workspace OWNS panel 'p' (no backing project) → Destroy, not Close.
    await expect(child.getByTestId('panel-close-p')).toHaveAttribute('title', /destroy/i);
    await child.getByTestId('panel-handle-p').click({ button: 'right' });
    await expect(child.getByTestId('menu-item-Destroy Panel')).toBeVisible();
    await expect(child.getByTestId('menu-item-Close Panel')).toHaveCount(0);
  });
});
