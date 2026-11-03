import { describe, expect, it } from 'vitest';
import { RelevantProcesses } from '../../src/relevant-processes.js';
import type { ProcRow } from '../../src/proc-table.js';

const ME = 1000;
const ROOT = 0;

interface Fake {
  pid: number;
  ppid: number;
  uid: number;
}

function machine(start: Fake[]) {
  let procs = start;
  const reads: number[] = [];
  const scope = new RelevantProcesses({
    uid: ME,
    listPids: () => procs.map((p) => p.pid),
    readRow: (pid) => {
      reads.push(pid);
      const p = procs.find((x) => x.pid === pid);
      return p ? ({ pid: p.pid, ppid: p.ppid } as ProcRow) : null;
    },
    ownerOf: (pid) => procs.find((x) => x.pid === pid)?.uid ?? null,
  });
  return {
    tick: () => {
      reads.length = 0;
      return { pids: scope.read().map((r) => r.pid).sort((a, b) => a - b), reads: [...reads].sort((a, b) => a - b) };
    },
    set: (next: Fake[]) => (procs = next),
  };
}

const INIT = { pid: 1, ppid: 0, uid: ROOT };
const DAEMON = { pid: 50, ppid: 1, uid: ROOT };
const SESSION = { pid: 100, ppid: 1, uid: ME };
const SHELL = { pid: 200, ppid: 100, uid: ME };

describe('which processes a Linux collector reads (055 SC-004)', () => {
  it('reads another user\'s daemon once, then leaves it out', () => {
    const m = machine([INIT, DAEMON, SESSION, SHELL]);
    expect(m.tick().reads).toEqual([1, 50, 100, 200]);
    expect(m.tick()).toEqual({ pids: [100, 200], reads: [100, 200] });
  });

  it('keeps a sudo the user started, and what runs under it', () => {
    const sudo = { pid: 300, ppid: 200, uid: ROOT };
    const apt = { pid: 301, ppid: 300, uid: ROOT };
    const m = machine([INIT, SESSION, SHELL, sudo, apt]);
    m.tick();
    expect(m.tick().pids).toEqual([100, 200, 300, 301]);
  });

  it('keeps a child whose parent appears later in the listing', () => {
    const sudo = { pid: 900, ppid: 200, uid: ROOT };
    const child = { pid: 400, ppid: 900, uid: ROOT };
    const m = machine([child, INIT, SESSION, SHELL, sudo]);
    expect(m.tick().pids).toEqual([100, 200, 400, 900]);
  });

  it('looks again at a pid that went away and came back as the user\'s', () => {
    const m = machine([INIT, DAEMON, SESSION]);
    m.tick();
    m.set([INIT, SESSION]);
    m.tick();
    m.set([INIT, SESSION, { pid: 50, ppid: 100, uid: ME }]);
    expect(m.tick().pids).toContain(50);
  });

  it('survives a process that vanishes mid-read and a parent loop', () => {
    const a = { pid: 70, ppid: 71, uid: ROOT };
    const b = { pid: 71, ppid: 70, uid: ROOT };
    const m = machine([INIT, a, b, SESSION]);
    expect(m.tick().pids).toEqual([100]);
  });
});
