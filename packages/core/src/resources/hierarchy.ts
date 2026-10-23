import { friendlyName } from './friendly-names.js';
import { tabLabel } from './held-folders.js';
import { NOT_MEASURED, ZERO_METRICS, rollUp, unavailable } from './metrics.js';
import {
  processKey,
  type ComponentId,
  type Metrics,
  type NodeOwner,
  type ProcessKey,
  type ProcessReading,
  type ProjectLoadState,
  type ResourceNode,
  type ThrongRole,
} from './types.js';

// ── Inputs (structural mirrors of the ipc-contract roster and context; core depends on nothing) ──

export interface HierarchyTerminal {
  readonly panelId: string;
  readonly projectId: string | null;
  readonly osPid: number | null;
  readonly conhostPid: number | null;
  /** Console-attached processes, each with its start time — a pid alone may have been reused. */
  readonly attached: readonly AttachedProcess[];
}

/** A console-attached process as the daemon last saw it: epoch-ms start time, 0 when unknown. */
export interface AttachedProcess {
  readonly pid: number;
  readonly startedAt: number;
}

/**
 * Whether a reading is the process the daemon saw attached. Both clocks floor the same OS creation
 * time to whole ms, so they agree to within 1; an unknown time on either side never matches — a
 * misattributed process would be killable from Kill All Below (review #1).
 */
function isSameProcess(r: ProcessReading, a: AttachedProcess): boolean {
  return a.startedAt > 0 && r.startedAt !== undefined && r.startedAt > 0 && Math.abs(r.startedAt - a.startedAt) <= 1;
}

export interface HierarchyRoster {
  /** `null` when the daemon cannot be reached (FR-044). */
  readonly daemonPid: number | null;
  readonly agentPid: number | null;
  readonly collectorPid: number | null;
  readonly terminals: readonly HierarchyTerminal[];
  readonly locks: readonly { readonly path: string; readonly projectId: string; readonly pid: number | null; readonly panelIds: readonly string[] }[];
  readonly ui: readonly { readonly pid: number; readonly role: string; readonly label: string }[];
}

export interface HierarchyContext {
  readonly projects: readonly { readonly id: string; readonly name: string; readonly state: ProjectLoadState; readonly listOrder: number }[];
  readonly tabs: readonly { readonly id: string; readonly projectId: string | null; readonly name: string; readonly subWorkspaceName: string | null }[];
  readonly panels: readonly { readonly id: string; readonly tabId: string; readonly projectId: string | null; readonly name: string; readonly kind: string }[];
}

export interface HierarchyEstimate {
  readonly panelId: string;
  readonly target: 'panel' | 'buffers';
  /** The process the memory is moved out of. */
  readonly pid: number;
  readonly memoryBytes: number;
  readonly sharedWith?: string;
}

/** ProcessKey → the panel it was once attributed to (R6). */
export type LineageMap = ReadonlyMap<ProcessKey, string>;

export interface BuildHierarchyInput {
  readonly readings: readonly ProcessReading[];
  /** Each process's own figures this tick, by key; a process absent here shows memory only. */
  readonly metrics: ReadonlyMap<ProcessKey, Metrics>;
  readonly descriptions?: ReadonlyMap<
    ProcessKey,
    { readonly commandLine?: string; readonly executablePath?: string; readonly unavailableReason?: string }
  >;
  readonly roster: HierarchyRoster;
  /** `null` before any renderer has reported (summary mode): panels are then named generically. */
  readonly context: HierarchyContext | null;
  readonly estimates?: readonly HierarchyEstimate[];
  readonly lineage: LineageMap;
}

export interface BuildHierarchyResult {
  readonly root: ResourceNode;
  /** The lineage to pass to the next tick: this tick's attributions, dead identities dropped. */
  readonly lineage: Map<ProcessKey, string>;
}

const NOT_MEASURED_METRICS: Metrics = {
  cpu: NOT_MEASURED,
  memory: NOT_MEASURED,
  gpu: NOT_MEASURED,
  ioRead: NOT_MEASURED,
  ioWrite: NOT_MEASURED,
  network: NOT_MEASURED,
};

const STATE_RANK: Record<ProjectLoadState, number> = { active: 0, loaded: 1, unloaded: 2 };

/** The roster's UI role as a {@link ThrongRole}; an unknown role reads as a utility process. */
function uiRole(role: string): ThrongRole {
  return role === 'main' || role === 'window' || role === 'gpu' ? role : 'utility';
}
const NO_PROJECT = '';

function uiNode(
  id: string,
  kind: ResourceNode['kind'],
  label: string,
  owner: NodeOwner,
  children: ResourceNode[],
  extra: Partial<ResourceNode> = {},
): ResourceNode {
  const own = extra.own ?? ZERO_METRICS;
  return { id, kind, label, owner, children, ...extra, own, rolled: rollUp(own, children.map((c) => c.rolled)) };
}

function limitation(slug: string, label: string, reason: string, owner: NodeOwner): ResourceNode {
  const u = unavailable(reason);
  const own: Metrics = { cpu: u, memory: u, gpu: u, ioRead: u, ioWrite: u, network: u };
  return { id: `l:${slug}`, kind: 'limitation', label, reason, owner, own, rolled: own, children: [] };
}

/**
 * The whole hierarchy for one tick (FR-020 – FR-024b, research R6): four components, every roster
 * process in exactly one of them, every terminal's processes under its panel — by parent link with
 * the pid-reuse guard, by console attachment, and by lineage — and each panel estimate moved out of
 * the process holding it. Nothing else on the machine appears.
 */
export function buildHierarchy(input: BuildHierarchyInput): BuildHierarchyResult {
  const { readings, roster, context } = input;
  const byPid = new Map(readings.map((r) => [r.pid, r]));
  const byParent = new Map<number, ProcessReading[]>();
  for (const r of readings) {
    if (r.ppid === r.pid) continue;
    const list = byParent.get(r.ppid);
    if (list) list.push(r);
    else byParent.set(r.ppid, [r]);
  }

  // Processes with a place of their own: never swept into another's subtree.
  const reserved = new Set<number>();
  for (const u of roster.ui) reserved.add(u.pid);
  for (const pid of [roster.daemonPid, roster.agentPid, roster.collectorPid]) if (pid !== null) reserved.add(pid);
  for (const t of roster.terminals) {
    if (t.osPid !== null) reserved.add(t.osPid);
    if (t.conhostPid !== null) reserved.add(t.conhostPid);
  }
  for (const l of roster.locks) if (l.pid !== null) reserved.add(l.pid);

  // Where panels can be placed: a context tab lands under its project only when that project has a
  // row — the context's projects plus every project a running terminal names. A terminal whose tab
  // has no row is placed loose under its own project instead, so it is never dropped.
  const rosterPanels = new Set(roster.terminals.map((t) => t.panelId));
  const terminalProject = (t: HierarchyTerminal): string =>
    t.projectId ?? context?.panels.find((p) => p.id === t.panelId)?.projectId ?? NO_PROJECT;
  const projectRows = new Set([...(context?.projects ?? []).map((p) => p.id), ...roster.terminals.map(terminalProject)]);
  const placedTabs = new Set((context?.tabs ?? []).filter((t) => projectRows.has(t.projectId ?? NO_PROJECT)).map((t) => t.id));
  const panelPlaced = new Set(
    (context?.panels ?? []).filter((p) => placedTabs.has(p.tabId) && p.kind !== 'terminal' && !rosterPanels.has(p.id)).map((p) => p.id),
  );

  // Estimates are MOVED: out of their source process, into the panel or its buffers (FR-024, FR-024b).
  // Only an estimate whose panel is placed moves — one with nowhere to land would take its memory out
  // of the total (summary mode, or a panel the windows have not reported).
  const moveOut = new Map<number, number>();
  const panelEstimate = new Map<string, { memory: number; sharedWith?: string }>();
  const buffersEstimate = new Map<string, number>();
  const lands = (e: HierarchyEstimate): boolean => (e.target === 'buffers' ? rosterPanels.has(e.panelId) : panelPlaced.has(e.panelId));
  for (const e of (input.estimates ?? []).filter(lands)) {
    moveOut.set(e.pid, (moveOut.get(e.pid) ?? 0) + e.memoryBytes);
    if (e.target === 'buffers') {
      buffersEstimate.set(e.panelId, (buffersEstimate.get(e.panelId) ?? 0) + e.memoryBytes);
    } else {
      const prev = panelEstimate.get(e.panelId);
      panelEstimate.set(e.panelId, {
        memory: (prev?.memory ?? 0) + e.memoryBytes,
        sharedWith: e.sharedWith ?? prev?.sharedWith,
      });
    }
  }

  const ownOf = (r: ProcessReading): Metrics => {
    const key = processKey(r.pid, r.createTime);
    const m = input.metrics.get(key) ?? { ...NOT_MEASURED_METRICS, memory: r.privateWorkingSet };
    const out = moveOut.get(r.pid);
    return out !== undefined && typeof m.memory === 'number' ? { ...m, memory: Math.max(0, m.memory - out) } : m;
  };

  const claimed = new Set<number>();
  const subtree = (
    r: ProcessReading,
    owner: NodeOwner,
    label?: string,
    onClaim?: (r: ProcessReading) => void,
    role?: ThrongRole,
  ): ResourceNode => {
    claimed.add(r.pid);
    onClaim?.(r);
    const kids: ResourceNode[] = [];
    for (const c of byParent.get(r.pid) ?? []) {
      if (claimed.has(c.pid) || reserved.has(c.pid)) continue;
      // A process cannot predate its parent: this edge is a reused pid, not a parentage.
      if (r.createTime > 0 && c.createTime > 0 && c.createTime < r.createTime) continue;
      kids.push(subtree(c, owner, undefined, onClaim));
    }
    const key = processKey(r.pid, r.createTime);
    const desc = input.descriptions?.get(key);
    const own = ownOf(r);
    return {
      id: `x:${key}`,
      kind: 'process',
      label: label ?? friendlyName(r.imageName, desc?.commandLine),
      own,
      rolled: rollUp(own, kids.map((k) => k.rolled)),
      children: kids,
      owner,
      ...(role !== undefined ? { role } : {}),
      process: {
        pid: r.pid,
        createTime: r.createTime,
        key,
        imageName: r.imageName,
        commandLine: desc?.commandLine,
        executablePath: desc?.executablePath,
        ...(desc?.unavailableReason !== undefined ? { unavailableReason: desc.unavailableReason } : {}),
        startedAt: r.startedAt,
      },
    };
  };

  // ── Projects: claim every terminal's processes first ─────────────────────────────────────────
  const ctxPanels = new Map((context?.panels ?? []).map((p) => [p.id, p]));
  const projectName = new Map((context?.projects ?? []).map((p) => [p.id, p.name]));
  const panelName = (panelId: string): string => ctxPanels.get(panelId)?.name ?? 'Terminal';

  const lineage = new Map<ProcessKey, string>();
  const terminalChildren = new Map<string, ResourceNode[]>();
  const terminalOwner = (t: HierarchyTerminal): NodeOwner => ({
    component: 'projects',
    projectId: t.projectId ?? ctxPanels.get(t.panelId)?.projectId ?? undefined,
    tabId: ctxPanels.get(t.panelId)?.tabId,
    panelId: t.panelId,
  });
  const ownersByPanel = new Map(roster.terminals.map((t) => [t.panelId, terminalOwner(t)]));

  for (const t of roster.terminals) {
    const owner = ownersByPanel.get(t.panelId)!;
    const record = (r: ProcessReading) => lineage.set(processKey(r.pid, r.createTime), t.panelId);
    const kids: ResourceNode[] = [];
    const shell = t.osPid === null ? undefined : byPid.get(t.osPid);
    if (t.osPid === null) {
      kids.push(
        limitation(
          `${t.panelId}-starting`,
          'Terminal process',
          'Its process is not known yet: the terminal is still starting',
          owner,
        ),
      );
    } else if (shell !== undefined) {
      kids.push(subtree(shell, owner, undefined, record));
    }
    for (const a of t.attached) {
      const r = byPid.get(a.pid);
      if (r !== undefined && isSameProcess(r, a) && !claimed.has(a.pid) && !reserved.has(a.pid)) {
        kids.push(subtree(r, owner, undefined, record));
      }
    }
    terminalChildren.set(t.panelId, kids);
  }

  // Lineage: a process once attributed keeps its panel while the same identity lives (FR-021).
  for (const r of [...readings].sort((a, b) => a.createTime - b.createTime)) {
    if (claimed.has(r.pid) || reserved.has(r.pid)) continue;
    const panelId = input.lineage.get(processKey(r.pid, r.createTime));
    const owner = panelId === undefined ? undefined : ownersByPanel.get(panelId);
    if (panelId === undefined || owner === undefined) continue;
    terminalChildren.get(panelId)!.push(subtree(r, owner, undefined, (x) => lineage.set(processKey(x.pid, x.createTime), panelId)));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────────────────────
  const helperOwner: NodeOwner = { component: 'helpers' };
  const helpers: ResourceNode[] = [];
  const helper = (pid: number | null, label: string, role: ThrongRole): void => {
    const r = pid === null ? undefined : byPid.get(pid);
    if (r !== undefined && !claimed.has(r.pid)) helpers.push(subtree(r, helperOwner, label, undefined, role));
  };
  for (const t of roster.terminals) helper(t.conhostPid, `Console host — ${panelName(t.panelId)}`, 'conhost');
  for (const l of roster.locks) helper(l.pid, `Folder lock — ${projectName.get(l.projectId) ?? l.projectId}`, 'lock-helper');
  helper(roster.agentPid, 'De-elevation agent', 'deelevation-agent');
  helper(roster.collectorPid, 'Resource collector', 'collector');

  // ── Daemon and UI ────────────────────────────────────────────────────────────────────────────
  const daemonOwner: NodeOwner = { component: 'daemon' };
  const daemonReading = roster.daemonPid === null ? undefined : byPid.get(roster.daemonPid);
  const daemonKids =
    daemonReading !== undefined
      ? [subtree(daemonReading, daemonOwner, 'Daemon', undefined, 'daemon')]
      : [limitation('daemon-unreachable', 'Daemon', 'The daemon cannot be reached', daemonOwner)];

  const uiOwner: NodeOwner = { component: 'ui' };
  const uiKids: ResourceNode[] = [];
  for (const u of roster.ui) {
    const r = byPid.get(u.pid);
    if (r !== undefined && !claimed.has(u.pid)) uiKids.push(subtree(r, uiOwner, u.label, undefined, uiRole(u.role)));
  }

  // ── Projects → tabs → panels ─────────────────────────────────────────────────────────────────
  const rosterByPanel = new Map(roster.terminals.map((t) => [t.panelId, t]));
  const placedPanels = new Set<string>();

  const panelNode = (panelId: string, name: string, kind: string, owner: NodeOwner): ResourceNode => {
    placedPanels.add(panelId);
    const terminal = rosterByPanel.get(panelId);
    if (kind === 'terminal' || terminal !== undefined) {
      const kids = [...(terminalChildren.get(panelId) ?? [])];
      if (terminal !== undefined) {
        const bytes = buffersEstimate.get(panelId);
        const own: Metrics = { ...NOT_MEASURED_METRICS, memory: bytes ?? NOT_MEASURED };
        kids.push({ id: `b:${panelId}`, kind: 'buffers', label: 'Terminal buffers', own, rolled: own, children: [], owner, estimated: true });
      }
      return uiNode(`n:${panelId}`, 'panel', name, owner, kids, { panelKind: 'terminal' });
    }
    const est = panelEstimate.get(panelId);
    const own: Metrics = { ...NOT_MEASURED_METRICS, memory: est?.memory ?? NOT_MEASURED };
    return uiNode(`n:${panelId}`, 'panel', name, owner, [], {
      own,
      panelKind: kind,
      ...(est !== undefined ? { estimated: true } : {}),
      ...(est?.sharedWith !== undefined ? { sharedWith: est.sharedWith } : {}),
    });
  };

  type ProjectRow = { id: string; name: string; state: ProjectLoadState; listOrder: number };
  const projects: ProjectRow[] = [...(context?.projects ?? [])];
  const known = new Set(projects.map((p) => p.id));
  const projectOf = (t: HierarchyTerminal): string => t.projectId ?? ctxPanels.get(t.panelId)?.projectId ?? NO_PROJECT;
  for (const t of roster.terminals) {
    const id = projectOf(t);
    if (known.has(id)) continue;
    known.add(id);
    projects.push({ id, name: id === NO_PROJECT ? 'No project' : id, state: 'loaded', listOrder: Number.MAX_SAFE_INTEGER });
  }
  projects.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.listOrder - b.listOrder);

  const projectNodes = projects.map((p) => {
    const tabs = (context?.tabs ?? [])
      .filter((t) => placedTabs.has(t.id) && (t.projectId ?? NO_PROJECT) === p.id)
      .map((t) => {
        const panels = (context?.panels ?? [])
          .filter((n) => n.tabId === t.id)
          .map((n) =>
            panelNode(n.id, n.name, n.kind, { component: 'projects', projectId: p.id || undefined, tabId: t.id, panelId: n.id }),
          );
        return uiNode(`t:${t.id}`, 'tab', tabLabel(t), { component: 'projects', projectId: p.id || undefined, tabId: t.id }, panels);
      });
    // A running terminal the context does not (yet) name still shows, directly under its project.
    const loose = roster.terminals
      .filter((t) => projectOf(t) === p.id && !placedPanels.has(t.panelId) && !placedTabs.has(ctxPanels.get(t.panelId)?.tabId ?? ''))
      .map((t) => panelNode(t.panelId, panelName(t.panelId), 'terminal', ownersByPanel.get(t.panelId)!));
    return uiNode(`p:${p.id}`, 'project', p.name, { component: 'projects', projectId: p.id || undefined }, [...tabs, ...loose], {
      projectState: p.state,
    });
  });

  const comp = (id: ComponentId, label: string, children: ResourceNode[]): ResourceNode =>
    uiNode(`c:${id}`, 'component', label, { component: id }, children);
  const components = [
    comp('ui', 'UI', uiKids),
    comp('daemon', 'Daemon', daemonKids),
    comp('helpers', 'Helpers', helpers),
    comp('projects', 'Projects', projectNodes),
  ];
  const root = uiNode('root', 'root', 'throng', { component: 'projects' }, components);
  return { root, lineage };
}
