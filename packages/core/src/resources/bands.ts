import type { MachineInfo, MetricName, MetricValue } from './types.js';

export type UsageBand = 'normal' | 'warning' | 'critical';

/** The four `resourceMonitor.*Percent` settings, already resolved (warning below critical). */
export interface UsageThresholds {
  readonly cpuWarning: number;
  readonly cpuCritical: number;
  readonly memoryWarning: number;
  readonly memoryCritical: number;
}

/**
 * The usage band of a figure (FR-046): CPU on its share of the machine, memory on its share of
 * installed RAM. Only CPU and memory are banded, and only a number has a band.
 */
export function bandFor(
  metric: MetricName,
  value: MetricValue,
  thresholds: UsageThresholds,
  machine: Pick<MachineInfo, 'installedRamBytes'>,
): UsageBand | undefined {
  if (typeof value !== 'number') return undefined;
  let percent: number;
  let warning: number;
  let critical: number;
  if (metric === 'cpu') {
    percent = value;
    warning = thresholds.cpuWarning;
    critical = thresholds.cpuCritical;
  } else if (metric === 'memory') {
    if (machine.installedRamBytes <= 0) return undefined;
    percent = (value / machine.installedRamBytes) * 100;
    warning = thresholds.memoryWarning;
    critical = thresholds.memoryCritical;
  } else {
    return undefined;
  }
  if (percent >= critical) return 'critical';
  if (percent >= warning) return 'warning';
  return 'normal';
}
