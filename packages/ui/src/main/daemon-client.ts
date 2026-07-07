import 'reflect-metadata';
import { connect, type Socket } from 'node:net';
import { injectable, inject } from 'inversify';
import {
  HEALTH_PING_METHOD,
  type DaemonStatus,
  type HealthPongResult,
  type JsonRpcResponse,
} from '@throng/ipc-contract';
import type { IUiSettings } from '@throng/core';
import { UI_TYPES } from './tokens.js';

/**
 * Named-pipe JSON-RPC client for the daemon `health.ping`. Always resolves —
 * never throws or hangs: connection failure, a malformed reply, or exceeding
 * the injected ping timeout all resolve to a daemon-unavailable outcome
 * (FR-010).
 */
/** A JSON-RPC error surfaced by the daemon, carrying its numeric code. */
export class DaemonRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'DaemonRpcError';
  }
}

@injectable()
export class DaemonClient {
  private nextId = 1;

  constructor(@inject(UI_TYPES.UiSettings) private readonly settings: IUiSettings) {}

  /**
   * Generic typed JSON-RPC call over the named pipe (002 / research D10). Used by
   * the `projects.*` and `workspace.*` bridges. Opens a short-lived connection
   * per call (matching the established 001 pattern), resolves with the `result`
   * payload, or rejects with a {@link DaemonRpcError} on a JSON-RPC error / a
   * plain Error on transport failure or timeout.
   */
  call<TResult>(method: string, params: unknown = {}): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      let settled = false;
      let buffer = '';
      const id = this.nextId++;
      const socket: Socket = connect(this.settings.pipeName);

      const finish = (run: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
        run();
      };

      const timer = setTimeout(
        () => finish(() => reject(new Error(`RPC "${method}" timed out`))),
        this.settings.pingTimeoutMs,
      );

      socket.setEncoding('utf8');
      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline).trim();
        try {
          const response = JSON.parse(line) as JsonRpcResponse<TResult>;
          if ('result' in response) {
            finish(() => resolve(response.result));
          } else if ('error' in response) {
            const { code, message, data } = response.error;
            finish(() => reject(new DaemonRpcError(message, code, data)));
          } else {
            finish(() => reject(new Error('invalid-response')));
          }
        } catch {
          finish(() => reject(new Error('invalid-response')));
        }
      });
      socket.on('error', (error: NodeJS.ErrnoException) => {
        finish(() => reject(new Error(error.code ?? 'daemon-unreachable')));
      });
    });
  }

  getStatus(): Promise<DaemonStatus> {
    return new Promise<DaemonStatus>((resolve) => {
      let settled = false;
      let buffer = '';
      const socket: Socket = connect(this.settings.pipeName);

      const finish = (status: DaemonStatus): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
        resolve(status);
      };

      const timer = setTimeout(
        () => finish({ available: false, reason: 'timeout' }),
        this.settings.pingTimeoutMs,
      );

      socket.setEncoding('utf8');

      socket.on('connect', () => {
        socket.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: HEALTH_PING_METHOD, params: {} })}\n`,
        );
      });

      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline).trim();
        try {
          const response = JSON.parse(line) as JsonRpcResponse<HealthPongResult>;
          if ('result' in response && response.result?.status === 'ok') {
            finish({ available: true, ...response.result });
          } else if ('error' in response) {
            finish({ available: false, reason: response.error.message });
          } else {
            finish({ available: false, reason: 'invalid-response' });
          }
        } catch {
          finish({ available: false, reason: 'invalid-response' });
        }
      });

      socket.on('error', (error: NodeJS.ErrnoException) => {
        finish({ available: false, reason: error.code ?? 'daemon-unreachable' });
      });
    });
  }
}
