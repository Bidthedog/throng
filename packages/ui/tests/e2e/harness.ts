/**
 * Shared E2E harness for the throng Electron app. NOT a test file (no `.e2e.ts`
 * suffix → not collected by Playwright's testMatch). New E2E specs import these
 * helpers instead of duplicating ~90 lines of daemon/app boilerplate.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { openDatabase, runMigrations, type ThrongDatabase } from '@throng/persistence';
import { quiesceSampler } from './quiesce-sampler.js';

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

/**
 * `process.env` with every CLAUDE_* / ANTHROPIC_* variable removed.
 *
 * A suite driven FROM a Claude Code session inherits its variables, and they reach all the way down
 * into a `claude` running inside a terminal panel under test — which then announces "Transcript
 * saving is off - inherited CLAUDE_CODE_CHILD_SESSION marker" and behaves like a child session:
 * no agents affordance, and no kitty keyboard negotiation. Measured: a test then presses Left into a
 * view that never opens and reports on a state no user is ever in.
 *
 * A test environment must not depend on who launched it, so they are stripped for every run.
 */
function claudeFreeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    // THRONG_CLAUDE_E2E* are this suite's own switches, not Claude Code's.
    if (/^(CLAUDE|ANTHROPIC)/i.test(key)) delete env[key];
  }
  return env;
}

function startDaemon(
  pipeName: string,
  dataDir: string,
  extraEnv: Record<string, string> = {},
): Promise<ChildProcess> {
  const child = spawn(process.execPath, [daemonEntry], {
    env: {
      // The daemon spawns every terminal, so a program in a panel inherits THIS environment - which
      // is why the Claude Code variables have to be stripped here too, not only at the app.
      ...claudeFreeEnv(),
      THRONG_PIPE_NAME: pipeName,
      THRONG_DATABASE_PATH: join(dataDir, 'throng.db'),
      THRONG_NO_ORPHAN_REAP: '1', // test daemons are short-lived + parallel; each test cleans its own tree
      // #209 — lets a spec give the DAEMON an environment the app will not have, which is an aged
      // daemon in miniature: the two differ, which is the whole of what that bug needs.
      ...extraEnv,
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
/**
 * Stop the app opening real OS file-manager windows during a test run.
 *
 * `shell.openPath` / `shell.showItemInFolder` launch Explorer. A test that exercises "Open Logs
 * Folder" therefore leaves a real window on the developer's desktop, every run — and on a suite this
 * size that is both a nuisance and a hazard, because a window appearing STEALS FOCUS, and throng
 * closes menus and popups on blur by design. A stray Explorer window can fail an unrelated test that
 * merely had a menu open at the wrong moment.
 *
 * Recorded rather than discarded: `__throngOpenedPaths` in the main process holds what the app asked
 * to open, so a spec can still assert the request was made and where it pointed. `openExternal` is
 * deliberately NOT stubbed here — the link specs install their own counters on it.
 */
export async function stubShellOpen(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __throngOpenedPaths?: string[] };
    g.__throngOpenedPaths = [];
    shell.openPath = async (target: string) => {
      g.__throngOpenedPaths!.push(target);
      return ''; // '' is Electron's "opened successfully"
    };
    shell.showItemInFolder = (target: string) => {
      g.__throngOpenedPaths!.push(target);
    };
  });
}

/** What the app asked the OS to open, in order. Empty unless something tried. */
export async function openedPaths(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __throngOpenedPaths?: string[] }).__throngOpenedPaths ?? [],
  );
}

/**
 * Click into a panel's CodeMirror editor and wait until it ACTUALLY has focus.
 *
 * A click resolves as soon as the event is dispatched; CodeMirror adds `.cm-focused` a beat later.
 * Keys sent in that gap go nowhere, so the assertion blames the feature for a keystroke the editor
 * never received. Measured repeatedly across full runs: `editor-find` failed 0/5 this way and
 * `editor-column-select` flaked twice in one run, both passing in isolation.
 *
 * Use this instead of clicking `.cm-content` directly whenever keys follow.
 */
export async function focusEditor(win: Page, panelId: string): Promise<void> {
  const editor = win.getByTestId(`editor-${panelId}`);
  await editor.locator('.cm-content').click();
  await expect(editor.locator('.cm-editor.cm-focused')).toBeVisible({ timeout: 10_000 });
}

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
export interface AppOptions {
  dataDir?: string;
  userDataDir?: string;
  env?: Record<string, string>;
  /**
   * Skip pre-spawning the daemon so the APP spawns its own via ensureDaemon
   * (exercises the real production startup + host-Node ABI). The app-spawned
   * detached daemon is killed on teardown via its health.ping pid.
   */
  skipDaemon?: boolean;
  /**
   * Extra environment for the DAEMON only, never the app (#209).
   *
   * The daemon outlives the UI and is reused, so in real life its environment is a snapshot of a
   * session that may be days old. Setting a variable here and not on the app reproduces exactly
   * that relationship, in seconds.
   */
  daemonEnv?: Record<string, string>;
}

/** A running app, plus the teardown that `runApp` would otherwise have done for you. */
export interface OpenApp {
  app: ElectronApplication;
  win: Page;
  pipeName: string;
  userDataDir: string;
  close: () => Promise<void>;
}

/**
 * Open an app and hand back the handle, leaving teardown to the caller.
 *
 * `runApp` opens one app per call, which for most specs means one Electron launch, one daemon and
 * one shell start PER TEST — measured at ~2s each on CI. The suite was 592 launches before spec 034
 * (`node scripts/count-e2e-launches.mjs --baseline d55054b`); run that script with no arguments for
 * today's figure, and see `launch-sharing.md` for the per-file decision. Where a file's tests do not
 * need distinct pre-launch state, they can share one app through `beforeAll`, which is what this
 * exists for:
 *
 *   let h: OpenApp;
 *   test.describe.configure({ mode: 'serial' });
 *   test.beforeAll(async () => { h = await openApp(); });
 *   test.afterAll(async () => { await h.close(); });
 *
 * Serial mode is not optional. Tests sharing an app share its window, its projects and its database,
 * so they must not interleave — and when one fails, the rest are skipped rather than run against
 * whatever state the failure left behind, which would turn one fault into a page of noise.
 *
 * Prefer `runApp` when a test's claim is ABOUT THE STARTUP PATH, or when it deliberately wants a
 * pristine app; the isolation is worth 2s. This is for the files where that 2s buys nothing.
 *
 * ══ "SEEDS A CONFIG ROOT" IS NOT THE TEST, AND READING IT AS ONE COST ~70 LAUNCHES ══
 *
 * Spec 034's SC-010 recorded that the whole `preferences-*` family was unshareable because "every one
 * of their tests seeds `THRONG_CONFIG_ROOT` BEFORE the app starts". Most of them call
 * `freshCfgRoot()` with NO ARGUMENTS: the isolated root is WRITE ISOLATION so one test's writes do
 * not reach another's, not state the app must find already there. The two are indistinguishable at
 * the call site, which is why a whole family was written off in a success criterion.
 *
 * The question that actually decides it is whether the state could be written THROUGH the running
 * app. It usually can — `helpers/config-write.ts` exists for exactly that, the config store
 * hot-reloads, and `preferences-json.e2e.ts` already rewrote a live app's `settings.json` and watched
 * the open editor follow it. That file went from 16 launches to 5.
 *
 * What genuinely resists is narrow and has one shape: a malformed file that must survive the STARTUP
 * read, a nonexistent active theme at boot, a fresh-install seeding — and anything fixed when the
 * `BrowserWindow` is CONSTRUCTED. `theme-flash.e2e.ts` was converted and had to be reverted for the
 * last of those: sharing made its Light test read a DARK native background while the renderer had
 * correctly gone light.
 *
 * Verify a conversion at `--repeat-each=3`, never on one green pass. Four conversions on this branch
 * passed once and were undone; see `launch-sharing.md`.
 */
export async function openApp(opts: AppOptions = {}): Promise<OpenApp> {
  const started = await launchApp(opts);
  return {
    app: started.app,
    win: started.win,
    pipeName: started.pipeName,
    userDataDir: started.userDataDir,
    // `true`: a shared app is torn down in an afterAll, where the flush cannot wait for a hook.
    close: () => started.teardown(true),
  };
}

export async function runApp(
  // `userDataDir` is the run's own Electron data directory — where per-user state, including
  // the diagnostics logs (#123), is written. Exposed so a spec can assert on what landed there.
  fn: (app: ElectronApplication, win: Page, ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts: AppOptions = {},
): Promise<void> {
  const started = await launchApp(opts);
  try {
    await fn(started.app, started.win, {
      pipeName: started.pipeName,
      userDataDir: started.userDataDir,
    });
  } finally {
    await started.teardown();
  }
}

/*
 * TRACES, for the failures only CI can produce (#298, #299).
 *
 * `use: { trace: 'retain-on-failure' }` in playwright.config.ts is the obvious implementation and it
 * would be INERT — while looking exactly like it worked. That fixture only covers a context
 * Playwright created itself; this harness calls `electron.launch()`, so the trace fixture never sees
 * the app and every run would produce a config nobody could tell was doing nothing. Tracing has to
 * be started on the ElectronApplication's OWN context, which is what these two do.
 *
 * OFF unless THRONG_E2E_TRACE is set. A trace captures a DOM snapshot per action, which is real
 * overhead across a 500-test suite; the runs that need it are the ones nobody can reproduce, so the
 * release lane sets it (`.github/workflows/release.yml`) and an ordinary local run is untouched.
 *
 * SAVED ONLY ON FAILURE, discarded otherwise — what `retain-on-failure` means. Note what a shared
 * app costs here: files using `openApp()` in `beforeAll` tear down in an `afterAll` hook, where no
 * individual test is current, so their trace is kept when the hook itself reports a failure and
 * covers the whole file rather than one test. That is the best a shared context can do, and it is
 * still the difference between a stack trace and a timeline.
 */
const tracingApps = new WeakSet<ElectronApplication>();
let traceSeq = 0;
/** Traces stopped to a scratch path, awaiting a settled test status to keep or discard them. */
const pendingTraces: string[] = [];
/**
 * Terminal diagnostics captured at teardown, kept or dropped with the trace.
 *
 * A trace shows what the TEST did; for #298 the open question is what THRONG DECIDED — specifically
 * whether `term.buffer.active.type === 'alternate'` held at the moment Ctrl+End was pressed, since
 * a program that negotiates nothing has no other way to own the keyboard
 * (`use-terminal.ts`: `programOwnsKeyboard = kittyKeyboardActive(kitty) || altBuffer`). throng
 * already records that per keypress; nothing was collecting it on a CI failure.
 */
const pendingDiagnostics: { name: string; body: string }[] = [];
/** Set by the afterEach below; the only failure signal a shared-app `afterAll` can still see. */
let workerSawFailure = false;

/**
 * `test.info()` THROWS when nothing is running — a teardown can legitimately reach here from
 * outside a test or hook, and that must not be an error.
 */
function currentTestInfo(): ReturnType<typeof test.info> | undefined {
  try {
    return test.info();
  } catch {
    return undefined;
  }
}

/**
 * Snapshot `__throngTerminalDiagnostics()` while the window still exists.
 *
 * Best-effort in every direction: the page may be gone, the helper may not be installed (it is a
 * renderer global), and neither is a reason to fail a test. Gated with tracing so an ordinary run
 * pays nothing.
 */
async function captureTerminalDiagnostics(app: ElectronApplication): Promise<void> {
  if (process.env.THRONG_E2E_TRACE === undefined) return;
  try {
    const win = app.windows()[0];
    if (win === undefined) return;
    const body = await win.evaluate(() => {
      const fn = (window as unknown as { __throngTerminalDiagnostics?: () => unknown })
        .__throngTerminalDiagnostics;
      return fn === undefined ? null : JSON.stringify(fn(), null, 2);
    });
    if (typeof body === 'string' && body.length > 0) {
      pendingDiagnostics.push({ name: `throng-terminal-diagnostics-${traceSeq}.json`, body });
    }
  } catch {
    // The window is already gone, or the page refused to evaluate. Diagnostics are never a reason
    // to redden a run.
  }
}

async function startTracing(app: ElectronApplication): Promise<void> {
  if (process.env.THRONG_E2E_TRACE === undefined) return;
  /*
   * NEVER trace a spec that measures time — you cannot measure frame timing under a profiler.
   *
   * A trace captures a DOM snapshot per action, and `editor-highlight-perf.e2e.ts` asserts that
   * typing drops NO frames. With tracing on it failed 4/4 on the release lane reporting a single
   * 59ms frame, which is the snapshot, not the product. The suite already names these files
   * `*perf*.e2e.ts` (editor-highlight-perf, quick-open-perf, performance), and that convention is
   * what this reads — a perf spec opts out by being named like one.
   */
  const spec = currentTestInfo()?.file ?? '';
  if (/perf/i.test(spec.replace(/^.*[\\/]/, ''))) return;
  try {
    await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    tracingApps.add(app);
  } catch (err) {
    // Diagnostics, never an assertion: a context that will not trace must not redden a run whose
    // every assertion was green. But it MUST say so — a silent catch here is how this seam spent
    // its first revision doing nothing at all while looking perfectly installed.
    console.warn(`[trace] could not start: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/*
 * Stopped to a SCRATCH path, always — the keep/discard decision cannot be made here.
 *
 * This is the part that cost a probe to find, and it is worth stating precisely because every
 * obvious implementation of it silently keeps nothing. `runApp` tears down in a `finally` INSIDE
 * the test body, so at this point the test function has not yet rejected and Playwright has
 * recorded nothing: `testInfo.status` still reads `passed` and `testInfo.errors` is still EMPTY.
 * There is no signal here to branch on. A `status` check discards the trace of every failure it
 * exists to capture, and so does an `errors` check.
 *
 * But the trace must be stopped before the app closes, so stopping cannot wait for the status.
 * Hence: stop to scratch now, decide in the hooks below, where the status is settled.
 */
async function stopTracing(app: ElectronApplication, flushNow = false): Promise<void> {
  if (!tracingApps.has(app)) return;
  tracingApps.delete(app);
  try {
    const scratch = join(tmpdir(), `throng-trace-${process.pid}-${(traceSeq += 1)}.zip`);
    await app.context().tracing.stop({ path: scratch });
    pendingTraces.push(scratch);
    /*
     * A SHARED app flushes here, not in the afterAll hook below, because hook ORDER decided whether
     * it worked at all — and it did not. `openApp()` files close in their own `afterAll`, and the
     * harness's flush hook is registered first (this module is imported before the spec body runs),
     * so it fired BEFORE the app had been torn down and found nothing pending. The result was that
     * traces landed for every `runApp` spec and for none of the shared-app ones — which is exactly
     * the set #298 lives in, so the one test the tracing was built for produced nothing.
     *
     * By this point every `afterEach` has already run, so `workerSawFailure` is settled and the
     * decision needs no hook of its own.
     */
    if (flushNow) {
      const info = currentTestInfo();
      if (info !== undefined) await flushTraces(info, workerSawFailure);
    }
  } catch (err) {
    console.warn(`[trace] could not stop: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Keep the pending traces under the test's own output dir, or delete them. */
async function flushTraces(info: ReturnType<typeof test.info>, keep: boolean): Promise<void> {
  const diags = pendingDiagnostics.splice(0, pendingDiagnostics.length);
  if (keep) {
    for (const d of diags) {
      try {
        writeFileSync(info.outputPath(d.name), d.body);
        console.warn(`[trace] kept ${d.name}`);
      } catch {
        /* best effort */
      }
    }
  }
  const taken = pendingTraces.splice(0, pendingTraces.length);
  for (const scratch of taken) {
    try {
      if (keep) {
        // `outputPath` lands it under test-results/, which the release lane already uploads.
        const kept = info.outputPath(basename(scratch));
        // copy+delete, not rename: %TEMP% and the repo are routinely on different drives here,
        // and rename across them is EXDEV.
        await copyFile(scratch, kept);
        await rm(scratch, { force: true });
        console.warn(`[trace] kept ${kept}`);
      } else {
        await rm(scratch, { force: true });
      }
    } catch (err) {
      console.warn(`[trace] could not flush: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/*
 * Two hooks, because the suite has two app lifetimes.
 *
 * A `runApp` spec tears its app down inside the test, so its trace is pending by the time
 * `afterEach` runs and that hook's `testInfo` carries the settled status — the ordinary case.
 *
 * A shared-app file (`openApp()` in `beforeAll`) tears down in `afterAll`, long after every
 * `afterEach` has fired, and an `afterAll` hook's own status says nothing about the tests that ran
 * under it. So `afterEach` records whether anything in this worker failed, and `afterAll` keeps the
 * file's trace on that. It is coarser — one trace for the file rather than the test — which is the
 * price of sharing one context across a file, and still the difference between a stack trace and a
 * timeline.
 */
/*
 * Registered ONLY when tracing is on, and defensively.
 *
 * `test.afterEach` throws unless it is called while Playwright is collecting a test file, and this
 * module is imported outside that runner: `packages/ui/tests/unit/harness-fence.test.ts` pulls
 * `stayedAbsent` from here under vitest, where a top-level hook registration takes the whole unit
 * project down. Gating on the env var keeps an ordinary vitest run clear of it, and the try/catch
 * covers the case where the variable is set in a shell that then runs something other than
 * Playwright — a diagnostic must never be the reason a suite cannot start.
 */
if (process.env.THRONG_E2E_TRACE !== undefined) {
  try {
    /*
     * `{}` and not a named parameter, with the rule disabled rather than worked around: Playwright
     * VALIDATES the shape of a hook's first argument and rejects anything that is not an object
     * destructuring pattern — "First argument must use the object destructuring pattern" — at
     * COLLECTION time, so renaming it to satisfy no-empty-pattern stops the whole file loading.
     */
    // eslint-disable-next-line no-empty-pattern
    test.afterEach(async ({}, info) => {
      if (info.status !== info.expectedStatus) workerSawFailure = true;
      if (pendingTraces.length > 0) await flushTraces(info, info.status !== info.expectedStatus);
    });
    // eslint-disable-next-line no-empty-pattern
    test.afterAll(async ({}, info) => {
      if (pendingTraces.length > 0) await flushTraces(info, workerSawFailure);
    });
  } catch (err) {
    console.warn(
      `[trace] hooks not registered (not a Playwright run?): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The shared launch + teardown both entry points are built from. */
async function launchApp(opts: AppOptions): Promise<{
  app: ElectronApplication;
  win: Page;
  pipeName: string;
  userDataDir: string;
  teardown: () => Promise<void>;
}> {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'throng-e2e-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-${process.pid}-${Date.now()}`;
  const daemon = opts.skipDaemon ? null : await startDaemon(pipeName, dataDir, opts.daemonEnv ?? {});
  const userData = opts.userDataDir ?? mkdtempSync(join(tmpdir(), 'throng-ud-'));
  // Isolate the user config root to a temp dir by default so the app's first-run
  // file creation never touches the real %USERPROFILE%\.throng (a test may still
  // override THRONG_CONFIG_ROOT via opts.env).
  const ownCfgRoot = opts.env?.THRONG_CONFIG_ROOT === undefined;
  const cfgRoot = opts.env?.THRONG_CONFIG_ROOT ?? mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  let app: ElectronApplication | undefined;
  let endSuddenDeathWatch: () => void = () => {};
  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      env: {
        ...claudeFreeEnv(),
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
    await startTracing(app); // #299: a CI-only failure is undiagnosable without one
    endSuddenDeathWatch = watchForSuddenDeath(app); // #240: say WHY, if this app goes away mid-test
    await stubFolderDialog(app); // cancel by default
    await stubShellOpen(app); // never leave a real Explorer window behind (and never steal focus)
    const launched = app;
    return {
      app: launched,
      win,
      pipeName,
      userDataDir: userData,
      teardown: (flushNow = false) => teardownApp(launched, flushNow),
    };
  } catch (error) {
    // The launch itself failed, so nobody holds a handle to tear down — do it here.
    await teardownApp(app);
    throw error;
  }

  async function teardownApp(
    started: ElectronApplication | undefined,
    flushNow = false,
  ): Promise<void> {
    endSuddenDeathWatch(); // from here on, the app going away is the intent, not a fault (#240)
    if (started) await captureTerminalDiagnostics(started);
    if (started) await stopTracing(started, flushNow);
    // Kill an app-spawned detached daemon BEFORE closing the app: Playwright's
    // app.close() waits for the Electron process's child tree, and the detached
    // daemon (which by design outlives the UI) would otherwise hang teardown.
    /*
     * TIMED, because a slow teardown does not fail the test that caused it (#211).
     *
     * Playwright gives a worker 30s to tear down, and everything below happens inside that budget:
     * `shutdownApp` alone allows a 15s graceful grace, and the `taskkill` behind it another 10s. When
     * the budget is blown, the worker dies and Playwright charges it to whichever test was current —
     * which is why #211 reads as "app-shell times out" when app-shell passes 6/6 in isolation at
     * ~1.5s. Nothing in the log said which phase spent the time, so it had to be inferred; now it is
     * reported.
     *
     * Only slow teardowns are printed. A line per teardown across ~640 tests would be noise, and
     * noise is what stops anyone reading the log the one time it matters.
     */
    const phase = async (name: string, run: () => Promise<void>): Promise<void> => {
      const began = Date.now();
      try {
        await run();
      } finally {
        const ms = Date.now() - began;
        if (ms >= SLOW_TEARDOWN_PHASE_MS) console.warn(`[teardown] ${name} took ${ms}ms`);
      }
    };

    const teardownBegan = Date.now();
    if (!daemon) await phase('killAppSpawnedDaemon', () => killAppSpawnedDaemon(pipeName));
    if (started) await phase('shutdownApp', () => shutdownApp(started));
    if (daemon) await phase('stopDaemon', () => stopDaemon(daemon));
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
    /*
     * ASYNCHRONOUS, and briefly — #211.
     *
     * This was `rmSync` with 15 retries at 200ms, over three directories: up to NINE SECONDS of
     * synchronous work in a teardown, and worse than it sounds, because `rm`'s retry budget applies
     * PER FAILING ENTRY in a recursive tree and an Electron userData directory holds hundreds of
     * cache files. A blocked event loop stops Playwright's timers with it, so the cost did not land
     * on the test that caused it — it landed on whichever test ran next, as a timeout that had
     * nothing to do with its own work.
     *
     * That is #211's measured signature exactly: `[cleanup] EPERM removing …` immediately before
     * `app-shell.e2e.ts` fails with `Test timeout of 30000ms exceeded`, in a full run, in BOTH tiers,
     * while passing 6/6 in isolation at ~1.5s.
     *
     * `await rm(...)` keeps the loop turning, and the retry budget drops to ~300ms because it was
     * never load-bearing: `globalTeardown` removes the whole per-run `throng_e2e_<runhash>` folder
     * these live under. The retries are a courtesy to keep the temp directory tidy DURING a run; the
     * sweep is what actually guarantees it, and paying seconds of blocked time for a courtesy is how
     * a housekeeping race became a red test.
     */
    const cleanup = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const;
    const rmBestEffort = async (dir: string): Promise<void> => {
      try {
        await rm(dir, cleanup);
      } catch {
        // lost the race with Electron's userData lock; globalTeardown sweeps it.
      }
    };
    await phase('removeTempDirs', async () => {
      if (!opts.dataDir) await rmBestEffort(dataDir);
      if (ownCfgRoot) await rmBestEffort(cfgRoot);
      if (!opts.userDataDir) await rmBestEffort(userData);
    });

    // The phases can each sit under the threshold while their SUM does not — which is the shape that
    // actually blows a 30s worker budget.
    const total = Date.now() - teardownBegan;
    if (total >= SLOW_TEARDOWN_TOTAL_MS) console.warn(`[teardown] TOTAL ${total}ms`);
  }
}

/**
 * Report an Electron app that dies while a test is still using it — issue #240.
 *
 * "Target page, context or browser has been closed" is the least informative failure this suite can
 * produce: it names no component, so there is nothing to grep for and nothing to bisect without
 * catching it again. What is missing is the app's own account of its death, which Playwright
 * discards. Keep the tail of the main process's stderr and print it with the exit code.
 *
 * Two gates keep it silent on a healthy run, and both are load-bearing — measured on a full local
 * suite, where the ungated version cried wolf four times in a row on perfectly ordinary teardowns:
 *
 *   - **Only before teardown.** `shutdownApp` destroys windows and, if that stalls, force-kills the
 *     process tree; Electron reports those as `0xC0000409` or `7`, which look exactly like a crash
 *     and are not one. Once teardown has begun, the app dying IS the point.
 *   - **Only non-zero.** Plenty of specs quit the app from inside the test body (TERMINATE ALL, an
 *     ordinary close that drains and quits), and those exit 0.
 *
 * @returns the callback that closes the first gate; teardown must call it before it starts.
 */
function watchForSuddenDeath(app: ElectronApplication): () => void {
  let tearingDown = false;
  const markTeardown = (): void => {
    tearingDown = true;
  };
  let proc: ReturnType<ElectronApplication['process']>;
  try {
    proc = app.process();
  } catch {
    return markTeardown; // already gone; nothing to observe
  }
  const tail: string[] = [];
  proc.stderr?.on('data', (chunk: Buffer) => {
    tail.push(chunk.toString());
    if (tail.length > 20) tail.shift();
  });
  proc.once('exit', (code, signal) => {
    if (tearingDown || code === 0 || code === null) return;
    const why = tail.join('').trim();
    console.warn(
      `[app] electron main (pid ${proc.pid}) died mid-test: code=${code} signal=${signal ?? 'none'}` +
        (why === ''
          ? ' — and wrote nothing to stderr, so look for something killing it from outside'
          : `\n${why}`),
    );
  });
  return markTeardown;
}

/** How long the graceful shutdown gets before we force-kill the Electron process tree. */
const SHUTDOWN_GRACE_MS = 15_000;

/**
 * How long to allow an Electron app to emit its own `close` event (spec 034, FR-016).
 *
 * MEASURED, not guessed. Closing a throng app is not a quick operation under load — it drains
 * pending layout writes, stops a daemon and reaps real shells — and the teardown reporter in this
 * very file logged `shutdownApp took 14514ms` and `15953ms` during the 034 baseline at six workers.
 * Specs that allowed 10s for it therefore failed on a close that was proceeding perfectly normally:
 * `terminal-reattach` did exactly that, twice, on an app that had 4.5s of closing left to do.
 *
 * The value is DERIVED, not picked. `shutdownApp` in this same file allows a closing app a 15s
 * graceful window and then gives `taskkill` a further 10s — so the harness's own position is that an
 * app may legitimately take up to ~25s to die. Any spec waiting less than that is contradicting its
 * own harness: it declares a failure while the mechanism that would have handled it is still
 * within its allowance. 30s is that 25s plus margin, and it stays inside the 60s test budget so the
 * failure still reads as "the app never closed" rather than as an anonymous test timeout.
 *
 * Measured against, twice. At 20s — already double what most specs allowed — `terminal-reattach`
 * still failed on the "Terminate all" path, which has to reap a real shell before the window goes.
 * The suite previously had 10000, 12000 and 20_000 at different close sites; `terminate-all-drain`,
 * the file that has spent the most time getting app-close right, used the largest. All of them were
 * under the harness's own bound.
 *
 * This is a HANG DETECTOR, not an assertion about how fast throng closes. A spec that means to
 * measure close latency must say so and name the requirement it defends (FR-018); nothing here
 * does, so nothing here should be timing it.
 */
export const APP_CLOSE_TIMEOUT_MS = 30_000;

/**
 * How long a spec-spawned daemon gets to print `listening` before the spec gives up (spec 034).
 *
 * Nine spec files carry a copy-pasted `setTimeout(() => reject(new Error('daemon not ready')),
 * 10_000)` around the daemon's stdout. Ten seconds is a cold Node process start, a pipe bind and a
 * SQLite open — comfortable on an idle box, and NOT comfortable on one already running six Electron
 * apps and their daemons. In the 034 verification runs `persistence-restore` failed twice on exactly
 * this, rejecting "daemon not ready" for a daemon that was merely still starting.
 *
 * 30s is a HANG DETECTOR: it still fails a daemon that never binds, and it fails well inside the 60s
 * test budget so the failure reads as "daemon not ready" rather than as an anonymous test timeout.
 * It asserts nothing about how fast the daemon starts; no requirement here claims that.
 *
 * The duplication itself is the deeper defect — nine copies of one wait, so nine places to get this
 * wrong again. Sharing the BUDGET is the minimum fix; extracting the whole helper is tracked as
 * follow-up rather than done here, because it touches nine files this change has no other reason to
 * disturb.
 */
export const DAEMON_READY_TIMEOUT_MS = 30_000;

/**
 * How long to wait for a real shell's output to reach the terminal (spec 034).
 *
 * The slowest specs here do not merely start a shell, they make it WORK: a 200-iteration `cmd` loop
 * painting 200 lines through a ConPTY, a `ping -n 7` delivering output on its own schedule. On an
 * idle box that lands in a couple of seconds. On one running six Electron apps, six daemons and
 * their shells, it does not, and the 20s these specs allowed was the last budget still failing after
 * the harness-wide ones were right-sized — `terminal-scrollback-nav` failed on it in two of three
 * consecutive verification runs.
 *
 * 30s is a hang detector for "the shell produced nothing", and it sits inside the 60s test budget so
 * the failure still names the text it was waiting for. Nothing here asserts throughput; the specs
 * that mean to measure terminal performance say so and name their requirement (FR-018).
 *
 * If a spec needs MORE than this, the honest answer is usually that it is doing too much work for a
 * parallel worker and the tier mechanism applies to it — not that the number should grow again.
 */
export const TERMINAL_OUTPUT_TIMEOUT_MS = 30_000;
/**
 * How long a SECOND window gets to appear after the click that opens it (spec 035).
 *
 * ══ THE MEASUREMENT ══
 *
 * `theme-flash.e2e.ts:92` failed a full-gate serial tier on
 * `app.waitForEvent('window', { timeout: 15_000 })` — a sub-workspace window that had not opened
 * within fifteen seconds — and passed on retry. Measured afterwards with retries OFF, in isolation:
 * **0 failures in 6 runs at one worker, and 0 in 6 at six workers.** It does not fail on a quiet
 * box at any worker count. It failed once, at the end of a seventeen-minute serial tier, on a
 * machine that had already run the parallel tier.
 *
 * That is the shape `docs/testing.md` names starvation rather than a defect, and it arrives by a
 * route the five 034 budgets did not cover: not concurrent workers, but a box that has been busy for
 * a quarter of an hour.
 *
 * ══ WHY 15s WAS THE WRONG NUMBER, SPECIFICALLY ══
 *
 * Sixty-eight `waitForEvent('window')` calls in this suite pass no timeout at all and inherit the
 * config's. Eight pass one, and every one of those eight pins **15 seconds** — which makes them
 * STRICTER than the suite's own default and stricter than its 15s assertion budget, for the single
 * most expensive thing a test can ask for: a whole second Electron BrowserWindow, its renderer, its
 * preload and its first paint.
 *
 * There was no reasoning behind the 15; it is a round number copied across eight files. This
 * replaces it with a named budget derived the way `DAEMON_READY_TIMEOUT_MS` is — a cold window on a
 * saturated box — and 30s is the same answer for the same reason.
 *
 * ══ WHAT IT IS AND IS NOT ══
 *
 * A HANG DETECTOR. It still fails a window that never opens, and it fails well inside the 60s test
 * budget, so the failure still reads as "no window appeared" rather than as an anonymous test
 * timeout. It asserts nothing about how fast a window opens; no requirement here claims that, and
 * `theme-flash` is about the COLOUR the window paints, not the speed it paints it.
 *
 * If a spec ever needs more than this, the answer is the tier mechanism rather than a fourth
 * number — the rule `TERMINAL_OUTPUT_TIMEOUT_MS` states above, unchanged.
 *
 * ══ AND IT DID NOT FIX WHAT IT WAS INTRODUCED FOR — SAY SO ══
 *
 * This budget was added in response to `theme-flash.e2e.ts:92` timing out at 15s waiting for a
 * sub-workspace window, on the reading that the cause was cumulative load: the spec measured 12/12
 * clean in isolation at both 1 and 6 workers, so a full-run-only failure looked like a saturated box.
 *
 * **A later full run disproved that reading, and the evidence is unambiguous.** The same test failed
 * at **33.0s** and its immediate retry — same process, same tier, same load, seconds later — passed
 * in **3.4s**. A slow machine does not produce a tenfold difference between two consecutive attempts.
 * Whatever this is, it is a RACE that a fresh app clears, not a duration that needs more room.
 *
 * So the number stays at 30s as a hang detector, which is all it was ever good for, and nobody should
 * raise it again expecting that to help. The mechanism is most likely the one `closeNewest` in
 * `theme-flash.e2e.ts` already documents for issue #75 — a child window's asynchronous teardown
 * racing the next interaction, so a click lands while focus is mid-transfer and no window is ever
 * created — reappearing one step further along, at the sub-workspace open. That is a HYPOTHESIS: it
 * fits the timings and the prior art, and it has not been reproduced on demand.
 */
export const NEW_WINDOW_TIMEOUT_MS = 30_000;


/**
 * How long to wait for a filesystem effect to become observable (spec 034).
 *
 * A drag that moves a folder is not one syscall: it is a renderer gesture, an IPC hop, a real
 * `rename` on a real disk, and a watcher waking up to notice. Polling for the result is the RIGHT
 * pattern — these sites already use `expect.poll` rather than a sleep — but 10s to complete that
 * chain is another budget sized on a quiet machine. `explorer-tree-state` flaked on exactly this in
 * the 034 verification run, waiting for a moved `child.txt` that arrived late rather than never.
 *
 * NOTE the wider problem this only partly addresses: roughly a dozen other spec files poll for a
 * filesystem effect on the same 10s budget. They did not flake in this run, which is not the same as
 * being right. Sweeping them belongs to the wait-and-budget work (FR-015 to FR-022), not here.
 */
export const FILE_OP_TIMEOUT_MS = 30_000;

/**
 * When a teardown phase is worth reporting (#211).
 *
 * 2s is comfortably above a healthy teardown (an app that closes when asked is a few hundred ms) and
 * far below the 15s grace, so anything printed is genuinely slow rather than merely unlucky.
 */
const SLOW_TEARDOWN_PHASE_MS = 2_000;

/**
 * When the WHOLE teardown is worth reporting.
 *
 * Playwright's worker-teardown budget is 30s. Reporting at 10s gives a clear margin: a run that is
 * heading for the cliff says so before it goes over, rather than only when the worker is already
 * dead and the evidence has gone with it.
 */
const SLOW_TEARDOWN_TOTAL_MS = 10_000;

/**
 * Force-kill an OS process and its entire child tree, best-effort and BOUNDED.
 *
 * Lives in `./process-tree.ts` so it can be proved at the integration layer without dragging
 * `@playwright/test` and `@throng/persistence` into a vitest worker (034 FR-045). Re-exported here
 * because this is the name ~a dozen specs and `shutdownApp` already import.
 *
 * Proved by `packages/ui/tests/integration/force-kill-process-tree.integration.test.ts`, which
 * replaced `harness-shutdown.e2e.ts`.
 */
export { forceKillProcessTree } from './process-tree.js';

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
export async function shutdownApp(app: ElectronApplication): Promise<void> {
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
export async function killAppSpawnedDaemon(pipeName: string): Promise<void> {
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

/**
 * How long to pause at each {@link step}, so a run can be WATCHED (`THRONG_E2E_STEP_MS=1500`).
 *
 * Zero by default, which makes every call below a no-op: an E2E suite must not get slower because
 * somebody once needed to see it. An Electron run already puts a real window on screen, so the only
 * thing missing when a defect has to be observed by eye is time between the actions.
 */
export const E2E_STEP_MS = Number(process.env.THRONG_E2E_STEP_MS ?? 0);

/** Pause between steps when observing, and say what is about to happen. */
export async function step(win: Page, label: string): Promise<void> {
  if (E2E_STEP_MS <= 0) return;
  console.log(`[step] ${label}`);
  // sleep-justified: this is the deliberate slow-motion debug knob documented on E2E_STEP_MS above
  // sleep-justified: — opt-in only (THRONG_E2E_STEP_MS), zero by default, and the entire function
  // sleep-justified: returns before this line when it is unset, so a normal run pays nothing for it.
  // sleep-justified: there is no condition to wait on here: the whole point is an artificial pause
  // sleep-justified: for a human to watch, not a race the suite needs to resolve.
  await win.waitForTimeout(E2E_STEP_MS);
}

/** Typing delay: slow enough to read when observing, normal otherwise. */
export const TYPE_DELAY = E2E_STEP_MS > 0 ? 180 : 40;

/** Create a project via the form (folder filled manually; dialog stays stubbed). */
export async function createProject(win: Page, name: string, root: string): Promise<void> {
  await win.getByTestId('project-new').click();
  await expect(win.getByTestId('project-form')).toBeVisible();
  await win.getByTestId('project-root-input').fill(root);
  await win.getByTestId('project-name-input').fill(name);
  await win.getByTestId('project-save').click();
  await expect(win.locator('.project-item').filter({ hasText: name }).first()).toBeVisible();
  /*
   * Wait for the new project to be ACTIVE, not merely listed.
   *
   * Creating a project opens it immediately (`projects-store.tsx` — `setOpenedId(created.id)`),
   * which swaps the entire workspace. Returning as soon as the row appears leaves the PREVIOUS
   * project's panels on screen, so a caller that reads a panel id straight afterwards can capture
   * one that is about to be destroyed. Every later `panel-type-select-<dead pid>` then waits out the
   * full test budget for an element that can never exist.
   *
   * That is not a hypothetical: in a full-suite run under six CPU hogs it accounted for four of six
   * failures, every one a 30s timeout, and it produced two of the CI failures on this branch too.
   * The symptom looks like a slow app; the cause is a stale id read a few milliseconds too early.
   *
   * Keyed on `data-active` rather than on the name: `hasText` is a SUBSTRING match over the row's
   * whole text, so in a file that accumulates projects it can resolve to more than one row and trip
   * strict mode. Exactly one project is active, which makes it the unambiguous handle.
   */
  const active = win.locator('.project-item[data-active="true"]');
  await expect(active).toHaveCount(1);
  await expect(active).toContainText(name);
}

export async function firstPanelId(win: Page): Promise<string> {
  // `.evaluate()` auto-waits for the element, so this cannot race the panel into existence — but it
  // CAN return '' if the node lacks the attribute, and an empty id builds testids that match
  // nothing. Fail here, naming the cause, rather than 30s later at an unrelated locator.
  const id = await win
    .locator('.panel-box')
    .first()
    .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
  if (id === '') throw new Error('firstPanelId: a .panel-box exists but carries no data-panel-id');
  return id;
}

export async function panelIds(win: Page): Promise<string[]> {
  /*
   * `evaluateAll` does NOT auto-wait — unlike `evaluate`, it resolves against whatever matches right
   * now, which is `[]` before the workspace renders. Callers index into it (`(await panelIds(win))[0]`)
   * and interpolate `undefined` into a testid, then wait out the whole budget for `panel-add-undefined`.
   */
  await expect(win.locator('.panel-box').first()).toBeAttached();
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
 * The rendered text of something that redraws, read once it has STOPPED redrawing (034 FR-019).
 *
 * `geom()` is this idea applied to geometry; this is the same idea applied to text, and it exists
 * because the geometry version could not cover the expensive half of the suite. A terminal running a
 * real TUI reports itself ready and then keeps painting — claude redraws its banner, its status line
 * and its input box for a second or two afterwards, and nothing it emits marks the end of that. The
 * suite's answer was `waitForTimeout(3000)`: eighty seconds of deliberate idling in one spec file,
 * and an assertion that three seconds is always enough on every machine at every worker count. On a
 * loaded box it is not, which is how #251 was diagnosed as starvation rather than a defect.
 *
 * Polling until two consecutive reads agree replaces that guess with a CONDITION — "the surface has
 * stopped changing" — and it is strictly better in both directions: it returns in about 200ms on an
 * idle machine instead of sleeping three seconds, and it keeps waiting on a machine where three
 * seconds would not have been enough.
 *
 * Two properties are deliberate:
 *
 *   - **It throws rather than giving up quietly.** A surface that never goes quiet — a spinner, an
 *     animation, a stream still arriving — is a real finding about the test, not something to paper
 *     over with a fallback sleep. A fallback would make this a `waitForTimeout` wearing a condition's
 *     name, which is the thing FR-015 forbids.
 *   - **It returns the settled text**, so the caller does not take a second read that may already
 *     have moved on. Reading twice is how a "stable" assertion goes flaky.
 *
 * Where a surface genuinely never quiesces, keep the sleep and declare it — see
 * `packages/ui/tests/unit/sleep-declared.test.ts` for the marker the build requires.
 */
export async function quiesced(
  locator: Locator,
  opts: { what?: string; timeout?: number } = {},
): Promise<string> {
  const what = opts.what ?? locator.toString();
  await expect(locator).toBeVisible();

  const sampler = quiesceSampler();

  await expect
    .poll(
      async () => sampler.sample((await locator.textContent()) ?? ''),
      {
        timeout: opts.timeout ?? 15_000,
        message:
          `quiesced(${what}): the surface never stopped changing, so there is no settled state to ` +
          `read. Something is still animating or still streaming — find out what, rather than ` +
          `replacing this with a sleep.`,
        intervals: [100, 100, 150, 150, 250],
      },
    )
    .toBe(true);

  const settledText = sampler.settled();
  if (settledText === null) {
    throw new Error(`quiesced(${what}): polled to completion without capturing a settled read`);
  }
  return settledText;
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
 * The pids of `conhost.exe` / `OpenConsole.exe` `--headless` hosts owned by `parentPid` — one
 * per live ConPTY. A terminal that has fully released its OS resources leaves none
 * behind, so this is the orphan-leak probe for the no-orphans E2E.
 */
/**
 * The result of ASKING the OS about a process's conhosts — which is not the same thing as the
 * answer.
 *
 * `conhostChildren` used to swallow every failure and return `[]`, so a probe that timed out was
 * indistinguishable from "this process has no conhosts". In {@link expectNoOrphanConhosts} that is
 * the dangerous direction: the assertion that exists to catch leaked OS processes would PASS
 * because it could not look. Under load — which is exactly when a reap is most likely to be slow —
 * the 8-second PowerShell budget is reachable, so this was not theoretical.
 */
export interface ConhostProbe {
  /** False when the query itself failed. `pids` is then meaningless, not empty. */
  ok: boolean;
  pids: number[];
}

/** Ask the OS which `--headless` conhosts are children of `parentPid`, reporting probe failure. */
export function probeConhostChildren(parentPid: number): ConhostProbe {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'conhost.exe' -or $_.Name -eq 'OpenConsole.exe') -and $_.ParentProcessId -eq ${parentPid} -and $_.CommandLine -match '--headless' } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf8', timeout: 8000, windowsHide: true },
    );
    return {
      ok: true,
      pids: out
        .split(/\r?\n/)
        .map((l) => Number(l.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    };
  } catch {
    return { ok: false, pids: [] };
  }
}

/**
 * As {@link probeConhostChildren}, but flattening a failed probe to "none".
 *
 * Only safe where an empty answer costs nothing — best-effort CLEANUP, where missing a pid means a
 * stray process rather than a false assertion. Never use it to decide whether a reap happened.
 */
export function conhostChildren(parentPid: number): number[] {
  return probeConhostChildren(parentPid).pids;
}

/**
 * Poll until this daemon's conhosts are a subset of `baseline` (orphans reaped), or fail.
 *
 * Scoped to `parentPid` throughout — it asks only about conhosts the DAEMON owns, so another
 * throng, an installed build, or the tooling running the suite cannot make it pass or fail.
 *
 * A probe that FAILS is treated as "not yet known", never as "nothing there". The distinction is
 * the whole point of this assertion: reporting success because the query broke would be the one
 * outcome worse than a false failure.
 */
export async function expectNoOrphanConhosts(
  parentPid: number,
  baseline: number[],
  timeoutMs = 12000,
): Promise<void> {
  const base = new Set(baseline);
  const deadline = Date.now() + timeoutMs;
  let extra: number[] = [];
  let everProbed = false;
  while (Date.now() < deadline) {
    const probe = probeConhostChildren(parentPid);
    if (probe.ok) {
      everProbed = true;
      extra = probe.pids.filter((p) => !base.has(p));
      if (extra.length === 0) return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!everProbed) {
    throw new Error(
      `could not read the daemon's conhosts (pid ${parentPid}) in ${timeoutMs}ms — every probe ` +
        `failed, so whether anything leaked is UNKNOWN. This is a broken measurement, not a pass.`,
    );
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

/**
 * Remove a test's temp directory — and never fail the test because Windows would not let go of it.
 *
 * This exists because it was the single most expensive thing in the suite. Measured on CI: 51 tests in
 * the slowest shard failed all four attempts with `EBUSY: resource busy or locked, rmdir`, burning
 * 23.7 of that shard's 36 minutes — two thirds of it — re-running tests whose BODIES had already
 * passed. The assertion succeeded; the `finally` threw on the way out.
 *
 * The lock is real and not a bug in the test: a terminal spec leaves a shell, a ConPTY host and a
 * daemon with the directory as their working directory, and they release it when Windows says so, not
 * when the test ends. Retrying harder does not fix a race with process teardown — the old call sites
 * already retried up to ten times and still lost.
 *
 * So the judgement is: a temp directory that will not unlink is not a product defect and must not be
 * reported as one. It is noise that costs a real signal, because a suite with known-red tests in it
 * teaches everyone to ignore red. The directory is under the runner's TEMP and is wiped with the
 * runner; locally it is a few KB that the next `throng-clear-dev-state` sweeps up.
 *
 * What this deliberately does NOT do is swallow deletions that are part of a test's SUBJECT — a spec
 * that deletes a file to prove the editor notices must still fail loudly when that delete fails. Use
 * this for teardown only; call `rmSync` directly when the removal is the thing under test.
 */
export function cleanupTemp(target: string): void {
  try {
    /*
     * A SMALL retry budget, for #211's reason.
     *
     * This was 10 retries at 250ms — 2.5s of blocked event loop per call, per failing entry, and
     * `cleanupTemp` is called from 180-odd `finally` blocks. Whatever it fails to remove is swept by
     * `globalTeardown` anyway, so the retries buy tidiness during the run and never correctness.
     *
     * Still synchronous, deliberately: the callers are `finally` blocks in specs that do not await
     * it, and changing that signature would be a 180-file edit to fix a budget.
     */
    rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // ENOENT is already the desired end state. The rest are Windows still holding a handle.
    if (code && !['EBUSY', 'EPERM', 'ENOTEMPTY', 'ENOENT'].includes(code)) {
      console.warn(`[cleanup] unexpected error removing ${target}: ${String(error)}`);
      return;
    }
    console.warn(`[cleanup] ${code ?? 'error'} removing ${target} — left for the temp sweep`);
  }
}

/**
 * Assert something did NOT happen, having first established that it HAD ITS CHANCE (FR-016/FR-017).
 *
 * ══ THE DEFECT THIS EXISTS FOR ══
 *
 * `await expect(thing).toHaveCount(0)` immediately after an action is green whether the behaviour is
 * right or the application is merely slow. It asserts "not yet", and reports it as "never". The
 * usual repair is a sleep long enough to feel safe, which is the same bug with a longer fuse: it is
 * green on a fast machine and red on a loaded one, and 222 such sites were measured across this
 * suite at the 034 baseline.
 *
 * ══ WHAT A FENCE IS ══
 *
 * A POSITIVE observable that can only occur once the opportunity for the absent thing has passed.
 * Not a duration — an event. "The next screen has rendered", "the write has landed", "the shell has
 * echoed the following command". Then, and only then, absence means something.
 *
 * ══ AND WHY IT THROWS ══
 *
 * If the fence itself never occurs, this FAILS rather than proceeding. That is FR-017 and it is the
 * half that is easy to omit: a fence that quietly gives up degrades into the sleep it replaced, and
 * the absence check downstream then passes for the wrong reason — the most expensive kind of green,
 * because it looks like evidence.
 *
 * @param fence      resolves once the opportunity has demonstrably passed; MUST reject or time out
 *                   rather than resolve if it never does.
 * @param count      how many of the forbidden thing exist right now.
 * @param what       named in both failure messages, so a red says which claim broke.
 */
export async function stayedAbsent(
  fence: () => Promise<unknown>,
  count: () => Promise<number>,
  what: string,
): Promise<void> {
  try {
    await fence();
  } catch (cause) {
    // Deliberately NOT falling through to the absence check. An unmet fence means the opportunity
    // cannot be shown to have passed, so the absence below would be unfalsifiable.
    throw new Error(
      `stayedAbsent(${what}): the fence never occurred, so "${what} did not happen" cannot be ` +
        `asserted — this would otherwise pass for the wrong reason`,
      { cause },
    );
  }
  const n = await count();
  if (n !== 0) {
    throw new Error(`stayedAbsent(${what}): expected none after the fence, found ${n}`);
  }
}
