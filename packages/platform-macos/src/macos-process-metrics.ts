import os from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  logCaught,
  logExpected,
  type IProcessMetrics,
  type MachineInfo,
  type ProcessDescription,
  type ProcessReading,
  type ProcessSnapshot,
  type TerminateResult,
  type Unavailable,
} from '@throng/core';
import type { RelevantProcesses } from '@throng/platform-node';
import { libSystem, type LibSystem } from './libsystem.js';
import {
  isLiveMacosRow,
  readMacosCommandLine,
  readMacosExecutablePath,
  readMacosMetrics,
  readMacosProcRow,
  trySignal,
  type MacosProcRow,
} from './macos-proc-table.js';
import { macosRelevantProcesses } from './macos-relevant-processes.js';

const GRACE_MS = 1500;
const POLL_MS = 25;
/** `cpuTime` is in 100 ns units across the interface. */
const HUNDRED_NS_PER_MS = 10_000;

/** Shown to the user where a figure cannot be read (070 FR-032, R3). */
export const MACOS_GPU_UNAVAILABLE = 'macOS does not report GPU use per process.';
export const MACOS_NETWORK_UNAVAILABLE = 'macOS has no per-process network figure without administrator rights.';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface MacosProcessMetricsDeps {
  readonly lib?: LibSystem | null;
  readonly scope?: RelevantProcesses<MacosProcRow>;
}

/**
 * `IProcessMetrics` from libproc (070 FR-032, FR-034, R2, R3): CPU from task info scaled by the Mach time base,
 * memory as `ri_phys_footprint` (what Activity Monitor calls Memory), I/O from rusage. GPU and network are unavailable,
 * each with its reason. Every read is a syscall of microseconds, so a tick holds the loop no longer than Linux's.
 */
export class MacosProcessMetrics implements IProcessMetrics {
  private readonly lib: LibSystem | null;
  private scope: RelevantProcesses<MacosProcRow> | undefined;
  private machineInfo: MachineInfo | undefined;

  constructor(deps: MacosProcessMetricsDeps = {}) {
    this.lib = deps.lib === undefined ? libSystem() : deps.lib;
    this.scope = deps.scope;
  }

  async snapshot(): Promise<ProcessSnapshot> {
    this.scope ??= macosRelevantProcesses(this.lib);
    const readings: ProcessReading[] = [];
    for (const row of this.scope.read()) {
      if (!isLiveMacosRow(row)) continue;
      // Another user's process beneath this one (a `sudo` in a terminal) has no figures this user may read.
      const metrics = readMacosMetrics(row.pid, this.lib);
      if (metrics === null) continue;
      readings.push({
        pid: row.pid,
        ppid: row.ppid,
        createTime: row.startedAt,
        imageName: row.comm,
        cpuTime: Math.round(metrics.cpuMs * HUNDRED_NS_PER_MS),
        privateWorkingSet: metrics.privateBytes,
        ioReadBytes: metrics.readBytes,
        ioWriteBytes: metrics.writeBytes,
        startedAt: row.startedAt,
      });
    }
    return { readings, wallTimeMs: performance.now() };
  }

  gpu(): Promise<ReadonlyMap<number, number> | Unavailable> {
    return Promise.resolve({ kind: 'unavailable', reason: MACOS_GPU_UNAVAILABLE });
  }

  network(): Promise<ReadonlyMap<number, number> | Unavailable> {
    return Promise.resolve({ kind: 'unavailable', reason: MACOS_NETWORK_UNAVAILABLE });
  }

  async describe(pid: number, createTime: number): Promise<ProcessDescription | Unavailable> {
    const row = readMacosProcRow(pid, this.lib);
    if (row === null || row.startedAt !== createTime) return { kind: 'unavailable', reason: 'The process has ended.' };
    const commandLine = readMacosCommandLine(pid, this.lib);
    const executablePath = readMacosExecutablePath(pid, this.lib);
    if (!commandLine && !executablePath) {
      return { commandLine: undefined, executablePath: undefined, unavailableReason: 'The system would not say.' };
    }
    return { commandLine: commandLine || undefined, executablePath };
  }

  /** Politely, then not. Start time is checked first, so a reused pid is never ended. */
  async terminate(pid: number, createTime: number): Promise<TerminateResult> {
    const row = readMacosProcRow(pid, this.lib);
    if (row === null || row.startedAt !== createTime || !isLiveMacosRow(row)) return { outcome: 'gone' };
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH' || code === 'EPERM') {
        logExpected('macos-process-metrics: SIGTERM', "the process exited after its row was read, or is another user's; the caller shows the outcome", error);
      } else {
        logCaught('macos-process-metrics: SIGTERM', error);
      }
      if (code === 'ESRCH') return { outcome: 'gone' };
      if (code === 'EPERM') return { outcome: 'denied', cause: 'It belongs to another user.' };
      return { outcome: 'failed', cause: String(error) };
    }
    if (await this.endedWithin(pid, createTime, GRACE_MS)) return { outcome: 'ended' };
    trySignal(pid, 'SIGKILL');
    return (await this.endedWithin(pid, createTime, GRACE_MS)) ? { outcome: 'ended' } : { outcome: 'failed', cause: 'It did not end.' };
  }

  private async endedWithin(pid: number, createTime: number, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const row = readMacosProcRow(pid, this.lib);
      if (row === null || row.startedAt !== createTime || !isLiveMacosRow(row)) return true;
      await sleep(POLL_MS);
    }
    return false;
  }

  /** Read once: neither figure moves while the machine is up. */
  machine(): MachineInfo {
    this.machineInfo ??= { logicalProcessors: Math.max(1, os.cpus().length), installedRamBytes: os.totalmem() };
    return this.machineInfo;
  }
}
