/**
 * Shared helpers for the 057 attention tests (unit layer). NOT a test file. A real `TerminalService` and RPC
 * router over a fake PTY host, so the bytes and exits are exact and no shell is spawned.
 */
import type {
  AttentionProducerConfig,
  AttentionSignal,
  ChildProcess,
  IPtyHost,
  PtyExit,
  PtyHandle,
  PtyStartOptions,
} from '@throng/core';
import { createAttentionScan, DEFAULT_APP_SETTINGS } from '@throng/core';
import { RpcRouter } from '../../src/rpc-router.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { TerminalService } from '../../src/terminal-service.js';

export const ESC = String.fromCharCode(27);
export const BEL = String.fromCharCode(7);
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class FakeHost implements IPtyHost {
  private nextPid = 1000;
  private readonly dataHandlers: Array<{ pid: number; cb: (chunk: string) => void }> = [];
  private exitHandlers: Array<{ pid: number; cb: (e: PtyExit) => void }> = [];
  /** What the next command observation reports as running in every shell. */
  children: ChildProcess[] = [];
  writes: string[] = [];
  start(_opts: PtyStartOptions): PtyHandle {
    return { pid: this.nextPid++ };
  }
  write(_h: PtyHandle, data: string): void {
    this.writes.push(data);
  }
  resize(): void {}
  async end(handle: PtyHandle): Promise<void> {
    // A throng-initiated end: the process dies and the exit arrives afterwards.
    queueMicrotask(() => this.fireExit({ code: 0 }, handle.pid));
  }
  async forceEnd(): Promise<{ survivors: never[] }> {
    return { survivors: [] };
  }
  onData(h: PtyHandle, cb: (chunk: string) => void): () => void {
    this.dataHandlers.push({ pid: h.pid, cb });
    return () => {};
  }
  onExit(h: PtyHandle, cb: (e: PtyExit) => void): () => void {
    this.exitHandlers.push({ pid: h.pid, cb });
    return () => {};
  }
  async probeChildPids(): Promise<number[]> {
    return this.children.map((c) => c.pid);
  }
  listChildProcesses(): Promise<ChildProcess[]> {
    return Promise.resolve(this.children);
  }
  /** Output from the shell with this pid (the n-th terminal attached has pid 1000 + n - 1); every shell when omitted. */
  emit(chunk: string, pid?: number): void {
    for (const h of this.dataHandlers) if (pid === undefined || h.pid === pid) h.cb(chunk);
  }
  /** The shell with this pid exits on its own (not a throng-initiated end); every shell when omitted. */
  fireExit(exit: PtyExit, pid?: number): void {
    const due = this.exitHandlers.filter((h) => pid === undefined || h.pid === pid);
    this.exitHandlers = this.exitHandlers.filter((h) => !due.includes(h));
    for (const h of due) h.cb(exit);
  }
}

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };
export const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };

export interface AttentionHarness {
  host: FakeHost;
  service: TerminalService;
  events: TerminalEvents;
  signals: AttentionSignal[];
  outputs: string[];
  /** `terminal.exit` params as published. */
  exits: any[];
  scans: { count: number };
  /** Detach the events sink, as when no window is open. */
  detachSink(): void;
  attachSink(): void;
  rpc(method: string, params?: object): Promise<{ result?: any; error?: any }>;
  attach(panelId?: string, projectId?: string, extra?: object): Promise<any>;
  stop(): Promise<void>;
}

export interface HarnessOptions {
  names?: (panelId: string, projectId: string, liveTitle: string | null) => { panelTitle: string; projectName: string; tabTitle?: string };
  commandPollMs?: number;
}

export function makeHarness(options: HarnessOptions = {}): AttentionHarness {
  const host = new FakeHost();
  const events = new TerminalEvents();
  const scans = { count: 0 };
  const service = new TerminalService(
    host,
    events,
    new TerminalLockManager(noopLock),
    { isElevated: () => false },
    undefined,
    false,
    0,
    undefined,
    options.commandPollMs ?? 50,
    undefined,
    {
      resolveNames: options.names,
      createScanner: () => {
        const inner = createAttentionScan();
        return {
          scan: (chunk) => {
            scans.count += 1;
            return inner.scan(chunk);
          },
        };
      },
    },
  );
  const router = new RpcRouter();
  service.register(router);
  const signals: AttentionSignal[] = [];
  const outputs: string[] = [];
  const exits: any[] = [];
  const sink = {
    write: (frame: string) => {
      const msg = JSON.parse(frame) as { method: string; params: any };
      if (msg.method === 'terminal.attention') signals.push(msg.params as AttentionSignal);
      if (msg.method === 'terminal.output') outputs.push(msg.params.data as string);
      if (msg.method === 'terminal.exit') exits.push(msg.params);
    },
  };
  events.addSink(sink);
  let id = 0;
  const rpc = (method: string, params: object = {}) =>
    router.handle({ jsonrpc: '2.0', id: ++id, method, params }) as Promise<{ result?: any; error?: any }>;
  return {
    host,
    service,
    events,
    signals,
    outputs,
    exits,
    scans,
    detachSink: () => events.removeSink(sink),
    attachSink: () => events.addSink(sink),
    rpc,
    attach: (panelId = 'p1', projectId = 'proj', extra = {}) =>
      rpc('terminal.attach', { panelId, projectId, launch, cols: 80, rows: 24, ...extra }),
    stop: () => service.shutdown(),
  };
}

/** The shipped producer config with overrides. */
export function config(
  overrides: Partial<AttentionProducerConfig> = {},
  signals: Partial<AttentionProducerConfig['signals']> = {},
): AttentionProducerConfig {
  const base = DEFAULT_APP_SETTINGS.terminals.attention;
  return {
    enabled: base.enabled,
    quietMs: base.quietSeconds * 1000,
    ...overrides,
    signals: { ...base.signals, ...signals },
  };
}
