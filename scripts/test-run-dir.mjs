/**
 * Shared run-directory plumbing for the whole test solution.
 *
 * Every test in this repo scratches to `os.tmpdir()` (E2E harness, the E2E
 * `temp-file-helpers`, and the scattered `mkdtempSync(join(tmpdir(), …))` calls
 * across the integration/contract layers). By redirecting `TEMP`/`TMP`/`TMPDIR`
 * to a single per-run folder BEFORE any test process starts, all of that scratch
 * lands under one parent — `%TEMP%/throng_e2e_<runhash>/` — with one sub-dir per
 * test, without touching a single test file.
 *
 * The top-level wrapper (`run-tests.mjs`) owns the folder for a full `npm run
 * test` (one hash across unit + integration + contract + e2e and all their
 * workers). When a single suite is run directly (e.g. `npm run test:e2e`), the
 * per-runner globalSetup hooks fall back to creating their own run folder so the
 * one-parent invariant still holds for that invocation.
 *
 * Per-test cleanup is unchanged (the harness / helpers still remove each sub-dir),
 * so a clean run empties the parent and the owner then removes it too. A crash or
 * hang skips the owner's cleanup, leaving the parent (and whatever the crashed
 * test never cleaned) behind for inspection — which is the whole point.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ENV_DIR = 'THRONG_TEST_RUN_DIR';

/** A short, filesystem-safe, collision-resistant run hash. */
export function newRunHash() {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

/**
 * Ensure a single run folder exists and that this process (plus every child and
 * worker it spawns) scratches into it. Idempotent: if `THRONG_TEST_RUN_DIR` is
 * already set (a parent owner established it), this reuses it and reports
 * `owned: false`; otherwise it creates the folder, redirects the temp env vars,
 * and reports `owned: true` so the caller knows it is responsible for teardown.
 *
 * MUST run before the runner spawns its workers, so the workers inherit the
 * redirected temp env.
 */
export function ensureRunDir() {
  const existing = process.env[ENV_DIR];
  if (existing) return { dir: existing, owned: false };

  // Derive from the *real* temp root before we redirect it.
  const dir = join(tmpdir(), `throng_e2e_${newRunHash()}`);
  mkdirSync(dir, { recursive: true });
  process.env[ENV_DIR] = dir;
  process.env.TEMP = dir;
  process.env.TMP = dir;
  process.env.TMPDIR = dir;
  return { dir, owned: true };
}

/**
 * Remove the run folder if the run cleaned up after itself (empty). If anything
 * remains — a test crashed or hung before its own cleanup ran — keep the folder
 * and report where it is, so the leftovers can be inspected.
 */
export function cleanupRunDir(dir) {
  let leftovers = [];
  try {
    leftovers = readdirSync(dir);
  } catch {
    return; // already gone
  }
  if (leftovers.length === 0) {
    rmSync(dir, { recursive: true, force: true });
    return;
  }
  console.log(
    `\n[throng test] kept run dir with ${leftovers.length} leftover item(s) ` +
      `(a test likely crashed or hung before cleanup):\n  ${dir}\n`,
  );
}
