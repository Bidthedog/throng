import { bandFor, type UsageThresholds } from './bands.js';
import type { MachineInfo, MetricValue, Metrics } from './types.js';

export const IDLE_CPU_PERCENT = 0.1;
export const IDLE_SAMPLES = 3;

const quiet = (v: MetricValue, below: number): boolean => typeof v !== 'number' || v < below;

/**
 * FR-061a: own CPU under 0.1% and own I/O and network zero in each of the last 3 samples (fewer while
 * fewer exist). A process at or above the memory warning threshold is never idle. `ownHistory` is oldest
 * first; a figure with no number yet (a first sighting) counts as quiet.
 */
export function isIdle(
  ownHistory: readonly Metrics[],
  thresholds: UsageThresholds,
  machine: Pick<MachineInfo, 'installedRamBytes'>,
): boolean {
  if (ownHistory.length === 0) return false;
  const latest = ownHistory[ownHistory.length - 1]!;
  const band = bandFor('memory', latest.memory, thresholds, machine);
  if (band !== undefined && band !== 'normal') return false;
  return ownHistory
    .slice(-IDLE_SAMPLES)
    .every(
      (m) =>
        quiet(m.cpu, IDLE_CPU_PERCENT) &&
        quiet(m.ioRead, Number.MIN_VALUE) &&
        quiet(m.ioWrite, Number.MIN_VALUE) &&
        quiet(m.network, Number.MIN_VALUE),
    );
}
