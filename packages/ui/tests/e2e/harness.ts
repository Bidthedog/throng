/**
 * Shared E2E harness for the throng Electron app. NOT a test file (no `.e2e.ts`
 * suffix → not collected by Playwright's testMatch). New E2E specs import these
 * helpers instead of duplicating ~90 lines of daemon/app boilerplate.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { openDatabase, runMigrations, type ThrongDatabase } from '@throng/persistence';

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

function startDaemon(pipeName: string, dataDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [daemonEntry], {
    env: {
      ...process.env,
      THRONG_PIPE_NAME: pipeName,
      THRONG_DATABASE_PATH: join(dataDir, 'throng.db'),
      THRONG_NO_ORPHAN_REAP: '1', // test daemons are short-lived + parallel; each test cleans its own tree
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('daemon not ready')), 10_000);
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

/**
 * Pre-seed the daemon's SQLite store in `dataDir` BEFORE the app/daemon launches.
 * Migrates a fresh DB to the current schema, then lets `mutate` shape it (e.g.
 * simulate a drifted schema or install a failure trigger). The DB is closed
 * before returning so the daemon can open it cleanly. Pass the same `dataDir` to
 * {@link runApp}.
 */
export function seedDatabase(dataDir: string, mutate: (db: ThrongDatabase) => void): void {
  const db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  try {
    runMigrations(db);
    mutate(db);
  } finally {
    db.close();
  }
}

/** Stub the native folder dialog. Pass a path to simulate a pick, or omit to cancel. */
export async function stubFolderDialog(app: ElectronApplication, pickedPath?: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () =>
      picked ? { canceled: false, filePaths: [picked] } : { canceled: true, filePaths: [] };
  }, pickedPath);
}

/**
 * Reload the renderer to re-fetch persisted state (e.g. after seeding the daemon).
 *
 * Uses a renderer-initiated `location.reload()` rather than Playwright's
 * `page.reload()` (CDP `Page.reload`). Under Electron 40+ the CDP reload of a
 * `file://`-loaded window intermittently aborts and double-commits the
 * navigation, leaving Playwright bound to a dead execution context whose
 * `ipcRenderer.send` is silently dropped — which made every "reload then open a
 * sub-workspace window" test flaky. A renderer-initiated reload is a single,
 * clean navigation and keeps the IPC channel live.
 */
export async function reloadWindow(win: Page): Promise<void> {
  await win.evaluate(() => location.reload());
  // Bounded (issue #75): a bare waitForLoadState defaults to the whole test timeout, so a reload
  // that never fires `load` hung the full budget as an unnamed timeout. 15s is generous for a
  // renderer reload and turns a genuine stall into a fast, named failure.
  await win.waitForLoadState('load', { timeout: 15_000 });
}

/**
 * Run a test body against a fresh app+daemon. A per-launch userData dir isolates
 * renderer localStorage; the folder dialog is stubbed to cancel by default.
 */
export async function runApp(
  fn: (app: ElectronApplication, win: Page, ctx: { pipeName: string }) => Promise<void>,
  opts: {
    dataDir?: string;
    userDataDir?: string;
    env?: Record<string, string>;
    /**
     * Skip pre-spawning the daemon so the APP spawns its own via ensureDaemon
     * (exercises the real production startup + host-Node ABI). The app-spawned
     * detached daemon is killed on teardown via its health.ping pid.
     */
    skipDaemon?: boolean;
  } = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'throng-e2e-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-${process.pid}-${Date.now()}`;
  const daemon = opts.skipDaemon ? null : await startDaemon(pipeName, dataDir);
  const userData = opts.userDataDir ?? mkdtempSync(join(tmpdir(), 'throng-ud-'));
  // Isolate the user config root to a temp dir by default so the app's first-run
  // file creation never touches the real %USERPROFILE%\.throng (a test may still
  // override THRONG_CONFIG_ROOT via opts.env).
  const ownCfgRoot = opts.env?.THRONG_CONFIG_ROOT === undefined;
  const cfgRoot = opts.env?.THRONG_CONFIG_ROOT ?? mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      env: {
        ...process.env,
        THRONG_PIPE_NAME: pipeName,
        THRONG_CONFIG_ROOT: cfgRoot,
        THRONG_NO_ORPHAN_REAP: '1', // an app-spawned test daemon must not sweep sibling test daemons' trees
        // Electron's clipboard DOES NOT WORK under this harness — text written to it reads back
        // empty and `availableFormats()` is empty — so the app under test would have no clipboard
        // at all, and every clipboard assertion would pass only by expecting nothing. Fill the seam
        // in-process instead: the tests then prove the FEATURE, and parallel workers stop fighting
        // over the one global OS clipboard. The shipped path is untouched (016, FR-013a).
        THRONG_E2E_CLIPBOARD: 'memory',
        // When the app spawns its own daemon, point that daemon at this run's DB
        // (the daemon inherits the app's env) so we never touch the real store.
        ...(opts.skipDaemon ? { THRONG_DATABASE_PATH: join(dataDir, 'throng.db') } : {}),
        ...opts.env,
      },
    });
    const win = await app.firstWindow();
    await stubFolderDialog(app); // cancel by default
    await fn(app, win, { pipeName });
  } finally {
    // Kill an app-spawned detached daemon BEFORE closing the app: Playwright's
    // app.close() waits for the Electron process's child tree, and the detached
    // daemon (which by design outlives the UI) would otherwise hang teardown.
    if (!daemon) await killAppSpawnedDaemon(pipeName);
    if (app) await shutdownApp(app);
    if (daemon) await stopDaemon(daemon);
    // Clean up every temp dir this run created (Electron holds the userData dir until
    // the app has fully closed, hence the retries). Skip any the caller supplied.
    //
    // BEST-EFFORT, and this matters (017 FR-013a/FR-014). Electron releases its userData
    // dir asynchronously, some time after the process exits; under worker contention it can
    // still hold the lock when the retries run out, and rmSync then throws EPERM. This is
    // housekeeping, not an assertion — the test has already passed by the time we get here —
    // so letting it throw turns a lost race with the OS file lock into a RED TEST, on the
    // first attempt, after every assertion was green. That is the precise non-signal the
    // flake gate must never fire on. `runApp` backs ~40 specs, so an unguarded rmSync here
    // is a flake source for the whole cohort. (The same class was fixed for non-runApp specs
    // in temp-file-helpers.ts; this is the seam it missed.) Nothing leaks: globalTeardown
    // removes the whole per-run throng_e2e_<runhash> folder these dirs live under.
    const cleanup = { recursive: true, force: true, maxRetries: 15, retryDelay: 200 } as const;
    const rmBestEffort = (dir: string): void => {
      try {
        rmSync(dir, cleanup);
      } catch {
        // lost the race with Electron's userData lock; globalTeardown sweeps it.
      }
    };
    if (!opts.dataDir) rmBestEffort(dataDir);
    if (ownCfgRoot) rmBestEffort(cfgRoot);
    if (!opts.userDataDir) rmBestEffort(userData);
  }
}

/** How long the graceful shutdown gets before we force-kill the Electron process tree. */
const SHUTDOWN_GRACE_MS = 15_000;

/**
 * Force-kill an OS process and its entire child tree, best-effort and BOUNDED.
 *
 * On Windows this is `taskkill /T /F` (whole tree, unconditional) — the only reliable way to reap
 * a wedged Electron app together with its renderer/GPU/utility children and any conhost it spawned.
 * A missing process (already exited) or an access error is swallowed: this is a last-resort cleanup,
 * never an assertion.
 */
export function forceKillProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 10_000,
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL'); // negative pid → the process group
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    /* already gone, or no permission — best effort, by design */
  }
}

/**
 * Tear down the Electron app without teardown hangs. Two distinct hazards, both closed here:
 *
 * 1) **The close handshake.** The main window intercepts its `close` event to show the app-close
 *    warning (FR-015) — so a plain `app.close()` (especially with a sub-workspace window also open)
 *    stalls waiting on a prompt Playwright never answers, and the windows "hang around". We
 *    **destroy** every BrowserWindow in the main process (destroy fires no `close` event, bypassing
 *    the handshake), which triggers `window-all-closed → app.quit()`, with a short settle between
 *    the sub-workspace windows and the main window.
 *
 * 2) **A wedged app hanging WORKER teardown (issue #75).** When a test times out, Playwright runs
 *    this teardown against an app that may already be wedged — a stuck renderer that never answers
 *    `evaluate`, an undead child keeping the process alive. An unbounded `app.close()` then rides
 *    out the *worker-teardown* budget and Playwright reports "1 error was not a part of any test" —
 *    a NON-test error that NO retry absorbs and that hard-reds the shard. So the graceful path is
 *    RACED against a deadline; if it does not complete, we force-kill the whole Electron process
 *    tree. Teardown is thereby bounded by construction and can never blow the worker budget.
 */
async function shutdownApp(app: ElectronApplication): Promise<void> {
  // The app may ALREADY have exited on its own — many specs trigger the app's own quit (TERMINATE
  // ALL / an ordinary close that drains and quits) in the test body. Once the Electron process is
  // gone, Playwright's `app.process()` throws ("Cannot read properties of undefined"), so read the
  // pid defensively: no process ⇒ nothing to force-kill, and the graceful path below no-ops fast.
  let pid: number | undefined;
  try {
    pid = app.process().pid;
  } catch {
    pid = undefined;
  }
  // The graceful path: destroy detached sub-workspace windows first (the child windows), settle,
  // then destroy whatever remains (the main window) — mirrors the manual "switch focus, close both
  // windows with a beat between" that avoids the handshake hang — then finalise with app.close().
  const graceful = (async () => {
    await app
      .evaluate(({ BrowserWindow }) => {
        const wins = BrowserWindow.getAllWindows();
        // Heuristic: the earliest-created window is the main one; destroy the rest first.
        const [main, ...children] = wins.sort((a, b) => a.id - b.id);
        for (const w of children) if (!w.isDestroyed()) w.destroy();
        return main?.id ?? null;
      })
      .catch(() => null);
    await new Promise((r) => setTimeout(r, 200));
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy();
      })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
    await app.close().catch(() => {});
  })();

  const settledGracefully = await Promise.race([
    graceful.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), SHUTDOWN_GRACE_MS)),
  ]);

  if (!settledGracefully && pid !== undefined) {
    forceKillProcessTree(pid);
    // The process is gone now, so this resolves immediately and lets Playwright observe the exit
    // rather than waiting on its own internal kill timeout.
    await app.close().catch(() => {});
  }
}

/** Kill a detached daemon the APP spawned: ask it for its pid via health.ping. */
async function killAppSpawnedDaemon(pipeName: string): Promise<void> {
  const pong = await new Promise<{ pid?: number } | null>((resolve) => {
    const socket = connect(pipeName);
    let buffer = '';
    const done = (v: { pid?: number } | null): void => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 2000);
    socket.setEncoding('utf8');
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'health.ping', params: {} })}\n`),
    );
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try {
        done(JSON.parse(buffer.slice(0, nl)).result ?? null);
      } catch {
        done(null);
      }
    });
    socket.on('error', () => done(null));
  });
  if (pong?.pid) {
    try {
      process.kill(pong.pid);
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Create a project via the form (folder filled manually; dialog stays stubbed). */
export async function createProject(win: Page, name: string, root: string): Promise<void> {
  await win.getByTestId('project-new').click();
  await expect(win.getByTestId('project-form')).toBeVisible();
  await win.getByTestId('project-root-input').fill(root);
  await win.getByTestId('project-name-input').fill(name);
  await win.getByTestId('project-save').click();
  await expect(win.locator('.project-item', { hasText: name })).toBeVisible();
}

export async function firstPanelId(win: Page): Promise<string> {
  return win
    .locator('.panel-box')
    .first()
    .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
}

export async function panelIds(win: Page): Promise<string[]> {
  return win.locator('.panel-box').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.panelId ?? ''));
}

/**
 * Add `n` sibling panels to the active tab, committing each new panel's inline rename.
 *
 * The two specs that need this each grew their own copy, each closing one of the two races
 * below and leaving the other open — so both were flaky, for different reasons (issue #59).
 * One helper, both races closed.
 *
 * **Race 1 — the baseline.** The workspace renders NO panels until its layout has loaded (the
 * tab group returns an empty fragment while `layout` is null), and {@link createProject} returns
 * as soon as the project appears in the sidebar, which is *before* that round-trip lands. Neither
 * `count()` nor `evaluateAll()` auto-waits, so a baseline read inside that window is 0 — the
 * click still works, and every assertion built on the baseline is then off by one. Settle on a
 * rendered workspace before reading anything.
 *
 * **Race 2 — the stray Enter.** A new panel opens in rename mode with its input `autoFocus`ed.
 * Press Enter before that focus lands and it re-activates the add BUTTON, adding a panel nobody
 * asked for.
 *
 * The rename input also commits on blur, so anything that steals focus back — a live terminal in
 * a sibling panel does exactly that — commits the rename for us and unmounts the input. That is a
 * legitimate outcome, not a failure: settle on the new panel existing, then commit the rename
 * only if it is still open.
 */
export async function addPanels(win: Page, n: number): Promise<void> {
  await expect(win.locator('.panel-box').first()).toBeVisible();
  for (let i = 0; i < n; i += 1) {
    const before = await win.locator('.panel-box').count();
    const first = (await panelIds(win))[0];
    await win.getByTestId(`panel-add-${first}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(before + 1);
    await commitPanelRename(win);
  }
}

/**
 * Close the inline rename a freshly-added Panel opens in — and do not return until no rename
 * input is open (017 FR-013a). Call this after ANY action that adds a Panel.
 *
 * `await expect(win.locator('.panel-box')).toHaveCount(n)` settles as soon as the BOX renders, but
 * the rename input `autoFocus`es a render LATER. A bare `keyboard.press('Enter')` after the count
 * therefore fires into the gap: it commits nothing, the input then mounts, and it STAYS OPEN.
 * `keyboard.press` does not auto-wait, so nothing catches it — the test carries on with an open
 * text input on the panel header.
 *
 * What that breaks is rarely the next assertion, which is what makes it so slippery. A panel whose
 * header is an open rename input is not draggable: the pointerdown lands in the input instead of
 * the drag handle, dnd-kit never reaches its activation distance, `draggingPanelId` stays null and
 * the edge drop-zones — rendered only while a drag is live — never appear. The failure surfaces
 * 30 seconds later as `waiting for getByTestId('edge-bottom-…') to be visible`, pointing at the
 * drag helper rather than at the Enter that missed (issue #75; observed on CI shard 3/3).
 *
 * 017 fixed this inside {@link addPanels}, but six specs hand-roll the add + blind-Enter sequence
 * without it. This is that fix, extracted so there is ONE implementation to be right.
 *
 * The input also commits on blur, so anything stealing focus back — a live terminal in a sibling
 * panel — closes it for us and it never appears. That is an equally fine outcome: either way we
 * return with no open rename input.
 */
export async function commitPanelRename(win: Page): Promise<void> {
  await commitInlineRename(win, 'panel-rename-input-');
}

/**
 * The Tab equivalent of {@link commitPanelRename} — `tab-add` opens the new tab in rename mode
 * (`onNewTab={() => setRenamingTabId(ws.addTab())}`), so a blind Enter after clicking it races the
 * input's mount exactly the same way.
 */
export async function commitTabRename(win: Page): Promise<void> {
  await commitInlineRename(win, 'tab-rename-input-');
}

/** Shared implementation: wait for the input, commit it if it opened, return only once it is gone. */
async function commitInlineRename(win: Page, testIdPrefix: string): Promise<void> {
  const rename = win.locator(`[data-testid^="${testIdPrefix}"]`);
  const appeared = await rename
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await expect(rename).toBeFocused();
    await win.keyboard.press('Enter');
  }
  await expect(rename).toHaveCount(0);
}

/**
 * Settle on a RENDERED window before reading any raw state (017 FR-013).
 *
 * A test may not measure the interface before the interface exists. The trap this closes is a
 * *negative* opening assertion — `await expect(x).toHaveCount(0)` — which a DOM that has not
 * rendered anything at all satisfies **vacuously**. It passes instantly, proves nothing, and reads
 * to the next author exactly like a wait. Assert something is PRESENT first; assert absence after.
 *
 * The root is a parameter because `.throng-shell` exists only in the main and sub-workspace
 * windows — the Preferences window's root is `.prefs-root`.
 */
export async function settle(win: Page, root = '.throng-shell'): Promise<void> {
  await expect(win.locator(root)).toBeVisible();
}

/**
 * Element geometry, measured only once the element has STOPPED MOVING (017 FR-013a).
 *
 * Two things are wrong with the read this replaces —
 * `page.evaluate(() => document.querySelector(…).getBoundingClientRect())`:
 *
 *   1. It does not wait for the element to exist, so it throws on null or measures an element the
 *      stylesheet has not reached yet.
 *   2. It does not wait for the element to be STILL. The pane layout animates
 *      (`grid-template-columns`, 180ms), so a read taken mid-transition is a real number that
 *      describes a moment nobody cares about — and it differs from run to run purely by timing.
 *
 * `locator.boundingBox()` fixes (1) but NOT (2): it waits for visibility, not for stability. So we
 * poll until two consecutive boxes agree. That is a genuine *condition* — "the element has stopped
 * moving" — and it is why this helper can replace `waitForTimeout(300)` rather than merely hide it.
 * A sleep asserts that 300ms is always enough; this asserts that the thing you are about to measure
 * has actually settled.
 *
 * Throws rather than returning null, so a missing element cannot slide into a `NaN` comparison that
 * silently passes.
 */
export async function geom(
  locator: Locator,
): Promise<{ x: number; y: number; w: number; h: number }> {
  await expect(locator).toBeVisible();

  let previous: { x: number; y: number; width: number; height: number } | null = null;
  let settledBox: { x: number; y: number; width: number; height: number } | null = null;

  await expect
    .poll(
      async () => {
        const current = await locator.boundingBox();
        if (!current) return false;
        const still =
          previous !== null &&
          Math.abs(current.x - previous.x) < 0.5 &&
          Math.abs(current.y - previous.y) < 0.5 &&
          Math.abs(current.width - previous.width) < 0.5 &&
          Math.abs(current.height - previous.height) < 0.5;
        previous = current;
        if (still) settledBox = current;
        return still;
      },
      {
        timeout: 10_000,
        message: `geom(): ${locator.toString()} never stopped moving (still animating?)`,
        intervals: [50, 50, 100, 100, 250],
      },
    )
    .toBe(true);

  if (!settledBox) {
    throw new Error(
      `geom(): element never became visible, so it has no box: ${locator.toString()}. ` +
        'Settle on it first (see settle()).',
    );
  }
  const box: { x: number; y: number; width: number; height: number } = settledBox;
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/**
 * The window's inner dimensions.
 *
 * Needed because some assertions measure a control against the WINDOW EDGE (e.g. the pane-collapse
 * button's gap from the right edge = `innerWidth - rect.right`), which a bounding box alone cannot
 * express. Reading `window.innerWidth` touches no element, so it cannot race with one rendering —
 * it is not the unguarded "reach through evaluate and measure an element" read that FR-013a bans.
 *
 * Take `geom()` FIRST (it auto-waits, and so establishes that the layout has settled), then read
 * the viewport. That ordering is what makes the pair consistent.
 */
export async function viewport(win: Page): Promise<{ width: number; height: number }> {
  return win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

/** JSON-RPC over the daemon pipe (one-shot request/response). */
export function daemonRpc(
  pipeName: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return new Promise((resolve) => {
    const socket = connect(pipeName);
    let buffer = '';
    const done = (v: unknown): void => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 3000);
    socket.setEncoding('utf8');
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })}\n`),
    );
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try {
        done(JSON.parse(buffer.slice(0, nl)).result ?? null);
      } catch {
        done(null);
      }
    });
    socket.on('error', () => done(null));
  });
}

/**
 * Count `throng:terminal:resize` IPC messages the renderer sends to the main
 * process (012, T003). Reused by SC-004 (a focus change must send ZERO terminal
 * resizes) and SC-005 (a per-type zoom recomputes the terminal grid → ≥1 resize).
 *
 * Instruments the main process by wrapping the existing `ipcMain.handle` for the
 * resize channel with a counter that delegates to the original handler, so the
 * real resize path (and its return value) is unchanged — only observed.
 */
export async function installResizeProbe(app: ElectronApplication): Promise<{
  count: () => Promise<number>;
  reset: () => Promise<void>;
}> {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as { __throngResizeCount?: number; __throngResizeProbed?: boolean };
    if (g.__throngResizeProbed) return;
    const channel = 'throng:terminal:resize';
    const store = ipcMain as unknown as {
      _invokeHandlers: Map<string, (...a: unknown[]) => unknown>;
    };
    const original = store._invokeHandlers.get(channel);
    if (!original) return;
    g.__throngResizeCount = 0;
    g.__throngResizeProbed = true;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      g.__throngResizeCount = (g.__throngResizeCount ?? 0) + 1;
      return (original as (...a: unknown[]) => unknown)(event, ...args);
    });
  });
  return {
    count: () =>
      app.evaluate(() => (globalThis as { __throngResizeCount?: number }).__throngResizeCount ?? 0),
    reset: () =>
      app.evaluate(() => {
        (globalThis as { __throngResizeCount?: number }).__throngResizeCount = 0;
      }),
  };
}

/** The terminal-hosting daemon's OS pid (via health.ping over its pipe). */
export async function daemonPid(pipeName: string): Promise<number> {
  const pong = (await daemonRpc(pipeName, 'health.ping')) as { pid?: number } | null;
  if (!pong?.pid) throw new Error('daemon health.ping returned no pid');
  return pong.pid;
}

/**
 * The pids of `conhost.exe --headless` hosts owned by `parentPid` (the daemon) — one
 * per live ConPTY. A terminal that has fully released its OS resources leaves none
 * behind, so this is the orphan-leak probe for the no-orphans E2E.
 */
export function conhostChildren(parentPid: number): number[] {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'conhost.exe' -and $_.ParentProcessId -eq ${parentPid} -and $_.CommandLine -match '--headless' } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf8', timeout: 8000, windowsHide: true },
    );
    return out
      .split(/\r?\n/)
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/** Poll until `conhostChildren(pid)` is a subset of `baseline` (orphans reaped), or fail. */
export async function expectNoOrphanConhosts(
  parentPid: number,
  baseline: number[],
  timeoutMs = 12000,
): Promise<void> {
  const base = new Set(baseline);
  const deadline = Date.now() + timeoutMs;
  let extra: number[] = [];
  while (Date.now() < deadline) {
    extra = conhostChildren(parentPid).filter((p) => !base.has(p));
    if (extra.length === 0) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`orphaned conhost hosts survived termination: ${extra.join(', ')}`);
}

export { mkdtempSync, tmpdir, join };

/**
 * Move a slider the way a HAND does: set the value, then LET GO.
 *
 * The slider commits when the pointer comes up, not on a timer and not on every pixel of travel — so a
 * `fill()` alone is a thumb held down forever, and nothing is written. Releasing is not test ceremony;
 * it is the gesture, and it is the half these tests used to leave out.
 */
export async function setSlider(slider: import('@playwright/test').Locator, value: string): Promise<void> {
  await slider.fill(value);
  await slider.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
}
