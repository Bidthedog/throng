import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from '@throng/core';
import { ATTACHED_HELPER_SOURCE, readAttachedProcesses } from '../../src/attached-processes.js';

/**
 * 051 FR-040/FR-041 — the attached set for every terminal from ONE helper run, joined to the process
 * table for command lines. The helper itself is measured in research.md R12; here it is a runner the
 * test scripts.
 */
const row = (pid: number, ppid: number, commandLine: string): ChildProcess => ({ pid, ppid, commandLine, startedAt: pid });
const TABLE = new Map([
  [10, row(10, 1, 'bash.exe')],
  [11, row(11, 99, 'sh.exe docker run x')],
  [20, row(20, 1, 'cmd.exe')],
]);
const table = async () => TABLE;

describe('051 — readAttachedProcesses', () => {
  it('asks once for every shell and joins each pid to its row', async () => {
    const run = vi.fn(async (_pids: readonly number[]) => JSON.stringify({ 10: [10, 11], 20: [20] }));
    const result = await readAttachedProcesses([10, 20], run, table);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith([10, 20]);
    expect(result.get(10)!.map((p) => p.pid)).toEqual([10, 11]);
    expect(result.get(20)!.map((p) => p.pid)).toEqual([20]);
  });

  it('a shell the helper could not attach to is absent — unknown, not empty', async () => {
    const result = await readAttachedProcesses([10, 20], async () => JSON.stringify({ 10: [10], 20: null }), table);
    expect(result.has(10)).toBe(true);
    expect(result.has(20)).toBe(false);
  });

  it('a pid the table no longer holds has exited in between and is left out', async () => {
    const result = await readAttachedProcesses([10], async () => JSON.stringify({ 10: [10, 77] }), table);
    expect(result.get(10)!.map((p) => p.pid)).toEqual([10]);
  });

  it('rejects on a failed helper or unreadable answer — unknown is never "nothing attached" (FR-042)', async () => {
    await expect(readAttachedProcesses([10], () => Promise.reject(new Error('spawn')), table)).rejects.toThrow('spawn');
    await expect(readAttachedProcesses([10], async () => 'not json', table)).rejects.toThrow();
  });

  it('the helper leaves its own pid out of what it reports (FR-043)', () => {
    expect(ATTACHED_HELPER_SOURCE).toContain('p !== process.pid');
  });
});
