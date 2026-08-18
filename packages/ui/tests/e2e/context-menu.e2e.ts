import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import {
  cleanupTemp,
  commitPanelRename,
  commitTabRename,
  createProject,
  firstPanelId,
  settle,
  shutdownApp,
  DAEMON_READY_TIMEOUT_MS,
} from './harness.js';

import type { ElectronApplication, Page } from '@playwright/test';

/*
 * ══ ONE APP FOR THE FILE (034 FR-045) ══
 *
 * FOUR tests, four `run()` calls, four Electron launches and four daemons — each of which opened an
 * app, made a project, right-clicked something and threw the app away. Nothing here seeds state
 * before the app starts and nothing relaunches, so the file now shares ONE app opened in `beforeAll`.
 *
 * WHY SHARING IS SAFE **HERE**, check by check, because this is the part that has to be re-derived
 * for every file rather than assumed:
 *
 *   - **No pre-launch seeding.** All four launches were byte-identical: a fresh temp `dataDir`, a
 *     fresh `THRONG_CONFIG_ROOT`, a fresh userData. Nothing read a pre-written config or a seeded
 *     database, so the isolation those four launches bought was never spent on anything.
 *
 *   - **No relaunch.** No test here closes the app to check what survives a restart.
 *
 *   - **Assertions are relative, or singletons the product guarantees.** The one global count in the
 *     file — `expect(getByTestId('context-menu')).toHaveCount(1)` — is the file's SUBJECT: at most one
 *     menu exists app-wide, which is what test 1 is for. No leftover can make it two. Everything else
 *     (`.panel-box`, `.tab-chip`, `panel-${id}`) lives inside the ACTIVE project's workspace, and only
 *     the active project renders (`app.tsx` returns one `<TabGroup/>` for the active layout), so an
 *     earlier test's panels are unmounted rather than merely elsewhere.
 *
 *   - **No project collision.** Four distinct names over four distinct SIBLING roots — `C:/c/menus`,
 *     `C:/c/close`, `C:/c/subopen`, `C:/c/send`. Project roots are exclusive (FR-029: identical,
 *     ancestor and descendant are all rejected), so this had to be checked rather than eyeballed;
 *     none of the four is an ancestor of another and `C:/c` itself is never a root.
 *
 *   - **No irreversible global mutation.** Nothing swaps a main-process handler permanently, resizes
 *     the window or collapses a pane. Tests 1 and 3 do end with a context menu open, and that is
 *     harmless by construction: the menu closes on a bare `window` pointerdown listener with no
 *     backdrop and no `preventDefault` (`workspace/context-menu.tsx`), so the next test's first click
 *     — always `project-new`, in the sidebar, nowhere near the menu — both closes it and lands.
 *
 * `Tab 2` STILL MEANS `Tab 2`. Tests 3 and 4 click `menu-item-Tab 2` by name, which would be a
 * cross-test literal if tab names were global. They are not: a tab is named
 * `Tab ${layout.tabs.length + 1}` from its OWN project's layout, so every project's second tab is
 * `Tab 2` however many projects exist. (Panel names ARE global, which is why nothing here names one.)
 *
 * TWO HELPERS NOW COME FROM THE HARNESS, and this is not tidying. The local `createProject` settled on
 * `tab-strip` being visible — a condition a shared app satisfies from the PREVIOUS test's project, so
 * it returned before the workspace had swapped and `firstPanelId` could read an id that was about to
 * be destroyed. The harness's settles on the new project being ACTIVE, which is the real condition;
 * its docblock records that exact failure. It was harmless when every test had a virgin app and there
 * was no previous project to catch.
 *
 * `registerTempCleanup()` IS GONE, deliberately. Its `afterEach` removes every directory `tmpDir()`
 * handed out and then forgets them — so with the userData and config roots created once in
 * `beforeAll`, the FIRST test's afterEach would delete the live app's directories out from under it.
 * The dirs are made with `mkdtempSync` here and removed in `afterAll` instead.
 *
 * Deliberately NOT `mode: 'serial'`. `fullyParallel: false` already keeps a file to one worker, in
 * order, so the shared window can never be driven by two tests at once — serial mode would add only
 * "skip the rest after the first failure". These four ask four independent questions, and a failure in
 * "only one menu is open app-wide" must not hide a regression in #157's idempotent parent click.
 */

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

function startDaemon(pipeName: string, dataDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [daemonEntry], {
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_DATABASE_PATH: join(dataDir, 'throng.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('daemon not ready')), DAEMON_READY_TIMEOUT_MS);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      if (c.includes('listening')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function stopDaemon(daemon: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    daemon.once('exit', () => resolve());
    daemon.kill();
    setTimeout(resolve, 3000);
  });
}

function launchApp(pipeName: string, userData: string, cfgRoot: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_CONFIG_ROOT: cfgRoot },
  });
}

let daemon: ChildProcess | undefined;
let dataDir: string | undefined;
let userDataDir: string | undefined;
let cfgRoot: string | undefined;
let app: ElectronApplication | undefined;
/** The one window every test below drives. */
let win: Page;

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-menu-'));
  userDataDir = mkdtempSync(join(tmpdir(), 'throng-ud-'));
  cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-menu-${process.pid}-${Date.now()}`;
  daemon = await startDaemon(pipeName, dataDir);
  app = await launchApp(pipeName, userDataDir, cfgRoot);
  win = await app.firstWindow();
  // Stub the native folder dialog so creating a project never opens a modal.
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  // Settle on a RENDERED window before the first test reads anything off it (017 FR-013).
  await settle(win);
});

test.afterAll(async () => {
  if (app) await shutdownApp(app);
  if (daemon) await stopDaemon(daemon);
  for (const dir of [dataDir, userDataDir, cfgRoot]) if (dir) cleanupTemp(dir);
});

/*
 * MOVED (034 FR-045) — three tests, to two files, and it takes both:
 *   `packages/ui/tests/component/context-menu-lifecycle.test.ts` (renders the real provider)
 *   `packages/ui/tests/unit/single-menu-host.test.ts` (a source guard)
 *
 * "Only one menu app-wide" is TWO claims and the E2E could only ever make one of them well. That a
 * second `openMenu` REPLACES the first is structural — the provider holds one `menu` state — and
 * the load-bearing half is the negative, that the first menu’s row has GONE, because a menu drawn
 * on top of the old one satisfies the positive. That NOTHING ELSE renders a `<ContextMenu>` is a
 * claim about absence across the whole renderer, which the E2E inferred from sampling two surfaces
 * in one window; a source guard states it directly.
 *
 * "Clicking outside closes it" was one `window` pointerdown listener. The component test asserts
 * BOTH directions — outside closes, inside does not — which matters, because a listener that
 * closes on everything passes the outside test and makes the menu unusable.
 *
 * "#157, a second click never closes it" is the idempotent-open branch, asserted directly.
 *
 * Red-proved. Two of the mutations were bad before they were right, both the same trap:
 * `setOpenLabel(` has EIGHT call sites and a non-global replace hit the wrong one, reporting "not
 * coupled" — anchored on the #157 comment it reddens. And the replacement mutation is INERT, not
 * unproven: the provider closes on window `pointerdown`, which fires before the second opener’s
 * click, so the previous state is already null by the time the mutated setter runs.
 */

test('"Send to Tab" submenu moves the panel to the chosen tab', { tag: ['@extended', '@window'] }, async () => {
  await createProject(win, 'Send', 'C:/c/send');

  // Two panels in Tab 1 so moving one out doesn't prune the tab.
  const a = await firstPanelId(win);
  await win.getByTestId(`panel-add-${a}`).click();
  await commitPanelRename(win); // the new panel opens in rename mode
  await expect(win.locator('.panel-box')).toHaveCount(2);

  // A second tab to send into.
  await win.getByTestId('tab-add').click();
  await commitTabRename(win);
  await expect(win.locator('.tab-chip')).toHaveCount(2);
  await win.locator('.tab-chip').first().click(); // back to Tab 1

  // Send panel A to "Tab 2" via the submenu.
  await win.getByTestId(`panel-handle-${a}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Send to Tab').click(); // click opens the flyout
  await win.getByTestId('menu-item-Tab 2').click();

  // Tab 1 now has one panel; switching to Tab 2 shows the moved panel A.
  await expect(win.locator('.panel-box')).toHaveCount(1);
  await win.locator('.tab-chip').nth(1).click();
  await expect(win.getByTestId(`panel-${a}`)).toBeVisible();
});
