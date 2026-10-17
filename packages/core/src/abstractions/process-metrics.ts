/**
 * IProcessMetrics (Principle II, 055 FR-010). The OS seam the resource monitor's collector reads
 * through: one process-table reading per tick, GPU use per process, a process's command line and
 * executable, and ending a process by its identity. The Windows implementation is
 * `WindowsProcessMetrics` (`@throng/platform-windows`); another platform supplies its own. A figure
 * a platform cannot produce is `Unavailable` with a reason (FR-011), never zero.
 */
import type { MachineInfo, ProcessReading, Unavailable } from '../resources/types.js';

export interface ProcessSnapshot {
  readonly readings: readonly ProcessReading[];
  /** Monotonic wall time of the reading, in ms — rates are taken between two of these. */
  readonly wallTimeMs: number;
}

export interface ProcessDescription {
  readonly commandLine?: string;
  readonly executablePath?: string;
  /** Why the command line and path could not be read, when they could not (FR-080). */
  readonly unavailableReason?: string;
}

export type TerminateOutcome = 'ended' | 'gone' | 'denied' | 'failed';

export interface TerminateResult {
  readonly outcome: TerminateOutcome;
  /** A failure-cause code for `denied` / `failed`. */
  readonly cause?: string;
}

export interface IProcessMetrics {
  /**
   * Every process the caller's session runs — everything throng can own, since it starts nothing in
   * another session — in one call that never blocks the caller's event loop. An implementation may
   * read the whole machine instead; attribution never claims a process the roster does not lead to.
   */
  snapshot(): Promise<ProcessSnapshot>;
  /** GPU % per pid (the largest per-engine-type sum), or why it cannot be read. */
  gpu(): Promise<ReadonlyMap<number, number> | Unavailable>;
  /** Read once per identity; a process that is gone or protected is `Unavailable` with the reason. */
  describe(pid: number, createTime: number): Promise<ProcessDescription | Unavailable>;
  /**
   * End the process with this identity. A pid whose create time no longer matches is a different
   * process: it is left alone and the result is `gone` (research R8).
   */
  terminate(pid: number, createTime: number): Promise<TerminateResult>;
  machine(): MachineInfo;
}
