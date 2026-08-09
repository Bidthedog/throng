import { connect, type Socket } from 'node:net';
import { BrowserWindow } from 'electron';
import { broadcastToWindows } from './broadcast.js';
import {
  TERMINAL_SUBSCRIBE_METHOD,
  TERMINAL_OUTPUT_NOTIFICATION,
  TERMINAL_EXIT_NOTIFICATION,
  TERMINAL_FLAVOUR_MISSING_NOTIFICATION,
  TERMINAL_GRID_NOTIFICATION,
  TERMINAL_CWD_NOTIFICATION,
  TERMINAL_COMMAND_NOTIFICATION,
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

  /**
   * 029 / #182 — the supervisor watching this socket.
   *
   * Optional so every existing construction site keeps working untouched: without one, this class
   * behaves exactly as it did, silently reconnecting forever.
   */
  constructor(
    private readonly pipeName: string,
    private readonly supervisor?: { onConnected(): void; onDisconnected(): void },
  ) {}

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
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: TERMINAL_SUBSCRIBE_METHOD, params: {} })}\n`);
      // 029 — a connected, subscribed events socket is the definition of "the daemon is usable".
      // It is also what cancels a grace still running from a previous close, so a blip the user
      // never noticed never becomes a notice.
      this.supervisor?.onConnected();
    });
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
      /*
       * 029 — this used to be the WHOLE story: retry in 500ms, forever, in silence. That silence is
       * exactly why a dead daemon left the app looking alive. The `stopped` guard keeps a
       * deliberate shutdown quiet, because closing throng is not a failure to report.
       */
      if (!this.stopped) {
        this.supervisor?.onDisconnected();
        setTimeout(() => this.open(), 500);
      }
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
            : msg.method === TERMINAL_GRID_NOTIFICATION
              ? 'throng:terminal:grid'
              : msg.method === TERMINAL_CWD_NOTIFICATION
                ? 'throng:terminal:cwd'
                : msg.method === TERMINAL_COMMAND_NOTIFICATION
                  ? 'throng:terminal:command'
                  : null;
    if (!channel) return;
    broadcastToWindows(BrowserWindow.getAllWindows(), channel, msg.params);
  }
}
