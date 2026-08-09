import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDaemon } from '../../src/main/daemon-lifecycle.js';

/**
 * #192 — a dev or E2E instance MUST NOT kill another instance's daemon.
 *
 * ══ THE DEFECT ══
 *
 * `ensureDaemon` retires any daemon on its pipe whose build id does not match the on-disk build.
 * That is correct for OUR daemon running older code, and catastrophic for someone else's: two throng
 * instances on one machine — a packaged install beside a dev build, or a dev build beside an E2E run
 * — is not an edge case, it is how throng is developed. Killing the other one ends every terminal it
 * owns, with no warning, and a raw ENOENT for everything the user does afterwards.
 *
 * Instance separation (`instancePipeName`) is supposed to keep the pipes apart, and it is the first
 * line of defence rather than a guarantee. It failed at least once in exactly the way you would
 * expect: `app-shell.e2e.ts` launched Electron directly and — alone among the twelve specs that do —
 * set no `THRONG_PIPE_NAME`, so it ran on the shared default dev pipe and would retire whatever
 * daemon it found there, including a developer's own `npm start` instance.
 *
 * So the promise is made unconditional here instead: a daemon reports which entry it is running, and
 * one that is not ours is left alone whatever its build id says.
 */

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  vi.restoreAllMocks();
});

/**
 * A fake daemon on `pipeName` that answers `health.ping` with whatever pong we hand it.
 *
 * AWAITED, because `listen` is asynchronous: connecting before it has bound fails instantly, which
 * made every assertion in this file fail for the same wrong reason, in 3ms.
 */
async function fakeDaemon(pipeName: string, pong: Record<string, unknown>): Promise<Server> {
  const server = createServer((socket) => {
    socket.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        const req = JSON.parse(line) as { id: number };
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: req.id, result: pong })}\n`);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(pipeName, resolve));
  return server;
}

/**
 * A daemon entry on disk, STAMPED with a build id.
 *
 * `currentBuildId` reads BUILD_ID beside the entry and returns null without one — and a null on-disk
 * build makes `stale` false, so `ensureDaemon` returns before it ever reaches the guard under test.
 * The fixture has to be a build, not merely a file.
 */
function entryFile(buildId: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-192-'));
  const file = join(dir, 'main.js');
  writeFileSync(file, '// daemon entry', 'utf8');
  writeFileSync(join(dir, 'BUILD_ID'), buildId, 'utf8');
  return file;
}

let seq = 0;
const pipe = (): string => `\\\\.\\pipe\\throng-192-${process.pid}-${seq++}`;

describe('ensureDaemon and another instance (#192)', () => {
  it('leaves a daemon belonging to a DIFFERENT entry alone, however stale it looks', async () => {
    const pipeName = pipe();
    const ours = entryFile('our-current-build');
    // A daemon on our pipe reporting a mismatching build id AND a different entry — which is exactly
    // what a packaged install, or another worktree, looks like from here.
    await fakeDaemon(pipeName, {
      status: 'ok',
      pid: 999_999,
      buildId: 'someone-elses-build',
      daemonEntry: 'E:/tools/throng/resources/app/packages/daemon/dist/main.js',
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const res = await ensureDaemon({
      pipeName,
      daemonEntry: ours,
      pingTimeoutMs: 2000,
      readyTimeoutMs: 2000,
    });

    // Nothing killed, nothing spawned — and it SAYS the pipe belongs to someone else rather than
    // reporting a healthy reuse, so a caller can tell "we have a daemon" from "we deliberately
    // have not taken one".
    expect(kill).not.toHaveBeenCalled();
    expect(res.spawned).toBe(false);
    expect(res.foreign).toBe(true);
  }, 30_000);

  it('still retires OUR daemon when its build is stale — the mechanism is not disabled', async () => {
    const pipeName = pipe();
    const ours = entryFile('our-current-build');
    await fakeDaemon(pipeName, {
      status: 'ok',
      pid: 999_999,
      buildId: 'old-build-of-ours',
      daemonEntry: ours,
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    // It tries to kill, waits for the pipe to free (our fake never leaves), then fails to spawn.
    // Only the attempted kill matters: the guard must not have swallowed the case it sits in front of.
    await ensureDaemon({
      pipeName,
      daemonEntry: ours,
      pingTimeoutMs: 500,
      readyTimeoutMs: 500,
    }).catch(() => undefined);

    expect(kill).toHaveBeenCalledWith(999_999);
  }, 30_000);

  it('retires a daemon that reports no entry at all — it predates the handshake', async () => {
    const pipeName = pipe();
    const ours = entryFile('our-current-build');
    // No `daemonEntry`: necessarily older code than this guard, so it can only be ours to replace.
    // Treating it as foreign would make the mechanism unable to replace the daemons it exists for.
    await fakeDaemon(pipeName, { status: 'ok', pid: 999_999, buildId: 'ancient' });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await ensureDaemon({
      pipeName,
      daemonEntry: ours,
      pingTimeoutMs: 500,
      readyTimeoutMs: 500,
    }).catch(() => undefined);

    expect(kill).toHaveBeenCalledWith(999_999);
  }, 30_000);

  it('recognises its own entry through a different spelling of the same path', async () => {
    const pipeName = pipe();
    const ours = entryFile('our-current-build');
    // The two sides come from different worlds: `process.argv[1]` as the OS spelled it, versus a path
    // resolved from the app's install root. A case or separator difference must not make our own
    // daemon look like a stranger — that would leave a stale daemon running for ever.
    await fakeDaemon(pipeName, {
      status: 'ok',
      pid: 999_999,
      buildId: 'stale',
      daemonEntry: ours.replace(/\\/g, '/').toUpperCase(),
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await ensureDaemon({
      pipeName,
      daemonEntry: ours,
      pingTimeoutMs: 500,
      readyTimeoutMs: 500,
    }).catch(() => undefined);

    expect(kill).toHaveBeenCalledWith(999_999);
  }, 30_000);
});
