/**
 * The harness's bounded force-kill primitive, in a module of its own (034 FR-045, issue #75).
 *
 * WHY IT LIVES HERE AND NOT IN `harness.ts`. This function is the one piece of the harness with a
 * testable property of its own — it must reap a whole process tree, and it must return inside a
 * bound whatever the tree does, because an unbounded teardown blows Playwright's *worker-teardown*
 * budget and surfaces as "1 error was not a part of any test", a non-test error that no retry
 * absorbs. Proving that needs real processes and nothing else: no Electron, no window, no daemon.
 *
 * `harness.ts` cannot be imported from a vitest layer — it pulls in `@playwright/test` and
 * `@throng/persistence` (better-sqlite3) at module scope. So the primitive moves out and `harness.ts`
 * re-exports it, which keeps every existing `import { forceKillProcessTree } from './harness.js'`
 * working while letting `packages/ui/tests/integration/force-kill-process-tree.integration.test.ts`
 * exercise THIS module — the one the harness actually calls, not a copy of it.
 */
import { execFileSync } from 'node:child_process';

/**
 * Force-kill an OS process and its entire child tree, best-effort and BOUNDED.
 *
 * On Windows this is `taskkill /T /F` (whole tree, unconditional) — the only reliable way to reap
 * a wedged Electron app together with its renderer/GPU/utility children and any conhost it spawned.
 * A missing process (already exited) or an access error is swallowed: this is a last-resort cleanup,
 * never an assertion.
 */
export function forceKillProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 10_000,
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL'); // negative pid → the process group
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    /* already gone, or no permission — best effort, by design */
  }
}
