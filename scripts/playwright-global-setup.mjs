/**
 * Playwright globalSetup: when the E2E layer is run directly (`npm run test:e2e`)
 * rather than via the top-level `run-tests.mjs` wrapper, establish the single
 * per-run temp folder before any worker is spawned so E2E scratch consolidates
 * under one `throng_e2e_<runhash>`. Under the wrapper the folder already exists,
 * so this is a no-op. Ownership is handed to the paired globalTeardown via env
 * (both hooks run in the same Playwright main process).
 */
import { ensureRunDir } from './test-run-dir.mjs';

export default function () {
  const { dir, owned } = ensureRunDir();
  if (owned) process.env.THRONG_TEST_RUN_OWNED_DIR = dir;
}
