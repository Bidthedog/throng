import type { ChildProcess, IPtyHost, PtyExit } from '../abstractions/pty-host.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`IPtyHost contract violation: ${message}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      /*
       * PRINT THE MEASUREMENT, not only the violation.
       *
       * Every budget in this file was picked without data, and one of them was picked WRONG in a
       * way no green run could reveal — see the child-lifetime note below. A budget you only ever
       * see violated is one you can only ever tune blindly, so each wait now reports what it
       * actually took, and the next person changing these numbers has a distribution.
       */
      // Measured, because the obvious assumption is wrong: vitest's default reporter hides
      // BOTH streams for a PASSING test, so this shows under `--reporter=verbose` and in any
      // run that fails. That is not quite the "every run" the rule asks for; it is enough to
      // take a reading on demand (which is where the figures below came from), and saying so
      // here is cheaper than the next person re-discovering it.
      console.error(`[pty-contract] ${label}: ${Date.now() - started}ms`);
      return;
    }
    await sleep(25);
  }
  assert(false, `timed out after ${timeoutMs}ms waiting for ${label}`);
}

/**
 * What the OS-specific caller must supply so this pure suite can drive a real PTY
 * without knowing the platform's shell. Kept import-free so `@throng/core` stays
 * OS/Node-free.
 */
export interface PtyHostContractEnv {
  make(): IPtyHost;
  /** An existing directory to start shells in. */
  cwd: string;
  /** An interactive shell that stays open reading input (e.g. cmd.exe, no args). */
  interactiveShell: { file: string; args: string[] };
  /** A shell invocation that runs briefly then exits on its own (e.g. cmd /c ver). */
  selfExitingShell: { file: string; args: string[] };
  /** Input line that makes the interactive shell echo `marker` back. */
  echoLine(marker: string): string;
  /** Input line that starts a multi-second child process (a real child pid). */
  startChildLine(): string;
}

/**
 * Reusable contract suite for any `IPtyHost` implementation (005 Phase C). Drives
 * a real short-lived shell: spawn → echo → resize → child-pids → unsubscribe →
 * kill, plus a self-exiting process for the exit code. Throws on the first
 * violation. Guarded by timeouts so it can never hang a test run.
 */
export async function runPtyHostContract(env: PtyHostContractEnv): Promise<void> {
  const host = env.make();

  // 1. start → positive pid.
  const handle = host.start({ ...env.interactiveShell, cwd: env.cwd, cols: 80, rows: 24 });
  try {
    assert(typeof handle.pid === 'number' && handle.pid > 0, `start() must return a positive pid; got ${handle.pid}`);

    // 2. write a marker-echoing command → onData delivers a chunk containing it.
    let output = '';
    const offData = host.onData(handle, (chunk) => {
      output += chunk;
    });
    const marker = 'PTY_MARKER_7Q';
    host.write(handle, env.echoLine(marker));
    await waitFor(() => output.includes(marker), 8000, 'echoed marker in onData');

    // 3. resize does not throw.
    host.resize(handle, 100, 40);

    // 4. listChildPids: a running command surfaces a child pid that an idle shell
    //    does not. (Asserting "appears while busy" rather than "idle === []" keeps
    //    this robust to ConPTY infrastructure pids across Windows versions.)
    await sleep(400); // let the shell settle back to its prompt after the echo
    const idlePids = new Set(host.listChildPids(handle));
    host.write(handle, env.startChildLine());
    /*
     * ══ THIS BUDGET AND THE CHILD'S LIFETIME ARE RELATED, AND USED TO BE INVERTED ══
     *
     * This wait and the `listChildProcesses` one below both need the child to still be RUNNING.
     * Together they could wait 16 s — while `startChildLine` was `ping -n 6`, which lives about
     * five. So the probe window already exceeded the subject's lifetime: on hardware slow enough
     * that the process snapshot lagged, the child could start, run and EXIT before it was ever
     * observed, after which it could never appear and the wait burned its full budget.
     *
     * That inversion is invisible while the pid shows up quickly, which it does on a developer
     * workstation — measured there at 581 ms for this wait and 522 ms for the one below, i.e.
     * roughly a THIRTEENTH of the old 8 s budget. It failed on the self-hosted runner (run
     * 33983069120), where the process snapshot degrades under load by far more than that
     * machine's general 2.5-3x.
     *
     * Note that RAISING THIS NUMBER ALONE WOULD HAVE MADE IT WORSE: more time spent waiting for
     * a process that is already dead. The caller's child now lives ~39 s, beyond both waits.
     */
    await waitFor(
      () => host.listChildPids(handle).some((pid) => !idlePids.has(pid)),
      15_000,
      'a new child pid to appear while a command runs',
    );

    // 4b. listChildProcesses (025 FR-022): the same descendants, WITH command lines, and with
    //     ppids expressed relative to the handle this caller holds.
    //
    //     That last part is the whole reason this obligation exists. `PtyAgentHost` identifies a
    //     terminal by a synthetic key, not an OS pid, so an implementation that forwards raw OS
    //     ppids leaves every direct child unmatchable and silently disables command memory. It is
    //     invisible to `listChildPids`, which only ever counts pids and never inspects a ppid.
    //     Waited for, not asserted once: the pid check above proves a child EXISTS, but this call
    //     takes its own process snapshot which may be momentarily stale. Asserting immediately made
    //     the obligation itself flaky, which is worse than not having it.
    let procs: ChildProcess[] = [];
    await waitFor(
      async () => {
        procs = await host.listChildProcesses(handle);
        return procs.some((p) => p.ppid === handle.pid);
      },
      15_000,
      'a DIRECT child (ppid === handle.pid) to appear in listChildProcesses',
    );
    const direct = procs.find((p) => p.ppid === handle.pid);
    assert(
      typeof direct?.commandLine === 'string' && direct.commandLine.length > 0,
      'a direct child must carry a non-empty command line',
    );
    assert(
      Number.isFinite(direct?.startedAt),
      'a direct child must carry a finite startedAt',
    );

    // 5. unsubscribe stops further callbacks.
    offData();
    const before = output.length;
    host.write(handle, env.echoLine('SHOULD_NOT_APPEAR'));
    await sleep(500);
    assert(output.length === before, 'onData unsubscribe must stop further callbacks');

    // 4c. listChildProcesses never REJECTS (FR-019e): a failed observation must leave the last
    //     known command in place, so the caller is never handed an exception to swallow.
    const dead = await host.listChildProcesses({ pid: 999_999_999 }).catch(() => 'REJECTED');
    assert(dead !== 'REJECTED', 'listChildProcesses must resolve, never reject, for a dead handle');

    // 6. kill → onExit fires.
    let exited = false;
    host.onExit(handle, () => {
      exited = true;
    });
    host.kill(handle);
    await waitFor(() => exited, 8000, 'onExit after kill');
  } finally {
    try {
      host.kill(handle);
    } catch {
      /* already dead */
    }
  }

  // 7. a self-exiting process delivers onExit with a numeric exit code.
  const host2 = env.make();
  const selfExit = host2.start({ ...env.selfExitingShell, cwd: env.cwd, cols: 80, rows: 24 });
  let exit: PtyExit | null = null;
  host2.onExit(selfExit, (e) => {
    exit = e;
  });
  await waitFor(() => exit !== null, 8000, 'onExit from a self-exiting process');
  assert(exit !== null && typeof (exit as PtyExit).code === 'number', 'self-exiting process must report a numeric exit code');
}
