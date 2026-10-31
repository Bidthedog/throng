import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { skipIfElevated } from './admin.js';
import type { ElectronApplication, Page } from '@playwright/test';
import { cleanupTemp, shutdownApp, DAEMON_READY_TIMEOUT_MS, splitPanelViaMenu } from './harness.js';

/**
 * ══ ONE APP FOR THE FILE (034 FR-045) ══
 *
 * **Launches: 8 Electron apps + 8 daemons BEFORE → 1 app + 1 daemon AFTER.** The largest saving in
 * the batch, and it was blocked by three small things rather than by anything structural.
 *
 * Sharing is safe because of what these eight tests actually measure. Only the ACTIVE project's
 * layout renders, so `.tab-chip`, `.panel-box`, `.split--row`, `.split--column` and the split-node
 * counts are active-project-scoped and see this test's workspace and no other. Tab titles are
 * per-layout, so every project's first tab is `Tab 1` however many projects exist. Panel names are
 * globally unique with a re-used `Blank Panel <n>` sequence (048 FR-127), so a later project's first
 * panel is `Blank Panel 7`, never `Blank Panel (2)` — which is why test 8's title regex survives. And every
 * root here is a distinct sibling (`C:/code/some/deep/path`, `C:/c/tm`, `C:/c/pm`, `C:/c/rz`,
 * `C:/c/dc`, `C:/c/sz`, `C:/c/a`, `C:/c/b`), so FR-029's root exclusivity — which refuses identical,
 * ancestor AND descendant roots — is never engaged.
 *
 * ══ THE THREE FIXES, AND WHERE THEY ARE ══
 *
 *  1. **Test 1 scopes its path assertion to its own project row.** `project-path` is rendered once
 *     PER PROJECT ROW in the sidebar; a bare `getByTestId('project-path')` matches one node per
 *     project, so with two projects it is a strict-mode violation rather than a wrong value.
 *  2. **Test 2 restores what it replaced.** It permanently swapped `dialog.showOpenDialog` in the
 *     MAIN PROCESS for one answering `C:/picked/folder`, and left a draft form open with its name
 *     auto-filled from that pick. Both now come off in a `finally`, and the dialog is restored to
 *     the exact function it replaced rather than to a stub of our own.
 *  3. **Test 6 double-clicks its OWN project.** `[data-testid^="project-switch-"]` `.first()` is the
 *     first project in the sidebar, which under a shared app is test 1's `Pathy` — so it renamed
 *     another test's project, and because the first half of a double-click is a plain click, it also
 *     switched the active project out from under the Tab and Panel renames that follow.
 *
 * Two supporting changes that are not visible as assertions but are the difference between a shared
 * app working and hanging: the local `createProject` now settles on the new project being ACTIVE
 * rather than merely listed (creating a project swaps the whole workspace, so an id read a moment
 * too early belongs to the outgoing project), and `panelIds` waits for a `.panel-box` to exist —
 * `evaluateAll` does NOT auto-wait, so it returns `[]` before the workspace renders and callers
 * interpolate `undefined` into a testid and wait out the whole budget.
 *
 * `registerTempCleanup()` is gone for the same reason as everywhere else in this batch: its
 * `afterEach` deletes every directory `tmpDir()` handed out, which under a shared app means deleting
 * the LIVE app's userData and config root after the first test.
 *
 * ══ ONE THING LEFT AS A CAVEAT ══
 *
 * Test 7 drags the sidebar ~120px wider and that persists in the shared `userData` localStorage for
 * the rest of the file. Nothing after it measures geometry — only test 8 follows, and it reads the
 * window title — so it is tolerable as ordered. Anything geometric added after test 7 must either
 * restore the width or run before it.
 *
 * ══ NO `mode: 'serial'` ══
 *
 * `fullyParallel: false` already pins the file to one worker, in order, so the shared app can never
 * be driven by two tests at once. These are eight independent FR questions, and skipping the rest on
 * the first failure would turn "the divider drag is broken" into "something about UX refinements is
 * broken".
 */

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

interface Harness {
  daemon: ChildProcess;
  dataDir: string;
  pipeName: string;
}

/*
 * Temp dirs are tracked and removed ONCE, in `afterAll` — see the header note on
 * `registerTempCleanup()`.
 */
const ownedTempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  ownedTempDirs.push(dir);
  return dir;
}

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

async function startHarness(): Promise<Harness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-ux-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-ux-${process.pid}-${Date.now()}`;
  const daemon = await startDaemon(pipeName, dataDir);
  return { daemon, dataDir, pipeName };
}

function launchApp(pipeName: string): Promise<ElectronApplication> {
  // Isolate Electron userData (and thus localStorage) per launch so renderer UI
  // state — e.g. persisted sidebar size — never leaks between FILES. (Within this file it is now
  // deliberately shared, which is what test 7's caveat in the header is about.)
  const userData = tempDir('throng-ud-');
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      THRONG_PIPE_NAME: pipeName,
      THRONG_CONFIG_ROOT: tempDir('throng-cfg-'),
      THRONG_TEST_SHELL_HISTORY: 'off',
    },
  });
}

async function createProject(win: Page, name: string, root: string): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill(name);
  await win.getByTestId('project-root-input').fill(root);
  await win.getByTestId('project-save').click();
  await expect(win.locator('.project-item', { hasText: name })).toBeVisible();
  /*
   * 034 FR-045 — settle on the new project being ACTIVE, not merely listed.
   *
   * Creating a project opens it immediately, which swaps the entire workspace. Returning on the
   * sidebar row alone leaves the PREVIOUS project's panels on screen, so the `panelIds(win)[0]` that
   * five of these tests run on the very next line can capture an id that is about to be destroyed —
   * and every later `panel-add-<dead id>` then waits out the full test budget for an element that
   * can never exist. With one app per test there was no previous project and the weak settle was
   * harmless; it becomes live the moment the app is shared.
   */
  const active = win.locator('.project-item[data-active="true"]');
  await expect(active).toHaveCount(1);
  await expect(active).toContainText(name);
}

async function panelIds(win: Page): Promise<string[]> {
  /*
   * 034 FR-045 — `evaluateAll` does NOT auto-wait. It resolves against whatever matches right now,
   * which is `[]` while the workspace is still rendering; callers index into it and interpolate
   * `undefined` into a testid, then wait out the whole budget for `panel-add-undefined`. Settle on a
   * panel existing first. (The harness's `panelIds` carries the same guard, for the same reason.)
   */
  await expect(win.locator('.panel-box').first()).toBeAttached();
  return win.locator('.panel-box').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
  );
}

/*
 * The one app, one daemon and one main window every test below drives.
 *
 * Deliberately the FILE'S OWN launch rather than `harness.openApp()`. `openApp()` sets
 * `THRONG_E2E_CLIPBOARD=memory` and `THRONG_NO_ORPHAN_REAP`, stubs `shell.openPath` /
 * `showItemInFolder`, stubs the folder dialog, and strips `CLAUDE_*`/`ANTHROPIC_*` — none of which
 * this file has ever been checked against. Switching to it would change what is under test at the
 * same moment as changing how often it launches, and test 2's whole subject is the folder dialog.
 */
let harness: Harness;
let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  harness = await startHarness();
  app = await launchApp(harness.pipeName);
  win = await app.firstWindow();
});

test.afterAll(async () => {
  if (app) await shutdownApp(app);
  if (harness) {
    await stopDaemon(harness.daemon);
    cleanupTemp(harness.dataDir);
  }
  for (const dir of ownedTempDirs.splice(0)) cleanupTemp(dir);
});

/*
 * ── ONE REMOVED (035 T055) ──
 *
 * `:198` "shows each project's path under its name (FR-032)" →
 * `packages/ui/tests/component/projects-panel-form.test.ts`, "each project row carries its own path".
 *
 * One DOM assertion behind an Electron launch — and 034's own note on it points at what the
 * replacement had to keep: a bare `getByTestId('project-path')` matched one node PER PROJECT the
 * moment a second existed, so the query was scoped to Pathy's row. That scoping is the whole
 * substance of "each project's".
 *
 * The replacement therefore uses TWO rows, not one, and asserts both directions: each row shows its
 * own path, and neither shows the other's. A single row cannot tell a per-row path apart from one
 * the panel renders once for everybody — measured: the mutation that gives every row the FIRST
 * project's path reddens both tests, and would have reddened nothing written against one project.
 */
/*
 * DELETED (test-suite audit): "uses a native folder picker for the project root (FR-034)". The dialog
 * was stubbed, so it only proved the picked path reaches the input — held by
 * `component/projects-panel-form.test.ts` ("auto-fills and SELECTS the name from the picked folder")
 * and the main-process side by `contract/pick-folder-ipc.contract.test.ts`.
 */

test('resizes split cells by dragging a divider (FR-038)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await createProject(win, 'Resize', 'C:/c/rz');
  const first = (await panelIds(win))[0];
  await splitPanelViaMenu(win, first);
  await expect(win.locator('.split--row')).toHaveCount(1);

  const cell = win.locator('.split--row > .split__cell').first();
  const before = await cell.evaluate((el) => (el as HTMLElement).style.flexGrow);

  const divider = win.locator('[data-testid^="split-divider-"]').first();
  const box = await divider.boundingBox();
  if (!box) throw new Error('divider has no box');
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
  await win.mouse.up();

  const after = await cell.evaluate((el) => (el as HTMLElement).style.flexGrow);
  expect(after).not.toBe(before);
});

/*
 * TWO TESTS REMOVED AND ONE NARROWED (035) — all three are now, in part or in whole,
 * `packages/ui/tests/component/tab-strip.test.ts`.
 *
 * Every one of them opened throng's own context menu, which is an in-DOM React component and not a
 * native `Menu`, then typed into an inline rename box. `TabGroup` mounts in jsdom under six
 * providers and renders the strip AND — through `SplitTree` — every panel, so both the tab and the
 * panel halves are reachable there.
 *
 * FIVE ASSERTIONS THE MIGRATED TESTS DID NOT MAKE, and each is a gap rather than a flourish:
 *
 *   - Escape DISCARDS a tab rename. All three only ever committed, so a box that ignored Escape
 *     passed them and lost whatever name the user was backing out of changing.
 *   - The rename box is GONE afterwards, not merely covered by the label — one left mounted
 *     swallows the next keystroke meant for the workspace.
 *   - A panel rename sets `titleIsCustom`. The E2E read the rendered text and stopped, so a rename
 *     that displayed correctly while leaving the flag false would pass and then be overwritten by
 *     the next file the panel opened.
 *   - "Destroy other tabs" destroys NOTHING on the first accept. FR-043's second confirmation is a
 *     second chance, and clicking accept twice cannot tell that from a formality.
 *   - A SINGLE click activates a tab and opens no box. The first half of a double-click is an
 *     ordinary click, and `:303`'s own comment records what that cost when it went unnoticed — the
 *     click half switched the active PROJECT and sent the rest of the test into a workspace it never
 *     set up.
 *
 * WHAT :303 KEEPS. Its first third renames a PROJECT by double-click. The sidebar is not in the
 * workspace mount, and `component/projects-panel-form.test.ts` — which owns the project rename box —
 * does not yet assert double-click as the route into it. So that third stays here, and the tab and
 * panel thirds below it are gone.
 */
/*
 * DELETED (test-suite audit): "renames a project by double-clicking its row (FR-041)". Held by
 * `component/projects-panel-drag-categories.test.ts` ("a double-click on the name still renames") and
 * `component/projects-panel-form.test.ts` (the rename box, via `user.dblClick`).
 */

test('resizes the sidebar horizontally by dragging its handle (FR-033)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await createProject(win, 'Sized', 'C:/c/sz');
  const shell = win.getByTestId('throng-shell');
  const before = await shell.evaluate((el) => (el as HTMLElement).style.gridTemplateColumns);

  const handle = win.getByTestId('sidebar-hresize');
  const box = await handle.boundingBox();
  if (!box) throw new Error('sidebar handle has no box');
  await win.mouse.move(box.x + box.width / 2, box.y + 100);
  await win.mouse.down();
  await win.mouse.move(box.x + 120, box.y + 100, { steps: 8 });
  await win.mouse.up();

  const after = await shell.evaluate((el) => (el as HTMLElement).style.gridTemplateColumns);
  expect(after).not.toBe(before);
});

test('window title shows the active project + Tab · Panel, no path or totals (FR-040)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  skipIfElevated(); // asserts no [ADMIN] marker; on an elevated runner the marker correctly appears
  await createProject(win, 'TitleA', 'C:/c/a');
  await createProject(win, 'TitleB', 'C:/c/b'); // the newly created project becomes active
  const getTitle = (): Promise<string> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());

  // Active project + its Tab · Panel context, nothing else (021 suffix form, FR-033).
  //
  // 048 FR-130 shows an empty panel as plain "Blank Panel"; the optional groups below keep the shape
  // check tolerant of the stored name. Historically (FR-127): panel names are unique across the whole
  // application (024 follow-up), and TitleA's panel claimed that name first, so TitleB's carries a
  // suffix. What this test is about is the SHAPE of the title — project · tab · panel, no path and
  // no totals — so it asserts that, and leaves the exact name to the naming tests.
  await expect
    .poll(getTitle, { timeout: 5000 })
    .toMatch(/^TitleB · Tab 1 · Blank Panel( \d+)?( \(\d+\))? — throng$/);
  const title = await getTitle();
  expect(title).not.toContain('C:/c/b'); // no path
  expect(title).not.toMatch(/\d+ (projects|tabs|panels)/); // no totals
  expect(title).not.toContain('[ADMIN]'); // not elevated
});
