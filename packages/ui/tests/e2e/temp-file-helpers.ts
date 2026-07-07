/**
 * Tracked temp-dir helpers for E2E specs that manage their own app/daemon launch
 * (i.e. don't go through `harness.runApp`, which cleans up its own dirs). Every dir
 * created via {@link tmpDir} is removed after each test — so a full suite run leaves
 * no `throng-*` directories behind in %TEMP%.
 *
 * Usage: call {@link registerTempCleanup} ONCE at the top of the spec file, then use
 * `tmpDir('throng-ud-')` in place of `mkdtempSync(join(tmpdir(), …))`. The cleanup
 * MUST be registered per file — a `test.afterEach` at this module's top level would
 * register only for the first file that imports it (Node caches the module).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@playwright/test';

const created: string[] = [];

/** Create a temp dir that is auto-removed after the current test. */
export function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** Register the after-each cleanup for the calling spec file. Call once at top level. */
export function registerTempCleanup(): void {
  test.afterEach(() => {
    // The app holds its userData dir until fully closed — hence the retries.
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
    }
  });
}
