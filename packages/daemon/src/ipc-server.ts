import 'reflect-metadata';
import { createServer, type Server, type Socket } from 'node:net';
import { injectable, inject } from 'inversify';
import { TERMINAL_SUBSCRIBE_METHOD, type JsonRpcRequest } from '@throng/ipc-contract';
import type { IDaemonSettings } from '@throng/core';
import { DAEMON_TYPES } from './tokens.js';
import type { RpcRouter } from './rpc-router.js';
import { TerminalEvents } from './terminal-events.js';

/**
 * Named-pipe JSON-RPC 2.0 server (newline-delimited). Owns only the wire
 * transport; method dispatch is delegated to the injected {@link RpcRouter}, so
 * new methods (projects.*, workspace.*) plug in at composition time without
 * touching this class (SRP/OCP). The pipe name is injected configuration; a
 * pipe-name-in-use conflict is surfaced explicitly (spec Edge Case).
 */
/** Guard against an unbounded read buffer from a client that never sends a newline. */
const MAX_LINE_BYTES = 1_000_000;

@injectable()
export class IpcServer {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();

  constructor(
    @inject(DAEMON_TYPES.DaemonSettings) private readonly settings: IDaemonSettings,
    @inject(DAEMON_TYPES.RpcRouter) private readonly router: RpcRouter,
    // Injected by the container; defaulted so tests can construct the server with
    // just settings + router (the terminal events channel is exercised separately).
    @inject(DAEMON_TYPES.TerminalEvents)
    private readonly terminalEvents: TerminalEvents = new TerminalEvents(),
  ) {}

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        if (error.code === 'EADDRINUSE') {
          reject(
            new Error(`throng daemon pipe "${this.settings.pipeName}" is already in use.`, {
              cause: error,
            }),
          );
        } else {
          reject(error);
        }
      };
      server.once('error', onError);
      server.listen(this.settings.pipeName, () => {
        server.removeListener('error', onError);
        this.server = server;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    // Destroy lingering connections so shutdown is prompt and the pipe is
    // released, rather than waiting on open clients (portable across socket
    // types; FR-005).
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private handleConnection(socket: Socket): void {
    socket.setEncoding('utf8');
    this.sockets.add(socket);
    socket.on('close', () => {
      this.sockets.delete(socket);
      this.terminalEvents.removeSink(socket); // drop a closed events socket (FR-021)
    });
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE_BYTES) {
        socket.destroy();
        return;
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) void this.handleLine(socket, line);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('error', () => socket.destroy());
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      return; // malformed line: no id to respond to
    }
    // A `terminal.subscribe` makes this a long-lived events socket: register it to
    // receive server-initiated notifications, then ack (don't route).
    if (request.method === TERMINAL_SUBSCRIBE_METHOD) {
      this.terminalEvents.addSink(socket);
      this.write(socket, { jsonrpc: '2.0', id: request.id, result: { ok: true } });
      return;
    }
    const response = await this.router.handle(request);
    this.write(socket, response);
  }

  private write(socket: Socket, message: object): void {
    socket.write(`${JSON.stringify(message)}\n`);
  }
}
