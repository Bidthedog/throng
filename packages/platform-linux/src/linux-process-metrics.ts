import { readFileSync } from 'node:fs';
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
import { programName, isLiveRow, kernelUnits, readCommandLine, readExecutablePath, readProcRow, trySignal } from './proc-table.js';
import type { LinuxGpuUsage } from './linux-gpu.js';
import { procRelevantProcesses, type RelevantProcesses } from './relevant-processes.js';

const GRACE_MS = 1500;
const POLL_MS = 25;
/** `cpuTime` is in 100 ns units across the interface. */
const HUNDRED_NS_PER_SECOND = 10_000_000;

/** Why there is no per-process network figure on Linux. Shown to the user (055 FR-011). */
export const LINUX_NETWORK_UNAVAILABLE = 'Linux has no per-process network figure without administrator rights.';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Cumulative read and write bytes from `/proc/<pid>/io`, which only the owner may read. */
function readIo(pid: number): { read: number; write: number } {
  try {
    const text = readFileSync(`/proc/${pid}/io`, 'utf8');
    const value = (key: string): number => Number(new RegExp(`^${key}: (\\d+)$`, 'm').exec(text)?.[1] ?? 0);
    // rchar and wchar count all I/O, device and pipe included, which is what the column is labelled as (055 R3).
    return { read: value('rchar'), write: value('wchar') };
  } catch (error) {
    logExpected('linux-process-metrics: read io', "only a process's owner may read its io counters, and a process can exit mid-tick", error);
    return { read: 0, write: 0 };
  }
}

/**
 * The memory only this process holds (055 FR-030), as resident pages less the file-backed and shared ones. Resident
 * alone counts every shared library again in each process, which made throng read 1.4 GB where it held 0.5 GB. Measured
 * over 11 of throng's processes this totals within 0.4% of `smaps_rollup`'s private figure at under 1/300 of its cost,
 * which would break 055 SC-004 by itself. A process gone since the table was read holds nothing.
 */
function readPrivateBytes(pid: number, pageSize: number): number {
  try {
    const [, resident, shared] = readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ').map(Number);
    return Math.max(0, (resident ?? 0) - (shared ?? 0)) * pageSize;
  } catch (error) {
    logExpected('linux-process-metrics: read statm', 'a process gone since the table was read holds nothing', error);
    return 0;
  }
}

/** `IProcessMetrics` from `/proc` (062 FR-037, FR-038). */
export class LinuxProcessMetrics implements IProcessMetrics {
  private scope: RelevantProcesses | undefined;
  private machineInfo: MachineInfo | undefined;

  constructor(private readonly gpuUsage: LinuxGpuUsage) {}

  async snapshot(): Promise<ProcessSnapshot> {
    const units = await kernelUnits();
    this.scope ??= procRelevantProcesses(units);
    const live = this.scope.read().filter((row) => isLiveRow(row) && row.rssPages > 0);
    this.gpuUsage.noteProcesses(live);
    const readings = live.map((row): ProcessReading => {
        // Both are read on first asking, and only throng's own processes are asked about (055 SC-004). Those are asked
        // every tick, so each reading's counters are fixed in its own tick and the next tick's difference is a true rate.
        let memory: number | undefined;
        let io: { read: number; write: number } | undefined;
        return {
          pid: row.pid,
          ppid: row.ppid,
          createTime: row.startedAt,
          imageName: programName(row),
          cpuTime: Math.round((row.cpuTicks * HUNDRED_NS_PER_SECOND) / units.ticksPerSecond),
          get privateWorkingSet(): number {
            memory ??= readPrivateBytes(row.pid, units.pageSize);
            return memory;
          },
          get ioReadBytes(): number {
            io ??= readIo(row.pid);
            return io.read;
          },
          get ioWriteBytes(): number {
            io ??= readIo(row.pid);
            return io.write;
          },
          startedAt: row.startedAt,
        };
    });
    return { readings, wallTimeMs: performance.now() };
  }

  gpu(): Promise<ReadonlyMap<number, number> | Unavailable> {
    return this.gpuUsage.read();
  }

  network(): Promise<ReadonlyMap<number, number> | Unavailable> {
    return Promise.resolve({ kind: 'unavailable', reason: LINUX_NETWORK_UNAVAILABLE });
  }

  async describe(pid: number, createTime: number): Promise<ProcessDescription | Unavailable> {
    const row = await readProcRow(pid);
    if (row === null || row.startedAt !== createTime) {
      return { kind: 'unavailable', reason: 'The process has ended.' };
    }
    const [commandLine, executablePath] = await Promise.all([readCommandLine(pid), readExecutablePath(pid)]);
    if (!commandLine && !executablePath) {
      return { commandLine: undefined, executablePath: undefined, unavailableReason: 'The system would not say.' };
    }
    return { commandLine: commandLine || undefined, executablePath };
  }

  /** Politely, then not. Start time is checked first, so a reused pid is never ended. */
  async terminate(pid: number, createTime: number): Promise<TerminateResult> {
    const row = await readProcRow(pid);
    if (row === null || row.startedAt !== createTime || !isLiveRow(row)) return { outcome: 'gone' };
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH' || code === 'EPERM') {
        logExpected('linux-process-metrics: SIGTERM', "the process exited after its row was read, or is another user's; the caller shows the outcome", error);
      } else {
        logCaught('linux-process-metrics: SIGTERM', error);
      }
      if (code === 'ESRCH') return { outcome: 'gone' };
      if (code === 'EPERM') return { outcome: 'denied', cause: 'It belongs to another user.' };
      return { outcome: 'failed', cause: String(error) };
    }
    if (await this.endedWithin(pid, createTime, GRACE_MS)) return { outcome: 'ended' };
    trySignal(pid, 'SIGKILL');
    return (await this.endedWithin(pid, createTime, GRACE_MS))
      ? { outcome: 'ended' }
      : { outcome: 'failed', cause: 'It did not end.' };
  }

  private async endedWithin(pid: number, createTime: number, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const row = await readProcRow(pid);
      if (row === null || row.startedAt !== createTime || !isLiveRow(row)) return true;
      await sleep(POLL_MS);
    }
    return false;
  }

  /** Asked every tick, and `os.cpus()` reads every core's times to answer: read once, since neither figure moves. */
  machine(): MachineInfo {
    this.machineInfo ??= { logicalProcessors: Math.max(1, os.cpus().length), installedRamBytes: os.totalmem() };
    return this.machineInfo;
  }
}
