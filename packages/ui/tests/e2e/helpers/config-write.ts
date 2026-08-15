import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 032 T030 (FR-013, G8) — the ONE way a test writes a running app's config root.
 *
 * ══ WHY THIS EXISTS ══
 *
 * `writeFileSync` truncates the target and then fills it. Against a file nobody is watching that is
 * invisible; against a **running** throng it is a race the app can lose. The config watcher is
 * debounced but not synchronised with the test, so it can wake while the file is empty or
 * half-written, read unparseable JSON, and broadcast the shipped defaults as though they were the
 * user's settings — and then nothing re-reads, because the writer has finished and the file is not
 * touched again. The change is lost, not late, which is why a longer timeout never helped.
 *
 * #243 already fixed this once, in `helpers/tab-settings.ts`, after it failed on CI as "the rename
 * field never started enforcing a limit of 64" and passed on retry. This is that fix hoisted so
 * there is one implementation to get right rather than one per spec — enforced by
 * `tests/unit/config-write-helper-single.test.ts` rather than by remembering.
 *
 * ══ WHY THE RETRY, AND WHY THESE NUMBERS ══
 *
 * On Windows a replace-rename fails with EPERM/EACCES/EBUSY while another process holds the target,
 * and the app under test is exactly such a process. Without a bounded retry this trades a
 * lost-event flake for an EBUSY flake, which is not progress.
 *
 * The budget and interval deliberately MIRROR the product's own `renameWithRetry`
 * (`packages/ui/src/main/config-store.ts:42` — 1000 ms budget, 20 ms interval, the same three
 * transient codes). A test helper that gives up sooner than the code under test would report
 * failures the product would have survived; one that persists longer would hide contention the
 * product cannot tolerate. Matching means the two fail at the same point, so a red test means
 * something a user would also have hit.
 */

/** Exactly the codes the product treats as transient. Anything else is a real fault, reported at once. */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Mirrors RENAME_RETRY_BUDGET_MS / RENAME_RETRY_INTERVAL_MS in config-store.ts. */
const RENAME_RETRY_BUDGET_MS = 1_000;
const RENAME_RETRY_INTERVAL_MS = 20;

function sleepSync(ms: number): void {
  // The E2E helpers are synchronous by convention (callers use them inline between Playwright
  // awaits), and Atomics.wait is the only way to block without an event loop turn.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Replace `target` with `content` **atomically**, as the application itself does.
 *
 * The temp file is created in the SAME directory as the target, because a rename is only atomic
 * within a filesystem volume — writing to the OS temp directory and renaming across would silently
 * degrade to copy-then-delete, which is the very non-atomicity this exists to remove.
 */
export function writeConfigAtomic(target: string, content: string): void {
  const dir = dirname(target);
  const scratch = mkdtempSync(join(dir, '.throng-write-'));
  const staged = join(scratch, 'staged.json');

  try {
    writeFileSync(staged, content, 'utf8');

    const deadline = Date.now() + RENAME_RETRY_BUDGET_MS;
    for (;;) {
      try {
        renameSync(staged, target);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? '';
        if (!TRANSIENT_RENAME_CODES.has(code) || Date.now() >= deadline) throw err;
        sleepSync(RENAME_RETRY_INTERVAL_MS);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Convenience for the common case: replace `settings.json` in a config root with a JSON value.
 *
 * Takes a value rather than a string so a caller cannot accidentally hand it a half-built document,
 * which is the mistake one layer up from the one this file exists to prevent.
 */
export function writeSettingsAtomic(cfgRoot: string, value: unknown): void {
  writeConfigAtomic(join(cfgRoot, 'settings.json'), `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Replace a config document with RAW text, including deliberately invalid text.
 *
 * A spec that wants the parser to see malformed content still wants it delivered whole — the app
 * should read a complete invalid file, never a truncated valid-looking one. Kept as a separate,
 * named entry point so "I meant to write broken JSON" is visible at the call site rather than
 * looking like a bug.
 */
export function writeConfigRawAtomic(cfgRoot: string, fileName: string, raw: string): void {
  writeConfigAtomic(join(cfgRoot, fileName), raw);
}
