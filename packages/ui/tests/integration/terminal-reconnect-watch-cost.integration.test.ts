/**
 * Arming a terminal's path-availability watch must not walk the directory it waits under (039 FR-030, #237).
 *
 * ══ THE DEFECT ══
 *
 * A terminal that fails on a missing working directory arms a watch on the directory's nearest EXISTING ancestor, so
 * it can start itself when the directory returns. Main handed that watch the shared project watcher, which is
 * RECURSIVE — and on Linux a recursive watch is built by walking the tree with `readdirSync` and one inotify watch per
 * directory, synchronously, on main's event loop (`directory-tree-watch.ts`).
 *
 * For a project root that is missing, the nearest existing ancestor is wherever the path stops resolving: the user's
 * home, a mount point, `/`. Main walked all of it. Measured on a hosted Ubuntu runner with the root at
 * `/throng-e2e-missing/pfb`: the main process stopped answering for about 90 s on a cold disk — every Playwright query
 * and every frame waited on it — and on a workstation 1.4 s, ending only where the inotify watch limit ran out. Either
 * way it spends the user's inotify watches on a tree throng has no interest in.
 *
 * The reconnect only needs to hear that an entry appeared in the ancestor, which a single non-recursive watch reports.
 *
 * Layer: integration — the cost is real inotify watches taken by a real watcher; a fake watcher would report whatever
 * it was told.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { skipUnlessLinux } from '@throng/core/testing';
import { TerminalReconnect } from '../../src/main/terminal-reconnect.js';
import { reconnectWatcher } from '../../src/main/reconnect-watcher.js';

/** Every inotify watch this process holds, read from the kernel's own accounting. */
function inotifyWatches(): number {
  let count = 0;
  for (const fd of readdirSync('/proc/self/fdinfo')) {
    let info: string;
    try {
      info = readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8');
    } catch {
      continue; // an fd closed between the listing and the read
    }
    count += info.split('\n').filter((line) => line.startsWith('inotify wd:')).length;
  }
  return count;
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Main's own `parentOf`: `dirname`, stopping at a filesystem root. */
const parentOf = (p: string): string | null => {
  const up = dirname(p);
  return up === p ? null : up;
};

async function until(check: () => boolean, what: string): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 5_000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe.skipIf(skipUnlessLinux('the recursive watch is a directory walk only on Linux (#585)'))(
  'terminal reconnect — the watch it arms (039 FR-030)',
  () => {
    let ancestor = '';
    let reconnect: TerminalReconnect | null = null;

    afterEach(() => {
      reconnect?.dispose();
      reconnect = null;
      if (ancestor) rmSync(ancestor, { recursive: true, force: true });
    });

    const arm = (target: string, notify: (ids: string[]) => void): ReturnType<TerminalReconnect['arm']> => {
      // Composed as main composes it (`main.ts`, `new TerminalReconnect`).
      reconnect = new TerminalReconnect({ fileWatcher: reconnectWatcher(), exists: isDir, parentOf, notify });
      return reconnect.arm('panel-1', 'project-1', target);
    };

    it('takes one watch for a missing root, not one per directory under its ancestor', () => {
      // The ancestor of a missing project root is an ordinary, populated folder: here 300 of them.
      ancestor = mkdtempSync(join(tmpdir(), 'throng-reconnect-cost-'));
      for (let i = 0; i < 30; i += 1) for (let j = 0; j < 10; j += 1) mkdirSync(join(ancestor, `d${i}`, `e${j}`), { recursive: true });

      const before = inotifyWatches();
      const result = arm(join(ancestor, 'missing-root'), () => {});
      const taken = inotifyWatches() - before;

      expect(result).toEqual({ ok: true, watching: ancestor });
      expect(taken, `arming took ${taken} inotify watches over an ancestor holding 330 directories`).toBeLessThanOrEqual(2);
    });

    it('still starts the terminal when a missing root two levels down comes back (FR-030)', async () => {
      ancestor = mkdtempSync(join(tmpdir(), 'throng-reconnect-cost-'));
      const notify = vi.fn<(ids: string[]) => void>();
      const target = join(ancestor, 'workspace', 'project');
      arm(target, notify);

      // `mkdir -p` in two steps, so the second creation lands where only a re-targeted watch can see it.
      mkdirSync(join(ancestor, 'workspace'));
      await new Promise((r) => setTimeout(r, 300));
      expect(notify).not.toHaveBeenCalled(); // the folder it waits for is still missing (FR-035)
      mkdirSync(target);

      await until(() => notify.mock.calls.length > 0, 'the reconnect to release the panel');
      expect(notify.mock.calls).toEqual([[['panel-1']]]);
    });
  },
);
