import { describe, it } from 'vitest';
import { runProcessMetricsContract, skipUnlessMacos } from '@throng/core/testing';
import { MacosProcessMetrics } from '../../src/macos-process-metrics.js';

/** Layer: contract. The shared process-metrics suite (055 T018) against the real libproc (070 FR-012, FR-032). */
describe.skipIf(skipUnlessMacos('reads libproc and proc_pid_rusage'))('MacosProcessMetrics meets the shared contract', () => {
  it('sees this process with a start time and memory, and refuses a stale identity', { timeout: 20_000 }, async () => {
    await runProcessMetricsContract({ make: () => new MacosProcessMetrics(), selfPid: process.pid });
  });
});
