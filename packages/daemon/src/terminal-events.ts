import 'reflect-metadata';
import { injectable } from 'inversify';
import {
  TERMINAL_OUTPUT_NOTIFICATION,
  TERMINAL_EXIT_NOTIFICATION,
  TERMINAL_FLAVOUR_MISSING_NOTIFICATION,
  TERMINAL_GRID_NOTIFICATION,
} from '@throng/ipc-contract';

/** Anything that can receive a serialized notification frame (a connected socket). */
export interface NotificationSink {
  write(frame: string): unknown;
}

/**
 * Daemon→UI streaming publisher (005 Phase C, contracts/terminal-rpc.md). Holds
 * the set of subscribed "events" sockets and fans JSON-RPC **notifications** out to
 * all of them. With single-instance UI, broadcasting every panel's output to the
 * (one) events socket — which UI main forwards to every window — is what makes a
 * mirrored panel show one session in many views (FR-021); each view filters by
 * `panelId`.
 */
@injectable()
export class TerminalEvents {
  private readonly sinks = new Set<NotificationSink>();

  addSink(sink: NotificationSink): void {
    this.sinks.add(sink);
  }

  removeSink(sink: NotificationSink): void {
    this.sinks.delete(sink);
  }

  /** Number of subscribed sinks — a closed events socket must drop to release it
   *  (no leaked subscribers when a sub-workspace window closes, FR-021). */
  get sinkCount(): number {
    return this.sinks.size;
  }

  publishOutput(panelId: string, data: string): void {
    this.emit(TERMINAL_OUTPUT_NOTIFICATION, { panelId, data });
  }

  publishExit(
    panelId: string,
    code: number | null,
    signal: string | undefined,
    unexpected: boolean,
  ): void {
    this.emit(TERMINAL_EXIT_NOTIFICATION, { panelId, code, signal, unexpected });
  }

  publishFlavourMissing(panelId: string, flavourId: string): void {
    this.emit(TERMINAL_FLAVOUR_MISSING_NOTIFICATION, { panelId, flavourId });
  }

  /**
   * The shared grid for a panel changed (008 FR-009/FR-013). Fanned to every view so
   * each conforms its xterm to the minimum grid — required for a full-screen program to
   * render identically in windows of different sizes (see TERMINAL_GRID_NOTIFICATION).
   * Published BEFORE the PTY resize so a view shrinks its xterm before the program's
   * resize-driven redraw arrives (that output travels the longer program round-trip).
   */
  publishGrid(panelId: string, cols: number, rows: number): void {
    this.emit(TERMINAL_GRID_NOTIFICATION, { panelId, cols, rows });
  }

  private emit(method: string, params: unknown): void {
    const frame = `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`;
    for (const sink of this.sinks) {
      try {
        sink.write(frame);
      } catch {
        this.sinks.delete(sink); // a dead socket drops out
      }
    }
  }
}
