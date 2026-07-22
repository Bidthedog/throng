/**
 * Unit-level coverage for the harness's bounded force-kill (issue #75).
 *
 * `shutdownApp` races a graceful Electron shutdown against a deadline and, if the app has wedged,
 * force-kills its whole process tree so a hung app can never blow Playwright's *worker-teardown*
 * budget (which surfaces as "1 error was not a part of any test" — a non-test error no retry
 * absorbs, and the exact way master went red on run 29909576080). This spec pins the reaping
 * primitive `forceKillProcessTree` directly, against a deliberately undead parent+child tree that
 * stands in for a wedged Electron app plus its renderer/conhost children — no Electron needed, so
 * it is fast and deterministic.
 */
import { spawn } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { forceKillProcessTree } from './harness.js';

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

test('forceKillProcessTree reaps a wedged process AND its child tree, bounded (issue #75)', async () => {
  // A parent that spawns a long-lived child, reports the child's pid, then sleeps forever — an
  // undead tree exactly like a wedged Electron app that still owns a renderer / conhost child.
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
    const timer = setTimeout(() => reject(new Error('child pid never reported')), 8000);
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
  expect(parentPid).toBeGreaterThan(0);
  expect(isAlive(parentPid as number)).toBe(true);
  expect(isAlive(childPid)).toBe(true);

  const start = Date.now();
  forceKillProcessTree(parentPid as number);
  // Bounded: the helper caps taskkill at 10s and swallows failures, so it must return well inside
  // that even in the worst case — this is the property that keeps worker teardown off the budget.
  expect(Date.now() - start).toBeLessThan(11_000);

  await expect.poll(() => isAlive(parentPid as number), { timeout: 8000 }).toBe(false);
  // The whole TREE goes with it — `taskkill /T` guarantees the child dies too on Windows (the
  // platform this app targets and CI runs). On POSIX a non-group-leader child can outlive a plain
  // kill, so assert the tree-kill only where the helper's tree semantics hold.
  if (process.platform === 'win32') {
    await expect.poll(() => isAlive(childPid), { timeout: 8000 }).toBe(false);
  } else {
    forceKillProcessTree(childPid); // keep the box clean regardless of platform
  }
});
