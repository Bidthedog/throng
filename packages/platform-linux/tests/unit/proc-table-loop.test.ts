import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A keystroke reaches the shell through the daemon's event loop, and the command poll reads every process on the
 * machine once a second. Started all at once, those reads held the loop long enough to delay typing (061 SC-002).
 */
const PROCESSES = 578;
const MOST_READS_IN_ONE_TURN = 32;

const fs = vi.hoisted(() => ({ started: 0 }));

vi.mock('node:child_process', () => ({
  execFile: (_file: string, _args: string[], _options: unknown, done: (e: null, out: string, err: string) => void) => {
    done(null, '100', '');
  },
}));

vi.mock('node:fs/promises', () => ({
  readdir: () => Promise.resolve(['self', ...Array.from({ length: PROCESSES }, (_, i) => String(i + 1))]),
  readlink: () => Promise.resolve(''),
  readFile: (path: string) => {
    if (path === '/proc/stat') return Promise.resolve('btime 1000\n');
    fs.started += 1;
    const pid = /\/proc\/(\d+)\/stat/.exec(path)?.[1] ?? '0';
    return Promise.resolve(`${pid} (sh) S 1 ${pid} ${pid} ${'0 '.repeat(40)}0`);
  },
}));

const { readProcTable } = await import('../../src/proc-table.js');

const nextLoopTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('reading the process table', () => {
  beforeEach(() => {
    fs.started = 0;
  });

  it('lets the event loop run while it reads', async () => {
    let finished = false;
    const table = readProcTable().finally(() => {
      finished = true;
    });
    const startedPerTurn: number[] = [];
    let seen = 0;
    while (!finished) {
      await nextLoopTurn();
      startedPerTurn.push(fs.started - seen);
      seen = fs.started;
    }
    await table;
    expect(Math.max(...startedPerTurn)).toBeLessThanOrEqual(MOST_READS_IN_ONE_TURN);
  });

  it('still reads every process', async () => {
    const rows = await readProcTable();
    expect(rows.map((row) => row.pid)).toEqual(Array.from({ length: PROCESSES }, (_, i) => i + 1));
  });
});
