import {
  editorMainBytes,
  resolveResourceMonitorSettings,
  terminalDaemonBytes,
  type AppSettings,
} from '@throng/core';
import type {
  CollectorToMain,
  DaemonRoster,
  DetailFrame,
  KillRequest,
  KillResult,
  MainToCollector,
  PanelEstimate,
  ResourceRoster,
  ResourceSummary,
  RosterUiProcess,
  WorkspaceContext,
} from '@throng/ipc-contract';

/** The parts of a forked `ChildProcess` the host uses — a seam for its unit test. */
export interface CollectorChild {
  readonly connected: boolean;
  send(msg: MainToCollector): boolean;
  kill(): boolean;
  on(event: 'message', cb: (msg: unknown) => void): this;
  on(event: 'exit', cb: (code: number | null) => void): this;
  on(event: 'error', cb: (error: Error) => void): this;
}

export interface DocumentEstimate {
  readonly panelId: string;
  /** UTF-16 code units of the document text. */
  readonly chars: number;
  /** A linked panel: the panel whose document it shows, which carries the figure. */
  readonly sharedWith?: string;
}

export interface ResourceMonitorHostDeps {
  readonly collectorEntry: string;
  /** The bundled Node runtime the daemon also runs on (`resolveDaemonNodeExe`). */
  readonly nodeExe: string;
  readonly fork: (entry: string, execPath: string) => CollectorChild;
  readonly daemonRoster: () => Promise<DaemonRoster>;
  /** UI main, every window's renderer and Electron's GPU/utility processes, by role. */
  readonly uiProcesses: () => RosterUiProcess[];
  readonly documentEstimates: () => readonly DocumentEstimate[];
  readonly settings: () => AppSettings;
  readonly send: (windowId: number, channel: string, payload: unknown) => void;
  readonly mainWindowId: () => number | null;
  /** Every open window: the detail-demand signal goes to all of them, so each reports its panels. */
  readonly broadcast: (channel: string, payload: unknown) => void;
  readonly now?: () => number;
}

const RESTART_SPACING_MS = 60_000;
const KILL_TIMEOUT_MS = 15_000;

export const RESOURCES_SUMMARY_CHANNEL = 'throng:resources:summary';
export const RESOURCES_DETAIL_CHANNEL = 'throng:resources:detail';
/** Whether any window has the monitor open: every window reports its panels while it is true. */
export const RESOURCES_DETAIL_DEMAND_CHANNEL = 'throng:resources:detail-demand';

/**
 * UI main's side of the resource monitor (055 R1, R7): it forks the collector, answers its roster
 * requests, and relays — it does no OS query and no aggregation of its own. The summary goes to the
 * main window only; detail frames only to windows that subscribed, and detail collection runs only
 * while one has. Panel estimates from the renderers are completed here with UI main's per-document
 * share and the daemon's scrollback before they reach the collector (FR-024, FR-024b).
 */
export class ResourceMonitorHost {
  private child: CollectorChild | null = null;
  private stopped = true;
  /** When the collector was last RE-started: the once-a-minute rule limits restarts, not the first start. */
  private lastRestart = Number.NEGATIVE_INFINITY;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private restartPending = false;
  private summary: ResourceSummary | null = null;
  private ui: RosterUiProcess[] | null = null;
  private lastDaemon: DaemonRoster | null = null;
  /** When `lastDaemon` was read: a roster kept through a failed read is stale from then (FR-044). */
  private lastDaemonAt = 0;
  /**
   * Added to every tick the collector numbers, so ticks keep increasing across a restart — a restarted
   * collector counts from 1, and a renderer adopting only newer ticks would otherwise freeze (FR-044).
   */
  private tickBase = 0;
  private lastTick = 0;
  private nextSubscription = 1;
  private readonly subscriptions = new Map<number, number>(); // subscriptionId → windowId
  private readonly contexts = new Map<number, WorkspaceContext>();
  private readonly rendererEstimates = new Map<number, readonly PanelEstimate[]>();
  private contextDirty = false;
  private nextKill = 1;
  private readonly kills = new Map<
    number,
    { resolve: (r: KillResult) => void; timer: ReturnType<typeof setTimeout>; fail: (cause: string) => KillResult }
  >();
  private readonly now: () => number;

  constructor(private readonly deps: ResourceMonitorHostDeps) {
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    this.stopped = false;
    this.spawn();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    const c = this.child;
    this.child = null;
    if (c?.connected) c.kill();
    for (const [id, k] of this.kills) {
      clearTimeout(k.timer);
      this.kills.delete(id);
    }
  }

  latestSummary(): ResourceSummary | null {
    return this.summary;
  }

  /**
   * The window that has this tab or panel mounted, from the contexts windows report while a monitor
   * is open — so a Destroy chosen in the main window's monitor runs where the tab lives (R12).
   */
  windowHolding(kind: 'tab' | 'panel', id: string): number | null {
    for (const [windowId, c] of this.contexts) {
      const list = kind === 'tab' ? c.tabs : c.panels;
      if (list.some((x) => x.id === id && x.mounted)) return windowId;
    }
    return null;
  }

  /** True while any window holds a detail subscription. */
  detailDemand(): boolean {
    return this.subscriptions.size > 0;
  }

  settingsChanged(): void {
    this.configure();
  }

  /** A window opened or closed, or an Electron child process went: re-read the UI roles once. */
  uiChanged(): void {
    this.ui = null;
  }

  subscribe(windowId: number): number {
    const id = this.nextSubscription++;
    const wasOn = this.subscriptions.size > 0;
    this.subscriptions.set(id, windowId);
    if (!wasOn) {
      this.post({ type: 'detail', on: true });
      this.deps.broadcast(RESOURCES_DETAIL_DEMAND_CHANNEL, true);
    }
    return id;
  }

  unsubscribe(subscriptionId: number): void {
    if (!this.subscriptions.delete(subscriptionId)) return;
    this.afterRelease();
  }

  windowClosed(windowId: number): void {
    let released = false;
    for (const [id, w] of this.subscriptions) {
      if (w === windowId) {
        this.subscriptions.delete(id);
        released = true;
      }
    }
    this.contexts.delete(windowId);
    this.rendererEstimates.delete(windowId);
    this.uiChanged();
    if (released) this.afterRelease();
  }

  /** A renderer's panels: its context when it changed (`null` = unchanged), its estimates every tick. */
  reportPanels(windowId: number, context: WorkspaceContext | null, estimates: readonly PanelEstimate[]): void {
    if (context !== null) {
      this.contexts.set(windowId, context);
      this.contextDirty = true;
    }
    this.rendererEstimates.set(windowId, estimates);
  }

  kill(req: KillRequest): Promise<KillResult> {
    const failAll = (cause: string): KillResult => ({
      results: req.targets.map((key) => ({ key, outcome: 'failed', cause })),
    });
    if (this.child === null || !this.child.connected) return Promise.resolve(failAll('collectorUnavailable'));
    const requestId = this.nextKill++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.kills.delete(requestId);
        resolve(failAll('timeout'));
      }, KILL_TIMEOUT_MS);
      timer.unref?.();
      this.kills.set(requestId, { resolve, timer, fail: failAll });
      // Named fields only: the request came from a renderer, and a spread would let its extra keys
      // (`type`, `requestId`) turn it into a different message.
      this.post({ type: 'kill', requestId, mode: req.mode, nodeId: req.nodeId, targets: req.targets });
    });
  }

  /** Retry a restart the once-a-minute rule held back, if it is now allowed. */
  tickRestart(): void {
    if (!this.restartPending || this.stopped) return;
    if (this.now() - this.lastRestart < RESTART_SPACING_MS) return;
    this.restartPending = false;
    this.restart();
  }

  private afterRelease(): void {
    if (this.subscriptions.size === 0) {
      this.contexts.clear();
      this.rendererEstimates.clear();
      this.post({ type: 'detail', on: false });
      this.deps.broadcast(RESOURCES_DETAIL_DEMAND_CHANNEL, false);
    }
  }

  private restart(): void {
    this.lastRestart = this.now();
    this.spawn();
  }

  private spawn(): void {
    this.tickBase = this.lastTick;
    const child = this.deps.fork(this.deps.collectorEntry, this.deps.nodeExe);
    this.child = child;
    child.on('message', (msg) => this.onMessage(child, msg as CollectorToMain));
    child.on('exit', () => this.onExit(child));
    // A spawn that fails, or a send on a pipe that is closing, emits 'error'; unheard, it would be an
    // uncaught exception in UI main. A child that never connected will not exit, so treat it as one.
    child.on('error', () => {
      if (!child.connected) this.onExit(child);
    });
    this.configure();
    if (this.subscriptions.size > 0) {
      this.contextDirty = true;
      this.post({ type: 'detail', on: true });
    }
  }

  private onExit(child: CollectorChild): void {
    if (this.child !== child) return;
    this.child = null;
    for (const [id, k] of this.kills) {
      clearTimeout(k.timer);
      this.kills.delete(id);
      k.resolve(k.fail('collectorUnavailable'));
    }
    if (this.summary !== null) this.publishSummary({ ...this.summary, stale: true, staleSince: this.summary.staleSince ?? this.summary.at });
    if (this.stopped) return;
    if (this.now() - this.lastRestart >= RESTART_SPACING_MS) {
      this.restart();
      return;
    }
    this.restartPending = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.tickRestart(), RESTART_SPACING_MS - (this.now() - this.lastRestart));
    this.restartTimer.unref?.();
  }

  private configure(): void {
    const r = resolveResourceMonitorSettings(this.deps.settings().resourceMonitor);
    this.post({ type: 'configure', intervalSeconds: r.intervalSeconds, historyMinutes: r.historyMinutes });
  }

  private post(msg: MainToCollector): void {
    if (this.child?.connected) this.child.send(msg);
  }

  private onMessage(child: CollectorChild, msg: CollectorToMain): void {
    if (this.child !== child) return;
    switch (msg.type) {
      case 'needRoster':
        void this.answerRoster(msg.requestId);
        break;
      case 'summary':
        this.publishSummary({ ...msg.summary, tick: this.renumber(msg.summary.tick) });
        break;
      case 'detailFrame':
        this.publishFrame({ ...msg.frame, tick: this.renumber(msg.frame.tick) });
        break;
      case 'killResult': {
        const k = this.kills.get(msg.requestId);
        if (k !== undefined) {
          clearTimeout(k.timer);
          this.kills.delete(msg.requestId);
          k.resolve({ results: msg.results });
        }
        break;
      }
      case 'error':
        break;
    }
  }

  private renumber(tick: number): number {
    this.lastTick = Math.max(this.lastTick, this.tickBase + tick);
    return this.tickBase + tick;
  }

  private publishSummary(s: ResourceSummary): void {
    this.summary = s;
    const main = this.deps.mainWindowId();
    if (main !== null) this.deps.send(main, RESOURCES_SUMMARY_CHANNEL, s);
  }

  private publishFrame(frame: DetailFrame): void {
    for (const windowId of new Set(this.subscriptions.values())) this.deps.send(windowId, RESOURCES_DETAIL_CHANNEL, frame);
  }

  private async answerRoster(requestId: number | undefined): Promise<void> {
    let fresh = true;
    try {
      this.lastDaemon = await this.deps.daemonRoster();
      this.lastDaemonAt = this.now();
    } catch {
      // Keep the last good roster: dropping it would detach every shell from its panel and lose the
      // collector's lineage for good. The figures say how old it is instead (FR-021, FR-044).
      fresh = false;
    }
    const daemon = this.lastDaemon;
    this.ui ??= this.deps.uiProcesses();
    const roster: ResourceRoster = {
      daemonPid: daemon?.daemonPid ?? null,
      agentPid: daemon?.agentPid ?? null,
      terminals: daemon?.terminals ?? [],
      locks: daemon?.locks ?? [],
      ui: this.ui,
      ...(!fresh && daemon !== null ? { daemonStaleSince: this.lastDaemonAt } : {}),
    };
    this.post({ type: 'roster', roster, ...(requestId === undefined ? {} : { requestId }) });
    if (this.subscriptions.size > 0 && this.contextDirty) {
      this.contextDirty = false;
      this.post({ type: 'context', context: this.mergedContext() });
    }
    // Every tick, monitor open or not: the status bar splits UI, Daemon and Projects as the monitor does.
    this.post({ type: 'estimates', estimates: this.mergedEstimates() });
  }

  private mergedContext(): WorkspaceContext {
    const main = this.deps.mainWindowId();
    const all = [...this.contexts.entries()];
    const projects = (all.find(([w]) => w === main)?.[1] ?? all[0]?.[1])?.projects ?? [];
    const tabs = new Map<string, WorkspaceContext['tabs'][number]>();
    const panels = new Map<string, WorkspaceContext['panels'][number]>();
    for (const [, c] of all) {
      for (const t of c.tabs) if (!tabs.has(t.id) || t.mounted) tabs.set(t.id, t);
      for (const p of c.panels) if (!panels.has(p.id) || p.mounted) panels.set(p.id, p);
    }
    return { projects, tabs: [...tabs.values()], panels: [...panels.values()] };
  }

  private mergedEstimates(): PanelEstimate[] {
    const out: PanelEstimate[] = [...this.rendererEstimates.values()].flat();
    for (const d of this.deps.documentEstimates()) {
      out.push({
        panelId: d.panelId,
        target: 'panel',
        source: 'main',
        pid: process.pid,
        memoryBytes: editorMainBytes(d.chars, { linked: d.sharedWith !== undefined }),
        ...(d.sharedWith !== undefined ? { sharedWith: d.sharedWith } : {}),
      });
    }
    const daemon = this.lastDaemon;
    if (daemon !== null) {
      for (const t of daemon.terminals) {
        out.push({ panelId: t.panelId, target: 'buffers', source: 'daemon', pid: daemon.daemonPid, memoryBytes: terminalDaemonBytes(t.scrollbackChars) });
      }
    }
    return out;
  }
}
