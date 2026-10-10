import { connect, type Socket } from 'node:net';
import process from 'node:process';
import {
  TERMINAL_END_TIMEOUT_MS,
  type ChildProcess,
  type IPtyHost,
  type ProcessSurvivor,
  type PtyExit,
  type PtyHandle,
  type PtyStartOptions,
} from '@throng/core';
import { encodeLine, type AgentCommand, type AgentEvent } from './pty-agent-protocol.js';

/**
 * Time budgets for the de-elevated agent handshake (Principle X — injected, never read
 * from the environment in here; the daemon's composition root binds them from
 * `IDaemonSettings`). The two are **separate** (019 C7): a slow connect must not consume
 * the readiness allowance.
 */
export interface AgentBudgets {
  /** Time from construction for the agent to connect back on the pipe (019 FR-012). */
  readonly connectMs: number;
  /** Time from CONNECT for a started terminal to ack `started` (019 FR-013). */
  readonly readyMs: number;
}

/** Documented defaults, used when a caller constructs the host without budgets. */
export const DEFAULT_AGENT_BUDGETS: AgentBudgets = { connectMs: 15_000, readyMs: 15_000 };

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
  /** 051: the in-flight end per key, so a second request returns the same outcome. */
  private readonly endings = new Map<number, Promise<void>>();
  /** 051: settles an in-flight end — by the agent's `ended`, its own timer, or the key failing. */
  private readonly endWaiters = new Map<number, { key: number; settle: (outcome: Error | null) => void }>();
  private readonly forceEndWaiters = new Map<number, (survivors: ProcessSurvivor[]) => void>();
  private endReqId = 1;
  /** 025: in-flight `childprocs` requests, resolved when the agent answers. */
  private readonly childprocWaiters = new Map<number, (procs: ChildProcess[]) => void>();
  private childprocReqId = 1;
  /** 051 — in-flight `attachedprocs` requests: the answer by key, or the failure. */
  private readonly attachedWaiters = new Map<number, (answer: Record<string, ChildProcess[]> | Error) => void>();
  private readonly cwdWaiters = new Map<number, (answer: Record<string, string>) => void>();
  /** 046: in-flight AWAITED `childpids` requests (reqId ≥ 1; reqId 0 is the fire-and-forget refresh). */
  private readonly childpidWaiters = new Map<number, (answer: number[] | Error) => void>();
  private childpidReqId = 1;
  /** Every key `start`ed and not yet ended — the set a failure must fail (not merely the
   *  keys that happen to have a listener registered yet, which would be a race). */
  private readonly liveKeys = new Set<number>();
  /** Per-key readiness budget, armed at connect and cleared by the `started` ack (C7). */
  private readonly readyTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** The last reason the launcher reported, appended to a lapse message (FR-015). Written
   *  ASYNCHRONOUSLY (the launcher reports from the shim's exit, which must `Add-Type`-compile
   *  its C# first), so it is read at every point a lapse is surfaced — never once, up front. */
  private launchReason: string | undefined;
  /** Which launch attempt `launchReason` belongs to. A superseded attempt's late report is a
   *  different process's failure and must not be attributed to the current one. */
  private launchGeneration = 0;
  /** Set when the connect deadline lapses: the agent is never going to arrive, and no retry is
   *  rescheduled (C8). `start()` consults it so a terminal opened at ANY time after the lapse
   *  fails visibly — production constructs this host at daemon BOOT (composition-root.ts,
   *  `main()`) and the user adds a terminal much later, so the lapse itself routinely fires
   *  with no terminal live at all (#94). Cleared by a relaunch, which starts a fresh deadline. */
  private connectLapsed = false;

  constructor(
    private readonly pipeName: string,
    private readonly launch: (pipeName: string, report: (reason: string) => void) => void,
    private readonly budgets: AgentBudgets = DEFAULT_AGENT_BUDGETS,
  ) {
    // The agent (medium) owns the pipe SERVER; the daemon (possibly elevated)
    // connects DOWN to it. Launch the agent, then connect with retry — it needs a
    // moment to start and listen (and the de-elevated launch is async).
    this.launchAgent();
    this.connectWithRetry(Date.now() + this.budgets.connectMs);
  }

  /** Launch the agent, capturing any failure the launcher can report (FR-015). The
   *  launch itself stays fire-and-forget; only its failure becomes observable. */
  private launchAgent(): void {
    // A fresh attempt starts with no reason of its own: the previous attempt's failure
    // explains the previous agent, and quoting it here would explain this lapse confidently
    // and wrongly. The generation makes that hold for a report that arrives late, too.
    const generation = ++this.launchGeneration;
    this.launchReason = undefined;
    this.connectLapsed = false;
    this.launch(this.pipeName, (reason) => {
      if (generation !== this.launchGeneration) return; // a superseded launch's reason
      this.launchReason = reason;
    });
  }

  /** The connect-lapse message, composed at the moment it is surfaced so that a launch reason
   *  arriving AFTER the lapse still reaches the user (FR-015) rather than being dropped. */
  private lapseMessage(): string {
    return this.launchReason
      ? `the de-elevated terminal agent never started: ${this.launchReason}`
      : 'the de-elevated terminal agent never started';
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
      // Only now is there an agent that could ack: start each pending key's readiness
      // budget FROM CONNECT (C7), never from start().
      for (const key of this.liveKeys) this.armReadyTimer(key);
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
      // A crashed agent's exit code is genuinely unknown: `null` ("exited (code —)") is
      // the honest render, so this caller keeps it (C28).
      this.failAllLive('the terminal agent stopped unexpectedly', null);
      this.launchAgent();
      this.connectWithRetry(Date.now() + this.budgets.connectMs);
    });
    sock.on('error', () => {
      // Agent not listening yet (ENOENT) or gone — retry until the deadline. A drop
      // of an already-connected socket is handled by 'close' above, not here.
      if (this.disposing || connected || this.socket) return;
      if (Date.now() < deadline) {
        this.retryTimer = setTimeout(() => this.connectWithRetry(deadline), 200);
        return;
      }
      // The budget has lapsed: the agent is never going to arrive (a de-elevated launch
      // that silently failed is the common cause — #94). Do NOT relaunch (C8): a launch
      // that never produced an agent indicates the shim, and retrying it just buries the
      // error in a loop. Instead surface it the way an agent-side start failure is
      // surfaced — output + a NON-ZERO exit — so the panel reverts with a visible message
      // (005 FR-019/FR-020) rather than believing it is running forever.
      //
      // Recording the lapse is load-bearing, not bookkeeping: this host is constructed at
      // daemon BOOT, so the lapse usually fires when NO terminal exists — `failAllLive`
      // iterates nothing — and the terminal that suffers is the one opened a minute later.
      // `start()` reads this flag and fails that terminal the same way (#94).
      this.connectLapsed = true;
      this.failAllLive(this.lapseMessage(), 1);
    });
  }

  /** Fire an unexpected exit for every live terminal and forget them. */
  private failAllLive(reason: string, code: number | null): void {
    for (const key of new Set([...this.liveKeys, ...this.dataCbs.keys(), ...this.exitCbs.keys()])) {
      this.failKey(key, reason, code);
    }
  }

  /** Surface a failure on ONE terminal: a message in the terminal + an exit, then forget it. */
  private failKey(key: number, reason: string, code: number | null): void {
    this.dataCbs.get(key)?.forEach((cb) => cb(`\r\n[throng] ${reason}\r\n`));
    this.exitCbs.get(key)?.forEach((cb) => cb({ code }));
    this.forgetKey(key);
  }

  /** Arm a key's readiness budget, if the agent is connected and the key still needs one. */
  private armReadyTimer(key: number): void {
    if (this.disposing || !this.socket) return;
    if (this.readyTimers.has(key) || !this.liveKeys.has(key)) return;
    const timer = setTimeout(() => {
      this.readyTimers.delete(key);
      if (this.disposing || !this.liveKeys.has(key)) return;
      // The agent took the `start` and never acked `{ev:'started'}`. Fail THIS key only —
      // other terminals are unaffected. Readiness is the ack, never first output: a slow
      // shell that has printed nothing is still starting and must not be killed (FR-013).
      this.failKey(key, 'the terminal never started', 1);
    }, this.budgets.readyMs);
    this.readyTimers.set(key, timer);
  }

  /** Drop all per-terminal state for a key that has ended (avoids leaks + double-fire). */
  private forgetKey(key: number): void {
    this.dataCbs.delete(key);
    this.exitCbs.delete(key);
    this.liveKeys.delete(key);
    // A terminal that is gone has ended, whatever its in-flight end was still waiting for.
    for (const [reqId, waiter] of this.endWaiters) {
      if (waiter.key === key) {
        this.endWaiters.delete(reqId);
        waiter.settle(null);
      }
    }
    const timer = this.readyTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.readyTimers.delete(key);
    }
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
      case 'ended': {
        const waiter = this.endWaiters.get(ev.reqId);
        if (waiter) {
          this.endWaiters.delete(ev.reqId);
          waiter.settle(ev.ok ? null : new Error(ev.reason ?? 'the terminal agent could not end it'));
        }
        break;
      }
      case 'forceEnded': {
        const waiter = this.forceEndWaiters.get(ev.reqId);
        if (waiter) {
          this.forceEndWaiters.delete(ev.reqId);
          waiter(ev.survivors);
        }
        break;
      }
      case 'childpids': {
        // A FAILED probe is not "no children" (046): the waiter rejects with it rather than being
        // handed an idle-looking empty list, and the caller counts the terminal busy.
        const waiter = this.childpidWaiters.get(ev.reqId);
        if (waiter) {
          this.childpidWaiters.delete(ev.reqId);
          waiter(ev.failed ? new Error(`the PTY agent could not read child processes for terminal ${ev.key}`) : ev.pids);
        }
        break;
      }
      case 'childprocs': {
        const waiter = this.childprocWaiters.get(ev.reqId);
        if (waiter) {
          this.childprocWaiters.delete(ev.reqId);
          waiter(ev.procs);
        }
        break;
      }
      case 'attachedprocs': {
        const waiter = this.attachedWaiters.get(ev.reqId);
        if (waiter) {
          this.attachedWaiters.delete(ev.reqId);
          waiter(ev.failed ? new Error('the PTY agent could not read attached processes') : ev.byKey);
        }
        break;
      }
      case 'cwds': {
        const waiter = this.cwdWaiters.get(ev.reqId);
        if (waiter) {
          this.cwdWaiters.delete(ev.reqId);
          waiter(ev.byKey);
        }
        break;
      }
      case 'started': {
        // The readiness ack (pty-agent-protocol.ts:26): the agent's ConPTY is spawned.
        // Whatever the shell does next — including printing nothing for a long time —
        // is no longer this budget's business.
        const timer = this.readyTimers.get(ev.key);
        if (timer) {
          clearTimeout(timer);
          this.readyTimers.delete(ev.key);
        }
        break;
      }
      case 'ready':
        break;
    }
  }

  start(opts: PtyStartOptions): PtyHandle {
    const key = this.nextKey++;
    this.liveKeys.add(key);
    if (this.connectLapsed) {
      // The connect budget already lapsed and, by C8, nothing will retry it: there is no agent
      // and there will not be one. Queueing this start into the outbox is the hang (#94) — the
      // panel would sit at 'running' with no prompt and no error, forever. Fail it instead,
      // with the SAME message and non-zero exit the lapse itself surfaces, reading the launch
      // reason as it stands NOW so a reason that arrived after the lapse is still told.
      //
      // On a timer, not inline: `IPtyHost.start` is synchronous and its caller registers
      // `onData`/`onExit` immediately AFTER it returns (terminal-service.ts), so firing here
      // would fire into no listeners — the very race the live-key set exists to avoid.
      setTimeout(() => {
        if (this.disposing || !this.liveKeys.has(key)) return;
        this.failKey(key, this.lapseMessage(), 1);
      }, 0);
      return { pid: key };
    }
    this.sendCmd({
      op: 'start',
      key,
      file: opts.file,
      args: opts.args,
      ...(opts.commandLine !== undefined ? { commandLine: opts.commandLine } : {}),
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: opts.env,
    });
    // Already connected? Then the agent exists now and the readiness clock starts now.
    // Otherwise 'connect' arms it — before connect there is nothing that could ack (C7).
    this.armReadyTimer(key);
    return { pid: key };
  }

  write(handle: PtyHandle, data: string): void {
    this.sendCmd({ op: 'write', key: handle.pid, data });
  }

  resize(handle: PtyHandle, cols: number, rows: number): void {
    this.sendCmd({ op: 'resize', key: handle.pid, cols, rows });
  }

  /**
   * 051 — the agent ends the terminal with its own host and answers `ended`. Rejects with the
   * agent's reason, or by itself one second past the limit if the agent never answers (the agent's
   * own limit fires first, so a missing answer means the agent is wedged or gone).
   */
  end(handle: PtyHandle, timeoutMs: number): Promise<void> {
    const key = handle.pid;
    if (!this.liveKeys.has(key)) return Promise.resolve();
    const existing = this.endings.get(key);
    if (existing) return existing;
    const reqId = this.endReqId++;
    const ending = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.endWaiters.delete(reqId);
        reject(new Error(`the terminal agent did not answer within ${Math.round((timeoutMs + 1000) / 1000)} seconds`));
      }, timeoutMs + 1000);
      timer.unref?.();
      this.endWaiters.set(reqId, {
        key,
        settle: (outcome) => {
          clearTimeout(timer);
          if (outcome) reject(outcome);
          else resolve();
        },
      });
      this.sendCmd({ op: 'end', key, reqId, timeoutMs });
    });
    this.endings.set(key, ending);
    const clear = (): void => {
      if (this.endings.get(key) === ending) this.endings.delete(key);
    };
    ending.then(clear, clear);
    return ending;
  }

  /** 051 FR-015a — escalation in the agent; no answer in time resolves with no survivors. */
  forceEnd(handle: PtyHandle, timeoutMs: number): Promise<{ survivors: ProcessSurvivor[] }> {
    const reqId = this.endReqId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.forceEndWaiters.delete(reqId);
        console.warn(`[terminal] the terminal agent did not report a forced end of terminal ${handle.pid}`);
        resolve({ survivors: [] });
      }, timeoutMs + 1000);
      timer.unref?.();
      this.forceEndWaiters.set(reqId, (survivors) => {
        clearTimeout(timer);
        resolve({ survivors });
      });
      this.sendCmd({ op: 'forceEnd', key: handle.pid, reqId, timeoutMs });
    });
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

  /**
   * 046 (Unload): the agent's CURRENT answer, awaited. Rejects when the agent does not answer in
   * time (wedged, gone, or the terminal already ended), and the caller treats that as busy.
   */
  probeChildPids(handle: PtyHandle): Promise<number[]> {
    const reqId = this.childpidReqId++;
    return new Promise<number[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.childpidWaiters.delete(reqId);
        reject(new Error(`the PTY agent did not report child processes for terminal ${handle.pid}`));
      }, TERMINAL_END_TIMEOUT_MS);
      timer.unref?.();
      this.childpidWaiters.set(reqId, (answer) => {
        clearTimeout(timer);
        if (answer instanceof Error) reject(answer);
        else resolve(answer);
      });
      this.sendCmd({ op: 'childpids', key: handle.pid, reqId });
    });
  }

  /**
   * 025 FR-022. Resolves to `[]` if the agent does not answer within the timeout, so a wedged
   * agent leaves the last known command in place rather than clearing it (FR-019e) and never
   * stalls the poll.
   */
  async listChildProcesses(handle: PtyHandle): Promise<ChildProcess[]> {
    const reqId = this.childprocReqId++;
    return new Promise<ChildProcess[]>((resolve) => {
      const done = (procs: ChildProcess[]): void => {
        clearTimeout(timer);
        resolve(procs);
      };
      const timer = setTimeout(() => {
        this.childprocWaiters.delete(reqId);
        resolve([]);
      }, TERMINAL_END_TIMEOUT_MS);
      timer.unref?.();
      this.childprocWaiters.set(reqId, done);
      this.sendCmd({ op: 'childprocs', key: handle.pid, reqId });
    });
  }

  /**
   * 051 FR-040/FR-041 — the agent's terminals in one request. Rejects when the agent reports a
   * failure or does not answer in time: unknown, never "nothing attached" (FR-042).
   */
  listAttachedProcesses(handles: readonly PtyHandle[]): Promise<Map<number, ChildProcess[]>> {
    const reqId = this.childprocReqId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.attachedWaiters.delete(reqId);
        reject(new Error('the PTY agent did not report attached processes'));
      }, TERMINAL_END_TIMEOUT_MS);
      timer.unref?.();
      this.attachedWaiters.set(reqId, (answer) => {
        clearTimeout(timer);
        if (answer instanceof Error) return reject(answer);
        resolve(new Map(Object.entries(answer).map(([key, procs]) => [Number(key), procs])));
      });
      this.sendCmd({ op: 'attachedprocs', keys: handles.map((h) => h.pid), reqId });
    });
  }

  /**
   * 012 / 053 FR-001 — the shells' working directories, which only the agent can read: the daemon knows its
   * terminals by key, not by OS pid. An agent that does not answer in time reads as nothing known, never as an error.
   */
  readCwds(handles: readonly PtyHandle[]): Promise<Map<number, string>> {
    const reqId = this.childprocReqId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.cwdWaiters.delete(reqId);
        resolve(new Map());
      }, TERMINAL_END_TIMEOUT_MS);
      timer.unref?.();
      this.cwdWaiters.set(reqId, (byKey) => {
        clearTimeout(timer);
        resolve(new Map(Object.entries(byKey).map(([key, dir]) => [Number(key), dir])));
      });
      this.sendCmd({ op: 'cwds', keys: handles.map((h) => h.pid), reqId });
    });
  }

  /**
   * Disconnect from the agent (daemon shutdown); the agent ends its terminals — escalating any that
   * resist (051 FR-015a) — and exits on close. The daemon has already ended this host's terminals
   * through `end`, so there is nothing left here to wait for.
   */
  async dispose(): Promise<void> {
    this.disposing = true; // suppress fail-all + relaunch on this deliberate close
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    for (const timer of this.readyTimers.values()) clearTimeout(timer);
    this.readyTimers.clear();
    try {
      this.socket?.end();
    } catch {
      /* ignore */
    }
  }
}
