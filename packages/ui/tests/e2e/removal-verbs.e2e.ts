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

/*
 * ONE TEST REMOVED (035) — "a project-owned panel in the MAIN window uses Destroy", now
 * `packages/ui/tests/component/panel-box.test.ts`. It launched Electron and created a project to
 * read one `title` attribute.
 *
 * The rule is one line, `panel-placeholder.tsx:186`: a panel is CLOSED only when it is being
 * viewed inside a sub-workspace window AND owned by a project — every other case Destroys. The
 * main window has no sub-workspace, so this test was asserting the `else`.
 *
 * The test BELOW asserts the other branch and stays: it needs a second real window, which is the
 * whole of what makes the two verbs different.
 *
 * The component test asserts the accessible name as well as the title, which this did not: both are
 * a glyph whose meaning lives in an attribute, and `aria-label` is the one that decides what is read
 * aloud (issue #282 is the same failure on the two buttons three lines above it in the source).
 */

/*
 * ── THE WORDING MOVED (035 T055) ──
 *
 * `packages/ui/tests/component/projects-panel-form.test.ts` now owns what the project control and
 * its confirmation SAY: the tooltip reads Remove rather than Delete, the sentence carries the one
 * promise that separates the two — no files on disk are deleted — and the forbidden verb does not
 * leak into it.
 *
 * ONE TEST REMOVED: `:69` "a project uses the Remove verb and states no files are deleted".
 *
 * The verb is not decoration. A dialog saying Delete over an operation that deletes nothing teaches
 * a user to fear a safe action, and — the direction that actually costs — teaches them that this
 * app's "Delete" does not mean what it says, which is the sentence they will remember when a dialog
 * does. `packages/core/tests/unit/removal-verbs.test.ts` proves which verb a PANEL gets; nothing
 * proved what the project control said, and this test was launching an app to read a title
 * attribute.
 *
 * The cancel-and-accept pair moved with it, so the wording tests are not asserting over a dialog
 * that never removes anything.
 */
test('a sub-workspace-OWNED panel uses Destroy in its sub-workspace window', { tag: ['@extended', '@explorer', '@reserve:window'] }, async () => {
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
