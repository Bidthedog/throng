import process from 'node:process';
import type { IPtyHost } from '@throng/core';
import { RESOURCES_ROSTER_METHOD, type DaemonRoster, type RosterTerminal } from '@throng/ipc-contract';
import type { RpcRouter } from './rpc-router.js';

export interface RosterTerminalSource {
  rosterTerminals(): readonly {
    panelId: string;
    projectId: string | null;
    host: IPtyHost;
    handlePid: number;
    scrollbackChars: number;
    attached: readonly { pid: number; startedAt: number }[];
  }[];
}

export interface RosterLockSource {
  heldLocks(): readonly { projectId: string; path: string; pid: number | null }[];
}

/**
 * `resources.roster` (055 R5): which processes are throng's and what each serves — every terminal's
 * shell and console host, every lock helper and the panels keeping its folder held, the daemon and
 * the PTY agent. Composed only from what the daemon already holds in memory; it makes no OS query,
 * because the resource collector asks on every tick.
 */
export class ResourceRosterService {
  constructor(
    private readonly terminals: RosterTerminalSource,
    private readonly locks: RosterLockSource,
    private readonly agentPid: () => number | null,
  ) {}

  register(router: RpcRouter): void {
    router.register(RESOURCES_ROSTER_METHOD, async () => this.roster());
  }

  roster(): DaemonRoster {
    const running = this.terminals.rosterTerminals();
    const entriesByHost = new Map<IPtyHost, Map<number, { osPid: number | null; conhostPid: number | null }>>();
    const entryFor = (host: IPtyHost, handlePid: number) => {
      let byHandle = entriesByHost.get(host);
      if (byHandle === undefined) {
        byHandle = new Map((host.rosterEntries?.() ?? []).map((e) => [e.handlePid, e]));
        entriesByHost.set(host, byHandle);
      }
      return byHandle.get(handlePid);
    };
    const terminals: RosterTerminal[] = running.map((t) => {
      const e = entryFor(t.host, t.handlePid);
      return {
        panelId: t.panelId,
        projectId: t.projectId,
        osPid: e?.osPid ?? null,
        conhostPid: e?.conhostPid ?? null,
        attached: t.attached.map((a) => ({ pid: a.pid, startedAt: a.startedAt })),
        scrollbackChars: t.scrollbackChars,
      };
    });
    const locks = this.locks.heldLocks().map((l) => ({
      path: l.path,
      projectId: l.projectId,
      pid: l.pid,
      panelIds: running.filter((t) => t.projectId === l.projectId).map((t) => t.panelId),
    }));
    return { daemonPid: process.pid, agentPid: this.agentPid(), terminals, locks };
  }
}
