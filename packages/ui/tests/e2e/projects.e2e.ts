import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { cleanupTemp, shutdownApp, DAEMON_READY_TIMEOUT_MS } from './harness.js';

/**
 * ══ ONE APP FOR TWO OF THE FOUR (034 FR-045) ══
 *
 * **Launches: 5 Electron apps + 4 daemons BEFORE → 4 apps + 3 daemons AFTER.**
 *
 * The smallest saving in the batch, and that is the honest answer rather than a disappointing one:
 * this file is ABOUT the global project list, which is the one piece of state a shared app cannot
 * scope away. Two of its four tests are structurally unshareable, and the expensive half of the file
 * is the restart test that can never be shared at all.
 *
 * **Tests 1 and 2 share one app.** Test 1 creates `Subnet Vault` at `C:/code/subnet`; test 2 creates
 * `Alpha` and `Beta` at `C:/code/alpha` and `C:/code/beta` — three distinct sibling roots, so
 * FR-029's root exclusivity (identical, ancestor OR descendant roots are refused) is not engaged.
 * Only the ACTIVE project's layout renders, so test 1's `.panel-box` count and test 2's
 * `workspace-pane` / `tab-strip` reads see one project's workspace and no other, and test 2's
 * `--accent` read — which IS global — is taken immediately after switching to the project whose
 * colour it set, so it is relative to what the test just did.
 *
 * ══ WHAT KEEPS ITS OWN LAUNCH, AND WHY THAT IS NOT LAZINESS ══
 *
 *  - **Test 3 — "edits and deletes a project, leaving a valid state".** It CONCLUDES on
 *    `projects-empty` AND `workspace-no-project`, i.e. "the app now has no projects". Under sharing
 *    that is false — three projects from tests 1 and 2 are still there — and the only way to make it
 *    pass would be to turn "the app has no projects" into "this project is absent". That is a
 *    coverage loss, not a fix: the empty-state rendering is the "valid state" in the test's own
 *    name. So it keeps its own app, and its assertions are untouched.
 *  - **Test 4 — "restores the project list and active project after a restart".** It closes the app,
 *    STOPS AND RESTARTS THE DAEMON against the same database, and relaunches. The restart is the
 *    requirement (SQLite durability). It also re-creates `Alpha` and `Beta` at exactly test 2's
 *    roots, which FR-029 would refuse outright in a shared app. Own app, own daemon, unchanged.
 *
 * There IS a version of this file where test 3 joins the shared app: run it FIRST, so it empties an
 * app that is already empty and test 1's opening `projects-empty` still holds. That was deliberately
 * not done. It buys one launch and costs a hidden ordering contract between two tests that are both
 * already position-dependent, where a failure in test 3 would red test 1 as well — see
 * `fix-projects.md`.
 *
 * ══ OTHER CHANGES ══
 *
 *  - The local `createProject` now settles on the new project being ACTIVE, not merely listed.
 *    Creating a project swaps the whole workspace, and a read taken before that swap belongs to the
 *    outgoing project. Harmless with one app per test; live the moment the app is shared.
 *  - `registerTempCleanup()` is gone. Its `afterEach` deletes every directory `tmpDir()` handed out,
 *    which under a shared app means deleting the LIVE app's userData and config root.
 *
 * ══ NO `mode: 'serial'` ══
 *
 * `fullyParallel: false` already pins the file to one worker, in order. Tests 1 and 2 are
 * independent claims about create and switch, and one failing must not skip the other. (Note this
 * file runs in the PARALLEL tier at several workers — it is not in `parallel-plan.json` — which is
 * orthogonal to serial mode but worth knowing before attributing any new red to this change.)
 */

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

interface Harness {
  daemon: ChildProcess;
  dataDir: string;
  pipeName: string;
}

/*
 * Temp dirs are tracked and removed ONCE, in the file-level `afterAll`, instead of by
 * `registerTempCleanup()` — see the header. A per-TEST sweep and a per-FILE app cannot coexist:
 * the first sweep would delete the live app's userData and config root.
 */
const ownedTempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  ownedTempDirs.push(dir);
  return dir;
}

test.afterAll(() => {
  for (const dir of ownedTempDirs.splice(0)) cleanupTemp(dir);
});

function startDaemon(pipeName: string, dataDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [daemonEntry], {
    env: {
      ...process.env,
      THRONG_PIPE_NAME: pipeName,
      THRONG_DATABASE_PATH: join(dataDir, 'throng.db'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('daemon did not become ready')),
      DAEMON_READY_TIMEOUT_MS,
    );
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (chunk.includes('listening')) {
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
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-projects-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-projects-${process.pid}-${Date.now()}`;
  const daemon = await startDaemon(pipeName, dataDir);
  return { daemon, dataDir, pipeName };
}

function launchApp(pipeName: string): Promise<ElectronApplication> {
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

async function createProject(win: Page, name: string, root: string, colour?: string): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill(name);
  await win.getByTestId('project-root-input').fill(root);
  if (colour) {
    // Drive the React-controlled colour input via the native value setter so
    // React's value tracker registers the change and fires onChange.
    await win.getByTestId('project-colour-input').evaluate((el, value) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, colour);
  }
  await win.getByTestId('project-save').click();
  await expect(win.locator('.project-item', { hasText: name })).toBeVisible();
  /*
   * 034 FR-045 — settle on the new project being ACTIVE, not merely listed.
   *
   * Creating a project opens it immediately, which swaps the entire workspace. Returning as soon as
   * the sidebar row appears leaves the PREVIOUS project's panels on screen, so anything read next —
   * a panel id, a `.panel-box` count, the accent — can describe the project that is about to be
   * destroyed. With one app per test there was never a previous project; shared, there is.
   *
   * Keyed on `data-active` rather than the name: `hasText` is a substring match over the row's whole
   * text, and exactly one project is active.
   */
  const active = win.locator('.project-item[data-active="true"]');
  await expect(active).toHaveCount(1);
  await expect(active).toContainText(name);
}

const projectItem = (win: Page, name: string) => win.locator('.project-item', { hasText: name });

test.describe('the two tests that only need an app', () => {
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
  });

  test('creates a project, makes it active, and opens its workspace', { tag: ['@core', '@window'] }, async () => {
    // A claim about the WHOLE app — no projects at all — and it is true here because this test runs
    // FIRST on the shared app, which is virgin. Kept verbatim rather than narrowed to "Subnet Vault
    // is absent": the empty state rendering on a fresh install is real coverage and narrowing it
    // would be a loss, not a fix. Anything inserted above this test breaks it, and that failure is
    // the correct one — at that point this test needs its own app.
    await expect(win.getByTestId('projects-empty')).toBeVisible();

    await createProject(win, 'Subnet Vault', 'C:/code/subnet');

    await expect(projectItem(win, 'Subnet Vault')).toHaveAttribute('data-active', 'true');
    // The active project's workspace (tab group) opens in the Workspace Pane.
    await expect(win.getByTestId('tab-strip')).toBeVisible();
    await expect(win.locator('.panel-box')).toHaveCount(1);
  });

  test('switches the active project and swaps the workspace + accent', { tag: ['@core', '@window', '@reserve:layout'] }, async () => {
    await createProject(win, 'Alpha', 'C:/code/alpha', '#ff0000');
    await createProject(win, 'Beta', 'C:/code/beta', '#00ff00');

    // Creating a project opens it: Beta (most recent) is active.
    await expect(projectItem(win, 'Beta')).toHaveAttribute('data-active', 'true');

    // Switching to Alpha swaps the Workspace Pane + the accent colour.
    await projectItem(win, 'Alpha').locator('[data-testid^="project-switch-"]').click();
    await expect(projectItem(win, 'Alpha')).toHaveAttribute('data-active', 'true');
    await expect(projectItem(win, 'Beta')).toHaveAttribute('data-active', 'false');
    await expect(win.getByTestId('workspace-pane')).toHaveAttribute('data-project', /.+/);
    await expect(win.getByTestId('tab-strip')).toBeVisible();

    const accent = await win.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    );
    expect(accent.toLowerCase()).toBe('#ff0000');
  });
});

/*
 * OWN APP — because its CONCLUSION is a claim about the whole app (034 FR-045).
 *
 * `projects-empty` and `workspace-no-project` together say "there are now no projects anywhere",
 * which is the "valid state" this test is named for. On a shared app three earlier projects would
 * still be there, and the only conversion available would be to stop asserting it. That is coverage
 * lost, so the launch is kept and the body is untouched.
 */
test('edits and deletes a project, leaving a valid state', { tag: ['@core', '@window'] }, async () => {
  const harness = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(harness.pipeName);
    const win = await app.firstWindow();

    await createProject(win, 'Working Title', 'C:/code/wt');
    await projectItem(win, 'Working Title').locator('[data-testid^="project-edit-"]').click();
    await win.getByTestId('project-name-input').fill('Renamed Project');
    await win.getByTestId('project-save').click();
    await expect(projectItem(win, 'Renamed Project')).toBeVisible();

    await projectItem(win, 'Renamed Project').locator('[data-testid^="project-delete-"]').click();
    await win.getByTestId('confirm-accept').click(); // Destroy Project: summary…
    await win.getByTestId('confirm-accept').click(); // …then the wry confirmation (FR-024)
    await expect(win.getByTestId('projects-empty')).toBeVisible();
    await expect(win.getByTestId('workspace-no-project')).toBeVisible();
  } finally {
    if (app) await shutdownApp(app);
    await stopDaemon(harness.daemon);
    cleanupTemp(harness.dataDir);
  }
});

/*
 * OWN APP AND OWN DAEMON — by construction (034 FR-045).
 *
 * Two app launches and a daemon restart against the same database ARE the requirement here (SQLite
 * durability), so there is nothing to share. Its `Alpha` / `Beta` at `C:/code/alpha` and
 * `C:/code/beta` also duplicate the shared test 2 exactly; FR-029 refuses identical roots, so even a
 * relaunch-free version of this test could not be folded in without renaming its fixtures.
 */
test('restores the project list and active project after a restart', { tag: ['@core', '@window', '@reserve:window'] }, async () => {
  const harness = await startHarness();
  let app: ElectronApplication | undefined;
  try {
    // Session 1: create two projects, leave Beta active.
    app = await launchApp(harness.pipeName);
    let win = await app.firstWindow();
    await createProject(win, 'Alpha', 'C:/code/alpha');
    await createProject(win, 'Beta', 'C:/code/beta');
    await projectItem(win, 'Beta').locator('[data-testid^="project-switch-"]').click();
    await expect(projectItem(win, 'Beta')).toHaveAttribute('data-active', 'true');
    await app.close();
    app = undefined;

    // Restart the daemon against the SAME database to prove SQLite durability.
    await stopDaemon(harness.daemon);
    harness.daemon = await startDaemon(harness.pipeName, harness.dataDir);

    // Session 2: relaunch the app; both projects + active Beta restored.
    app = await launchApp(harness.pipeName);
    win = await app.firstWindow();
    await expect(projectItem(win, 'Alpha')).toBeVisible();
    await expect(projectItem(win, 'Beta')).toBeVisible();
    // Lazy loading: nothing is opened at startup; open Beta on demand.
    await expect(win.getByTestId('workspace-no-project')).toBeVisible();
    await projectItem(win, 'Beta').locator('[data-testid^="project-switch-"]').click();
    await expect(projectItem(win, 'Beta')).toHaveAttribute('data-active', 'true');
  } finally {
    if (app) await shutdownApp(app);
    await stopDaemon(harness.daemon);
    cleanupTemp(harness.dataDir);
  }
});
