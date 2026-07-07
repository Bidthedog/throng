/**
 * Playwright globalTeardown: remove the per-run temp folder this E2E invocation
 * created (see playwright-global-setup.mjs). Only runs when this process owned
 * the folder — under the top-level wrapper the wrapper owns teardown instead.
 */
import { cleanupRunDir } from './test-run-dir.mjs';

export default function () {
  const dir = process.env.THRONG_TEST_RUN_OWNED_DIR;
  if (dir) cleanupRunDir(dir);
}
