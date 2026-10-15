/**
 * Layer: integration — the GPU figures come from Windows' own performance counters; only the real
 * PDH can show the reader agrees with an independent query of the same counter (055 FR-012, T022).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { WindowsGpuCounters, gpuByPid, parseItems } from '../../src/windows-gpu-counters.js';

const require = createRequire(import.meta.url);
const koffi = require('koffi');
const pdh = koffi.load('pdh.dll');
const PdhOpenQueryW = pdh.func('PdhOpenQueryW', 'uint32', ['void *', 'uintptr_t', '_Out_ void **']);
const PdhAddEnglishCounterW = pdh.func('PdhAddEnglishCounterW', 'uint32', ['void *', 'str16', 'uintptr_t', '_Out_ void **']);
const PdhCollectQueryData = pdh.func('PdhCollectQueryData', 'uint32', ['void *']);
const PdhGetFormattedCounterArrayW = pdh.func('PdhGetFormattedCounterArrayW', 'uint32', ['void *', 'uint32', '_Inout_ uint32 *', '_Out_ uint32 *', 'void *']);

/** A second, independent query of the same counter, read synchronously. */
function independentQuery(): { collect: () => void; read: () => Map<number, number> } | null {
  const q = [null];
  const c = [null];
  if (PdhOpenQueryW(null, 0, q) !== 0 || PdhAddEnglishCounterW(q[0], '\\GPU Engine(*)\\Utilization Percentage', 0, c) !== 0) return null;
  return {
    collect: () => PdhCollectQueryData(q[0]),
    read: () => {
      const size = [0];
      const count = [0];
      PdhGetFormattedCounterArrayW(c[0], 0x200, size, count, null);
      const buf = Buffer.alloc(size[0]!);
      PdhGetFormattedCounterArrayW(c[0], 0x200, size, count, buf);
      return gpuByPid(parseItems(buf, count[0]!, koffi.address(buf)));
    },
  };
}

describe('WindowsGpuCounters (055 T022, R4)', () => {
  it('returns a pid → percent map, or Unavailable with a reason', async () => {
    const r = await new WindowsGpuCounters().read();
    if (r instanceof Map) {
      for (const [pid, pct] of r) {
        expect(pid).toBeGreaterThan(0);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    } else {
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('agrees with an independent query of the same counter, over the same window, within 2 points', async () => {
    const ours = new WindowsGpuCounters();
    const theirs = independentQuery();
    if (theirs === null) return; // a runner with no GPU engine counters: the first test covers it
    await ours.read();
    theirs.collect();
    await new Promise((r) => setTimeout(r, 1_000));
    const a = await ours.read();
    theirs.collect();
    const b = theirs.read();
    expect(a).toBeInstanceOf(Map);
    for (const [pid, pct] of b) {
      expect(Math.abs(((a as Map<number, number>).get(pid) ?? 0) - pct), `pid ${pid}`).toBeLessThan(2);
    }
  });
});
