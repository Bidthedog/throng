import { describe, it, expect } from 'vitest';
import { descendantsOf } from '../../src/process-tree.js';

/**
 * The descendant walk behind command memory (`listChildProcesses`) and the close-time busy check
 * (`listChildPids`) must terminate on ANY process table Windows can hand it.
 *
 * Windows reuses pids, and a process keeps the parent pid it was born with after that parent has
 * exited. So a snapshot can say "X's parent is 100" when 100 is now a DIFFERENT process — the
 * shell a terminal just started, say — and if X is itself an ancestor of that shell (the app, the
 * daemon, the agent hosting the shell), the parent graph is a cycle.
 *
 * The walk had no guard against that. Caught in the de-elevated agent's own log, in the one run of
 * twenty that failed `terminal-kitty-editing-keys.e2e.ts`:
 *
 *   childprocs error key=1: RangeError: Invalid array length
 *       at Array.push (<anonymous>)
 *       at descendantProcesses (node-pty-host.js:376:16)
 *
 * — an unbounded push that can only happen on a cyclic table, after seconds of a blocked event loop
 * during which the agent served no terminal at all: a new shell stayed blank, typed input never
 * echoed, and on the hosted runner the agent died and every terminal reported "exited (code —)".
 */

interface Row {
  pid: number;
  ppid: number;
  startedAt?: number;
  name: string;
}

function table(rows: Row[]): Map<number, Row[]> {
  const byParent = new Map<number, Row[]>();
  for (const row of rows) {
    const list = byParent.get(row.ppid);
    if (list) list.push(row);
    else byParent.set(row.ppid, [row]);
  }
  return byParent;
}

const names = (rows: Row[]): string[] => rows.map((r) => r.name).sort();

describe('descendantsOf', () => {
  it('returns every process below the root, and nothing above or beside it', () => {
    const byParent = table([
      { pid: 10, ppid: 1, startedAt: 100, name: 'agent' },
      { pid: 20, ppid: 10, startedAt: 200, name: 'shell' },
      { pid: 30, ppid: 20, startedAt: 300, name: 'node' },
      { pid: 40, ppid: 30, startedAt: 400, name: 'grandchild' },
      { pid: 50, ppid: 10, startedAt: 250, name: 'other-shell' },
    ]);

    expect(names(descendantsOf(byParent, 20))).toEqual(['grandchild', 'node']);
  });

  it('does not take a process born before its recorded parent for a descendant (pid reuse)', () => {
    // pid 100 was recycled: the shell that holds it now started at t=1000, but `ghost` was born at
    // t=50 under an older, long-gone process that also had pid 100.
    const byParent = table([
      { pid: 100, ppid: 400, startedAt: 1000, name: 'shell' },
      { pid: 200, ppid: 100, startedAt: 50, name: 'ghost' },
      { pid: 500, ppid: 100, startedAt: 2000, name: 'real-child' },
    ]);

    expect(names(descendantsOf(byParent, 100))).toEqual(['real-child']);
  });

  it('terminates when a recycled pid closes a loop through the shell', () => {
    // The shape that stalled the agent: the app (`ghost`) carries a stale ppid equal to the shell's
    // recycled pid, and the shell descends from the app through the daemon and the agent.
    const byParent = table([
      { pid: 200, ppid: 100, startedAt: 50, name: 'app' },
      { pid: 300, ppid: 200, startedAt: 60, name: 'daemon' },
      { pid: 400, ppid: 300, startedAt: 70, name: 'agent' },
      { pid: 100, ppid: 400, startedAt: 1000, name: 'shell' },
      { pid: 500, ppid: 100, startedAt: 2000, name: 'node' },
    ]);

    expect(names(descendantsOf(byParent, 100))).toEqual(['node']);
  });

  it('terminates on a cycle even when no creation times are known', () => {
    // `listChildPids` reads pids and parent pids only, so the age check has nothing to compare and
    // the walk itself must refuse to revisit a process.
    const byParent = table([
      { pid: 200, ppid: 100, name: 'a' },
      { pid: 300, ppid: 200, name: 'b' },
      { pid: 100, ppid: 300, name: 'root' },
    ]);

    // The root is never its own descendant, and nothing is reported twice.
    expect(names(descendantsOf(byParent, 100))).toEqual(['a', 'b']);
  });

  it('keeps a child whose creation time is unknown', () => {
    const byParent = table([
      { pid: 100, ppid: 1, startedAt: 1000, name: 'shell' },
      { pid: 200, ppid: 100, startedAt: 0, name: 'unknown-age' },
    ]);

    expect(names(descendantsOf(byParent, 100))).toEqual(['unknown-age']);
  });
});
