import { createRequire } from 'node:module';
import process from 'node:process';
import type { IProcessCwd } from '@throng/core';

/**
 * Windows {@link IProcessCwd} (012 revision). Reads a process's current working
 * directory by walking its **PEB** — the only reliable way to get a live cwd on
 * Windows (node-pty exposes none, and no built-in tool reports it):
 *
 *   OpenProcess(QUERY_INFORMATION|VM_READ) → NtQueryInformationProcess(basic) →
 *   PEB.ProcessParameters → RTL_USER_PROCESS_PARAMETERS.CurrentDirectory.DosPath.
 *
 * Done in-process via koffi (a prebuilt FFI — no native build step). Every native
 * read is checked and every pid is isolated in try/catch, so a gone/denied process
 * (or any failure) yields *no* entry rather than throwing — the daemon poller must
 * never crash on a terminal that just exited. x64-only (the field offsets below are
 * the 64-bit PEB layout); on any other architecture it returns nothing.
 */
const require = createRequire(import.meta.url);

// x64 PEB / process-parameters field offsets (stable across Windows releases).
const PBI_PEB_OFFSET = 8; // PROCESS_BASIC_INFORMATION.PebBaseAddress
const PEB_PROCESS_PARAMETERS_OFFSET = 0x20n; // PEB.ProcessParameters
const RTL_CURRENT_DIRECTORY_OFFSET = 0x38n; // RTL_USER_PROCESS_PARAMETERS.CurrentDirectory.DosPath
const UNICODE_STRING_BUFFER_OFFSET = 8; // UNICODE_STRING.Buffer (after Length/MaxLength + padding)

const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_VM_READ = 0x0010;

interface Ffi {
  openProcess(access: number, inherit: boolean, pid: number): unknown;
  closeHandle(handle: unknown): boolean;
  ntQueryBasic(handle: unknown, buf: Buffer, size: number): number;
  readMemory(handle: unknown, address: bigint, buf: Buffer, size: number): boolean;
}

let ffi: Ffi | null | undefined;

/** Lazily bind the ntdll/kernel32 functions via koffi (once). null if unavailable. */
function loadFfi(): Ffi | null {
  if (ffi !== undefined) return ffi;
  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    const ntdll = koffi.load('ntdll.dll');
    const OpenProcess = kernel32.func('OpenProcess', 'void *', ['uint32', 'bool', 'uint32']);
    const CloseHandle = kernel32.func('CloseHandle', 'bool', ['void *']);
    const ReadProcessMemory = kernel32.func('ReadProcessMemory', 'bool', [
      'void *',
      'uintptr_t',
      'void *',
      'size_t',
      'void *',
    ]);
    const NtQueryInformationProcess = ntdll.func('NtQueryInformationProcess', 'int32', [
      'void *',
      'int',
      'void *',
      'uint32',
      'void *',
    ]);
    ffi = {
      openProcess: (access, inherit, pid) => OpenProcess(access, inherit, pid),
      closeHandle: (handle) => CloseHandle(handle) as boolean,
      // ProcessBasicInformation == 0.
      ntQueryBasic: (handle, buf, size) => NtQueryInformationProcess(handle, 0, buf, size, null) as number,
      readMemory: (handle, address, buf, size) =>
        ReadProcessMemory(handle, address, buf, size, null) as boolean,
    };
  } catch {
    ffi = null; // koffi missing or the libraries failed to load → feature simply off
  }
  return ffi;
}

export class WindowsProcessCwd implements IProcessCwd {
  async read(pids: readonly number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (process.arch !== 'x64') return out; // offsets below are the 64-bit layout
    const api = loadFfi();
    if (!api) return out;
    for (const pid of pids) {
      const cwd = readOne(api, pid);
      if (cwd) out.set(pid, cwd);
    }
    return out;
  }
}

/** Read one process's cwd, or null on any failure (never throws). */
function readOne(api: Ffi, pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  let handle: unknown = null;
  try {
    handle = api.openProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
    if (!handle) return null;

    // PROCESS_BASIC_INFORMATION → PebBaseAddress.
    const pbi = Buffer.alloc(48);
    if (api.ntQueryBasic(handle, pbi, pbi.length) !== 0) return null;
    const pebBase = pbi.readBigUInt64LE(PBI_PEB_OFFSET);
    if (pebBase === 0n) return null;

    // PEB.ProcessParameters (a remote pointer).
    const ptrBuf = Buffer.alloc(8);
    if (!api.readMemory(handle, pebBase + PEB_PROCESS_PARAMETERS_OFFSET, ptrBuf, 8)) return null;
    const processParameters = ptrBuf.readBigUInt64LE(0);
    if (processParameters === 0n) return null;

    // CurrentDirectory.DosPath (a UNICODE_STRING: Length @0, Buffer @+8).
    const usBuf = Buffer.alloc(16);
    if (!api.readMemory(handle, processParameters + RTL_CURRENT_DIRECTORY_OFFSET, usBuf, 16)) return null;
    const length = usBuf.readUInt16LE(0); // bytes of UTF-16 text
    const bufferPtr = usBuf.readBigUInt64LE(UNICODE_STRING_BUFFER_OFFSET);
    if (length === 0 || length > 0x8000 || bufferPtr === 0n) return null;

    // The path text itself.
    const pathBuf = Buffer.alloc(length);
    if (!api.readMemory(handle, bufferPtr, pathBuf, length)) return null;
    const cwd = pathBuf.toString('utf16le').replace(/\\+$/, ''); // drop a trailing separator
    return cwd.length > 0 ? cwd : null;
  } catch {
    return null;
  } finally {
    if (handle) {
      try {
        api.closeHandle(handle);
      } catch {
        /* handle already invalid */
      }
    }
  }
}
