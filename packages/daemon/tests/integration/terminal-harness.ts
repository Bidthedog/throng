/**
 * Shared helpers for the terminal daemon integration tests (005 Phase C). NOT a
 * test file (no `.test.ts`). Spins up a real IpcServer wired to the real
 * TerminalService (node-pty) + events publisher over a unique named pipe, and
 * provides RPC + events-socket clients.
 */
import { connect, type Socket } from 'node:net';
import process from 'node:process';
import { NodePtyHost, WindowsDirectoryLock } from '@throng/platform-windows';
import { IpcServer } from '../../src/ipc-server.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { TerminalService } from '../../src/terminal-service.js';

export const CMD = process.env.ComSpec ?? 'cmd.exe';

export interface TerminalDaemon {
  pipeName: string;
  events: TerminalEvents;
  service: TerminalService;
  lockManager: TerminalLockManager;
  router: RpcRouter;
  server: IpcServer;
  stop(): Promise<void>;
}

let counter = 0;

export async function startTerminalDaemon(opts: { elevated?: boolean } = {}): Promise<TerminalDaemon> {
  counter += 1;
  const pipeName = `\\\\.\\pipe\\throng-term-${process.pid}-${counter}`;
  const events = new TerminalEvents();
  const lockManager = new TerminalLockManager(new WindowsDirectoryLock());
  const elevation = { isElevated: () => opts.elevated === true };
  const service = new TerminalService(new NodePtyHost(), events, lockManager, elevation);
  const router = new RpcRouter();
  service.register(router);
  const server = new IpcServer({ pipeName, startupTimeoutMs: 5000 }, router, events);
  await server.start();
  return { pipeName, events, service, lockManager, router, server, stop: () => server.stop() };
}

let rpcId = 0;

/** One request/response RPC over a short-lived socket. */
export function rpcCall(pipeName: string, method: string, params: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(pipeName);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      rpcId += 1;
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params })}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try {
        resolve(JSON.parse(buffer.slice(0, nl)));
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });
    socket.on('error', reject);
  });
}

export interface EventsSocket {
  notifications: Array<{ method: string; params: any }>;
  close(): void;
}

/** A long-lived events socket: subscribes, then accumulates notification frames. */
export function openEventsSocket(pipeName: string): Promise<EventsSocket> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(pipeName);
    const notifications: Array<{ method: string; params: any }> = [];
    let buffer = '';
    let resolved = false;
    socket.setEncoding('utf8');
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'terminal.subscribe', params: {} })}\n`),
    );
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try {
            const msg = JSON.parse(line) as { id?: number; result?: unknown; method?: string; params?: unknown };
            if (msg.method) {
              notifications.push({ method: msg.method, params: msg.params });
            } else if (!resolved && msg.result) {
              resolved = true;
              resolve({ notifications, close: () => socket.end() });
            }
          } catch {
            /* ignore non-JSON */
          }
        }
        nl = buffer.indexOf('\n');
      }
    });
    socket.on('error', reject);
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a condition, and FAIL LOUDLY if it never arrives.
 *
 * ══ WHY THIS THROWS RATHER THAN RETURNING FALSE ══
 *
 * It used to return `false` on expiry, and most call sites discarded the result — so a wait that
 * gave up was indistinguishable from one that succeeded, and the test carried on with a precondition
 * that had never held. The failure then surfaced somewhere further down, as an assertion about
 * behaviour that was actually correct.
 *
 * Measured: `terminal-reattach.integration.test.ts` waited for the daemon to classify a session as
 * busy, gave up silently, and then failed with
 *
 *     AssertionError: expected [ 'idle1', 'busy1' ] to not include 'busy1'
 *
 * which reads as "closeIdle closed a busy session" — a serious-sounding daemon defect. The daemon
 * was right: nothing had made that session busy yet. An hour could be spent in the wrong file.
 *
 * No caller wants `false`: every site that binds the result asserts `.toBe(true)`. So expiry is
 * always a failure, and it now says so at the moment it happens, naming what it was waiting for.
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 8000,
  what = 'a condition',
): Promise<true> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(25);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
}
