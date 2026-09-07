import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { cleanupTemp, killAppSpawnedDaemon, shutdownApp } from './harness.js';
import { expectWithinSla } from './helpers/sla.js';

/*
 * WHY THIS SPEC DOES NOT CALL `app.close()` DIRECTLY — #211.
 *
 * A bare `await app.close()` has no timeout and no fallback. When Electron does not exit on request
 * — a renderer that will not close, a child still holding it — the await simply does not return, and
 * the only thing that ends it is the TEST's own 30-second timeout. Playwright then reports
 * "Test timeout of 30000ms exceeded" against a test whose assertions all passed seconds earlier.
 *
 * That is #211 exactly: this file passed 6/6 in isolation at ~1.5s and failed roughly once per full
 * suite run, in both tiers, always as a 30s timeout and never as the 5s SLA it asserts. The
 * `[cleanup] EPERM removing …` line that kept appearing beside it was never a separate problem — it
 * is the same app still holding its userData directory, which is what "did not close" looks like
 * from the other side, and is why the two correlated without either causing the other.
 *
 * `shutdownApp` is the harness's bounded version, already relied on by ~40 specs: it races the
 * graceful close against SHUTDOWN_GRACE_MS and force-kills the process tree if that expires. This
 * spec launches Electron directly — deliberately, since it runs without a daemon — which is how it
 * came to miss the protection everything else has.
 */

// Smoke E2E for the two-Pane docking shell (FR-008). The shell renders without a
// daemon (the project list simply loads empty), so these checks need no daemon;
// the daemon round-trip is exercised by projects.e2e.ts.
const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));

// Track every temp dir created so it is removed after each test (no %TEMP% leaks).
const tempDirs: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
test.afterEach(() => {
  for (const dir of tempDirs) {
    try {
      cleanupTemp(dir);
    } catch {
      // BEST-EFFORT (017 FR-013a/FR-014). Electron releases its userData dir
      // asynchronously, some time after the process exits; under worker contention it
      // can still hold the lock when the retries above run out, and rmSync then throws
      // EPERM. This is housekeeping, not an assertion — the test it is attributed to has
      // already passed — so letting it throw would turn a lost race with the OS file
      // lock into a RED TEST, exactly the non-signal the flake gate must not fire on.
      // (Observed: app-shell.e2e.ts:66 failed this way in afterEach with every assertion
      // green; the same class was already fixed for runApp specs in temp-file-helpers.ts.)
      // Nothing leaks: globalTeardown removes the whole per-run throng_e2e_<runhash> folder.
    }
  }
  tempDirs.length = 0;
});

let pipeSeq = 0;

/**
 * The pipe each launched app was given, so its daemon can be reaped before the app is closed.
 *
 * ══ THIS IS #211's TRUE MECHANISM ══
 *
 * The app spawns its daemon DETACHED, to outlive the UI on purpose. Playwright's `app.close()` waits
 * for the Electron process's child tree, so an app-spawned daemon still running makes close hang —
 * `runApp` has always known this and kills the daemon FIRST for exactly that reason.
 *
 * This spec never did, and the reason it failed only sometimes is that it also had no pipe of its
 * own: on the shared dev pipe it usually found an existing daemon and spawned nothing, so close was
 * fast. When nothing happened to be there it spawned one, close hung, and the test ran out its own
 * 30-second budget — reported against a test whose assertions had passed seconds earlier. "Roughly
 * once per full run" was that coin landing the other way.
 *
 * Giving it a private pipe made it spawn a daemon EVERY time, which turned the intermittent failure
 * into a deterministic one and is how the cause was finally identified.
 */
const launchedPipes = new Map<ElectronApplication, string>();

async function launchApp(): Promise<ElectronApplication> {
  const userData = tmp('throng-ud-');
  const pipeName = `\\\\.\\pipe\\throng.e2e.app-shell.${process.pid}.${pipeSeq++}`;
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      THRONG_CONFIG_ROOT: tmp('throng-cfg-'),
      /*
       * ITS OWN PIPE — #192.
       *
       * This spec was alone among the twelve that launch Electron directly in setting no pipe name,
       * so it fell back to the shared per-user DEV pipe. `ensureDaemon` retires any daemon on its
       * pipe whose build id does not match, so this app would find, and kill, a developer's own
       * `npm start` daemon — ending their terminals mid-session — simply because the suite was run.
       *
       * The product now refuses to retire a daemon belonging to another entry, which makes that
       * unconditional. This is the other half: not sharing the endpoint in the first place, exactly
       * as every sibling spec already does.
       */
      THRONG_PIPE_NAME: pipeName,
      THRONG_TEST_SHELL_HISTORY: 'off',
    },
  });
  launchedPipes.set(app, pipeName);
  return app;
}

/**
 * Close an app the way `runApp` does: reap its detached daemon FIRST, then shut down under a bound.
 *
 * Either half alone is not enough. Without the reap, close waits on a child the app is designed
 * never to reap and burns the full 15s shutdown grace before being force-killed — measured at 17s
 * per test here. Without the bound, a genuine hang runs out the test's own budget instead.
 */
async function closeApp(app: ElectronApplication): Promise<void> {
  const pipeName = launchedPipes.get(app);
  launchedPipes.delete(app);
  if (pipeName) await killAppSpawnedDaemon(pipeName);
  await shutdownApp(app);
}

test('opens the two-Pane shell within 5 seconds (NFR-002)', { tag: ['@core', '@window', '@reserve:window'] }, async () => {
  const start = Date.now();
  const app = await launchApp();
  try {
    const window = await app.firstWindow();
    await window.getByTestId('throng-shell').waitFor({ state: 'visible' });
    await expect(window.getByTestId('sidebar-pane')).toBeVisible();
    await expect(window.getByTestId('workspace-pane')).toBeVisible();
    await expect(window.getByTestId('projects-panel')).toBeVisible();
    await expect(window.locator('.sidebar-panel--subworkspaces')).toBeVisible();
    // NFR-002's 5s SLA presumes an UNLOADED machine — one app cold-starting on its own.
    // But this suite defaults to SIX workers, launching up to six Electron apps at once,
    // and a hard wall-clock budget cannot survive that concurrency: it then measures the
    // test rig, not the app (5.3–6.0s observed at 6-worker contention, all on retry-green
    // runs — the same load-sensitive class as performance:72 in the 017 audit). A retry
    // absorbs it, which is exactly what the flake gate now forbids.
    //
    // So the SLA is asserted only where the reading is valid, and NOT relaxed to a bigger
    // number elsewhere — a second budget is a second promise, and nobody can say which one
    // NFR-002 made. This used to fall back to 20s under contention; that fallback was wide
    // enough to pass anything, so it defended nothing while looking like it did.
    //
    // `slaMeasurable` also covers the case this file's old predicate could not see: a
    // dedicated test VM at one worker is UNCONTENDED and still several times slower than
    // the machine NFR-002 is about. Unloaded is not the same as representative.
    expectWithinSla(test.info(), {
      what: 'the two-Pane shell opens',
      requirement: 'NFR-002',
      elapsedMs: Date.now() - start,
      budgetMs: 5000,
    });
  } finally {
    await closeApp(app);
  }
});

test('opens a resizable main window', { tag: ['@core', '@window', '@reserve:window'] }, async () => {
  const app = await launchApp();
  try {
    await app.firstWindow();
    const isResizable = await app.evaluate(async ({ BrowserWindow }) => {
      const [win] = BrowserWindow.getAllWindows();
      return win.isResizable();
    });
    expect(isResizable).toBe(true);
  } finally {
    await closeApp(app);
  }
});

test('exposes only placeholder workspace content (no real product features)', { tag: ['@core', '@window'] }, async () => {
  const app = await launchApp();
  try {
    const window = await app.firstWindow();
    await window.getByTestId('throng-shell').waitFor({ state: 'visible' });
    // The sidebar hosts only Projects + Sub-workspaces (the Terminals panel was removed, FR-023).
    await expect(window.getByTestId('projects-panel')).toBeVisible();
    await expect(window.locator('.sidebar-panel--terminals')).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test('closes cleanly', { tag: ['@core', '@window', '@reserve:window'] }, async () => {
  const app = await launchApp();
  await app.firstWindow();

  /*
   * "Cleanly" means the GRACEFUL path finished — not that the process is gone, which force-killing
   * also achieves and which would make this test unable to fail.
   *
   * So it is timed. `closeApp` reaps the detached daemon, then `shutdownApp` destroys the windows and
   * closes, racing a 15s grace before it resorts to `taskkill`. Finishing well inside that grace is
   * exactly the claim: the app shut itself down when asked.
   *
   * A bare `app.close()` is NOT the thing to assert here, which took a while to establish. It hangs
   * even on a healthy app, because throng runs its own close handling and Playwright is waiting on a
   * window that is waiting on the app; destroying the windows first is what lets it exit. Asserting
   * the bare call would have been asserting a behaviour throng does not have.
   */
  const began = Date.now();
  await closeApp(app);
  const took = Date.now() - began;

  // validity-bound: derived from the production constant SHUTDOWN_GRACE_MS (15s), and it is not a
  // performance claim — a shutdown that needed the force-kill fallback cannot come in under ten
  // seconds, so this number is the only thing distinguishing "closed itself" from "was killed".
  // Remove it and the test passes when the app had to be killed, which is the opposite of what it
  // says it checks. 034 SC-007's ceiling-needs-a-requirement rule is answered by the constant.
  expect(took, `shutdown took ${took}ms — it needed the force-kill fallback`).toBeLessThan(10_000);
});
