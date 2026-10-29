/**
 * The status-bar popover's data (055 FR-115, data-model *status-bar history ring*): a bounded ring of the
 * summary's totals — one point per capture since the main window opened, capped at the monitor graphs'
 * point count — and the arithmetic that puts them on a scale.
 *
 * CPU, Memory and GPU plot as a percentage of the machine (every logical processor, installed RAM, the GPU,
 * as FR-094 measures them); I/O plots bytes per second on a scale fitted to the ring's own peak. A capacity
 * that is not known — no installed RAM to divide by — leaves that point's share ABSENT, not zero. Nothing
 * here touches the DOM or the session of the monitor window; the ring is not persisted.
 */
import type { MachineInfo, MetricValue } from '@throng/core';
import type { ResourceSummary } from '@throng/ipc-contract';
import { combineIo } from './format.js';
import { DEFAULT_CAPACITY } from './monitor-session.js';

/** The figures the popover graphs. */
export type PopoverFigureId = 'cpu' | 'memory' | 'gpu' | 'io';

/** One capture's totals: shares of the machine in percent, I/O in bytes per second; `undefined` is absent. */
export interface StatusPoint {
  readonly tick: number;
  readonly cpu: number | undefined;
  readonly memory: number | undefined;
  readonly gpu: number | undefined;
  readonly io: number | undefined;
}

/** A figure's share of the machine as a percentage, or `undefined` when it is not a number or has no capacity. */
export function sharePercent(
  id: 'cpu' | 'memory' | 'gpu',
  value: MetricValue,
  machine: Pick<MachineInfo, 'installedRamBytes'>,
): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (id === 'memory') return machine.installedRamBytes > 0 ? (value / machine.installedRamBytes) * 100 : undefined;
  return value;
}

/** The I/O scale: the highest rate in `values`, or 0 when there is none to fit to. */
export function ioScale(values: readonly (number | undefined)[]): number {
  let peak = 0;
  for (const v of values) if (v !== undefined && v > peak) peak = v;
  return peak;
}

/** One figure's series across `points`, absent points staying absent. */
export function seriesOf(points: readonly StatusPoint[], id: PopoverFigureId): (number | undefined)[] {
  return points.map((p) => p[id]);
}

export class StatusHistory {
  private ring: StatusPoint[] = [];
  private lastTick = -Infinity;

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  /** Take a capture. A tick already taken or older, and a stale capture (a repeat of the last reading), are ignored. */
  push(summary: ResourceSummary): void {
    if (summary.stale || summary.tick <= this.lastTick) return;
    this.lastTick = summary.tick;
    const t = summary.total;
    const m = summary.machine;
    const io = combineIo(t).value;
    this.ring.push({
      tick: summary.tick,
      cpu: sharePercent('cpu', t.cpu, m),
      memory: sharePercent('memory', t.memory, m),
      gpu: sharePercent('gpu', t.gpu, m),
      io: typeof io === 'number' ? io : undefined,
    });
    if (this.ring.length > this.capacity) this.ring.splice(0, this.ring.length - this.capacity);
  }

  /** A copy, oldest first. */
  points(): StatusPoint[] {
    return [...this.ring];
  }
}
