import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
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

// US7 / 003 clone-and-sync (feedback items 3-5): a Tab/Panel can be "Sync to"-ed
// into an EXISTING sub-workspace from the context menu (and, via drag, by dropping
// onto its window). Cloning leaves the original in place.

// Seed one sub-workspace "Detached A" (id sw1) with a single Tab "T" / Panel "p".
const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Detached A', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }] },
] }))()`;

/*
 * MOVED to `packages/ui/tests/component/subworkspace-sync.test.ts` (034 FR-045) — two tests:
 * "syncs a Tab into an existing sub-workspace via the menu" and "syncing a Panel as a \"New\"
 * Tab adds a Tab to the sub-workspace".
 *
 * This file shares one app, so no Electron launch is saved — the case for moving them is
 * FR-045 alone. Both were entirely about what the sync WRITES, and the component layer can see
 * that where this one could only see a count.
 *
 * WHAT UNLOCKED IT, because it reopens work declined elsewhere on this branch: the sync hub is
 * `DetachProvider`, which consumes `useWorkspace()`. `WorkspaceContext` is private, so this was
 * written off as E2E-only. But `WorkspaceProvider` IS exported and takes `client` and
 * `activeProjectId` as PROPS, and `WorkspaceClient`/`SubWorkspacesClient` are one-argument
 * classes over `ThrongBridge`. The real providers mount over a fake daemon, no production
 * change, exactly as `project-settings-dialog.test.ts` does.
 *
 * WHAT THE REPLACEMENTS ASSERT MORE STRONGLY THAN THESE DID:
 *   - the PERSISTED payload as well as the counts, so "the Panel landed in the Tab the user
 *     chose" is distinguishable from "a Panel landed somewhere" — two states with the same
 *     `1T·2P`
 *   - the counts themselves are DERIVED by the fake from what was persisted, using the same two
 *     lines the real repository uses (`packages/persistence/src/subworkspace-repository.ts:24`),
 *     so a count is evidence of a write rather than of a fixture
 *   - "clone, not move" against the whole main layout rather than a `.tab-chip` count
 *
 * WHAT DID NOT MOVE:
 *   - "syncs a Panel into a chosen Tab (third level)" stays because of its `toBeInViewport()`
 *     assertions: that the third-level flyout is fully on screen is the flip/clamp behaviour,
 *     which is real layout and which jsdom cannot see at all (034 FR-049). Its STATE half is
 *     re-proved below as a strengthening, not as a replacement.
 *   - "a Panel cannot be synced to a sub-workspace twice (greyed out)" stays because the three
 *     lines at `workspace/panel-placeholder.tsx:507` that DERIVE `alreadyHasPanel` from the
 *     sub-workspace’s own panels belong to that call site, and the component host mirrors them
 *     rather than running them. A mirrored mapping is not a covered mapping (FR-047) — though
 *     the rendering of the greyed row AND the menu refreshing after a sync are both proved
 *     below.
 *
 * ANTI-VACUITY CONTROL: drop the `DetachProvider` wrapper from the replacement’s `mount()` —
 * all SIX of its tests fail.
 */

/*
 * ── ONE REMOVED (035 T056) ──
 *
 * `:131` "a Panel cannot be synced to a sub-workspace twice (greyed out)" — a strict duplicate of
 * `component/subworkspace-sync.test.ts:501`, which is strictly STRONGER. Both drive the same
 * `alreadyHasPanel` branch after a real sync has landed; the component test additionally asserts
 * that the greyed row drops its SUBMENU (a disabled row that still opened a flyout would offer
 * "New Tab" behind a greyed label, and clicking it would sync the Panel a second time) and that
 * clicking the row is INERT — no persist, and the menu stays open.
 *
 * Red-proven before deletion with `sync-twice-allowed`, which reddens exactly that test.
 *
 * ── WHAT STAYS ──
 *
 * `:108`, tagged `@reserve:layout`: it drives a THIRD level of nested flyout, whose reachability
 * is a fact about where the submenus were actually laid out.
 */
test('syncs a Panel into a chosen Tab of an existing sub-workspace (third level)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await runApp(async (_app, win) => {
    await win.evaluate(seedSub);
    await reloadWindow(win);
    await createProject(win, 'PanelSync', 'C:/c/panelsync');
    const pid = await firstPanelId(win);
    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('1T·1P');

    // Right-click the Panel → Sync to → Detached A → its Tab "T".
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    await win.getByTestId('menu-item-Detached A').click();
    // The third-level flyout must be fully on-screen (not clipped to a scrollbar).
    await expect(win.getByTestId('menu-item-New Tab')).toBeInViewport();
    await expect(win.getByTestId('menu-item-T')).toBeInViewport();
    await win.getByTestId('menu-item-T').click();

    // The Panel is cloned into that Tab → still 1 Tab, now 2 Panels.
    await expect(win.getByTestId('subworkspace-counts-sw1')).toContainText('1T·2P');
    await expect(win.locator('.panel-box')).toHaveCount(1); // main project unchanged
  });
});

// Item 5 (drag a Tab/Panel past the main window's edge ONTO an open sub-workspace
// window → it is cloned there) is implemented via the main-process cursor
// hit-test (`subWorkspace.atPoint`) + `syncToExisting` on a drop-outside. It is
// NOT exercised here because Playwright clamps the mouse to the page viewport and
// can't move the OS cursor onto another window — the same limitation that blocks
// an E2E for the drag-past-edge "Sync to new window" gesture. The identical
// add-to-existing OUTCOME is covered by the "Sync to" menu tests above.
