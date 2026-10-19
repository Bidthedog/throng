import {
  buildHierarchy,
  heldFolders,
  isUnavailable,
  killOrder,
  processKey,
  processMetrics,
  type IProcessMetrics,
  type Metrics,
  type ProcessDescription,
  type ProcessKey,
  type ProcessReading,
  type ResourceNode,
  type Unavailable,
} from '@throng/core';
import type {
  CollectorToMain,
  DetailFrame,
  KillRequest,
  KillTargetResult,
  MainToCollector,
  PanelEstimate,
  ResourceRoster,
  ResourceSummary,
  WorkspaceContext,
} from '@throng/ipc-contract';

/** How long a tick waits for UI main to answer `needRoster` before using the roster it last had. */
const ROSTER_WAIT_MS = 1_000;
/** Command lines read per tick, so a first detail frame over hundreds of new processes stays fast. */
const DESCRIBE_PER_TICK = 64;
/**
 * The longest any one OS call may take before the tick gives up on it (FR-001, Edge Cases). A hung
 * call cannot be cancelled, but it must not hold the loop: the tick reports stale and the next runs.
 */
const OS_CALL_LIMIT_MS = 5_000;

const TIMED_OUT = 'timedOut';

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(TIMED_OUT)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e)),
    );
  });
}

export interface CollectorDeps {
  readonly metrics: IProcessMetrics;
  readonly send: (msg: CollectorToMain) => void;
  readonly collectorPid: number;
  readonly now?: () => number;
  /** Tests shorten the OS-call limit; production uses `OS_CALL_LIMIT_MS`. */
  readonly osCallLimitMs?: number;
}

/**
 * The resource collector's loop (055 research R1, R7, contracts/collector-protocol.md). Runs in its
 * own process so measuring throng never costs throng's event loops anything (FR-002).
 *
 * One tick at a time: ask UI main for the roster, take one process-table reading, attribute it into
 * the hierarchy, send the summary — and, while a window has the monitor open, the whole frame. Every
 * process's previous reading is kept whatever the mode, so the first frame after `detail {on}` (which
 * ticks at once) already has rates (SC-002).
 */
export class ResourceCollector {
  private intervalMs = 2_000;
  private detail = false;
  private roster: ResourceRoster | null = null;
  private rosterWaiter: (() => void) | null = null;
  /** The `needRoster` this tick is waiting on; a reply to an earlier one is kept but ends no wait. */
  private rosterRequest = 0;
  private context: WorkspaceContext | null = null;
  private estimates: readonly PanelEstimate[] = [];
  private prev = new Map<ProcessKey, ProcessReading>();
  private prevWall: number | null = null;
  private lineage = new Map<ProcessKey, string>();
  private readonly descriptions = new Map<ProcessKey, ProcessDescription>();
  private lastHierarchy: ResourceNode | null = null;
  private lastSummary: ResourceSummary | null = null;
  private lastFrame: DetailFrame | null = null;
  /**
   * The last GPU reading and whether this tick takes a new one. PDH reports utilisation averaged since
   * its previous collect, so reading every other tick in summary mode still gives a true average — over
   * twice the interval — at half the cost (SC-004). Detail mode reads every tick.
   */
  private lastGpu: ReadonlyMap<number, number> | Unavailable | null = null;
  private gpuSkip = false;
  private tickNo = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ticking = false;
  /** A tick was asked for (by `detail {on}`) while one ran: run another the moment it ends. */
  private tickAgain = false;
  private stopped = false;
  private readonly now: () => number;
  private readonly limitMs: number;

  constructor(private readonly deps: CollectorDeps) {
    this.now = deps.now ?? Date.now;
    this.limitMs = deps.osCallLimitMs ?? OS_CALL_LIMIT_MS;
  }

  start(): void {
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  handle(msg: MainToCollector): void {
    switch (msg.type) {
      case 'configure':
        this.intervalMs = Math.max(1, msg.intervalSeconds * 1_000);
        if (!this.ticking) this.schedule(this.intervalMs);
        break;
      case 'roster':
        this.roster = msg.roster;
        if (msg.requestId === undefined || msg.requestId === this.rosterRequest) this.rosterWaiter?.();
        break;
      case 'context':
        this.context = msg.context;
        break;
      case 'estimates':
        this.estimates = msg.estimates;
        break;
      case 'detail': {
        const was = this.detail;
        this.detail = msg.on;
        if (msg.on && !was) {
          if (this.ticking) this.tickAgain = true;
          else this.schedule(0);
        }
        // Context and estimates are kept when detail goes off: summary mode still moves the
        // estimates whose panels it can place, so the status bar splits as the monitor does (FR-042).
        break;
      }
      case 'kill':
        void this.kill(msg).then((results) => this.deps.send({ type: 'killResult', requestId: msg.requestId, results }));
        break;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async awaitRoster(): Promise<void> {
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.rosterWaiter = null;
        resolve();
      }, ROSTER_WAIT_MS);
      this.rosterWaiter = () => {
        clearTimeout(t);
        this.rosterWaiter = null;
        resolve();
      };
    });
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      this.deps.send({ type: 'needRoster', requestId: ++this.rosterRequest });
      await this.awaitRoster();
      await this.measure();
    } catch (error) {
      this.deps.send({ type: 'error', cause: error instanceof Error && error.message ? error.message : 'readFailed' });
      // The previous figures, marked stale with the time they are from; an open monitor gets the same,
      // so it says so instead of freezing (FR-044, Edge Cases).
      const tick = ++this.tickNo;
      if (this.detail && this.lastFrame !== null) {
        const staleSince = this.lastFrame.staleSince ?? this.lastFrame.at;
        this.deps.send({ type: 'detailFrame', frame: { ...this.lastFrame, tick, stale: true, staleSince } });
      }
      if (this.lastSummary !== null) {
        const staleSince = this.lastSummary.staleSince ?? this.lastSummary.at;
        this.deps.send({ type: 'summary', summary: { ...this.lastSummary, tick, stale: true, staleSince } });
      }
    } finally {
      this.ticking = false;
      const again = this.tickAgain;
      this.tickAgain = false;
      this.schedule(again ? 0 : this.intervalMs);
    }
  }

  private async measure(): Promise<void> {
    const { metrics } = this.deps;
    const readGpu = this.detail || !this.gpuSkip || this.lastGpu === null;
    this.gpuSkip = readGpu;
    const [snapshot, gpu] = await Promise.all([
      within(metrics.snapshot(), this.limitMs),
      readGpu
        ? within(metrics.gpu(), this.limitMs).catch((): Unavailable => ({ kind: 'unavailable', reason: 'GPU counters did not answer in time' }))
        : Promise.resolve(this.lastGpu!),
    ]);
    this.lastGpu = gpu;
    const machine = metrics.machine();
    const elapsed = this.prevWall === null ? 0 : snapshot.wallTimeMs - this.prevWall;
    const gpuOf = (pid: number): number | Unavailable =>
      isUnavailable(gpu as Unavailable) ? (gpu as Unavailable) : ((gpu as ReadonlyMap<number, number>).get(pid) ?? 0);

    const next = new Map<ProcessKey, ProcessReading>();
    for (const cur of snapshot.readings) next.set(processKey(cur.pid, cur.createTime), cur);
    // Figures only for the processes the hierarchy asks about — throng's, a small share of the table.
    const prev = this.prev;
    const own = new LazyMetrics((key) => {
      const cur = next.get(key);
      return cur === undefined
        ? undefined
        : processMetrics({ prev: prev.get(key), cur, elapsedMs: elapsed, machine, gpu: gpuOf(cur.pid) });
    });
    this.prev = next;
    this.prevWall = snapshot.wallTimeMs;
    for (const key of this.descriptions.keys()) if (!next.has(key)) this.descriptions.delete(key);

    const roster = this.roster ?? { daemonPid: null, agentPid: null, terminals: [], locks: [], ui: [] };
    const build = () =>
      buildHierarchy({
        readings: snapshot.readings,
        metrics: own,
        descriptions: this.descriptions,
        roster: { ...roster, collectorPid: this.deps.collectorPid },
        context: this.context,
        estimates: this.estimates,
        lineage: this.lineage,
      });
    let built = build();
    if (this.detail && (await this.describeNew(built.root))) built = build();
    this.lineage = built.lineage;
    this.lastHierarchy = built.root;

    const at = this.now();
    const tick = ++this.tickNo;
    // A roster UI main could not refresh from the daemon: attribution is as of its time (FR-044).
    const staleSince = roster.daemonStaleSince;
    const freshness = staleSince === undefined ? { stale: false } : { stale: true, staleSince };
    const summary: ResourceSummary = {
      tick,
      at,
      ...freshness,
      total: built.root.rolled,
      components: built.root.children.map((c) => ({ id: c.owner.component, rolled: c.rolled })),
      machine,
    };
    this.lastSummary = summary;
    this.deps.send({ type: 'summary', summary });
    if (this.detail) {
      const held = heldFolders(roster.locks, this.context ?? { tabs: [], panels: [] });
      const frame: DetailFrame = { tick, at, ...freshness, hierarchy: built.root, held, machine };
      this.lastFrame = frame;
      this.deps.send({ type: 'detailFrame', frame });
    }
  }

  /** Reads the command lines of processes the hierarchy shows for the first time. True if any arrived. */
  private async describeNew(root: ResourceNode): Promise<boolean> {
    const missing: { pid: number; createTime: number; key: ProcessKey }[] = [];
    const walk = (n: ResourceNode): void => {
      if (n.process !== undefined && !this.descriptions.has(n.process.key) && missing.length < DESCRIBE_PER_TICK) missing.push(n.process);
      n.children.forEach(walk);
    };
    walk(root);
    const read = await Promise.all(
      missing.map((p) =>
        within(this.deps.metrics.describe(p.pid, p.createTime), this.limitMs).catch(
          (): Unavailable => ({ kind: 'unavailable', reason: 'It did not answer in time' }),
        ),
      ),
    );
    let any = false;
    read.forEach((d, i) => {
      // An unreadable process is remembered with its reason: asking again every tick would not make it
      // readable, and the detail pane says why it has no command line (FR-080).
      this.descriptions.set(
        missing[i]!.key,
        isUnavailable(d as Unavailable) ? { unavailableReason: (d as Unavailable).reason } : (d as ProcessDescription),
      );
      any = true;
    });
    return any;
  }

  /**
   * Ends what a confirmed kill names (FR-063, research R8). Authorised here, against the latest
   * hierarchy, not by the window that asked: only live processes under Projects are ended; anything
   * else is `denied` untouched. Below a node, leaves first.
   */
  private async kill(req: KillRequest): Promise<KillTargetResult[]> {
    const root = this.lastHierarchy;
    const projects = root?.children.find((c) => c.owner.component === 'projects');
    const allowed = new Set<ProcessKey>(projects === undefined ? [] : killOrder(projects, { isEnded: () => false }));
    const node = projects === undefined ? undefined : findNode(projects, req.nodeId);
    const order =
      node === undefined
        ? [...req.targets]
        : req.mode === 'below'
          ? killOrder(node, { isEnded: () => false }).filter((k) => req.targets.includes(k))
          : req.targets.filter((k) => k === node.process?.key);
    const results: KillTargetResult[] = [];
    for (const key of order) {
      if (!allowed.has(key)) {
        results.push({ key, outcome: 'denied', cause: 'notUsersProcess' });
        continue;
      }
      const [pid, createTime] = key.split(':').map(Number) as [number, number];
      const r = await within(this.deps.metrics.terminate(pid, createTime), this.limitMs).catch(() => ({
        outcome: 'failed' as const,
        cause: TIMED_OUT,
      }));
      results.push({ key, outcome: r.outcome, ...(r.cause !== undefined ? { cause: r.cause } : {}) });
    }
    for (const key of req.targets) if (!order.includes(key)) results.push({ key, outcome: 'denied', cause: 'notUsersProcess' });
    return results;
  }
}

/** A metrics map that computes each entry the first time it is read. */
class LazyMetrics extends Map<ProcessKey, Metrics> {
  constructor(private readonly compute: (key: ProcessKey) => Metrics | undefined) {
    super();
  }

  override get(key: ProcessKey): Metrics | undefined {
    if (super.has(key)) return super.get(key);
    const m = this.compute(key);
    if (m !== undefined) super.set(key, m);
    return m;
  }

  override has(key: ProcessKey): boolean {
    return this.get(key) !== undefined;
  }
}

function findNode(n: ResourceNode, id: string): ResourceNode | undefined {
  if (n.id === id) return n;
  for (const c of n.children) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return undefined;
}
