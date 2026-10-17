import { createRequire } from 'node:module';
import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import type {
  IProcessMetrics,
  MachineInfo,
  ProcessDescription,
  ProcessReading,
  ProcessSnapshot,
  TerminateResult,
  Unavailable,
} from '@throng/core';

/**
 * Windows {@link IProcessMetrics} (055 research R2, R8). One `NtQuerySystemInformation
 * (SystemProcessInformation)` per snapshot reads every process's identity, CPU times, private working
 * set and I/O transfer counts in a single call — the same numbers Task Manager shows — through koffi's
 * `.async`, so the read runs on a worker thread and never stalls the caller's loop. Fields are read
 * from the x64 `SYSTEM_PROCESS_INFORMATION` layout in a Buffer (the `windows-process-cwd.ts` pattern).
 *
 * `describe` reads the command line (`ProcessCommandLineInformation`) and image path
 * (`QueryFullProcessImageNameW`) once per identity. `terminate` opens the process, re-checks its
 * create time with `GetProcessTimes` so a pid reused since the request is never ended, then
 * `TerminateProcess`.
 */
const require = createRequire(import.meta.url);

// x64 SYSTEM_PROCESS_INFORMATION offsets.
const SPI_NEXT = 0x00;
const SPI_WORKING_SET_PRIVATE = 0x08;
const SPI_CREATE_TIME = 0x20;
const SPI_USER_TIME = 0x28;
const SPI_KERNEL_TIME = 0x30;
const SPI_IMAGE_NAME_LENGTH = 0x38;
const SPI_IMAGE_NAME_BUFFER = 0x40;
const SPI_PID = 0x50;
const SPI_PPID = 0x58;
const SPI_READ_TRANSFER = 0xe8;
const SPI_WRITE_TRANSFER = 0xf0;

const SYSTEM_PROCESS_INFORMATION = 5;
/**
 * The same table for one session only (SYSTEM_SESSION_PROCESS_INFORMATION). Throng's processes all run
 * in the user's session, and the services in session 0 hold most of a machine's threads, so this read
 * costs the kernel about a quarter less (measured 4.7 ms against 6.2 ms) — the largest share of the
 * collector's SC-004 budget.
 */
const SYSTEM_SESSION_PROCESS_INFORMATION = 53;
const STATUS_INFO_LENGTH_MISMATCH = 0xc0000004 | 0;
const PROCESS_COMMAND_LINE_INFORMATION = 60;
const STATUS_SUCCESS = 0;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
/** FILETIME epoch (1601) to Unix epoch, in ms. */
const FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000;

/**
 * A FILETIME (100-ns ticks since 1601, ~1.3e17 today) as whole ms since 1601, divided exactly.
 *
 * The raw tick count is past Number's exact range (2^53), so `Number(ticks) + 1 === Number(ticks)`:
 * an identity check on raw ticks cannot tell two create times apart and would end a process whose pid
 * was reused. Measured: the IProcessMetrics contract's stale-identity terminate ended the test runner.
 * Milliseconds stay exact for 285,000 years, and no pid is reused within one.
 */
function filetimeMs(buf: Buffer, offset: number): number {
  return Number(buf.readBigInt64LE(offset) / 10_000n);
}

/** The native calls, each settling off the event loop. Exported for tests to substitute. */
export interface ProcessMetricsFfi {
  querySystem(cls: number, buf: Buffer, size: number, needed: number[]): Promise<number>;
  addressOf(buf: Buffer): bigint;
  openProcess(access: number, pid: number): Promise<unknown>;
  closeHandle(handle: unknown): Promise<boolean>;
  queryProcess(handle: unknown, cls: number, buf: Buffer, size: number, needed: number[]): Promise<number>;
  imageName(handle: unknown, buf: Buffer, size: number[]): Promise<boolean>;
  processTimes(handle: unknown, create: Buffer, exit: Buffer, kernel: Buffer, user: Buffer): Promise<boolean>;
  terminate(handle: unknown, code: number): Promise<boolean>;
  /** The session a process runs in, or null when it cannot be read. Absent: read the whole machine. */
  sessionOf?(pid: number): Promise<number | null>;
}

type KoffiFn = { async: (...args: unknown[]) => void };
function callAsync<T>(fn: KoffiFn, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) =>
    fn.async(...args, (error: unknown, result: T) => (error ? reject(error) : resolve(result))),
  );
}

let ffi: ProcessMetricsFfi | null | undefined;

function loadFfi(): ProcessMetricsFfi | null {
  if (ffi !== undefined) return ffi;
  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    const ntdll = koffi.load('ntdll.dll');
    const NtQuerySystemInformation = ntdll.func('NtQuerySystemInformation', 'int32', ['int', 'void *', 'uint32', '_Out_ uint32 *']);
    const NtQueryInformationProcess = ntdll.func('NtQueryInformationProcess', 'int32', ['void *', 'int', 'void *', 'uint32', '_Out_ uint32 *']);
    const OpenProcess = kernel32.func('OpenProcess', 'void *', ['uint32', 'bool', 'uint32']);
    const CloseHandle = kernel32.func('CloseHandle', 'bool', ['void *']);
    const QueryFullProcessImageNameW = kernel32.func('QueryFullProcessImageNameW', 'bool', ['void *', 'uint32', 'void *', '_Inout_ uint32 *']);
    const GetProcessTimes = kernel32.func('GetProcessTimes', 'bool', ['void *', 'void *', 'void *', 'void *', 'void *']);
    const TerminateProcess = kernel32.func('TerminateProcess', 'bool', ['void *', 'uint32']);
    const ProcessIdToSessionId = kernel32.func('ProcessIdToSessionId', 'bool', ['uint32', '_Out_ uint32 *']);
    ffi = {
      querySystem: (cls, buf, size, needed) => callAsync(NtQuerySystemInformation, cls, buf, size, needed),
      addressOf: (buf) => koffi.address(buf) as bigint,
      openProcess: (access, pid) => callAsync(OpenProcess, access, false, pid),
      closeHandle: (h) => callAsync(CloseHandle, h),
      queryProcess: (h, cls, buf, size, needed) => callAsync(NtQueryInformationProcess, h, cls, buf, size, needed),
      imageName: (h, buf, size) => callAsync(QueryFullProcessImageNameW, h, 0, buf, size),
      processTimes: (h, c, e, k, u) => callAsync(GetProcessTimes, h, c, e, k, u),
      terminate: (h, code) => callAsync(TerminateProcess, h, code),
      sessionOf: async (pid) => {
        const out = [0];
        return (await callAsync<boolean>(ProcessIdToSessionId, pid, out)) ? (out[0] ?? null) : null;
      },
    };
  } catch {
    ffi = null;
  }
  return ffi;
}

const unavailable = (reason: string): Unavailable => ({ kind: 'unavailable', reason });

export interface GpuReader {
  read(): Promise<ReadonlyMap<number, number> | Unavailable>;
}

export class WindowsProcessMetrics implements IProcessMetrics {
  /** Kept between snapshots: the table is ~0.5 MB on a busy machine and rarely grows. */
  private buf = Buffer.alloc(1 << 20);
  private readonly described = new Map<string, ProcessDescription | Unavailable>();
  /** This process's session: undefined until asked, null to read the whole machine. */
  private session: number | null | undefined = undefined;
  private readonly sessionRequest = Buffer.alloc(16);

  constructor(
    private readonly gpuReader?: GpuReader,
    /** Test seam: the native calls. Defaults to koffi's bindings, loaded once. */
    private readonly api: ProcessMetricsFfi | null | undefined = undefined,
  ) {}

  private ffi(): ProcessMetricsFfi | null {
    if (this.api !== undefined) return this.api;
    return process.arch === 'x64' ? loadFfi() : null;
  }

  /** One query at a time: every read shares `buf`, and a terminate's liveness check is a second reader. */
  private reading: Promise<unknown> = Promise.resolve();

  snapshot(): Promise<ProcessSnapshot> {
    const next = this.reading.then(() => this.read());
    this.reading = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<ProcessSnapshot> {
    const api = this.ffi();
    if (api === null) throw new Error('process table unavailable on this platform');
    if (this.session === undefined) this.session = api.sessionOf ? await api.sessionOf(process.pid).catch(() => null) : null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const needed = [0];
      const session = this.session;
      let status: number;
      if (session !== null) {
        const req = this.sessionRequest;
        req.writeUInt32LE(session, 0);
        req.writeUInt32LE(this.buf.length, 4);
        req.writeBigUInt64LE(api.addressOf(this.buf), 8);
        status = await api.querySystem(SYSTEM_SESSION_PROCESS_INFORMATION, req, req.length, needed);
      } else {
        status = await api.querySystem(SYSTEM_PROCESS_INFORMATION, this.buf, this.buf.length, needed);
      }
      const wallTimeMs = performance.now();
      if (status === STATUS_SUCCESS) return { readings: parse(this.buf, api.addressOf(this.buf)), wallTimeMs };
      if (status !== STATUS_INFO_LENGTH_MISMATCH && session !== null) {
        // The session-scoped class refused: read the whole machine from now on.
        this.session = null;
        continue;
      }
      // The table grew between calls.
      this.buf = Buffer.alloc(Math.max(needed[0] ?? 0, this.buf.length * 2) + 128 * 1024);
    }
    throw new Error('process table kept growing faster than it could be read');
  }

  async gpu(): Promise<ReadonlyMap<number, number> | Unavailable> {
    return this.gpuReader ? this.gpuReader.read() : unavailable('GPU counters are not available');
  }

  async describe(pid: number, createTime: number): Promise<ProcessDescription | Unavailable> {
    const key = `${pid}:${createTime}`;
    const cached = this.described.get(key);
    if (cached !== undefined) return cached;
    const result = await this.readDescription(pid, createTime);
    if (this.described.size > 4096) this.described.clear();
    this.described.set(key, result);
    return result;
  }

  private async readDescription(pid: number, createTime: number): Promise<ProcessDescription | Unavailable> {
    const api = this.ffi();
    if (api === null) return unavailable('Process details are not available on this platform');
    const handle = await this.open(api, PROCESS_QUERY_LIMITED_INFORMATION, pid);
    if (!handle) return unavailable('The process has ended, or throng is not allowed to read it');
    try {
      if ((await this.createTimeOf(api, handle)) !== createTime) return unavailable('The process has ended');
      const out: { commandLine?: string; executablePath?: string } = {};
      const pathBuf = Buffer.alloc(32_768 * 2);
      const size = [32_768];
      if (await api.imageName(handle, pathBuf, size)) out.executablePath = pathBuf.toString('utf16le', 0, (size[0] ?? 0) * 2);
      const cmdBuf = Buffer.alloc(64 * 1024);
      const needed = [0];
      if ((await api.queryProcess(handle, PROCESS_COMMAND_LINE_INFORMATION, cmdBuf, cmdBuf.length, needed)) === STATUS_SUCCESS) {
        // A UNICODE_STRING whose Buffer points into cmdBuf.
        const len = cmdBuf.readUInt16LE(0);
        const rel = Number(cmdBuf.readBigUInt64LE(8) - api.addressOf(cmdBuf));
        if (len > 0 && rel >= 0 && rel + len <= cmdBuf.length) out.commandLine = cmdBuf.toString('utf16le', rel, rel + len);
      }
      return out;
    } catch {
      return unavailable('The process could not be read');
    } finally {
      await api.closeHandle(handle).catch(() => false);
    }
  }

  async terminate(pid: number, createTime: number): Promise<TerminateResult> {
    const api = this.ffi();
    if (api === null) return { outcome: 'failed', cause: 'unsupported' };
    const handle = await this.open(api, PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, pid);
    if (!handle) {
      const alive = (await this.snapshot()).readings.some((r) => r.pid === pid && r.createTime === createTime);
      return alive ? { outcome: 'denied', cause: 'accessDenied' } : { outcome: 'gone' };
    }
    try {
      if ((await this.createTimeOf(api, handle)) !== createTime) return { outcome: 'gone' };
      return (await api.terminate(handle, 1)) ? { outcome: 'ended' } : { outcome: 'failed', cause: 'terminateFailed' };
    } catch {
      return { outcome: 'failed', cause: 'terminateFailed' };
    } finally {
      await api.closeHandle(handle).catch(() => false);
    }
  }

  machine(): MachineInfo {
    return { logicalProcessors: os.availableParallelism(), installedRamBytes: os.totalmem() };
  }

  private async open(api: ProcessMetricsFfi, access: number, pid: number): Promise<unknown> {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    try {
      return await api.openProcess(access, pid);
    } catch {
      return null;
    }
  }

  private async createTimeOf(api: ProcessMetricsFfi, handle: unknown): Promise<number | undefined> {
    const c = Buffer.alloc(8);
    const e = Buffer.alloc(8);
    const k = Buffer.alloc(8);
    const u = Buffer.alloc(8);
    return (await api.processTimes(handle, c, e, k, u)) ? filetimeMs(c, 0) : undefined;
  }
}

/** Every entry of a SystemProcessInformation table. `base` is the buffer's address, for the name pointers. */
export function parse(buf: Buffer, base: bigint): ProcessReading[] {
  const out: ProcessReading[] = [];
  let off = 0;
  for (;;) {
    const pid = Number(buf.readBigUInt64LE(off + SPI_PID));
    const nameLen = buf.readUInt16LE(off + SPI_IMAGE_NAME_LENGTH);
    const namePtr = buf.readBigUInt64LE(off + SPI_IMAGE_NAME_BUFFER);
    const rel = Number(namePtr - base);
    const imageName =
      nameLen > 0 && namePtr !== 0n && rel >= 0 && rel + nameLen <= buf.length
        ? buf.toString('utf16le', rel, rel + nameLen)
        : pid === 0
          ? 'System Idle Process'
          : 'Unknown';
    const createTime = filetimeMs(buf, off + SPI_CREATE_TIME);
    out.push({
      pid,
      ppid: Number(buf.readBigUInt64LE(off + SPI_PPID)),
      createTime,
      imageName,
      cpuTime: Number(buf.readBigInt64LE(off + SPI_USER_TIME)) + Number(buf.readBigInt64LE(off + SPI_KERNEL_TIME)),
      privateWorkingSet: Number(buf.readBigInt64LE(off + SPI_WORKING_SET_PRIVATE)),
      ioReadBytes: Number(buf.readBigInt64LE(off + SPI_READ_TRANSFER)),
      ioWriteBytes: Number(buf.readBigInt64LE(off + SPI_WRITE_TRANSFER)),
      ...(createTime > 0 ? { startedAt: createTime - FILETIME_EPOCH_OFFSET_MS } : {}),
    });
    const next = buf.readUInt32LE(off + SPI_NEXT);
    if (next === 0) break;
    off += next;
  }
  return out;
}
