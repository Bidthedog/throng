import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonInfo, ensureDaemon, pingDaemon } from '../../src/main/daemon-lifecycle.js';

// T065 (US3): the UI main spawns the persistent detached daemon if it is not
// already running, single-instances it (a second start just connects), and can
// reconnect. Exercised over the real named pipe against the built daemon.

const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

let counter = 0;
const uniquePipe = (): string => `\\\\.\\pipe\\throng-life-${process.pid}-${Date.now()}-${counter++}`;

const spawned: ChildProcess[] = [];
const dataDirs: string[] = [];

function makeOpts(pipeName: string): {
  pipeName: string;
  daemonEntry: string;
  databasePath: string;
  readyTimeoutMs: number;
  pingTimeoutMs: number;
} {
  const dir = mkdtempSync(join(tmpdir(), 'throng-life-'));
  dataDirs.push(dir);
  return {
    pipeName,
    daemonEntry,
    databasePath: join(dir, 'throng.db'),
    readyTimeoutMs: 15_000,
    pingTimeoutMs: 800,
  };
}

afterEach(async () => {
  // Wait on each daemon's exit (bounded) rather than a fixed sleep: the database folder cannot be
  // removed until the process holding it has gone.
  await Promise.all(
    spawned.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          const bound = setTimeout(resolve, 2000);
          child.once('exit', () => {
            clearTimeout(bound);
            resolve();
          });
          try {
            child.kill();
          } catch {
            clearTimeout(bound);
            resolve();
          }
        }),
    ),
  );
  for (const dir of dataDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  dataDirs.length = 0;
});

describe('ensureDaemon (spawn-if-absent + connect + single-instance)', () => {
  it('connects to an already-running daemon instead of spawning a second', async () => {
    const pipe = uniquePipe();
    const first = await ensureDaemon(makeOpts(pipe));
    if (first.child) spawned.push(first.child);
    expect(first.spawned).toBe(true);

    const second = await ensureDaemon(makeOpts(pipe));
    if (second.child) spawned.push(second.child);

    expect(second.spawned).toBe(false); // reused the running one
    expect(second.child).toBeUndefined();
    expect(await pingDaemon(pipe, 1000)).toBe(true);
  });

  it('two concurrent starts race to one daemon and both end up connected', async () => {
    const pipe = uniquePipe();
    const [a, b] = await Promise.all([ensureDaemon(makeOpts(pipe)), ensureDaemon(makeOpts(pipe))]);
    if (a.child) spawned.push(a.child);
    if (b.child) spawned.push(b.child);

    // Whoever lost the pipe race exits on EADDRINUSE; the daemon is reachable.
    expect(await pingDaemon(pipe, 1000)).toBe(true);
  });

  it('restarts a running daemon whose build id is stale (code changed since it started)', async () => {
    const pipe = uniquePipe();
    const buildIdPath = join(dirname(daemonEntry), 'BUILD_ID');
    const original = existsSync(buildIdPath) ? readFileSync(buildIdPath, 'utf8') : null;
    try {
      // Daemon starts stamped with build 'A'.
      writeFileSync(buildIdPath, 'test-A');
      const first = await ensureDaemon(makeOpts(pipe));
      if (first.child) spawned.push(first.child);
      expect(first.spawned).toBe(true);
      const oldPid = (await daemonInfo(pipe, 1000))?.pid;

      // A rebuild bumps the on-disk build id → the running daemon is now stale.
      writeFileSync(buildIdPath, 'test-B');
      const second = await ensureDaemon(makeOpts(pipe));
      if (second.child) spawned.push(second.child);

      expect(second.restarted).toBe(true);
      expect(second.spawned).toBe(true);
      const after = await daemonInfo(pipe, 1000);
      expect(after?.pid).not.toBe(oldPid); // a different, fresh daemon
      expect(after?.buildId).toBe('test-B'); // running the new build
    } finally {
      if (original !== null) writeFileSync(buildIdPath, original);
      else rmSync(buildIdPath, { force: true });
    }
  });

  // The buildId-less daemon (predates the build-id protocol) is retired: daemon-foreign-instance's
  // retire table carries that row against a fake daemon, with no real process spawned.
});
