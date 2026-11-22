import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveIpcAddress } from '@throng/core';
import { RPC_MAX_LINE_CHARS } from '@throng/ipc-contract';
import { DaemonClient } from '../../src/main/daemon-client.js';
import { writeToTerminal } from '../../src/main/terminal-write.js';

/**
 * A large terminal paste against the daemon's request-line limit (`RPC_MAX_LINE_CHARS`).
 *
 * The daemon closes a connection whose request line grows past the limit, so a paste sent as one
 * `terminal.write` of a megabyte or so never reached the shell, and nothing said so.
 *
 * Layer: contract — the claim is that what UI main sends fits the limit the daemon's server enforces;
 * that needs a real socket and the shared constant, and nothing else.
 */

const PIPE = `\\\\.\\pipe\\throng-contract-write-limit-${process.pid}`;
const servers: Server[] = [];

/** A pipe server that, like the daemon's, drops a connection whose line passes the limit; else records `data`. */
async function daemonLike(received: string[]): Promise<void> {
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > RPC_MAX_LINE_CHARS) {
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as { id: number; params: { data: string } };
      received.push(request.params.data);
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } })}\n`);
    });
    socket.on('error', () => {});
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(resolveIpcAddress(PIPE), resolve));
}

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('a terminal paste larger than one request line', () => {
  it('reaches the session whole and in order', async () => {
    const received: string[] = [];
    await daemonLike(received);
    const client = new DaemonClient({ pipeName: PIPE, window: { width: 1, height: 1 }, pingTimeoutMs: 5_000, attachTimeoutMs: 5_000 } as never);
    // Newlines and quotes double in JSON; a control character grows six-fold.
    const paste = 'line "one"\n'.repeat(60_000) + '\u0001'.repeat(200_000) + 'end';

    await writeToTerminal(client, 'p1', paste);

    expect(received.join('')).toBe(paste);
  });
});
