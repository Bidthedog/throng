import process from 'node:process';
import { logCaught, logExpected, type IOrphanProcesses } from '@throng/core';

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
  if (name === 'node.exe' || name === 'node') {
    // 055 — the resource collector UI main forks: orphaned (and reaped) if UI main dies first.
    return cmd.includes('pty-agent-entry') || cmd.includes('THRONG_LOCK_DIR') || cmd.includes('resource-collector-entry');
  }
  return false;
}

/** The owning daemon's pid, from the pipe an agent serves (`throng.ptyagent.<daemonPid>.<id>`). */
const AGENT_PIPE_DAEMON = /throng\.ptyagent\.(\d+)\./;

/**
 * Pure orphan selection: given a snapshot of processes, return the pids of
 * throng-owned processes whose parent is gone (missing, or a PID-reuse impostor that
 * started after the child). `selfPid` (the current daemon) is never returned even if
 * matched. Deterministic and side-effect-free for unit testing.
 *
 * A de-elevated agent's parent is the launcher shim, which exits as soon as the agent
 * starts — so for an agent, the owner is the daemon its pipe names, not its parent.
 * Judging it by its parent reaped a live daemon's agent, including the sweeping daemon's
 * own, which `createDaemonContainer` has already launched by the time the sweep runs.
 */
export function findOrphans(procs: ProcInfo[], selfPid = process.pid): number[] {
  const byId = new Map<number, ProcInfo>();
  for (const p of procs) byId.set(p.pid, p);
  const alive = (ownerPid: number, child: ProcInfo): boolean => {
    const owner = byId.get(ownerPid);
    return owner !== undefined && owner.createdMs <= child.createdMs;
  };
  const orphans: number[] = [];
  for (const p of procs) {
    if (p.pid === selfPid || !isThrongOwned(p)) continue;
    const daemonPid = AGENT_PIPE_DAEMON.exec(p.commandLine)?.[1];
    if (daemonPid !== undefined && (Number(daemonPid) === selfPid || alive(Number(daemonPid), p))) continue;
    if (!alive(p.ppid, p)) orphans.push(p.pid);
  }
  return orphans;
}

/**
 * Reap orphaned throng-owned OS processes. Safe to call at daemon startup: it only
 * kills processes whose parent is already gone, never a live daemon's. Best-effort
 * and non-fatal — a sweep failure must not stop the daemon from starting. Opt out via
 * THRONG_NO_ORPHAN_REAP=1 (the E2E harness sets it: test daemons are short-lived and
 * spawn many in parallel, and each test cleans up its own tree).
 */
export async function reapOrphans(processes: IOrphanProcesses): Promise<number[]> {
  if (process.env.THRONG_NO_ORPHAN_REAP === '1') return [];
  let orphans: number[];
  try {
    orphans = findOrphans(await processes.snapshot());
  } catch (error) {
    logCaught('reap-orphans: snapshot processes', error);
    return []; // never block startup
  }
  const reaped: number[] = [];
  for (const pid of orphans) {
    try {
      if (await processes.kill(pid)) reaped.push(pid);
    } catch (error) {
      logExpected(`reap-orphans: kill ${pid}`, 'an orphan may exit between the snapshot and the kill, or belong to another account', error);
    }
  }
  return reaped;
}
