import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDaemon } from '../../src/main/daemon-lifecycle.js';

/**
 * alpha6 — every terminal fails with "Failed to load native module: conpty.node … Cannot find module
 * './prebuilds/win32-x64//conpty.node'", and the require stack names
 * `%LOCALAPPDATA%\Temp\<random>\resources\app\…` — the PORTABLE build's self-extraction folder — even
 * when the user launched the INSTALLED throng.
 *
 * ══ THE HYPOTHESIS THIS TEST PINS ══
 *
 * The portable launcher unpacks to a temp folder and deletes it when the app exits. The daemon it
 * started is detached by design (Principle III) and survives, now running from a folder whose files
 * are gone — except the ones it already had open. node-pty loads `conpty.node` lazily, on the first
 * terminal, so that file is among the deleted.
 *
 * Every packaged throng for one user shares one pipe (only dev and packaged are separated), and a
 * daemon reporting the current build id is reused without looking at WHERE it runs. So the installed
 * app — or the next portable launch, from a fresh temp folder — adopts the orphan, and every terminal
 * it is asked for fails to load its native module.
 */

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

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

/** A stamped daemon entry, as a real install has it (`dist/main.js` beside `dist/BUILD_ID`). */
function entryFile(buildId: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-deleted-entry-'));
  dirs.push(dir);
  const file = join(dir, 'main.js');
  writeFileSync(file, '// daemon entry', 'utf8');
  writeFileSync(join(dir, 'BUILD_ID'), buildId, 'utf8');
  return file;
}

let seq = 0;
const pipe = (): string => `\\\\.\\pipe\\throng-deleted-entry-${process.pid}-${seq++}`;

describe('ensureDaemon and a daemon whose install folder has been deleted', () => {
  it('does not adopt a same-build daemon running from a folder that no longer exists', async () => {
    const pipeName = pipe();
    const ours = entryFile('alpha6-build');

    // The portable run's daemon: the same build, running from its self-extraction folder — which the
    // launcher has since deleted.
    const portable = entryFile('alpha6-build');
    rmSync(join(portable, '..'), { recursive: true, force: true });

    await fakeDaemon(pipeName, {
      status: 'ok',
      pid: 999_999,
      buildId: 'alpha6-build',
      daemonEntry: portable,
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const res = await ensureDaemon({
      pipeName,
      daemonEntry: ours,
      pingTimeoutMs: 500,
      readyTimeoutMs: 500,
    }).catch((error: unknown) => ({ threw: String(error) }));

    expect(
      res,
      'the app adopted a daemon whose code has been deleted from disk: every terminal it starts then ' +
        'fails to load conpty.node, which went with the folder',
    ).not.toEqual({ spawned: false });
    expect(kill, 'the orphaned daemon was left running on our pipe').toHaveBeenCalledWith(999_999);
  }, 30_000);

  it('retires an orphan of a DIFFERENT build too, rather than leaving it alone as a foreign instance', async () => {
    // The #192 guard spares another instance's daemon so its terminals survive. A deleted install
    // has no terminals it can start and nothing that will come back for it, so the guard must not
    // leave it squatting on the pipe for ever.
    const pipeName = pipe();
    const ours = entryFile('beta7-build');
    const portable = entryFile('alpha6-build');
    rmSync(join(portable, '..'), { recursive: true, force: true });

    await fakeDaemon(pipeName, {
      status: 'ok',
      pid: 999_998,
      buildId: 'alpha6-build',
      daemonEntry: portable,
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const res = await ensureDaemon({
      pipeName,
      daemonEntry: ours,
      pingTimeoutMs: 500,
      readyTimeoutMs: 500,
    }).catch(() => undefined);

    expect(res?.foreign).not.toBe(true);
    expect(kill).toHaveBeenCalledWith(999_998);
  }, 30_000);

  it('still reuses a same-build daemon whose entry exists — the ordinary case is untouched', async () => {
    const pipeName = pipe();
    const ours = entryFile('beta7-build');
    await fakeDaemon(pipeName, { status: 'ok', pid: 999_997, buildId: 'beta7-build', daemonEntry: ours });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const res = await ensureDaemon({ pipeName, daemonEntry: ours, pingTimeoutMs: 2000 });

    expect(res).toEqual({ spawned: false });
    expect(kill).not.toHaveBeenCalled();
  }, 30_000);
});
