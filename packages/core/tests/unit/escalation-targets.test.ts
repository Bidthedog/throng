import { describe, expect, it } from 'vitest';
import { escalationTargets } from '../../src/terminal/escalation-targets.js';

/**
 * 051 FR-015a — what a forced end must reach: the shell, every process descended from it, and its
 * console host. Walked by parent pid over ONE process table, so the descendants of a shell that has
 * already exited are still reached — `taskkill /T` needs a live root.
 */
const row = (pid: number, ppid: number) => ({ pid, ppid });

describe('051 FR-015a — escalationTargets', () => {
  it('collects the shell, its whole descendant tree and the conhost', () => {
    const table = [row(10, 1), row(11, 10), row(12, 11), row(13, 10), row(99, 1)];
    expect(escalationTargets(table, 10, 50, 1).sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 50]);
  });

  it('still includes the shell when the table no longer lists it, and its surviving children', () => {
    // The shell already exited; its child's ppid still names it.
    const table = [row(11, 10), row(12, 11)];
    expect(escalationTargets(table, 10, null, 1).sort((a, b) => a - b)).toEqual([10, 11, 12]);
  });

  it('never targets the caller itself, even if a row claims it descends from the shell', () => {
    const table = [row(10, 1), row(1, 10)];
    expect(escalationTargets(table, 10, null, 1)).toEqual([10]);
  });

  it('terminates on a cycle in the table and lists each pid once', () => {
    const table = [row(10, 12), row(11, 10), row(12, 11)];
    expect(escalationTargets(table, 10, 11, 1).sort((a, b) => a - b)).toEqual([10, 11, 12]);
  });
});

describe('051 FR-015a — a forced end never reaches a process that only CLAIMS the shell as parent (#280)', () => {
  const timed = (pid: number, ppid: number, startedAt: number) => ({ pid, ppid, startedAt });

  it('skips a process older than the shell whose stale ppid names it, and everything under it', () => {
    // 70 is another program's long-running process: its real parent died long ago, and Windows left
    // a ppid that now happens to equal the shell's recycled-looking pid. It must not be force-killed.
    const table = [timed(10, 1, 5000), timed(11, 10, 5100), timed(70, 10, 1000), timed(71, 70, 1200)];
    expect(escalationTargets(table, 10, null, 1, 5000).sort((a, b) => a - b)).toEqual([10, 11]);
  });

  it('applies the same test below the shell: a grandchild older than its supposed parent is not it', () => {
    const table = [timed(10, 1, 5000), timed(11, 10, 5100), timed(12, 11, 5050)];
    expect(escalationTargets(table, 10, null, 1, 5000).sort((a, b) => a - b)).toEqual([10, 11]);
  });
});
