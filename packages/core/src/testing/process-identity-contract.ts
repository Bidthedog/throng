import type { IProcessIdentity } from '../abstractions/claude-session.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`IProcessIdentity contract violation: ${message}`);
}

export interface StartedWithArgv {
  readonly pid: number;
  /** End it and wait until it has gone. */
  stop(): Promise<void>;
}

export interface ProcessIdentityContractEnv {
  make(): IProcessIdentity;
  /** Start a long-running process with exactly `argv` (argv[0] the program as named). */
  start(argv: readonly string[]): Promise<StartedWithArgv>;
  /** A pid no process has. */
  readonly unusedPid: number;
}

/**
 * An argument vector a command-line re-split would get wrong: spaces inside single arguments. The trailing `:` stops a
 * shell from replacing itself with `sleep`, which would change the vector under the test.
 */
const ARGV = ['/bin/sh', '-c', 'sleep 30; :', 'a b'] as const;

/**
 * Reusable contract for an `IProcessIdentity` that reads the real argument vector (068 FR-043, 070 FR-011): the
 * vector as the process was given it, and a start marker that names this process and no later one with its pid.
 * In behaviour terms; throws on the first violation.
 */
export async function runProcessIdentityContract(env: ProcessIdentityContractEnv): Promise<void> {
  const subject = env.make();
  const started = await env.start(ARGV);
  try {
    const argv = await subject.argv(started.pid);
    assert(Array.isArray(argv), `a live process's argv must be read; got ${JSON.stringify(argv)}`);
    assert(JSON.stringify(argv) === JSON.stringify(ARGV), `argv must be the vector the process was given; got ${JSON.stringify(argv)}`);

    const marker = await subject.startMarker(started.pid);
    assert(marker === undefined || (typeof marker === 'string' && marker.length > 0), 'a start marker is a non-empty string or absent');
    assert((await subject.startMarker(started.pid)) === marker, 'a start marker must not change for the life of the process');

    const other = await env.start(ARGV);
    try {
      const otherMarker = await subject.startMarker(other.pid);
      assert(otherMarker === undefined || otherMarker.length > 0, 'a start marker is a non-empty string or absent');
    } finally {
      await other.stop();
    }
  } finally {
    await started.stop();
  }

  assert((await subject.argv(env.unusedPid)) === undefined, 'a pid no process has must have no argv');
  assert((await subject.startMarker(env.unusedPid)) === undefined, 'a pid no process has must have no start marker');
  assert((await subject.argv(started.pid)) === undefined, 'a process that has ended must have no argv');
}
