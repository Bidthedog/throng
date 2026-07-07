import { connect, type Socket } from 'node:net';
import process from 'node:process';
import type { IPtyHost, PtyExit, PtyHandle, PtyStartOptions } from '@throng/core';
import { encodeLine, type AgentCommand, type AgentEvent } from './pty-agent-protocol.js';

/**
 * Daemon-side proxy `IPtyHost` (FR-025c) that hosts terminals in the **de-elevated
 * PTY agent** instead of in-process. It creates the named-pipe server, launches the
 * agent (via the injected `launch` — a normal spawn in tests, the OS de-elevated
 * launcher in production), and forwards start/write/resize/kill/child-pids to it,
 * relaying output/exit back. Terminals are keyed by a synthetic integer (the
 * `PtyHandle.pid` handed to `TerminalService`); the OS pid never crosses the seam.
 *
 * `IPtyHost.start` is synchronous but the agent is async, so `start()` returns a
 * handle immediately and queues the command until the agent connects (then flushes).
 */
export class PtyAgentHost implements IPtyHost {
  private socket: Socket | null = null;
  private readonly outbox: string[] = [];
  private buffer = '';
  private nextKey = 1;
  private disposing = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly dataCbs = new Map<number, Set<(chunk: string) => void>>();
  private readonly exitCbs = new Map<number, Set<(e: PtyExit) => void>>();
  private readonly childpids = new Map<number, number[]>();

  constructor(
    private readonly pipeName: string,
    private readonly launch: (pipeName: string) => void,
  ) {
    // The agent (medium) owns the pipe SERVER; the daemon (possibly elevated)
    // connects DOWN to it. Launch the agent, then connect with retry — it needs a
    // moment to start and listen (and the de-elevated launch is async).
    this.launch(pipeName);
    this.connectWithRetry(Date.now() + 15_000);
  }

  private connectWithRetry(deadline: number): void {
    if (this.disposing) return;
    const sock = connect(this.pipeName);
    let connected = false;
    sock.setEncoding('utf8');
    sock.on('connect', () => {
      connected = true;
      this.socket = sock;
      // First frame: hand the agent our pid so it self-terminates (reaping its
      // terminals) if we die without a clean pipe close (T134).
      sock.write(encodeLine({ op: 'hello', daemonPid: process.pid }));
      for (const line of this.outbox) sock.write(line);
      this.outbox.length = 0;
    });
    sock.on('data', (chunk: string) => this.ingest(chunk));
    sock.on('close', () => {
      if (this.socket === sock) this.socket = null;
      if (this.disposing || !connected) return;
      // An ESTABLISHED agent connection dropped: the agent process died (crash /
      // external kill) while the daemon lives. Its ConPTYs are gone, so surface an
      // unexpected exit for every still-live terminal — otherwise those sessions
      // hang 'running' forever, the UI never reverts (FR-017/020) and the project
      // root lock is never released. Then relaunch the agent so future de-elevated
      // terminals can start rather than queueing into the outbox indefinitely.
      this.failAllLive('the terminal agent stopped unexpectedly');
      this.launch(this.pipeName);
      this.connectWithRetry(Date.now() + 15_000);
    });
    sock.on('error', () => {
      // Agent not listening yet (ENOENT) or gone — retry until the deadline. A drop
      // of an already-connected socket is handled by 'close' above, not here.
      if (this.disposing || connected || this.socket) return;
      if (Date.now() < deadline) {
        this.retryTimer = setTimeout(() => this.connectWithRetry(deadline), 200);
      }
    });
  }

  /** Fire an unexpected exit for every live terminal and forget them. */
  private failAllLive(reason: string): void {
    for (const key of new Set([...this.dataCbs.keys(), ...this.exitCbs.keys()])) {
      this.dataCbs.get(key)?.forEach((cb) => cb(`\r\n[throng] ${reason}\r\n`));
      this.exitCbs.get(key)?.forEach((cb) => cb({ code: null }));
      this.forgetKey(key);
    }
  }

  /** Drop all per-terminal state for a key that has ended (avoids leaks + double-fire). */
  private forgetKey(key: number): void {
    this.dataCbs.delete(key);
    this.exitCbs.delete(key);
    this.childpids.delete(key);
  }

  private sendCmd(cmd: AgentCommand): void {
    const line = encodeLine(cmd);
    if (this.socket) this.socket.write(line);
    else this.outbox.push(line);
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        this.onEvent(JSON.parse(line) as AgentEvent);
      } catch {
        /* ignore malformed */
      }
    }
  }

  private onEvent(ev: AgentEvent): void {
    switch (ev.ev) {
      case 'data':
        this.dataCbs.get(ev.key)?.forEach((cb) => cb(ev.data));
        break;
      case 'exit':
        this.exitCbs.get(ev.key)?.forEach((cb) => cb({ code: ev.code, signal: ev.signal }));
        this.forgetKey(ev.key); // ended: release its state so a later drop can't re-fire it
        break;
      case 'error':
        // A start failure in the agent — surface it as output + a non-zero exit so
        // the Panel reverts with a visible message (FR-019), never a silent blank.
        this.dataCbs.get(ev.key)?.forEach((cb) => cb(`\r\n[throng] terminal failed to start: ${ev.message}\r\n`));
        this.exitCbs.get(ev.key)?.forEach((cb) => cb({ code: 1 }));
        this.forgetKey(ev.key);
        break;
      case 'childpids':
        this.childpids.set(ev.key, ev.pids);
        break;
      case 'ready':
      case 'started':
        break;
    }
  }

  start(opts: PtyStartOptions): PtyHandle {
    const key = this.nextKey++;
    this.sendCmd({
      op: 'start',
      key,
      file: opts.file,
      args: opts.args,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: opts.env,
    });
    return { pid: key };
  }

  write(handle: PtyHandle, data: string): void {
    this.sendCmd({ op: 'write', key: handle.pid, data });
  }

  resize(handle: PtyHandle, cols: number, rows: number): void {
    this.sendCmd({ op: 'resize', key: handle.pid, cols, rows });
  }

  kill(handle: PtyHandle): void {
    this.sendCmd({ op: 'kill', key: handle.pid });
  }

  onData(handle: PtyHandle, cb: (chunk: string) => void): () => void {
    const set = this.dataCbs.get(handle.pid) ?? new Set();
    set.add(cb);
    this.dataCbs.set(handle.pid, set);
    return () => set.delete(cb);
  }

  onExit(handle: PtyHandle, cb: (e: PtyExit) => void): () => void {
    const set = this.exitCbs.get(handle.pid) ?? new Set();
    set.add(cb);
    this.exitCbs.set(handle.pid, set);
    return () => set.delete(cb);
  }

  /** Best-effort: returns the last child-pids the agent reported (refreshing async). */
  listChildPids(handle: PtyHandle): number[] {
    this.sendCmd({ op: 'childpids', key: handle.pid, reqId: 0 });
    return this.childpids.get(handle.pid) ?? [];
  }

  /** Disconnect from the agent (daemon shutdown); the agent exits on close. */
  dispose(): void {
    this.disposing = true; // suppress fail-all + relaunch on this deliberate close
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    try {
      this.socket?.end();
    } catch {
      /* ignore */
    }
  }
}
