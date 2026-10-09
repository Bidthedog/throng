import { describe, expect, it } from 'vitest';
import { assignConhosts, CONHOST_CLOCK_TOLERANCE_MS } from '../../src/terminal/conhost-assignment.js';

/**
 * 051 R5 — which per-terminal console host is whose, now that attribution runs on an async snapshot.
 * Hosts are created during their terminal's synchronous spawn, so they are created in spawn order and
 * none is older than its session's spawn time.
 */
const host = (pid: number, createdAt: number) => ({ pid, createdAt });
const pending = (seq: number, spawnedAt: number) => ({ seq, spawnedAt });

describe('051 R5 — assignConhosts', () => {
  it('gives the only free host to the only pending session', () => {
    expect(assignConhosts([pending(0, 1000)], [host(100, 1001)], new Set())).toEqual(new Map([[0, 100]]));
  });

  it('skips hosts already claimed, or being reaped', () => {
    expect(assignConhosts([pending(3, 1000)], [host(100, 1001), host(200, 1002)], new Set([100]))).toEqual(
      new Map([[3, 200]]),
    );
  });

  it('never gives a pending session an orphan created before it spawned', () => {
    expect(assignConhosts([pending(7, 5000)], [host(50, 1000), host(300, 5002)], new Set())).toEqual(
      new Map([[7, 300]]),
    );
  });

  it('pairs oldest-first, so a terminal spawned during the read never takes an earlier one its host', () => {
    // The defect: seq 1 was pending when the read began; seq 2 spawned during it and its host is in
    // the table too. Newest-first gave seq 1 host 20 — and ending terminal 1 then ended terminal 2.
    const both = [pending(1, 1000), pending(2, 1100)];
    expect(assignConhosts(both, [host(10, 1001), host(20, 1101)], new Set())).toEqual(
      new Map([
        [1, 10],
        [2, 20],
      ]),
    );
  });

  it('leaves the later pending sessions for a later pass when their hosts are not in the table yet', () => {
    expect(assignConhosts([pending(2, 1100), pending(1, 1000)], [host(10, 1001)], new Set())).toEqual(
      new Map([[1, 10]]),
    );
  });

  it('accepts a host reading slightly before the recorded spawn time — the two clocks round apart', () => {
    expect(
      assignConhosts([pending(0, 1000)], [host(9, 1000 - CONHOST_CLOCK_TOLERANCE_MS + 1)], new Set()),
    ).toEqual(new Map([[0, 9]]));
  });

  it('assigns nothing when nothing is pending', () => {
    expect(assignConhosts([], [host(1, 1), host(2, 2)], new Set())).toEqual(new Map());
  });
});
