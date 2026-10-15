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

/** What a tile can be sized and coloured by: the four figures the monitor offers (I/O is read + write). */
export type HeatMetric = 'cpu' | 'memory' | 'gpu' | 'io';

/**
 * How much of the machine a node takes, on the scale its tile is coloured by (FR-094): 0 at nothing, 0.5
 * at the warning threshold, 1 at the critical threshold and beyond. CPU and GPU are already shares of the
 * machine (GPU takes the CPU thresholds); memory is a share of installed RAM; I/O has no machine total, so
 * it is measured against `ioPeak`, the highest rate seen, on the CPU thresholds. `undefined` when there is
 * nothing to measure — a figure that is not a number, or no RAM or peak to divide by.
 */
export function heatFor(
  metric: HeatMetric,
  value: MetricValue,
  thresholds: UsageThresholds,
  machine: Pick<MachineInfo, 'installedRamBytes'>,
  ioPeak: number,
): number | undefined {
  if (typeof value !== 'number') return undefined;
  let percent: number;
  let warning = thresholds.cpuWarning;
  let critical = thresholds.cpuCritical;
  if (metric === 'memory') {
    if (machine.installedRamBytes <= 0) return undefined;
    percent = (value / machine.installedRamBytes) * 100;
    warning = thresholds.memoryWarning;
    critical = thresholds.memoryCritical;
  } else if (metric === 'io') {
    percent = ioPeak > 0 ? (value / ioPeak) * 100 : 0;
  } else {
    percent = value;
  }
  if (percent <= 0) return 0;
  if (percent >= critical) return 1;
  if (percent <= warning) return (percent / warning) * 0.5;
  return 0.5 + ((percent - warning) / (critical - warning)) * 0.5;
}
