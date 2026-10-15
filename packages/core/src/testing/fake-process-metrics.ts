import type {
  IProcessMetrics,
  ProcessDescription,
  ProcessSnapshot,
  TerminateResult,
} from '../abstractions/process-metrics.js';
import type { MachineInfo, ProcessReading, Unavailable } from '../resources/types.js';

/**
 * An in-memory `IProcessMetrics` for tests (055 T019). Tests edit `readings` between ticks; a
 * terminate removes the matching reading and is recorded in `terminated`.
 */
export class FakeProcessMetrics implements IProcessMetrics {
  readings: ProcessReading[];
  wallTimeMs = 0;
  gpuReading: ReadonlyMap<number, number> | Unavailable = { kind: 'unavailable', reason: 'No GPU counters in the fake' };
  descriptions = new Map<string, ProcessDescription>();
  readonly terminated: { pid: number; createTime: number }[] = [];
  /** Set to make the next snapshot reject, once. */
  failNextSnapshot: Error | null = null;
  /** Set to make the next snapshot never settle, once — a hung OS call. */
  hangNextSnapshot = false;
  /** Pids whose terminate is refused. */
  readonly protectedPids = new Set<number>();

  constructor(
    readings: ProcessReading[] = [],
    private readonly machineInfo: MachineInfo = { logicalProcessors: 4, installedRamBytes: 16 * 1024 ** 3 },
  ) {
    this.readings = readings;
  }

  async snapshot(): Promise<ProcessSnapshot> {
    if (this.failNextSnapshot !== null) {
      const e = this.failNextSnapshot;
      this.failNextSnapshot = null;
      throw e;
    }
    if (this.hangNextSnapshot) {
      this.hangNextSnapshot = false;
      return new Promise<ProcessSnapshot>(() => {});
    }
    return { readings: this.readings.map((r) => ({ ...r })), wallTimeMs: this.wallTimeMs };
  }

  async gpu(): Promise<ReadonlyMap<number, number> | Unavailable> {
    return this.gpuReading;
  }

  async describe(pid: number, createTime: number): Promise<ProcessDescription | Unavailable> {
    const live = this.readings.some((r) => r.pid === pid && r.createTime === createTime);
    if (!live) return { kind: 'unavailable', reason: 'The process has ended' };
    return this.descriptions.get(`${pid}:${createTime}`) ?? {};
  }

  async terminate(pid: number, createTime: number): Promise<TerminateResult> {
    const i = this.readings.findIndex((r) => r.pid === pid && r.createTime === createTime);
    if (i < 0) return { outcome: 'gone' };
    if (this.protectedPids.has(pid)) return { outcome: 'denied', cause: 'accessDenied' };
    this.readings.splice(i, 1);
    this.terminated.push({ pid, createTime });
    return { outcome: 'ended' };
  }

  machine(): MachineInfo {
    return this.machineInfo;
  }
}
