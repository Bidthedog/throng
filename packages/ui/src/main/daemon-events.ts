import { connect, type Socket } from 'node:net';
import { BrowserWindow } from 'electron';
import { broadcastToWindows } from './broadcast.js';
import {
  TERMINAL_SUBSCRIBE_METHOD,
  TERMINAL_OUTPUT_NOTIFICATION,
  TERMINAL_EXIT_NOTIFICATION,
  TERMINAL_FLAVOUR_MISSING_NOTIFICATION,
} from '@throng/ipc-contract';

/**
 * Long-lived daemon→UI events channel (005 Phase C). Holds one subscribed socket
 * to the daemon and forwards `terminal.output`/`terminal.exit`/`flavourMissing`
 * notifications to **every** renderer window via `webContents.send`. Broadcasting
 * to all windows (each filters by panelId) is what makes a mirrored panel show one
 * session in many views (FR-021). Reconnects if the socket drops (e.g. a daemon
 * restart) so streaming resumes.
 */
export class DaemonEvents {
  private socket: Socket | null = null;
  private stopped = false;

  constructor(private readonly pipeName: string) {}

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.destroy();
    this.socket = null;
  }

  private open(): void {
    const socket = connect(this.pipeName);
    this.socket = socket;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: TERMINAL_SUBSCRIBE_METHOD, params: {} })}\n`),
    );
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) this.dispatch(line);
        nl = buffer.indexOf('\n');
      }
    });
    socket.on('close', () => {
      this.socket = null;
      if (!this.stopped) setTimeout(() => this.open(), 500);
    });
    socket.on('error', () => socket.destroy());
  }

  private dispatch(line: string): void {
    let msg: { method?: string; params?: unknown };
    try {
      msg = JSON.parse(line) as { method?: string; params?: unknown };
    } catch {
      return;
    }
    const channel =
      msg.method === TERMINAL_OUTPUT_NOTIFICATION
        ? 'throng:terminal:output'
        : msg.method === TERMINAL_EXIT_NOTIFICATION
          ? 'throng:terminal:exit'
          : msg.method === TERMINAL_FLAVOUR_MISSING_NOTIFICATION
            ? 'throng:terminal:flavourMissing'
            : null;
    if (!channel) return;
    broadcastToWindows(BrowserWindow.getAllWindows(), channel, msg.params);
  }
}
