import type { IProcessMetrics } from '../abstractions/process-metrics.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`IProcessMetrics contract violation: ${message}`);
}

const isUnavailable = (v: unknown): v is { kind: 'unavailable'; reason: string } =>
  typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'unavailable';

export interface ProcessMetricsContractEnv {
  make(): IProcessMetrics;
  /** A pid the implementation must see in its snapshot — the test's own process, for a real one. */
  readonly selfPid: number;
}

/**
 * Reusable contract for any `IProcessMetrics` (055 T018). Throws on the first violation.
 */
export async function runProcessMetricsContract(env: ProcessMetricsContractEnv): Promise<void> {
  const m = env.make();

  const machine = m.machine();
  assert(machine.logicalProcessors >= 1, 'machine() must report at least one logical processor');
  assert(machine.installedRamBytes > 0, 'machine() must report installed RAM');

  const snap = await m.snapshot();
  const self = snap.readings.find((r) => r.pid === env.selfPid);
  assert(self !== undefined, `snapshot must contain pid ${env.selfPid}`);
  assert(self.createTime > 0, 'a reading must carry its create time');
  assert(self.privateWorkingSet > 0, 'a live process must report a private working set');
  assert(Number.isFinite(snap.wallTimeMs), 'a snapshot must carry its wall time');

  const later = await m.snapshot();
  assert(later.wallTimeMs >= snap.wallTimeMs, 'wall time must not run backwards');

  const unknown = await m.describe(0x7ffffff0, 1);
  assert(isUnavailable(unknown) && unknown.reason.length > 0, 'describe of an unknown process must be Unavailable with a reason');

  const reused = await m.terminate(self.pid, self.createTime + 1);
  assert(reused.outcome === 'gone', `terminate with a stale create time must be 'gone'; got '${reused.outcome}'`);
  const still = await m.snapshot();
  assert(still.readings.some((r) => r.pid === self.pid), 'terminate with a stale create time must not end the process');

  const gpu = await m.gpu();
  assert(gpu instanceof Map || (isUnavailable(gpu) && gpu.reason.length > 0), 'gpu() must be a map or Unavailable with a reason');
}
