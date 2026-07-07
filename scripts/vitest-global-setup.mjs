/**
 * Vitest globalSetup: when a vitest layer is run directly (e.g. `npm run
 * test:integration`) rather than via the top-level `run-tests.mjs` wrapper, this
 * establishes the single per-run temp folder before any worker is forked, so the
 * layer's scratch still consolidates under one `throng_e2e_<runhash>`. Under the
 * wrapper the run folder already exists, so this is a no-op and the wrapper owns
 * teardown.
 */
import { ensureRunDir, cleanupRunDir } from './test-run-dir.mjs';

export default function () {
  const { dir, owned } = ensureRunDir();
  return () => {
    if (owned) cleanupRunDir(dir);
  };
}
