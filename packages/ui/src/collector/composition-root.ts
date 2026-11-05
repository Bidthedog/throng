import type { IProcessMetrics } from '@throng/core';
import { startPlatform } from '@throng/platform';

/**
 * The collector's one composition root (Principle IX). `THRONG_COLLECTOR_FAKE=1` — set only by the
 * collector's integration test — swaps the OS for a fake. The import is dynamic so test code stays out of an
 * installed app's static import graph (#542; `production-import-graph.test.ts`).
 */
export interface CollectorComposition {
  readonly metrics: IProcessMetrics;
  /** Test-only messages; undefined in production, where they are ignored. */
  readonly onTestMessage?: (msg: { type: string; [k: string]: unknown }) => void;
}

export async function composeCollector(env: NodeJS.ProcessEnv): Promise<CollectorComposition> {
  if (env.THRONG_COLLECTOR_FAKE !== '1') {
    return { metrics: startPlatform().processMetrics() };
  }
  const { composeFakeCollector } = await import('./fake-composition.js');
  return composeFakeCollector();
}
