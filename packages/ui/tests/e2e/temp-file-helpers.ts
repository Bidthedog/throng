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
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
      } catch {
        // BEST-EFFORT, and deliberately so (017 FR-013a/FR-014).
        //
        // Electron releases its userData dir asynchronously, some time after the process
        // exits; under load it can still hold the lock when the retries above run out,
        // and rmSync then throws EPERM. This is *housekeeping*, not an assertion — the
        // test it is attributed to has already passed. Letting it throw turns a lost race
        // with the OS file lock into a RED TEST, which is precisely the kind of
        // non-signal the flake gate must not fire on. (Observed: context-menu.e2e.ts
        // failed this way, in an afterEach, with every assertion green.)
        //
        // Nothing leaks: globalTeardown removes the whole per-run `throng_e2e_<runhash>`
        // folder, which is where every one of these dirs lives.
      }
    }
  });
}
