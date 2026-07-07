import { execFileSync } from 'node:child_process';
import process from 'node:process';

/**
 * Startup orphan reaper (Constitution VII — no orphaned OS processes). The daemon
 * owns three kinds of child OS process that must die with it: the de-elevated PTY
 * **agent** (`pty-agent-entry`), each terminal's **`conhost.exe --headless`** ConPTY
 * host, and the ref-counted **directory-lock** holder (`THRONG_LOCK_DIR`). A clean
 * shutdown reaps them, and the agent self-terminates when its daemon dies — but that
 * liveness check (`process.kill(daemonPid, 0)`) is fooled by PID reuse, and a hard
 * kill can skip cleanup, so these leak. A fresh daemon therefore sweeps for orphans
 * at startup as a backstop.
 *
 * "Orphan" = a throng-owned process whose parent is gone: either no process holds its
 * ParentProcessId, or one does but it started AFTER the child (so the PID was reused —
 * the real parent is dead). That test never reaps a LIVE daemon's processes (a live
 * parent started before its child), so it is safe with concurrent daemons.
 */

export interface ProcInfo {
  pid: number;
  ppid: number;
  name: string;
  /** Process creation time, ms since epoch. */
  createdMs: number;
  commandLine: string;
}

/** Whether a process is a throng-owned child that must not outlive its daemon. */
export function isThrongOwned(p: ProcInfo): boolean {
  const name = p.name.toLowerCase();
  const cmd = p.commandLine;
  if (name === 'conhost.exe') return cmd.includes('--headless');
  if (name === 'node.exe') {
    return cmd.includes('pty-agent-entry') || cmd.includes('THRONG_LOCK_DIR');
  }
  return false;
}

/**
 * Pure orphan selection: given a snapshot of processes, return the pids of
 * throng-owned processes whose parent is gone (missing, or a PID-reuse impostor that
 * started after the child). `selfPid` (the current daemon) is never returned even if
 * matched. Deterministic and side-effect-free for unit testing.
 */
export function findOrphans(procs: ProcInfo[], selfPid = process.pid): number[] {
  const byId = new Map<number, ProcInfo>();
  for (const p of procs) byId.set(p.pid, p);
  const orphans: number[] = [];
  for (const p of procs) {
    if (p.pid === selfPid || !isThrongOwned(p)) continue;
    const parent = byId.get(p.ppid);
    const parentGone = !parent || parent.createdMs > p.createdMs;
    if (parentGone) orphans.push(p.pid);
  }
  return orphans;
}

/** Snapshot every process (pid, ppid, name, creation ms, command line) via CIM. */
function snapshotProcesses(): ProcInfo[] {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      // Pipe-delimited; command line last (its own '|' stripped) so a 5-field split is safe.
      "Get-CimInstance Win32_Process | ForEach-Object { " +
        "'{0}|{1}|{2}|{3}|{4}' -f $_.ProcessId, $_.ParentProcessId, $_.Name, " +
        "([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(), " +
        "(($_.CommandLine -replace '\\|',' ') -replace '[\\r\\n]',' ') }",
    ],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  const procs: ProcInfo[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length < 4) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    const createdMs = Number(parts[3]);
    if (!Number.isFinite(pid)) continue;
    procs.push({
      pid,
      ppid: Number.isFinite(ppid) ? ppid : -1,
      name: parts[2] ?? '',
      createdMs: Number.isFinite(createdMs) ? createdMs : 0,
      commandLine: parts.slice(4).join('|'),
    });
  }
  return procs;
}

/**
 * Reap orphaned throng-owned OS processes. Safe to call at daemon startup: it only
 * kills processes whose parent is already gone, never a live daemon's. Best-effort
 * and non-fatal — a sweep failure must not stop the daemon from starting. Opt out via
 * THRONG_NO_ORPHAN_REAP=1 (the E2E harness sets it: test daemons are short-lived and
 * spawn many in parallel, and each test cleans up its own tree).
 */
export function reapOrphans(): number[] {
  if (process.platform !== 'win32') return [];
  if (process.env.THRONG_NO_ORPHAN_REAP === '1') return [];
  let orphans: number[] = [];
  try {
    orphans = findOrphans(snapshotProcesses());
  } catch {
    return []; // enumeration failed — never block startup
  }
  const reaped: number[] = [];
  for (const pid of orphans) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
        stdio: 'ignore',
      });
      reaped.push(pid);
    } catch {
      /* already gone / access denied — best-effort */
    }
  }
  return reaped;
}
