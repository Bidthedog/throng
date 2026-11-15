import type { IOrphanProcesses } from '../abstractions/platform-seams.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`IOrphanProcesses contract violation: ${message}`);
}

export interface StartedProcess {
  readonly pid: number;
  /** End it, if it is still running, and wait until it has gone. */
  stop(): Promise<void>;
}

export interface OrphanProcessesContractEnv {
  make(): IOrphanProcesses;
  /** The test's own pid: its children have it as their parent. */
  readonly selfPid: number;
  /** A long-running child of the test's own process. */
  startChild(): Promise<StartedProcess>;
  /** A long-running process whose parent has exited, so the system has adopted it. */
  startOrphan(): Promise<StartedProcess>;
  isAlive(pid: number): boolean;
  /** A pid no process has. */
  readonly unusedPid: number;
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reusable contract for any `IOrphanProcesses` (062 FR-018, 070 FR-018, R10): the table the daemon's startup sweep
 * reads, where a process the system adopted reports no parent (-1), and the means to end one. In behaviour terms;
 * throws on the first violation.
 */
export async function runOrphanProcessesContract(env: OrphanProcessesContractEnv): Promise<void> {
  const subject = env.make();
  const child = await env.startChild();
  const orphan = await env.startOrphan();
  try {
    const table = await subject.snapshot();
    for (const row of table) {
      assert(Number.isInteger(row.pid) && row.pid > 0, `every row needs a pid; got ${JSON.stringify(row)}`);
      assert(Number.isInteger(row.ppid), `every row needs a ppid; got ${JSON.stringify(row)}`);
      assert(typeof row.name === 'string', `every row needs a name; got ${JSON.stringify(row)}`);
      assert(typeof row.commandLine === 'string', `every row needs a command line; got ${JSON.stringify(row)}`);
      assert(Number.isFinite(row.createdMs), `every row needs a start time; got ${JSON.stringify(row)}`);
    }
    const self = table.find((row) => row.pid === env.selfPid);
    assert(self !== undefined && self.name.length > 0, 'the table must hold the test process, named');
    assert(self.createdMs > 0, 'a live process must carry its start time');

    const childRow = table.find((row) => row.pid === child.pid);
    assert(childRow?.ppid === env.selfPid, `a child must name its living parent; got ${JSON.stringify(childRow)}`);

    const orphanRow = table.find((row) => row.pid === orphan.pid);
    assert(orphanRow?.ppid === -1, `an adopted process must report no parent (-1); got ${JSON.stringify(orphanRow)}`);

    assert((await subject.kill(orphan.pid)) === true, 'ending a live process of this user must be attempted');
    for (let waited = 0; env.isAlive(orphan.pid) && waited < 3000; waited += 25) await settle(25);
    assert(!env.isAlive(orphan.pid), 'a process kill was attempted on must end');
    assert(env.isAlive(child.pid), 'ending one process must leave the others alone');

    assert((await subject.kill(env.unusedPid)) === false, 'ending a pid no process has must report that it could not');
  } finally {
    await orphan.stop();
    await child.stop();
  }
}
