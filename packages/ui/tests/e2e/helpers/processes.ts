import { execFileSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { TERMINAL_OUTPUT_TIMEOUT_MS } from '../harness.js';

/**
 * The OS process table, for specs that must see whether a command a terminal started is still running.
 *
 * A spec asks about exactly the commands it started by giving each its own marker — a `127.0.0.x` ping target, a
 * script name — so the answer does not depend on which process a terminal's shell is the child of (the daemon's,
 * or the de-elevated agent's when the daemon is elevated), nor on anything else running on the machine.
 */
export interface Proc {
  pid: number;
  parent: number;
  name: string;
  cmd: string;
}

/** Every process on the machine. Throws when the query itself fails, so a broken probe never reads as "none". */
export function processTable(): Proc[] {
  if (process.platform === 'linux') return linuxProcessTable();
  if (process.platform === 'darwin') return darwinProcessTable();
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  );
  const rows = JSON.parse(out) as Array<{ ProcessId: number; ParentProcessId: number; Name: string; CommandLine: string | null }>;
  return rows.map((r) => ({ pid: r.ProcessId, parent: r.ParentProcessId, name: r.Name, cmd: r.CommandLine ?? '' }));
}

function linuxProcessTable(): Proc[] {
  const out = execFileSync('ps', ['-eo', 'pid=,ppid=,comm=,args=', '-ww'], { encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024 * 1024 });
  const rows: Proc[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), parent: Number(m[2]), name: linuxImage(Number(m[1]), m[3] ?? ''), cmd: m[4] ?? '' });
  }
  return rows;
}

/**
 * A Linux process's executable name. `comm` is the main THREAD's name, which a process may set: Node names its own
 * `node-MainThread`, so a table by `comm` finds no `node` at all. The executable (`/proc/<pid>/exe`) is what the
 * Windows and macOS tables name; `comm` stands in only where that link cannot be read (another user's process).
 */
function linuxImage(pid: number, comm: string): string {
  try {
    return basename(readlinkSync(`/proc/${pid}/exe`)).replace(/ \(deleted\)$/, '');
  } catch {
    return comm;
  }
}

/**
 * 070 FR-047, research R27: macOS's table comes from BSD `ps`, read by `scripts/process-table.mjs` — the one parser the
 * CI clean-up uses too, unit-tested against macOS's output shape. `comm` there is the executable's full path, so the
 * name is its last part, as Linux's `comm` already is.
 */
function darwinProcessTable(): Proc[] {
  const script = fileURLToPath(new URL('../../../../../scripts/process-table.mjs', import.meta.url));
  const out = execFileSync(process.execPath, [script, '--json'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
  const rows = JSON.parse(out) as Array<{ pid: number; ppid: number; comm: string; args: string }>;
  return rows.map((r) => ({ pid: r.pid, parent: r.ppid, name: basename(r.comm), cmd: r.args }));
}

/** The processes named `image` (e.g. `ping.exe`) whose command line contains `marker`. */
export const processesMatching = (image: string, marker: string, table = processTable()): Proc[] =>
  table.filter(
    (p) =>
      p.name.toLowerCase() === (process.platform === 'win32' ? image : image.replace(/\.exe$/i, '')).toLowerCase() &&
      p.cmd.includes(marker),
  );

/** The ping processes aimed at `target`. */
export const pings = (target: string, table = processTable()): Proc[] => processesMatching('ping.exe', target, table);

/** Wait until exactly `n` pings aimed at `target` are running. */
export async function expectPingCount(target: string, n: number, timeout = TERMINAL_OUTPUT_TIMEOUT_MS): Promise<void> {
  await expect
    .poll(() => pings(target).length, { timeout, message: `expected ${n} ping(s) at ${target}` })
    .toBe(n);
}
