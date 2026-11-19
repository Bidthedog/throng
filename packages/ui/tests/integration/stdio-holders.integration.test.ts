import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { skipUnlessLinux } from '@throng/core/testing';
import { stdioHolders, stdioIdentities } from '../e2e/process-tree.js';

/**
 * Why `app.close()` outlived a dead Electron app (1.0.0-beta1, `app-shell.e2e.ts:127`, run 44479757262), and the
 * diagnostic that now names the culprit in the harness's stall dump.
 *
 * The fixture is that launch in miniature, with real processes: a parent spawned the way Playwright spawns Electron
 * (`stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']`, its own process group), which starts a child in a session of
 * its own with stdio on /dev/null, the way the app starts its daemon. The child still inherits descriptors 3 and 4 —
 * they are not close-on-exec — so the parent's `close` event, which is what `app.close()` settles on, cannot fire while
 * the child lives, even after the parent itself has exited.
 *
 * ANTI-VACUITY: make `stdioHolders` return `[]` and the holder assertions fail; drop the detached child's spawn and
 * the "close is held" assertion fails. Linux only — `/proc` is what the helpers read, and they return `[]` elsewhere.
 */
describe.skipIf(skipUnlessLinux('the stdio holders are read from /proc, which only Linux has'))('stdioHolders — who keeps a dead app from closing', () => {
  it('names a detached child holding the parent’s piped fd 3/4, which alone holds the parent’s close', async () => {
    // The parent is a shell rather than Node: a standalone Node marks what it inherited close-on-exec, the Electron
    // main process measurably does not, and a shell — like Electron's main — passes 3 and 4 straight through.
    const parent = spawn(
      '/bin/sh',
      ['-c', `setsid '${process.execPath}' -e 'setInterval(()=>{},1e9)' </dev/null >/dev/null 2>&1 & echo $!; exec sleep 1000`],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] },
    );
    let childPid = 0;
    try {
      childPid = await new Promise<number>((resolve, reject) => {
        parent.stdout!.setEncoding('utf8');
        parent.stdout!.once('data', (chunk: string) => resolve(Number(chunk.trim())));
        parent.once('error', reject);
      });
      const identities = stdioIdentities(parent.pid!);
      expect(identities).toHaveLength(4);

      // Every holder while both live: the parent has all four, the detached child the two Node did not replace.
      const before = stdioHolders(identities);
      expect(before.find((l) => l.startsWith(`${parent.pid} `))).toMatch(/fd1=.*fd2=.*fd3=.*fd4=/);
      const childLine = before.find((l) => l.startsWith(`${childPid} `));
      expect(childLine).toMatch(/fd3=socket:\[\d+\],fd4=socket:\[\d+\]/);
      expect(childLine).toMatch(new RegExp(`sid=${childPid} `)); // its own session: in no group of the parent's

      let closed = false;
      parent.once('close', () => {
        closed = true;
      });
      process.kill(-parent.pid!, 'SIGKILL'); // the force-kill: the parent's whole group
      await new Promise((r) => setTimeout(r, 1_000));
      expect(closed, 'the parent is dead, but its close waits on the detached child').toBe(false);
      expect(stdioHolders(identities).map((l) => l.split(' ')[0])).toEqual([String(childPid)]);

      process.kill(childPid, 'SIGKILL');
      childPid = 0;
      await expect.poll(() => closed, { timeout: 5_000 }).toBe(true);
    } finally {
      try {
        process.kill(-parent.pid!, 'SIGKILL');
      } catch {
        /* gone */
      }
      if (childPid) {
        try {
          process.kill(childPid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    }
  });
});
