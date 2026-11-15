import type { IProcessCwd } from '../abstractions/process-cwd.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`IProcessCwd contract violation: ${message}`);
}

/** A live process the harness started, and the folder it runs in as the OS spells it (symlinks resolved). */
export interface StartedInFolder {
  readonly pid: number;
  readonly dir: string;
  /** End it and wait until it has gone. */
  stop(): Promise<void>;
}

export interface ProcessCwdContractEnv {
  make(): IProcessCwd;
  /** Start a long-running process in a fresh folder. */
  startIn(): Promise<StartedInFolder>;
  /** A pid no process has. */
  readonly unusedPid: number;
}

/**
 * Reusable contract for any `IProcessCwd` (070 FR-018, contracts/platform-services-macos.md): a terminal's directory
 * read from the operating system. In behaviour terms, so every platform that implements the seam runs the same suite.
 * Throws on the first violation.
 */
export async function runProcessCwdContract(env: ProcessCwdContractEnv): Promise<void> {
  const subject = env.make();

  const empty = await subject.read([]);
  assert(empty instanceof Map && empty.size === 0, 'reading no pids must answer an empty map');

  const started = await env.startIn();
  try {
    const found = await subject.read([started.pid, env.unusedPid]);
    assert(found.get(started.pid) === started.dir, `a live process's cwd must be its folder; got ${JSON.stringify(found.get(started.pid))}, expected ${JSON.stringify(started.dir)}`);
    assert(!found.has(env.unusedPid), 'a pid no process has must be absent, not an error');
    for (const [pid, cwd] of found) assert(cwd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwd), `pid ${pid}'s cwd must be absolute; got ${JSON.stringify(cwd)}`);

    const again = await subject.read([started.pid, started.pid]);
    assert(again.get(started.pid) === started.dir, 'asking twice for one pid must answer it once, the same');

    const hostile = await subject.read([0, -1, Number.NaN, 2 ** 40]);
    assert(hostile instanceof Map, 'an impossible pid must be answered by absence, never a throw');
  } finally {
    await started.stop();
  }

  const gone = await subject.read([started.pid]);
  assert(!gone.has(started.pid), 'a process that has ended must be absent');
}
