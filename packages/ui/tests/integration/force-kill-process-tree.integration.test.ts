import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { forceKillProcessTree } from '../e2e/process-tree.js';

/**
 * The harness's bounded force-kill (034 FR-045, replacing `harness-shutdown.e2e.ts`; issue #75).
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT ONE. `tasks.md` T034 said "→ unit". It cannot be:
 * the whole subject is REAL operating-system processes — a parent that outlives a plain kill, a child
 * that is only reaped by `taskkill /T`, and a shell-out that must return inside a bound. Mocking
 * `child_process` would leave the assertion testing the mock. The repo's own layer rule puts real
 * processes and files at integration, so that is where it goes.
 *
 * WHY IT IS NOT AN E2E TEST, WHICH IS WHAT IT WAS. `harness-shutdown.e2e.ts` launched no Electron,
 * opened no window and touched no product code — its own header called itself "unit-level coverage".
 * It asserted a property of the TEST HARNESS while occupying a slot in the most expensive suite in
 * the repo. Nothing about the claim needs Playwright; it needs two processes and a stopwatch.
 *
 * WHAT IS ASSERTED, unchanged from the E2E it replaces:
 *   • a wedged parent is killed;
 *   • its child dies WITH it (the `/T` in `taskkill /pid <n> /T /F`) — on win32, where the helper's
 *     tree semantics hold; a POSIX non-group-leader child can legitimately outlive a plain kill;
 *   • the call RETURNS inside the 10s cap it sets on `taskkill`, which is the property that keeps a
 *     wedged app off Playwright's worker-teardown budget.
 *
 * ANTI-VACUITY CONTROL, RUN AND CONFIRMED. Change `forceKillProcessTree` in
 * `packages/ui/tests/e2e/process-tree.ts` into a no-op (`export function forceKillProcessTree(): void
 * {}`) and BOTH tests in this file fail: the first on the parent still being alive, the second on the
 * child. Nothing here can pass against a helper that kills nothing — there is no negative assertion
 * in the file that an unstarted tree would satisfy vacuously, because both trees are asserted ALIVE
 * before the kill.
 *
 * ⚠ WHAT THE SECOND TEST DOES *NOT* PIN, measured rather than assumed. Removing the `/T` from
 * `taskkill /pid <n> /T /F` leaves both tests GREEN. The reason is environmental and not a defect in
 * the test: Node's `spawn` on Windows associates a child with the parent's job object, so this
 * fixture's child is reaped when its parent dies whether or not the kill was a tree kill. The
 * fixture therefore cannot manufacture the orphan the flag exists to prevent.
 *
 * So read the second test as "the child is gone afterwards", which is the property the harness needs,
 * and NOT as "the `/T` is what did it". A real conhost orphan — the case issue #75 was opened for —
 * is not job-associated, and only the E2E process-tree hygiene checks see it. Retitling this to claim
 * otherwise would be worse than the gap.
 */

/** True while `pid` is a live process. `kill(pid, 0)` probes without signalling; ESRCH ⇒ gone. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but we may not signal it — still alive for our purposes.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Poll `probe` until it returns `want`, or give up after `timeoutMs`. Returns the last reading. */
async function settle(probe: () => boolean, want: boolean, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let last = probe();
  while (last !== want && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    last = probe();
  }
  return last;
}

/**
 * An undead parent + child, exactly like a wedged Electron app that still owns a renderer or a
 * conhost child: the parent reports the child's pid and then sleeps forever, and neither will ever
 * exit on its own.
 */
async function spawnUndeadTree(): Promise<{ parentPid: number; childPid: number }> {
  const parent = spawn(
    process.execPath,
    [
      '-e',
      "const {spawn}=require('child_process');" +
        "const c=spawn(process.execPath,['-e','setInterval(()=>{},1e9)'],{stdio:'ignore'});" +
        'process.stdout.write(String(c.pid)+"\\n");' +
        'setInterval(()=>{},1e9);',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );

  const childPid = await new Promise<number>((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('child pid never reported')), 8_000);
    parent.stdout?.setEncoding('utf8');
    parent.stdout?.on('data', (d: string) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        clearTimeout(timer);
        resolve(Number(buf.slice(0, nl).trim()));
      }
    });
  });

  const parentPid = parent.pid;
  expect(parentPid, 'the undead parent never got a pid').toBeGreaterThan(0);
  // Both are ALIVE before the kill. This is what stops either test below from passing vacuously
  // against a tree that never started.
  expect(isAlive(parentPid as number)).toBe(true);
  expect(isAlive(childPid)).toBe(true);
  return { parentPid: parentPid as number, childPid };
}

describe('forceKillProcessTree (issue #75)', () => {
  it('reaps a wedged process, and returns inside its own bound', async () => {
    const { parentPid, childPid } = await spawnUndeadTree();
    try {
      const start = Date.now();
      forceKillProcessTree(parentPid);
      // BOUNDED. The helper caps `taskkill` at 10s and swallows failures, so it must return well
      // inside that even in the worst case. This is the property that keeps a wedged app from
      // riding out Playwright's worker-teardown budget — the failure mode that reds a whole run
      // with "1 error was not a part of any test", which no retry absorbs.
      expect(Date.now() - start).toBeLessThan(11_000);

      expect(await settle(() => isAlive(parentPid), false)).toBe(false);
    } finally {
      forceKillProcessTree(childPid); // keep the box clean whatever happened above
    }
  });

  it('takes the whole CHILD TREE with it, not just the process named', async () => {
    const { parentPid, childPid } = await spawnUndeadTree();
    try {
      forceKillProcessTree(parentPid);
      expect(await settle(() => isAlive(parentPid), false)).toBe(false);

      if (process.platform === 'win32') {
        // `taskkill /T` is what makes this true, and it is the half of the helper that a plain
        // `process.kill(pid)` would silently fail to do: the child is not a group leader's child on
        // Windows, so killing the parent alone leaves it running and the app's process tree undead.
        expect(await settle(() => isAlive(childPid), false)).toBe(false);
      } else {
        // On POSIX a non-group-leader child can legitimately outlive a plain kill, so the tree
        // claim is asserted only where the helper's tree semantics actually hold.
        expect(process.platform).not.toBe('win32');
      }
    } finally {
      forceKillProcessTree(childPid);
    }
  });
});
