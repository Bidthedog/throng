import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { IpcServer } from '../../src/ipc-server.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { HealthService } from '../../src/health-service.js';

let counter = 0;
const startedServers: IpcServer[] = [];

/** Build an IpcServer wired with only the health.ping method (001 behaviour). */
function makeServer(pipeName: string): IpcServer {
  const router = new RpcRouter();
  new HealthService().register(router);
  return new IpcServer({ pipeName, startupTimeoutMs: 5000 }, router);
}

function uniquePipeName(): string {
  counter += 1;
  return `\\\\.\\pipe\\throng-test-${process.pid}-${counter}`;
}

function sendOnce(pipeName: string, request: object): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const socket = connect(pipeName);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });
    socket.on('error', reject);
  });
}

afterEach(async () => {
  for (const server of startedServers.splice(0)) {
    await server.stop();
  }
});

async function startServer(pipeName: string): Promise<void> {
  const server = makeServer(pipeName);
  startedServers.push(server);
  await server.start();
}

describe('daemon health.ping IPC', () => {
  it('responds to health.ping with a well-formed pong over the real pipe', async () => {
    const pipeName = uniquePipeName();
    await startServer(pipeName);

    const response = await sendOnce(pipeName, {
      jsonrpc: '2.0',
      id: 1,
      method: 'health.ping',
      params: {},
    });

    expect(response.id).toBe(1);
    expect(response.result.status).toBe('ok');
    expect(typeof response.result.pid).toBe('number');
    expect(response.result.daemonStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(Number.isNaN(Date.parse(response.result.daemonStartedAt))).toBe(false);
  });

  it('returns a JSON-RPC method-not-found error for unknown methods', async () => {
    const pipeName = uniquePipeName();
    await startServer(pipeName);

    const response = await sendOnce(pipeName, {
      jsonrpc: '2.0',
      id: 7,
      method: 'does.not.exist',
      params: {},
    });

    expect(response.id).toBe(7);
    expect(response.error.code).toBe(-32601);
  });

  it('stops promptly even with an open client connection', async () => {
    const pipeName = uniquePipeName();
    const server = makeServer(pipeName);
    await server.start();

    const socket = connect(pipeName);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('error', reject);
    });

    // stop() must destroy lingering connections rather than block on them.
    const outcome = await Promise.race([
      server.stop().then(() => 'stopped'),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('stop() timed out')), 2000),
      ),
    ]);
    expect(outcome).toBe('stopped');
    socket.destroy();
  });

  it('surfaces an explicit error when the pipe name is already in use', async () => {
    const pipeName = uniquePipeName();
    await startServer(pipeName);

    const second = makeServer(pipeName);
    startedServers.push(second);
    await expect(second.start()).rejects.toThrow(/in use/i);
  });
});
