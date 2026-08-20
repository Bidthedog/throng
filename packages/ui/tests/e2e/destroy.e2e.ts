import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  daemonRpc,
  firstPanelId,
  cleanupTemp,
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


// US3 / SC-005: Destroy flows use the shared confirm dialog with the configured
// confirmation level. A PANEL only confirms when it hosts a live terminal (losing
// a running shell is the destructive case); a plain Panel is removed immediately.
// Tab/Project destroys stay level-based. Cancelling any destroy leaves state
// unchanged (FR-025).

/*
 * ONE TEST REMOVED (035) — "destroys an empty Panel immediately — no terminal, no confirmation",
 * now `packages/ui/tests/component/panel-box.test.ts`.
 *
 * PanelPlaceholder mounts in jsdom under six providers, which was established by a spike rather
 * than assumed: its thirty imports include dnd-kit, the terminal focus registry and the document
 * authority, and every previous attempt to reach this component turned back at that list. Only
 * `useProjects` actually throws without its provider; `useDraggable`, `useDroppable`,
 * `useDetach`, `useSubWorkspaceWindow` and `useCapabilities` all tolerate absence, and
 * ConfigContext has shipped defaults.
 *
 * The component test makes two claims this one could not. That the removal is PERSISTED — "the panel
 * left the screen" and "the panel left the layout that gets saved" are different facts, and only the
 * second survives a restart. And that `notifyDestroyed` fires, which is FR-026's cascade to the
 * sub-workspaces mirroring that panel: a broadcast, not a rendered change, and invisible from here.
 *
 * WHAT STAYS, AND WHY IT IS NOT THE SAME DECISION.
 *
 * ":86" hosts a REAL cmd shell. Its confirmation is gated on `panelHasLiveTerminal`, which reads a
 * registry fed by real PTY sessions, and its last assertion polls the DAEMON's own session list.
 * ":141" cancels a TAB destroy, which is `tab-group.tsx` — a different component, and one nothing
 * has yet mounted. Both are still on the movable backlog; neither is movable today.
 */

test('warns before destroying a Panel that hosts a live terminal', { tag: ['@extended', '@window', '@reserve:process'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-destroy-term-'));
  try {
    await runApp(async (_app, win, { pipeName }) => {
      await createProject(win, 'TermDestroy', root);
      const pid = await firstPanelId(win);

      // A second Panel so destroying the terminal Panel is allowed.
      await win.getByTestId(`panel-add-${pid}`).click();
      await expect(win.locator('.panel-box')).toHaveCount(2);
      await win.keyboard.press('Escape');

      // Turn the first Panel into a live Terminal.
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      // Wait until the shell prompt is live. This Panel is SPLIT (two panels), so the
      // full root path in the cmd prompt wraps across xterm rows; match only the temp
      // dir's trailing (random) chars, which land contiguously on the final wrapped row.
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root).slice(-6), {
        timeout: 15000,
      });

      // Header × on the Terminal Panel → confirmation fires (double level), because
      // the Panel hosts a live terminal.
      await win.getByTestId(`panel-close-${pid}`).click();
      await expect(win.getByTestId('confirm-dialog')).toBeVisible();
      await expect(win.getByTestId('confirm-dialog')).toContainText('running terminal');
      await win.getByTestId('confirm-accept').click(); // "Destroy Panel"
      await expect(win.getByTestId('confirm-dialog')).toContainText('absolutely sure');
      await win.getByTestId('confirm-accept').click(); // "Yes, I'm absolutely sure"

      await expect(win.locator('.panel-box')).toHaveCount(1);
      /*
       * Destroying killed the terminal; poll the daemon's OWN session list until it agrees the
       * session is gone, rather than guessing how long that takes — the real signal the app-close
       * handshake needs before teardown, and a poll on daemon state rather than a duration.
       */
      await expect
        .poll(
          async () => {
            const result = (await daemonRpc(pipeName, 'terminal.list', {})) as
              | { sessions?: { panelId: string }[] }
              | null;
            return result?.sessions?.some((s) => s.panelId === pid) ?? false;
          },
          { timeout: 15_000, message: `daemon never cleared the killed terminal's session (panel ${pid})` },
        )
        .toBe(false);
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * ONE TEST REMOVED (035) — "cancelling a Tab destroy leaves all state unchanged (FR-025)", now
 * `packages/ui/tests/component/tab-strip.test.ts`.
 *
 * `TabGroup` takes no props and renders the whole workspace — the strip, the New Tab button, the
 * picker overlay and, through `SplitTree`, every panel — so mounting it needs the same six providers
 * `panel-box.test.ts` established. Established by spike, not assumed.
 *
 * The component version makes three claims this could not:
 *
 *   - It compares the tab IDS rather than counting chips. FR-025's claim is a NEGATIVE, and a count
 *     of 2 is satisfied by a destroy that removed one tab and added another.
 *   - It asserts NOTHING WAS PERSISTED. A cancel that redrew correctly but still saved would restore
 *     the tab on this run and lose it on the next.
 *   - It has a POSITIVE CONTROL — and the control found something. Written with one accept, the tab
 *     survived, correctly: `destroyTab` ships at level DOUBLE, so the first accept opens the "Are
 *     you absolutely sure?" dialog. `core/tests/unit/destroy.test.ts:22` owns that plan; nothing
 *     owned this call site honouring it, and a cancel-only test cannot tell a one-dialog flow from a
 *     two-dialog one because it never reaches the second. Refusing the wry final is asserted too.
 */
