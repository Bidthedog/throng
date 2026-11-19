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
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';

/**
 * What Playwright's `app.close()` is really waiting for, on Linux: the identities (`pipe:[n]` /
 * `socket:[n]`) of the app process's descriptors 1–4.
 *
 * Playwright launches Electron with stdio `['ignore', 'pipe', 'pipe', 'pipe', 'pipe']` and settles
 * `close` on the child's `close` event, which needs EVERY copy of those four descriptors closed — not
 * just the main process gone. Descriptors 3 and 4 are inherited without close-on-exec, so Node's
 * `child_process.spawn` hands them to everything the app starts, the detached daemon included (it is
 * a process the app does not reap, on purpose). Read while the app is alive; `[]` off Linux or once
 * it has gone.
 */
export function stdioIdentities(pid: number): string[] {
  if (process.platform !== 'linux') return [];
  const ids: string[] = [];
  for (const fd of [1, 2, 3, 4]) {
    try {
      ids.push(readlinkSync(`/proc/${pid}/fd/${fd}`));
    } catch {
      /* not open, or the process has gone */
    }
  }
  return ids;
}

/**
 * Every process still holding any of `identities` (from {@link stdioIdentities}), one line each:
 * pid, ppid, pgid, sid, which descriptors, and its command line. Linux only (`/proc`); `[]` elsewhere.
 * Never throws — it is read while diagnosing a stall, and a process vanishing mid-scan is expected.
 */
export function stdioHolders(identities: readonly string[]): string[] {
  if (process.platform !== 'linux' || identities.length === 0) return [];
  const wanted = new Set(identities);
  const lines: string[] = [];
  let pids: string[];
  try {
    pids = readdirSync('/proc').filter((p) => /^\d+$/.test(p));
  } catch {
    return [];
  }
  for (const pid of pids) {
    let fds: string[];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue; // gone, or not ours to read
    }
    const held: string[] = [];
    for (const fd of fds) {
      try {
        const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
        if (wanted.has(target)) held.push(`fd${fd}=${target}`);
      } catch {
        /* closed mid-scan */
      }
    }
    if (held.length === 0) continue;
    let ids = '';
    let args = '';
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const [, ppid, pgid, sid] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      ids = `ppid=${ppid} pgid=${pgid} sid=${sid}`;
      args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
    } catch {
      /* exited mid-scan: the pid and descriptors are still worth printing */
    }
    lines.push(`${pid} ${ids} ${held.join(',')} ${args}`.replace(/\s+/g, ' ').trim());
  }
  return lines;
}

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
