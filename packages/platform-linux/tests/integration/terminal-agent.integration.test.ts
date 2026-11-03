import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipUnlessLinux } from '@throng/core/testing';

/**
 * Layer: integration. A real daemon over a real Unix socket starting a real shell, which is the one route from IPC to
 * PTY that no contract test crosses (062 T022). Needs `npm run build`, like every daemon-spawning layer.
 */
const daemonEntry = join(import.meta.dirname, '../../../daemon/dist/main.js');

describe.skipIf(skipUnlessLinux('Unix sockets and a POSIX shell'))('the daemon on Linux (062 FR-011, FR-010)', () => {
  let daemon: ChildProcess;
  let dir: string;
  const socket = (): string => join(dir, 'daemon.sock');

  const rpc = (method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown; error?: unknown }> =>
    new Promise((resolve, reject) => {
      const s = connect(socket());
      let buffer = '';
      s.setEncoding('utf8');
      s.once('error', reject);
      s.on('data', (chunk: string) => {
        buffer += chunk;
        const line = buffer.indexOf('\n');
        if (line < 0) return;
        s.destroy();
        resolve(JSON.parse(buffer.slice(0, line)) as { result?: unknown; error?: unknown });
      });
      s.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })}\n`);
    });

  const waitForDaemon = async (): Promise<void> => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        await rpc('health.ping');
        return;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'throng-d-'));
    daemon = spawn(process.execPath, [daemonEntry], {
      env: {
        ...process.env,
        THRONG_PIPE_NAME: socket(),
        THRONG_DATABASE_PATH: join(dir, 'throng.db'),
        THRONG_NO_ORPHAN_REAP: '1',
      },
      stdio: 'ignore',
    });
    await waitForDaemon();
  }, 30_000);

  afterAll(async () => {
    daemon?.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers over its socket, and reports who it is', async () => {
    const pong = await rpc('health.ping');
    expect(pong.result).toMatchObject({ pid: daemon.pid });
  });

  it('a second daemon on a live socket does not take it from the first', { timeout: 20_000 }, async () => {
    const second = spawn(process.execPath, [daemonEntry], {
      env: { ...process.env, THRONG_PIPE_NAME: socket(), THRONG_DATABASE_PATH: join(dir, 'second.db'), THRONG_NO_ORPHAN_REAP: '1' },
      stdio: 'ignore',
    });
    await new Promise((resolve) => second.once('exit', resolve));
    const pong = await rpc('health.ping');
    expect(pong.result).toMatchObject({ pid: daemon.pid });
  });
});
