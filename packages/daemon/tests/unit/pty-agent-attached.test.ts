import { describe, expect, it } from 'vitest';
import type { ChildProcess, PtyHandle } from '@throng/core';
import { answerAttachedProcs } from '../../src/pty-agent-attached.js';

/**
 * 051 FR-040/FR-041 — the PTY agent's `attachedprocs` answer. The daemon knows a de-elevated terminal
 * by its key, so the shell's OS pid must come back as the key, or the rule that excludes the shell
 * would report the shell itself as the running command.
 */
const msg = { op: 'attachedprocs' as const, keys: [7, 8, 9], reqId: 4 };
const HANDLES = new Map<number, PtyHandle>([
  [7, { pid: 5000 }],
  [8, { pid: 6000 }],
]);
const proc = (pid: number, ppid: number, commandLine: string): ChildProcess => ({ pid, ppid, commandLine, startedAt: 1 });

describe('051 — answerAttachedProcs', () => {
  it('asks once for every live terminal and rewrites each shell pid to its key', async () => {
    const asked: number[][] = [];
    const ev = await answerAttachedProcs(
      async (handles) => {
        asked.push(handles.map((h) => h.pid));
        return new Map([
          [5000, [proc(5000, 1, 'cmd.exe'), proc(5001, 5000, 'node a.js'), proc(5002, 4999, 'sh.exe x')]],
          [6000, [proc(6000, 1, 'bash.exe')]],
        ]);
      },
      (key) => HANDLES.get(key),
      msg,
      () => {},
    );
    expect(asked).toEqual([[5000, 6000]]); // key 9 is not held: not asked about
    expect(ev.byKey['7']).toEqual([proc(7, 1, 'cmd.exe'), proc(5001, 7, 'node a.js'), proc(5002, 4999, 'sh.exe x')]);
    expect(ev.byKey['8']).toEqual([proc(8, 1, 'bash.exe')]);
    expect(ev.failed).toBeUndefined();
  });

  it('a terminal the host could not answer for is absent — the daemon falls back to its direct children', async () => {
    const ev = await answerAttachedProcs(async () => new Map([[5000, []]]), (key) => HANDLES.get(key), msg, () => {});
    expect(Object.keys(ev.byKey)).toEqual(['7']);
  });

  it('a failed request is reported as failed, never as an empty answer (FR-042)', async () => {
    const logged: string[] = [];
    const ev = await answerAttachedProcs(
      () => Promise.reject(new Error('helper timed out')),
      (key) => HANDLES.get(key),
      msg,
      (line) => logged.push(line),
    );
    expect(ev).toEqual({ ev: 'attachedprocs', reqId: 4, byKey: {}, failed: true });
    expect(logged.join('\n')).toContain('helper timed out');
  });

  it('a host that cannot ask at all answers failed', async () => {
    const ev = await answerAttachedProcs(undefined, (key) => HANDLES.get(key), msg, () => {});
    expect(ev.failed).toBe(true);
  });
});
