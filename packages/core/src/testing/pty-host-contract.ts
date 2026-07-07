import type { IPtyHost, PtyExit } from '../abstractions/pty-host.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`IPtyHost contract violation: ${message}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  assert(false, `timed out waiting for ${label}`);
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
    await waitFor(
      () => host.listChildPids(handle).some((pid) => !idlePids.has(pid)),
      8000,
      'a new child pid to appear while a command runs',
    );

    // 5. unsubscribe stops further callbacks.
    offData();
    const before = output.length;
    host.write(handle, env.echoLine('SHOULD_NOT_APPEAR'));
    await sleep(500);
    assert(output.length === before, 'onData unsubscribe must stop further callbacks');

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
