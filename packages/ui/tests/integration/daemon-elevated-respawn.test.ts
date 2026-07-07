import { execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonInfo, ensureDaemon } from '../../src/main/daemon-lifecycle.js';

// T126 / FR-025b: when the app is elevated but a running daemon is NOT, ensureDaemon
// must retire that daemon and respawn (an elevated app spawns an elevated daemon, so
// terminals can run "as administrator"). A process's integrity cannot be raised in
// place, so replacement is the only path. This exercises the real ensureDaemon over the
// pipe against the built daemon; the test process is medium-integrity, so the daemon it
// spawns reports elevated=false — exactly the case an elevated app must replace.

const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

// These tests set up a NON-elevated daemon (the case an elevated app must replace),
// which only holds when the test runner is itself medium-integrity. On an elevated
// runner the spawned daemon is elevated too, so the "reports elevated=false" and
// "elevated app respawns a non-elevated daemon" cases can't be arranged — skip them
// (the elevated path has @admin E2E coverage). `net session` succeeds only elevated.
function runnerElevated(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'net.exe'), ['session'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

let counter = 0;
const uniquePipe = (): string => `\\\\.\\pipe\\throng-elev-${process.pid}-${Date.now()}-${counter++}`;

const spawned: ChildProcess[] = [];
const dataDirs: string[] = [];

function makeOpts(pipeName: string, appElevated?: boolean): Parameters<typeof ensureDaemon>[0] {
  const dir = mkdtempSync(join(tmpdir(), 'throng-elev-'));
  dataDirs.push(dir);
  return {
    pipeName,
    daemonEntry,
    databasePath: join(dir, 'throng.db'),
    readyTimeoutMs: 15_000,
    pingTimeoutMs: 800,
    appElevated,
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

describe('ensureDaemon — elevated-daemon respawn (FR-025b)', () => {
  it.skipIf(runnerElevated())('the daemon reports its (medium) integrity via health.ping', async () => {
    const pipe = uniquePipe();
    const res = await ensureDaemon(makeOpts(pipe));
    if (res.child) spawned.push(res.child);
    const info = await daemonInfo(pipe, 1000);
    expect(info?.elevated).toBe(false); // this runner is not elevated
  });

  it.skipIf(runnerElevated())('an elevated app retires a non-elevated daemon and respawns it', async () => {
    const pipe = uniquePipe();
    const first = await ensureDaemon(makeOpts(pipe));
    if (first.child) spawned.push(first.child);
    expect(first.spawned).toBe(true);
    const oldPid = (await daemonInfo(pipe, 1000))?.pid;

    // Same code/build, but the app is now elevated while the daemon is not → replace.
    const second = await ensureDaemon(makeOpts(pipe, true));
    if (second.child) spawned.push(second.child);

    expect(second.restarted).toBe(true);
    expect(second.spawned).toBe(true);
    const after = await daemonInfo(pipe, 1000);
    expect(after?.pid).not.toBe(oldPid); // a different, freshly-spawned daemon
  });

  it('a non-elevated app reuses the running daemon (no respawn)', async () => {
    const pipe = uniquePipe();
    const first = await ensureDaemon(makeOpts(pipe));
    if (first.child) spawned.push(first.child);
    expect(first.spawned).toBe(true);
    const oldPid = (await daemonInfo(pipe, 1000))?.pid;

    const second = await ensureDaemon(makeOpts(pipe, false));
    if (second.child) spawned.push(second.child);

    expect(second.spawned).toBe(false); // reused — nothing to elevate
    expect((await daemonInfo(pipe, 1000))?.pid).toBe(oldPid);
  });
});
