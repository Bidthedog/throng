import {
  METRIC_NAMES,
  type MachineInfo,
  type MetricName,
  type MetricValue,
  type Metrics,
  type NotMeasured,
  type ProcessReading,
  type Unavailable,
} from './types.js';

export const NOT_MEASURED: NotMeasured = Object.freeze({ kind: 'notMeasured' });

export function unavailable(reason: string): Unavailable {
  return { kind: 'unavailable', reason };
}

export function isUnavailable(v: MetricValue): v is Unavailable {
  return typeof v === 'object' && v.kind === 'unavailable';
}

export function isNotMeasured(v: MetricValue): v is NotMeasured {
  return typeof v === 'object' && v.kind === 'notMeasured';
}

/** All-zero figures, for nodes that are UI elements rather than processes. */
export const ZERO_METRICS: Metrics = Object.freeze({ cpu: 0, memory: 0, gpu: 0, ioRead: 0, ioWrite: 0, network: 0 });

/** 100-ns ticks per millisecond. */
const TICKS_PER_MS = 10_000;

export interface ProcessMetricsInput {
  /** The same process's previous reading, if any. A different create time counts as none. */
  readonly prev: ProcessReading | undefined;
  readonly cur: ProcessReading;
  /** Wall time between the two readings. */
  readonly elapsedMs: number;
  readonly machine: MachineInfo;
  /** The platform's GPU figure for this process; unavailable where the platform has none. */
  readonly gpu?: MetricValue;
  /** The platform's network rate for this process (FR-113); unavailable unless elevated. */
  readonly network?: MetricValue;
}

/**
 * One process's figures from two consecutive readings (FR-030, FR-031): CPU as a share of the whole
 * machine over the interval, I/O as bytes per second over it, memory as the current private working
 * set. A first sighting has no rate.
 */
export function processMetrics({ prev, cur, elapsedMs, machine, gpu, network }: ProcessMetricsInput): Metrics {
  const comparable = prev !== undefined && prev.pid === cur.pid && prev.createTime === cur.createTime && elapsedMs > 0;
  const rate = (delta: number, perMs: (d: number) => number): MetricValue =>
    comparable ? Math.max(0, perMs(delta)) : NOT_MEASURED;
  return {
    cpu: rate(cur.cpuTime - (prev?.cpuTime ?? 0), (d) => ((d / TICKS_PER_MS) / (elapsedMs * machine.logicalProcessors)) * 100),
    memory: cur.privateWorkingSet,
    gpu: gpu ?? NOT_MEASURED,
    ioRead: rate(cur.ioReadBytes - (prev?.ioReadBytes ?? 0), (d) => (d / elapsedMs) * 1_000),
    ioWrite: rate(cur.ioWriteBytes - (prev?.ioWriteBytes ?? 0), (d) => (d / elapsedMs) * 1_000),
    network: network ?? NOT_MEASURED,
  };
}

/**
 * `own` plus every child's (already rolled) figures (FR-022). Numbers add. An unavailable part adds
 * nothing and marks the total partial with its reason — the total is never presented as complete,
 * nor as zero (FR-044). A not-measured part adds nothing and marks nothing: it was never part of
 * what the operating system reports.
 */
export function rollUp(own: Metrics, children: readonly Metrics[]): Metrics {
  const parts = [own, ...children];
  const out: Record<string, MetricValue> = {};
  const partial: Partial<Record<MetricName, string>> = {};
  for (const name of METRIC_NAMES) {
    let sum: number | undefined;
    let missing: Unavailable | undefined;
    for (const part of parts) {
      const v = part[name];
      if (typeof v === 'number') sum = (sum ?? 0) + v;
      else if (isUnavailable(v)) missing ??= v;
      const carried = part.partial?.[name];
      if (carried !== undefined) partial[name] ??= carried;
    }
    if (sum !== undefined) {
      out[name] = sum;
      if (missing !== undefined) partial[name] ??= missing.reason;
    } else {
      out[name] = missing ?? NOT_MEASURED;
    }
  }
  const result = out as Record<MetricName, MetricValue>;
  return Object.keys(partial).length > 0 ? { ...result, partial } : result;
}
