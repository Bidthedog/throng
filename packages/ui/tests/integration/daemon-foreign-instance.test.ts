import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDaemon, type EnsureDaemonOptions } from '../../src/main/daemon-lifecycle.js';

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
 *
 * Layer: integration — the fake daemon speaks the real named-pipe JSON-RPC that `ensureDaemon` pings.
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
 * A `process.kill` spy that behaves like a kill that worked: the fake daemon stops listening, so
 * `ensureDaemon`'s wait-for-the-pipe-to-free loop exits at once instead of running out its 5 s.
 */
function killSpyFreeing(server: Server): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'kill').mockImplementation(() => {
    server.close();
    return true;
  });
}

/**
 * A daemon entry on disk, STAMPED with a build id.
 *
 * `currentBuildId` reads BUILD_ID beside the entry and returns null without one — and a null on-disk
 * build makes `stale` false, so `ensureDaemon` returns before it ever reaches the guard under test.
 * The fixture has to be a build, not merely a file.
 */
function entryFile(buildId: string, layout: 'source' | 'packaged' = 'source'): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-192-'));
  // A packaged copy is not asar-packed, so its daemon runs from under `resources\app` (058 D7).
  const dir = layout === 'packaged' ? join(root, 'resources', 'app', 'packages', 'daemon', 'dist') : root;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'main.js');
  writeFileSync(file, '// daemon entry', 'utf8');
  writeFileSync(join(dir, 'BUILD_ID'), buildId, 'utf8');
  return file;
}

let seq = 0;
const pipe = (): string => `\\\\.\\pipe\\throng-192-${process.pid}-${seq++}`;

/** Options for a case that is expected to RETIRE the daemon; the replacement spawn may fail. */
const retiringOptions = (pipeName: string, daemonEntry: string): EnsureDaemonOptions => ({
  pipeName,
  daemonEntry,
  pingTimeoutMs: 500,
  readyTimeoutMs: 100,
});

describe('ensureDaemon and another instance (#192)', () => {
  it('leaves a daemon started from a DEVELOPMENT tree alone, however stale it looks', async () => {
    const pipeName = pipe();
    const ours = entryFile('our-current-build', 'packaged');
    // A daemon on our pipe reporting a mismatching build id AND a different entry, from a source
    // checkout — another worktree, or a developer's `npm start` (058 FR-018a keeps it safe).
    //
    // The other instance's entry must EXIST: #429 retires a daemon whose entry is gone from disk,
    // whoever it belongs to. This used a hardcoded `E:/tools/throng/…` path, which only ever
    // existed on one workstation — where it passed — and on the gate runner read as a deleted
    // install.
    const theirs = entryFile('someone-elses-build');
    await fakeDaemon(pipeName, {
      status: 'ok',
      pid: 999_999,
      buildId: 'someone-elses-build',
      daemonEntry: theirs,
      packaged: false,
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

  /*
   * Every row is a daemon `ensureDaemon` must RETIRE. The kill spy frees the fake's pipe, so the
   * replacement spawn (of a stub entry that exits) is what ends the run, not a 5 s wait; only the
   * attempted kill, and that the daemon was not reported foreign, matter.
   */
  interface RetireCase {
    name: string;
    pid: number;
    /** Builds our entry and the pong the daemon on our pipe answers with. */
    build: () => { ours: string; pong: Record<string, unknown> };
    replaceForeign?: boolean;
  }
  const retireCases: RetireCase[] = [
    {
      // 058 FR-021a (research D7): each user has ONE daemon, shared by every copy. Starting a copy of
      // a different build replaces it — ending its terminals, with no prompt — exactly as a stale
      // build of our own is replaced. Under #192 as first written that daemon was "foreign" and left
      // squatting on the pipe, so the new copy could start no daemon at all.
      name: 'a different-build daemon from ANOTHER PACKAGED copy on our pipe (058 FR-021a)',
      pid: 999_996,
      build: () => ({
        ours: entryFile('our-current-build', 'packaged'),
        pong: {
          status: 'ok',
          pid: 999_996,
          buildId: 'other-copy-build',
          daemonEntry: entryFile('other-copy-build', 'packaged'),
          packaged: true,
        },
      }),
    },
    {
      name: 'a pre-058 RELEASE daemon (no packaged field, entry under resources\\app) (058 D7)',
      pid: 999_995,
      build: () => ({
        ours: entryFile('our-current-build', 'packaged'),
        pong: { status: 'ok', pid: 999_995, buildId: 'pre-058-build', daemonEntry: entryFile('pre-058-build', 'packaged') },
      }),
    },
    {
      name: 'OUR daemon when its build is stale — the mechanism is not disabled',
      pid: 999_999,
      build: () => {
        const ours = entryFile('our-current-build');
        return { ours, pong: { status: 'ok', pid: 999_999, buildId: 'old-build-of-ours', daemonEntry: ours } };
      },
    },
    {
      // No `daemonEntry`: necessarily older code than the #192 guard, so it can only be ours to
      // replace. Treating it as foreign would make the mechanism unable to replace the daemons it
      // exists for.
      name: 'a daemon that reports no entry at all — it predates the handshake',
      pid: 999_998,
      build: () => ({
        ours: entryFile('our-current-build'),
        pong: { status: 'ok', pid: 999_998, buildId: 'ancient' },
      }),
    },
    {
      // Predates the build-id protocol itself (formerly daemon-lifecycle's fake-old-daemon case): it
      // cannot be left serving stale code just because it cannot name its build.
      name: 'a daemon that reports NO build id and no entry (predates the build-id protocol)',
      pid: 999_988,
      build: () => ({ ours: entryFile('current-build'), pong: { status: 'ok', pid: 999_988 } }),
    },
    {
      // #533 — a dev build may replace another dev checkout's daemon, but only on the user's say-so.
      name: 'another dev checkout’s daemon when asked to (#533)',
      pid: 999_990,
      replaceForeign: true,
      build: () => ({
        ours: entryFile('our-dev-build'),
        pong: {
          status: 'ok',
          pid: 999_990,
          buildId: 'other-checkout-build',
          daemonEntry: entryFile('other-checkout-build'),
          packaged: false,
        },
      }),
    },
    {
      // The two sides come from different worlds: `process.argv[1]` as the OS spelled it, versus a
      // path resolved from the app's install root. A case or separator difference must not make our
      // own daemon look like a stranger — that would leave a stale daemon running for ever.
      name: 'OUR stale daemon though it spells its own entry differently',
      pid: 999_987,
      build: () => {
        const ours = entryFile('our-current-build');
        return {
          ours,
          pong: { status: 'ok', pid: 999_987, buildId: 'stale', daemonEntry: ours.replace(/\\/g, '/').toUpperCase() },
        };
      },
    },
  ];

  it.each(retireCases)('retires $name', async ({ pid, build, replaceForeign }) => {
    const pipeName = pipe();
    const { ours, pong } = build();
    const server = await fakeDaemon(pipeName, pong);
    const kill = killSpyFreeing(server);

    const res = await ensureDaemon({ ...retiringOptions(pipeName, ours), replaceForeign }).catch(() => undefined);

    expect(res?.foreign).not.toBe(true);
    expect(kill).toHaveBeenCalledWith(pid);
  }, 30_000);

  /*
   * Review A2. Whether the stranger is a dev daemon is read from its ENTRY, here, not from a field it
   * has to volunteer: a dev daemon built before 058 reports no `packaged` field, and taking absence
   * to mean "packaged" would retire a developer's running terminals.
   */
  it('leaves a PRE-058 dev-tree daemon alone though it reports no packaged field (058 review A2)', async () => {
    const pipeName = pipe();
    const ours = entryFile('our-current-build', 'packaged');
    const theirs = entryFile('pre-058-dev-build');
    await fakeDaemon(pipeName, { status: 'ok', pid: 999_992, buildId: 'pre-058-dev-build', daemonEntry: theirs });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const res = await ensureDaemon({ pipeName, daemonEntry: ours, pingTimeoutMs: 2000, readyTimeoutMs: 2000 });

    expect(kill).not.toHaveBeenCalled();
    expect(res).toEqual({ spawned: false, foreign: true, foreignEntry: theirs });
  }, 30_000);

  it('a development build never retires a packaged copy’s daemon (058 FR-018a)', async () => {
    const pipeName = pipe();
    const ours = entryFile('our-dev-build');
    const theirs = entryFile('installed-build', 'packaged');
    await fakeDaemon(pipeName, {
      status: 'ok',
      pid: 999_994,
      buildId: 'installed-build',
      daemonEntry: theirs,
      packaged: true,
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const res = await ensureDaemon({ pipeName, daemonEntry: ours, pingTimeoutMs: 2000, readyTimeoutMs: 2000 });

    expect(kill).not.toHaveBeenCalled();
    expect(res).toEqual({ spawned: false, foreign: true, foreignEntry: theirs });
  }, 30_000);

  it('reuses a SAME-build daemon started by another packaged copy, so its terminals reattach (058 FR-021)', async () => {
    const pipeName = pipe();
    const ours = entryFile('shared-build', 'packaged');
    const theirs = entryFile('shared-build', 'packaged');
    await fakeDaemon(pipeName, {
      status: 'ok',
      pid: 999_993,
      buildId: 'shared-build',
      daemonEntry: theirs,
      packaged: true,
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const res = await ensureDaemon({ pipeName, daemonEntry: ours, pingTimeoutMs: 2000 });

    expect(res).toEqual({ spawned: false });
    expect(kill).not.toHaveBeenCalled();
  }, 30_000);

  /*
   * #533 — a dev build that leaves another checkout's daemon alone must still be able to SAY whose it
   * is, and replace it when the user asks. Left silent, the first call the older daemon does not know
   * reaches the user as "Method not found".
   */
  it('names the other checkout’s daemon entry when it leaves it alone (#533)', async () => {
    const pipeName = pipe();
    const ours = entryFile('our-dev-build');
    const theirs = entryFile('other-checkout-build');
    await fakeDaemon(pipeName, {
      status: 'ok',
      pid: 999_991,
      buildId: 'other-checkout-build',
      daemonEntry: theirs,
      packaged: false,
    });
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const res = await ensureDaemon({ pipeName, daemonEntry: ours, pingTimeoutMs: 2000, readyTimeoutMs: 2000 });

    expect(res).toEqual({ spawned: false, foreign: true, foreignEntry: theirs });
  }, 30_000);

  it('never replaces a packaged copy’s daemon from a dev build, even when asked (#533, 058 FR-018a)', async () => {
    const pipeName = pipe();
    const ours = entryFile('our-dev-build');
    const theirs = entryFile('installed-build', 'packaged');
    await fakeDaemon(pipeName, {
      status: 'ok',
      pid: 999_989,
      buildId: 'installed-build',
      daemonEntry: theirs,
      packaged: true,
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const res = await ensureDaemon({
      pipeName,
      daemonEntry: ours,
      pingTimeoutMs: 2000,
      readyTimeoutMs: 2000,
      replaceForeign: true,
    });

    expect(kill).not.toHaveBeenCalled();
    expect(res.foreign).toBe(true);
  }, 30_000);
});
