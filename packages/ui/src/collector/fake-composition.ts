import { performance } from 'node:perf_hooks';
import type { ProcessReading, ProcessSnapshot } from '@throng/core';
import { FakeProcessMetrics } from '@throng/core/testing';
import type { CollectorComposition } from './composition-root.js';

/**
 * The fake OS the collector's integration test drives over the IPC channel with `test:*` messages, so cadence
 * and liveness can be proven with deterministic figures.
 *
 * Loaded only by `composition-root.ts`'s dynamic import: `@throng/core/testing` imports `vitest`, which an
 * installed app does not have (#542).
 */
class TestDrivenMetrics extends FakeProcessMetrics {
  delayMs = 0;
  override async snapshot(): Promise<ProcessSnapshot> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    this.wallTimeMs = performance.now();
    return super.snapshot();
  }
}

export function composeFakeCollector(): CollectorComposition {
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
