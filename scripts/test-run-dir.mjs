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
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
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
 * Delete run folders left behind by EARLIER runs.
 *
 * A run folder is kept when it is not empty, which is the right call for the run that just
 * finished — its leftovers are evidence. It is the wrong call forever: a directory Windows would
 * not release leaves one item behind, every run leaves one folder, and nothing ever removes them.
 * Measured on this machine after a few days of iterating: 378 folders, 4.4 GB.
 *
 * So each run sweeps what previous runs abandoned, never its own. `ageMs` is generous on purpose —
 * a concurrent run's folder must never be touched, and a stale folder costs nothing but disk until
 * the next sweep.
 */
export function sweepStaleRunDirs({ ageMs = 6 * 60 * 60 * 1000, keep = '' } = {}) {
  const parent = tmpdir();
  const cutoff = Date.now() - ageMs;
  let removed = 0;
  let entries = [];
  try {
    entries = readdirSync(parent).filter((n) => n.startsWith('throng_e2e_'));
  } catch {
    return { removed, scanned: 0 };
  }
  for (const name of entries) {
    const dir = join(parent, name);
    if (dir === keep) continue;
    try {
      if (statSync(dir).mtimeMs > cutoff) continue;
      rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      removed += 1;
    } catch {
      // Still locked, or someone else is using it. It will be swept next time.
    }
  }
  if (removed > 0) {
    console.log(`[throng test] swept ${removed} stale run folder(s) from previous runs`);
  }
  return { removed, scanned: entries.length };
}

/** `throng-agent-<pid>.log` — the de-elevated PTY agent's diagnostic sink (pty-agent-log.ts). */
const AGENT_LOG = /^throng-agent-\d+\.log$/;

/**
 * Remove the run folder if the run cleaned up after itself (empty), otherwise keep it and say where
 * it is, so the leftovers can be inspected.
 *
 * A leftover is NOT evidence that something went wrong. Windows routinely keeps a handle on a
 * directory after the process that owned it has gone, so `cleanupTemp` (tests/e2e/harness.ts)
 * deliberately gives up rather than failing a test whose assertions already passed — that lock used
 * to cost two thirds of CI's slowest shard in retries.
 *
 * ══ THIS MESSAGE HAS NAMED THE WRONG CAUSE TWICE — SO IT NOW NAMES NONE (issue #336) ══
 *
 * It first read "a test likely crashed", which sent people looking for a crash that had not
 * happened. That was corrected to also offer a Windows lock — and the lock was not there either.
 * Both times the folder held the same thing: `throng-agent-<pid>.log` files. `%TEMP%` is redirected
 * into the run folder for the duration of a run, the agent writes one log per process, and NO
 * cleanup path removes them — so an ordinary green run ends with a folder full of them. Measured on
 * a 205-passed / 0-failed run: 137 of 161 items were agent logs.
 *
 * The pattern behind both wordings is the same one: stating a cause that was never checked. A
 * confident wrong diagnosis costs a reader more than no diagnosis, because they believe it. So the
 * line now COUNTS what is there, and offers the two candidates only where they are still plausible
 * — beside something that is not an agent log — and only ever as candidates.
 *
 * The logs are reported rather than deleted on purpose. They are the only record of an agent that
 * dies after connecting back (`packages/daemon/DEBUG-agent-crash.md` sends developers to exactly
 * these files), and they do not accumulate: {@link sweepStaleRunDirs} drops run folders older than
 * six hours on every gate and every E2E run. Bounded diagnostics are worth keeping.
 *
 * Held by `packages/ui/tests/unit/test-run-dir.test.ts`.
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

  const logs = leftovers.filter((name) => AGENT_LOG.test(name)).length;
  const other = leftovers.length - logs;
  const counted = [
    logs > 0 ? `${logs} pty-agent log(s)` : '',
    other > 0 ? `${other} other item(s)` : '',
  ]
    .filter(Boolean)
    .join(' and ');

  // Only the unexplained leftovers are worth speculating about, and only out loud as speculation.
  const guess =
    other > 0
      ? '\n  The non-log leftovers may be a directory Windows would not release, or a test that ' +
        'stopped\n  before its cleanup — neither has been established here, so open it and look.'
      : '';

  console.log(`\n[throng test] kept run dir for inspection — ${counted}:\n  ${dir}${guess}\n`);
}
