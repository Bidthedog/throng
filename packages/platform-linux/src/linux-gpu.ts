import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { logExpected, type Unavailable } from '@throng/core';

const NO_SOURCE = 'This machine\'s graphics driver does not publish per-process GPU use.';
const OWN_PROCESS = /electron|throng/i;

/** The `drm-engine-*` nanoseconds and `drm-client-id` from one `/proc/<pid>/fdinfo` entry, or null. */
export function parseDrmFdinfo(text: string): { client: string; engineNs: number } | null {
  const client = /^drm-client-id:\s*(\S+)/m.exec(text)?.[1];
  if (client === undefined) return null;
  let engineNs = 0;
  for (const match of text.matchAll(/^drm-engine-[^:]+:\s*(\d+)\s*ns/gm)) engineNs += Number(match[1]);
  return { client, engineNs };
}

/**
 * Per-process GPU use where the driver publishes it (062 FR-037): the kernel's DRM usage stats in `fdinfo`. Reading a
 * rate needs two samples, so the first read of a process reports nothing for it. Only throng's own process tree is
 * asked about, since a scan of every descriptor of every process is not cheap, and pids come from the caller.
 */
export class LinuxGpuUsage {
  private previous = new Map<number, { at: number; ns: number }>();
  private noted: readonly number[] | null = null;

  constructor(private readonly pidsToWatch?: () => Promise<readonly number[]>) {}

  /** The process table the caller has just read, so a tick need not read every process's name a second time (055 SC-004). */
  noteProcesses(rows: readonly { pid: number; comm: string }[]): void {
    this.noted = rows.filter((row) => OWN_PROCESS.test(row.comm)).map((row) => row.pid);
  }

  async read(): Promise<ReadonlyMap<number, number> | Unavailable> {
    const pids = this.pidsToWatch ? await this.pidsToWatch() : (this.noted ?? listOwnPids());
    const at = performance.now();
    const current = new Map<number, { at: number; ns: number }>();
    for (const pid of pids) {
      const ns = engineNanoseconds(pid);
      if (ns !== null) current.set(pid, { at, ns });
    }
    if (current.size === 0) return { kind: 'unavailable', reason: NO_SOURCE };
    const usage = new Map<number, number>();
    for (const [pid, now] of current) {
      const before = this.previous.get(pid);
      if (!before || now.at <= before.at) continue;
      const percent = ((now.ns - before.ns) / ((now.at - before.at) * 1e6)) * 100;
      usage.set(pid, Math.max(0, Math.min(100, percent)));
    }
    this.previous = current;
    return usage;
  }
}

/**
 * A pid's total engine time across its DRM clients, each counted once. Null when it has none. Read blocking, as the
 * process table is: only the collector asks, it has a process of its own to block, and throng holds hundreds of descriptors.
 */
function engineNanoseconds(pid: number): number | null {
  let names: string[];
  try {
    names = readdirSync(`/proc/${pid}/fdinfo`);
  } catch (error) {
    logExpected('linux-gpu: list descriptors', 'the process may have exited since it was listed', error);
    return null;
  }
  const clients = new Map<string, number>();
  for (const name of names) {
    try {
      const parsed = parseDrmFdinfo(readFileSync(`/proc/${pid}/fdinfo/${name}`, 'utf8'));
      if (parsed) clients.set(parsed.client, parsed.engineNs);
    } catch (error) {
      logExpected('linux-gpu: read descriptor info', 'a descriptor can close while it is being read', error);
    }
  }
  if (clients.size === 0) return null;
  return [...clients.values()].reduce((a, b) => a + b, 0);
}

/** Electron's processes, the only ones that open the GPU. */
function listOwnPids(): number[] {
  const pids: number[] = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      if (OWN_PROCESS.test(readFileSync(`/proc/${name}/comm`, 'utf8'))) pids.push(Number(name));
    } catch (error) {
      logExpected('linux-gpu: read process name', 'a process can exit between the /proc listing and this read', error);
    }
  }
  return pids;
}
