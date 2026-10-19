import { describe, it, expect } from 'vitest';
import { FakeProcessMetrics, runProcessMetricsContract } from '../../../src/testing/index.js';

const self = { pid: 42, ppid: 1, createTime: 7, imageName: 'node.exe', cpuTime: 0, privateWorkingSet: 1, ioReadBytes: 0, ioWriteBytes: 0 };

describe('IProcessMetrics contract against the fake (055 T018, FR-010, FR-011)', () => {
  it('satisfies the shared contract', async () => {
    await runProcessMetricsContract({ make: () => new FakeProcessMetrics([{ ...self }]), selfPid: 42 });
  });

  it('ends a process by identity, and reports a protected one as denied', async () => {
    const m = new FakeProcessMetrics([{ ...self }, { ...self, pid: 43 }]);
    m.protectedPids.add(43);
    expect(await m.terminate(42, 7)).toEqual({ outcome: 'ended' });
    expect(await m.terminate(42, 7)).toEqual({ outcome: 'gone' });
    expect((await m.terminate(43, 7)).outcome).toBe('denied');
  });

  it('rejects the contract for an implementation that ends a stale identity', async () => {
    const make = () => {
      const m = new FakeProcessMetrics([{ ...self }]);
      m.terminate = async () => ({ outcome: 'ended' });
      return m;
    };
    await expect(runProcessMetricsContract({ make, selfPid: 42 })).rejects.toThrow(/stale create time/);
  });
});
