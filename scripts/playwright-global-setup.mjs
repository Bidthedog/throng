/**
 * Playwright globalSetup: when the E2E layer is run directly (`npm run test:e2e`)
 * rather than via the top-level `run-tests.mjs` wrapper, establish the single
 * per-run temp folder before any worker is spawned so E2E scratch consolidates
 * under one `throng_e2e_<runhash>`. Under the wrapper the folder already exists,
 * so this is a no-op. Ownership is handed to the paired globalTeardown via env
 * (both hooks run in the same Playwright main process).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRunDir, sweepStaleRunDirs } from './test-run-dir.mjs';

/** A cold launch took about 8 s on a hosted runner (gate run 41326945782). */
const WARM_UP_MS = 10_000;

export default async function () {
  const { dir, owned } = ensureRunDir();
  if (owned) process.env.THRONG_TEST_RUN_OWNED_DIR = dir;

  // Clear out what earlier runs abandoned. A run keeps its own folder when it is not empty, which is
  // right for inspecting that run and wrong forever: measured at 378 folders and 4.4 GB after a few
  // days of iterating. Never touches this run's folder, nor anything recent enough to belong to a
  // concurrent one.
  sweepStaleRunDirs({ keep: dir });

  // Size the app's daemon-RPC budget for the TEST environment (017 FR-013a).
  //
  // Every non-attach RPC — `workspace.*`, `projects.*`, `subworkspace.*` — shares the
  // app's DEFAULT_PING_TIMEOUT_MS, which is **2000ms** (packages/ui/src/main/ui-settings.ts).
  // That is a liveness budget, not a work budget, and it is ample for one app talking to
  // one daemon. This suite, however, runs up to SIX Electron apps and six daemons at once,
  // where a round-trip routinely exceeds 2s. When it does, the RPC rejects and the app
  // reports a *user-facing failure* for an action that was never broken — e.g.
  //   "Couldn't create the sub-workspace: RPC \"workspace.loadSubWorkspaces\" timed out"
  // — and the spec fails for a reason that has nothing to do with the behaviour it asserts.
  // (Proven: destroy-cascade's terminal-mirror test failed 3/9 this way; it passes 5/5 with
  // this budget raised. See specs/017-icon-tooltip-flake-fixes/e2e-audit.md.)
  //
  // This is deliberately NOT a fix for the underlying conflation of the ping and work
  // budgets, which is a real product concern and is reported separately — it removes the
  // harness's own contention from the tests' results. Overridable, so a test that wants to
  // exercise the timeout itself still can.
  if (!process.env.THRONG_PING_TIMEOUT_MS) process.env.THRONG_PING_TIMEOUT_MS = '20000';

  // Warm up Electron once on CI. The first-ever launch on a cold runner is slow and
  // highly variable — reading ~200MB of Electron off cold disk, plus GPU/V8 init —
  // which would otherwise be charged to whichever spec launches first and can blow
  // that spec's test timeout AND the 60s worker-teardown timeout. One launch here
  // warms the OS file cache so every spec starts warm (a warm launch is ~2s). This is
  // best-effort: a warm-up failure must never block the suite. Skipped locally, where
  // the cache is already warm and this would just add a few seconds per run.
  // run-e2e-local.mjs sets THRONG_E2E_WARM for its second tier, which the first has already warmed.
  if (process.env.CI && !process.env.THRONG_E2E_WARM) {
    // A plain child process rather than Playwright's _electron.launch: an app launched that way is
    // registered with Playwright's main process, which then waits on it at exit until a 30 s guard
    // fires. Merely reading Electron off disk during launch warms the OS file cache, so a fixed window
    // is enough and nothing needs to answer. Best-effort throughout.
    const mainEntry = fileURLToPath(new URL('../packages/ui/dist/main/main.js', import.meta.url));
    const userData = mkdtempSync(join(tmpdir(), 'throng-warmup-'));
    try {
      const electron = createRequire(import.meta.url)('electron');
      const child = spawn(electron, [mainEntry, `--user-data-dir=${userData}`], {
        stdio: 'ignore',
        env: { ...process.env, THRONG_CONFIG_ROOT: mkdtempSync(join(tmpdir(), 'throng-warmcfg-')) },
      });
      child.on('error', () => {});
      await new Promise((resolve) => setTimeout(resolve, WARM_UP_MS));
      if (child.pid !== undefined) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Ignore — worst case the first spec bears the cold start and recovers on retry.
    }
    try {
      rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best-effort */
    }
  }
}
