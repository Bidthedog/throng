import { describe, it, expect } from 'vitest';
import { gpuByPid, WindowsGpuCounters, type GpuCountersFfi } from '../../src/windows-gpu-counters.js';

const item = (pid: number, eng: number, type: string, value: number) => ({
  name: `pid_${pid}_luid_0x00000000_0x000147A9_phys_0_eng_${eng}_engtype_${type}`,
  value,
});

/** A PDH stand-in: `collect` and the sizing probe answer as scripted. */
function pdh(collect: number, probe: { status: number; size: number; count: number }): GpuCountersFfi {
  return {
    openQuery: async (q) => ((q[0] = 'q'), 0),
    addCounter: async (_q, _p, c) => ((c[0] = 'c'), 0),
    collect: async () => collect,
    formattedArray: async (_c, size, count) => ((size[0] = probe.size), (count[0] = probe.count), probe.status),
    addressOf: () => 0n,
  };
}

describe('WindowsGpuCounters — a failed read is unavailable, never zero (055 FR-011, convergence T100)', () => {
  it('reports unavailable when the counters cannot be collected', async () => {
    const r = await new WindowsGpuCounters(pdh(1, { status: 0, size: 0, count: 0 })).read();
    expect(r).toMatchObject({ kind: 'unavailable' });
  });

  it('reports unavailable when the sizing probe fails', async () => {
    const r = await new WindowsGpuCounters(pdh(0, { status: 0xc0000bba, size: 0, count: 0 })).read();
    expect(r).toMatchObject({ kind: 'unavailable' });
  });

  it('reports an empty table — nothing on a GPU engine — as no usage, not unavailable', async () => {
    const r = await new WindowsGpuCounters(pdh(0, { status: 0, size: 0, count: 0 })).read();
    expect(r).toEqual(new Map());
  });
});

describe('gpuByPid (055 R4)', () => {
  it("takes a process's LARGEST per-engine-type sum, as Task Manager does", () => {
    const m = gpuByPid([item(7, 0, '3D', 10), item(7, 1, '3D', 5), item(7, 2, 'Copy', 12), item(9, 0, 'VideoDecode', 3)]);
    expect(m.get(7)).toBe(15);
    expect(m.get(9)).toBe(3);
  });

  it('ignores names it cannot read, and never exceeds 100', () => {
    const m = gpuByPid([{ name: '_Total', value: 50 }, item(4, 0, '3D', 80), item(4, 1, '3D', 70)]);
    expect([...m.keys()]).toEqual([4]);
    expect(m.get(4)).toBe(100);
  });
});
