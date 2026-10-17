import { describe, it, expect } from 'vitest';
import {
  NOT_MEASURED,
  processKey,
  processMetrics,
  rollUp,
  unavailable,
  type Metrics,
  type ProcessReading,
} from '../../../src/resources/index.js';

const reading = (over: Partial<ProcessReading> = {}): ProcessReading => ({
  pid: 10,
  ppid: 1,
  createTime: 500,
  imageName: 'node.exe',
  cpuTime: 0,
  privateWorkingSet: 1_000,
  ioReadBytes: 0,
  ioWriteBytes: 0,
  ...over,
});

const machine = { logicalProcessors: 4, installedRamBytes: 16 * 1024 ** 3 };

const metrics = (over: Partial<Metrics> = {}): Metrics => ({
  cpu: 0,
  memory: 0,
  gpu: 0,
  ioRead: 0,
  ioWrite: 0,
  ...over,
});

describe('processMetrics (055 FR-030, FR-031)', () => {
  it('reports CPU as a share of the WHOLE machine over the interval, not of one core', () => {
    // One full core for 2 s on a 4-processor machine is 25% of the machine.
    const prev = reading({ cpuTime: 0 });
    const cur = reading({ cpuTime: 2_000 * 10_000 }); // 2,000 ms of CPU in 100-ns ticks
    const m = processMetrics({ prev, cur, elapsedMs: 2_000, machine });
    expect(m.cpu).toBeCloseTo(25, 5);
  });

  it('reports I/O as bytes per second averaged over the interval', () => {
    const prev = reading({ ioReadBytes: 1_000, ioWriteBytes: 0 });
    const cur = reading({ ioReadBytes: 5_000, ioWriteBytes: 8_000 });
    const m = processMetrics({ prev, cur, elapsedMs: 2_000, machine });
    expect(m.ioRead).toBe(2_000);
    expect(m.ioWrite).toBe(4_000);
  });

  it('takes memory as the private working set of the current reading', () => {
    const m = processMetrics({ prev: undefined, cur: reading({ privateWorkingSet: 42 }), elapsedMs: 2_000, machine });
    expect(m.memory).toBe(42);
  });

  it('has no rate on a first sighting — two readings are needed — so CPU and I/O are not measured yet', () => {
    const m = processMetrics({ prev: undefined, cur: reading(), elapsedMs: 2_000, machine });
    expect(m.cpu).toBe(NOT_MEASURED);
    expect(m.ioRead).toBe(NOT_MEASURED);
    expect(m.ioWrite).toBe(NOT_MEASURED);
  });

  it('treats a previous reading of a DIFFERENT process (a reused pid) as no previous reading', () => {
    const prev = reading({ createTime: 1, cpuTime: 0 });
    const cur = reading({ createTime: 2, cpuTime: 9_999_999 });
    expect(processMetrics({ prev, cur, elapsedMs: 2_000, machine }).cpu).toBe(NOT_MEASURED);
  });

  it('never reports a negative rate', () => {
    const prev = reading({ cpuTime: 100, ioReadBytes: 100 });
    const cur = reading({ cpuTime: 50, ioReadBytes: 10 });
    const m = processMetrics({ prev, cur, elapsedMs: 2_000, machine });
    expect(m.cpu).toBe(0);
    expect(m.ioRead).toBe(0);
  });

  it('takes GPU as given, unavailable when the platform has none', () => {
    const none = unavailable('No GPU counters on this machine');
    expect(processMetrics({ prev: undefined, cur: reading(), elapsedMs: 2_000, machine, gpu: none }).gpu).toEqual(none);
    expect(processMetrics({ prev: undefined, cur: reading(), elapsedMs: 2_000, machine, gpu: 7 }).gpu).toBe(7);
  });

  it('keys a process by pid AND create time', () => {
    expect(processKey(10, 500)).toBe('10:500');
    expect(processKey(10, 500)).not.toBe(processKey(10, 501));
  });
});

describe('rollUp (055 FR-022, FR-044, SC-006)', () => {
  it('adds numbers: own plus every child', () => {
    const r = rollUp(metrics({ cpu: 1, memory: 10 }), [metrics({ cpu: 2, memory: 20 }), metrics({ cpu: 3, memory: 30 })]);
    expect(r.cpu).toBe(6);
    expect(r.memory).toBe(60);
    expect(r.partial).toBeUndefined();
  });

  it('lets an UNAVAILABLE child contribute nothing, and marks the total partial with the reason — never zero', () => {
    const reason = 'Access denied: elevated process';
    const r = rollUp(metrics({ memory: 10 }), [metrics({ memory: unavailable(reason) })]);
    expect(r.memory).toBe(10);
    expect(r.partial?.memory).toBe(reason);
  });

  it('lets a NOT MEASURED child contribute nothing without marking the total partial', () => {
    const r = rollUp(metrics({ cpu: 4 }), [metrics({ cpu: NOT_MEASURED })]);
    expect(r.cpu).toBe(4);
    expect(r.partial).toBeUndefined();
  });

  it('is unavailable — not zero — when nothing in the subtree could be read', () => {
    const r = rollUp(metrics({ gpu: unavailable('No GPU counters') }), [metrics({ gpu: unavailable('No GPU counters') })]);
    expect(r.gpu).toEqual(unavailable('No GPU counters'));
  });

  it('is not measured when nothing in the subtree was measured', () => {
    const r = rollUp(metrics({ cpu: NOT_MEASURED }), []);
    expect(r.cpu).toBe(NOT_MEASURED);
  });

  it('carries a child total that was itself partial up as partial', () => {
    const child = rollUp(metrics({ memory: 5 }), [metrics({ memory: unavailable('denied') })]);
    const r = rollUp(metrics({ memory: 1 }), [child]);
    expect(r.memory).toBe(6);
    expect(r.partial?.memory).toBe('denied');
  });
});
