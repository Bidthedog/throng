import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonInfo, ensureDaemon, pingDaemon } from '../../src/main/daemon-lifecycle.js';

const fakeOldDaemonEntry = fileURLToPath(new URL('./fixtures/fake-old-daemon.mjs', import.meta.url));

/** Start the pre-buildId fixture daemon on `pipe`; resolves once it is listening. */
function startFakeOldDaemon(pipe: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fakeOldDaemonEntry], {
      env: { ...process.env, THRONG_PIPE_NAME: pipe },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const t = setTimeout(() => reject(new Error('fake-old-daemon did not start')), 8000);
    child.stdout!.on('data', (c: Buffer) => {
      if (c.toString().includes('listening')) { clearTimeout(t); resolve(child); }
    });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

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
  for (const child of spawned) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  spawned.length = 0;
  await new Promise((r) => setTimeout(r, 400));
  for (const dir of dataDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  dataDirs.length = 0;
});

describe('ensureDaemon (spawn-if-absent + connect + single-instance)', () => {
  it('spawns a detached daemon when none is running, then it answers health.ping', async () => {
    const pipe = uniquePipe();
    expect(await pingDaemon(pipe, 300)).toBe(false); // nothing listening yet

    const res = await ensureDaemon(makeOpts(pipe));
    if (res.child) spawned.push(res.child);

    expect(res.spawned).toBe(true);
    expect(await pingDaemon(pipe, 1000)).toBe(true);
  });

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

  it('restarts a reachable daemon that reports NO build id (predates the build-id protocol)', async () => {
    // A daemon running code older than the build-id handshake answers health.ping
    // WITHOUT a buildId. The UI cannot leave it serving stale code (no close-dialog
    // metadata, old kill path) just because it can't name its build — it must be
    // retired and replaced, exactly like a mismatched build id.
    const pipe = uniquePipe();
    const buildIdPath = join(dirname(daemonEntry), 'BUILD_ID');
    const original = existsSync(buildIdPath) ? readFileSync(buildIdPath, 'utf8') : null;
    const fake = await startFakeOldDaemon(pipe);
    try {
      writeFileSync(buildIdPath, 'current-build'); // on-disk build is known
      expect((await daemonInfo(pipe, 1000))?.buildId).toBeUndefined(); // fixture reports none

      const res = await ensureDaemon(makeOpts(pipe));
      if (res.child) spawned.push(res.child);

      expect(res.restarted).toBe(true); // the pre-buildId daemon was treated as stale
      expect(res.spawned).toBe(true);
      const after = await daemonInfo(pipe, 1000);
      expect(after?.buildId).toBe('current-build'); // a fresh daemon on the new build
    } finally {
      try { fake.kill(); } catch { /* already gone */ }
      if (original !== null) writeFileSync(buildIdPath, original);
      else rmSync(buildIdPath, { force: true });
    }
  });
});
