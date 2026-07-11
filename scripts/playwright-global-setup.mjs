/**
 * Playwright globalSetup: when the E2E layer is run directly (`npm run test:e2e`)
 * rather than via the top-level `run-tests.mjs` wrapper, establish the single
 * per-run temp folder before any worker is spawned so E2E scratch consolidates
 * under one `throng_e2e_<runhash>`. Under the wrapper the folder already exists,
 * so this is a no-op. Ownership is handed to the paired globalTeardown via env
 * (both hooks run in the same Playwright main process).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRunDir } from './test-run-dir.mjs';

export default async function () {
  const { dir, owned } = ensureRunDir();
  if (owned) process.env.THRONG_TEST_RUN_OWNED_DIR = dir;

  // Warm up Electron once on CI. The first-ever launch on a cold runner is slow and
  // highly variable — reading ~200MB of Electron off cold disk, plus GPU/V8 init —
  // which would otherwise be charged to whichever spec launches first and can blow
  // that spec's test timeout AND the 60s worker-teardown timeout. One launch here
  // warms the OS file cache so every spec starts warm (a warm launch is ~2s). This is
  // best-effort: a warm-up failure must never block the suite. Skipped locally, where
  // the cache is already warm and this would just add a few seconds per run.
  if (process.env.CI) {
    const mainEntry = fileURLToPath(new URL('../packages/ui/dist/main/main.js', import.meta.url));
    // Hard deadline: whatever happens, warming NEVER blocks the suite for more than
    // this. It RESOLVES (never rejects) so the race below just falls through. Merely
    // reading Electron's binary off disk during launch warms the OS file cache, so a
    // warm-up that times out before the window shows is still useful.
    const after = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());
    let app;
    let userData;
    try {
      const { _electron } = await import('@playwright/test');
      userData = mkdtempSync(join(tmpdir(), 'throng-warmup-'));
      const launch = (async () => {
        app = await _electron.launch({
          args: [mainEntry, `--user-data-dir=${userData}`],
          env: { ...process.env, THRONG_CONFIG_ROOT: mkdtempSync(join(tmpdir(), 'throng-warmcfg-')) },
        });
        await app.firstWindow();
      })();
      await Promise.race([launch, after(90_000)]);
    } catch {
      // Ignore — worst case the first spec bears the cold start and recovers on retry.
    } finally {
      try {
        if (app) await Promise.race([app.close(), after(15_000)]);
      } catch {
        /* best-effort */
      }
      if (userData) {
        try {
          rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch {
          /* best-effort */
        }
      }
    }
  }
}
