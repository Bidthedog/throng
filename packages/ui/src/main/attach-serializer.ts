/**
 * Serialize terminal attaches (005 Phase C fix). Opening a project mounts every
 * Terminal Panel at once, so their `terminal.attach` RPCs fire in parallel — but each
 * starts its own RPC timeout clock immediately, while the daemon cold-starts PTYs one
 * at a time (synchronous node-pty spawn). The later attaches then time out waiting
 * behind the earlier cold-starts, even though nothing is wrong. Running them through a
 * FIFO queue makes each terminal's timeout window start when ITS load starts, not when
 * the whole batch fired.
 *
 * Returns a function that enqueues an async task and resolves/rejects with that task's
 * own result. Tasks run strictly in submission order, each starting only after the
 * previous one settles (success OR failure — one failure never stalls the queue).
 */
export function createSerializer(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(() => task());
    // Keep the chain moving whether this task fulfilled or rejected.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
