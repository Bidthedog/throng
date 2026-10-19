import { performance } from 'node:perf_hooks';
import type { IProcessMetrics, ProcessReading, ProcessSnapshot } from '@throng/core';
import { FakeProcessMetrics } from '@throng/core/testing';
import { WindowsGpuCounters, WindowsProcessMetrics } from '@throng/platform-windows';

/**
 * The collector's one composition root (Principle IX). `THRONG_COLLECTOR_FAKE=1` — set only by the
 * collector's integration test — swaps the OS for a fake the test drives over the IPC channel with
 * `test:*` messages, so cadence and liveness can be proven with deterministic figures.
 */
export interface CollectorComposition {
  readonly metrics: IProcessMetrics;
  /** Test-only messages; undefined in production, where they are ignored. */
  readonly onTestMessage?: (msg: { type: string; [k: string]: unknown }) => void;
}

class TestDrivenMetrics extends FakeProcessMetrics {
  delayMs = 0;
  override async snapshot(): Promise<ProcessSnapshot> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    this.wallTimeMs = performance.now();
    return super.snapshot();
  }
}

export function composeCollector(env: NodeJS.ProcessEnv): CollectorComposition {
  if (env.THRONG_COLLECTOR_FAKE !== '1') {
    return { metrics: new WindowsProcessMetrics(new WindowsGpuCounters()) };
  }
  const fake = new TestDrivenMetrics();
  return {
    metrics: fake,
    onTestMessage: (msg) => {
      if (msg.type === 'test:readings') fake.readings = (msg.readings as ProcessReading[]).map((r) => ({ ...r }));
      else if (msg.type === 'test:failNext') fake.failNextSnapshot = new Error('readFailed');
      else if (msg.type === 'test:delayMs') fake.delayMs = Number(msg.ms);
    },
  };
}
