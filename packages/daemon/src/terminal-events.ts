import 'reflect-metadata';
import { injectable } from 'inversify';
import {
  TERMINAL_OUTPUT_NOTIFICATION,
  TERMINAL_EXIT_NOTIFICATION,
  TERMINAL_GRID_NOTIFICATION,
  TERMINAL_CWD_NOTIFICATION,
  TERMINAL_COMMAND_NOTIFICATION,
  TERMINAL_ATTENTION_NOTIFICATION,
  type TerminalSubscribeParams,
} from '@throng/ipc-contract';
import {
  logExpected,
  TERMINAL_BATCH_INTERVAL_MS,
  TERMINAL_BATCH_MAX_CHARS,
  type AttentionSignal,
  type PtyExitFailure,
} from '@throng/core';

/** Anything that can receive a serialized notification frame (a connected socket). */
export interface NotificationSink {
  write(frame: string): unknown;
}

/** Output waiting to be delivered for one panel. */
interface PendingOutput {
  sessionId: number;
  chunks: string[];
  chars: number;
  end: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Daemon→UI streaming publisher (005 Phase C, contracts/terminal-rpc.md). Holds
 * the set of subscribed "events" sockets and fans JSON-RPC **notifications** out to
 * all of them. UI main routes a terminal's output on to the windows showing it (061 FR-001).
 */
@injectable()
export class TerminalEvents {
  private readonly sinks = new Set<NotificationSink>();
  private readonly lastSinkListeners = new Set<() => void>();
  private readonly subscribedListeners = new Set<(views: TerminalSubscribeParams['views']) => void>();
  private readonly pending = new Map<string, PendingOutput>();
  private readonly lastSentAt = new Map<string, number>();

  addSink(sink: NotificationSink): void {
    this.sinks.add(sink);
  }

  removeSink(sink: NotificationSink): void {
    if (this.sinks.delete(sink) && this.sinks.size === 0) for (const listener of this.lastSinkListeners) listener();
  }

  /** Called when the last events socket goes: no UI is attached any more (057 FR-099). */
  onLastSinkRemoved(listener: () => void): () => void {
    this.lastSinkListeners.add(listener);
    return () => this.lastSinkListeners.delete(listener);
  }

  /** A UI main (re)connected and said which views it is routing output to (061 FR-005a). */
  subscribed(views: TerminalSubscribeParams['views']): void {
    for (const listener of this.subscribedListeners) listener(views);
  }

  onSubscribed(listener: (views: TerminalSubscribeParams['views']) => void): () => void {
    this.subscribedListeners.add(listener);
    return () => this.subscribedListeners.delete(listener);
  }

  /** Number of subscribed sinks — a closed events socket must drop to release it
   *  (no leaked subscribers when a sub-workspace window closes, FR-021). */
  get sinkCount(): number {
    return this.sinks.size;
  }

  /** `end` is the session's output position after the last character of `data` (061 FR-010). */
  publishOutput(panelId: string, sessionId: number, data: string, end: number): void {
    let batch = this.pending.get(panelId);
    if (batch && batch.sessionId !== sessionId) {
      this.flush(panelId);
      batch = undefined;
    }
    if (!batch) {
      const sinceLast = Date.now() - (this.lastSentAt.get(panelId) ?? -Infinity);
      if (sinceLast >= TERMINAL_BATCH_INTERVAL_MS) {
        this.send(panelId, sessionId, [data], end);
        return;
      }
      batch = { sessionId, chunks: [], chars: 0, end, timer: this.deliverAfter(panelId, TERMINAL_BATCH_INTERVAL_MS - sinceLast) };
      this.pending.set(panelId, batch);
    }
    batch.chunks.push(data);
    batch.chars += data.length;
    batch.end = end;
    if (batch.chars >= TERMINAL_BATCH_MAX_CHARS) this.flush(panelId);
  }

  /** Deliver what is waiting for this panel now: before anything that must follow it, or a replay snapshot. */
  flush(panelId: string): void {
    const batch = this.pending.get(panelId);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.pending.delete(panelId);
    this.send(panelId, batch.sessionId, batch.chunks, batch.end);
  }

  /** The panel's terminal is gone: deliver what is left and hold nothing for it (061 FR-070). */
  forgetPanel(panelId: string): void {
    this.flush(panelId);
    this.lastSentAt.delete(panelId);
  }

  private deliverAfter(panelId: string, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.flush(panelId), ms);
    timer.unref?.();
    return timer;
  }

  /** Chunk boundaries travel with the delivery: a view's clear detection is per chunk (061 FR-022). */
  private send(panelId: string, sessionId: number, chunks: string[], end: number): void {
    this.lastSentAt.set(panelId, Date.now());
    this.emit(TERMINAL_OUTPUT_NOTIFICATION, {
      panelId,
      sessionId,
      data: chunks.join(''),
      end,
      ...(chunks.length > 1 ? { lengths: chunks.map((chunk) => chunk.length) } : {}),
    });
  }

  publishExit(
    panelId: string,
    code: number | null,
    signal: string | undefined,
    unexpected: boolean,
    sessionId?: number,
    failure?: PtyExitFailure,
  ): void {
    this.forgetPanel(panelId);
    this.emit(TERMINAL_EXIT_NOTIFICATION, { panelId, code, signal, unexpected, sessionId, ...(failure ? { failure } : {}) });
  }

  /**
   * The shared grid for a panel changed (008 FR-009/FR-013). Fanned to every view so
   * each conforms its xterm to the minimum grid — required for a full-screen program to
   * render identically in windows of different sizes (see TERMINAL_GRID_NOTIFICATION).
   * Published BEFORE the PTY resize so a view shrinks its xterm before the program's
   * resize-driven redraw arrives (that output travels the longer program round-trip).
   */
  publishGrid(panelId: string, cols: number, rows: number): void {
    this.flush(panelId);
    this.emit(TERMINAL_GRID_NOTIFICATION, { panelId, cols, rows });
  }

  /** A terminal's shell working directory changed (012 revision) — shown in its title. */
  publishCwd(panelId: string, cwd: string): void {
    this.flush(panelId);
    this.emit(TERMINAL_CWD_NOTIFICATION, { panelId, cwd });
  }

  /**
   * 025 FR-019: which command now holds this terminal, or null when it went idle — with 053's `arch`
   * of the program it names, null when idle or unreadable — and `observedAt`, when the reading behind it began
   * (epoch ms), so a renderer can tell a window title that arrived after the reading from one before it.
   */
  publishCommand(panelId: string, command: string | null, arch: string | null = null, observedAt?: number): void {
    this.flush(panelId);
    this.emit(TERMINAL_COMMAND_NOTIFICATION, { panelId, command, arch, ...(observedAt !== undefined ? { observedAt } : {}) });
  }

  /** 057: a terminal signal that may raise a panel attention mark (contracts/daemon-attention.md). */
  publishAttention(signal: AttentionSignal): void {
    this.flush(signal.panelId);
    this.emit(TERMINAL_ATTENTION_NOTIFICATION, signal);
  }

  private emit(method: string, params: unknown): void {
    const frame = `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`;
    for (const sink of this.sinks) {
      try {
        sink.write(frame);
      } catch (error) {
        logExpected('terminal-events: write to subscriber', 'a UI main that has gone leaves a dead socket, which drops out here', error);
        this.sinks.delete(sink);
      }
    }
  }
}
