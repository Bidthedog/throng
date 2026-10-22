// The integrity level a process runs at (058 FR-007, FR-029): "the app the elevated installer starts
// is not elevated" and "the standard account's daemon is medium integrity" are both statements about
// a token, and the only way to check one is to read it.
//
// The read is a small P/Invoke run in PowerShell (OpenProcessToken + GetTokenInformation with
// TokenIntegrityLevel); it needs only PROCESS_QUERY_LIMITED_INFORMATION, so an administrator can ask
// about another account's process. `integrityName` is the pure half.
import { execFileSync } from 'node:child_process';

/** The mandatory-label RIDs: 0x1000 low, 0x2000 medium, 0x3000 high, 0x4000 system. */
export function integrityName(rid) {
  if (rid >= 0x4000) return 'system';
  if (rid >= 0x3000) return 'high';
  if (rid >= 0x2000) return 'medium';
  if (rid >= 0x1000) return 'low';
  return 'unknown';
}

/**
 * The main process of an app: the throng.exe whose parent is not itself a throng.exe. Its renderer,
 * GPU and utility children are sandboxed to LOW integrity (or cannot be read at all), so they say
 * nothing about the level the app was started at.
 * @param {{pid: number, ppid: number, name: string}[]} processes
 */
export function findMainProcess(processes) {
  const throngs = processes.filter((p) => /^throng\.exe$/i.test(p.name));
  const pids = new Set(throngs.map((p) => p.pid));
  return throngs.find((p) => !pids.has(p.ppid));
}

const MEDIUM = 0x2000;

/**
 * FR-007 — was the app started at the desktop's integrity level, not the installer's?
 *
 * `passed` only when the main process is at medium. `failed` when it is above the desktop that
 * started it, or is not medium on a medium desktop. `unproven` when the desktop itself is above
 * medium: a hosted runner is an administrator with UAC disabled, so explorer.exe is high and there is
 * no medium desktop to start from — the check cannot tell a correct launch from an elevated one.
 * @param {{mainLevel: number, explorerLevel: number}} levels RIDs; -1 when unreadable.
 * @returns {{status: 'passed'|'failed'|'unproven', reason: string}}
 */
export function judgeNotElevated({ mainLevel, explorerLevel }) {
  const name = (rid) => (rid < 0 ? 'unreadable' : `${integrityName(rid)} (0x${rid.toString(16)})`);
  if (mainLevel < 0) return { status: 'failed', reason: 'the app’s main process integrity could not be read' };
  if (explorerLevel >= 0 && mainLevel > explorerLevel) {
    return { status: 'failed', reason: `the app runs at ${name(mainLevel)}, above the desktop that started it (${name(explorerLevel)})` };
  }
  if (explorerLevel > MEDIUM) {
    return {
      status: 'unproven',
      reason: `the runner’s desktop (explorer.exe) is itself ${name(explorerLevel)}, so there is no medium-integrity desktop to start the app from`,
    };
  }
  if (mainLevel >= MEDIUM && mainLevel < 0x3000) return { status: 'passed', reason: 'the app runs at medium integrity' };
  return { status: 'failed', reason: `the app’s main process runs at ${name(mainLevel)}, not medium` };
}

const SOURCE = `
using System;
using System.Runtime.InteropServices;
public static class ThrongIntegrity {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr info, int len, out int returned);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, int n);
  public static int Level(int pid) {
    IntPtr process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) return -1;
    IntPtr token;
    if (!OpenProcessToken(process, 8, out token)) { CloseHandle(process); return -1; }
    int needed;
    GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed);
    IntPtr buffer = Marshal.AllocHGlobal(needed);
    int rid = -1;
    if (GetTokenInformation(token, 25, buffer, needed, out needed)) {
      IntPtr sid = Marshal.ReadIntPtr(buffer);
      int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
      rid = Marshal.ReadInt32(GetSidSubAuthority(sid, count - 1));
    }
    Marshal.FreeHGlobal(buffer);
    CloseHandle(token);
    CloseHandle(process);
    return rid;
  }
}`;

/**
 * The integrity level (a RID, or -1 when it cannot be read) of each process id.
 * @param {number[]} pids
 * @returns {Record<number, number>}
 */
export function integrityLevels(pids) {
  if (pids.length === 0) return {};
  const script =
    `$ErrorActionPreference = 'Stop'\n` +
    `Add-Type -TypeDefinition @'\n${SOURCE}\n'@\n` +
    `$out = @{}\n` +
    `foreach ($p in @(${pids.join(',')})) { $out[[string]$p] = [ThrongIntegrity]::Level([int]$p) }\n` +
    `ConvertTo-Json -Compress -InputObject $out`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      encoding: 'utf8',
      timeout: 60000,
    });
    const parsed = JSON.parse(out);
    return Object.fromEntries(Object.entries(parsed).map(([pid, rid]) => [Number(pid), Number(rid)]));
  } catch {
    return Object.fromEntries(pids.map((p) => [p, -1]));
  }
}
