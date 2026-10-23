/**
 * Builders for the resource monitor's component tests (055): metrics, nodes with their roll-ups
 * computed by core's own `rollUp`, a sample hierarchy, summaries and detail frames.
 *
 * The roll-up is NOT re-implemented here: a fixture whose parent figures were typed by hand would
 * agree with the component under test by construction and prove nothing about it.
 */
import {
  NOT_MEASURED,
  ZERO_METRICS,
  processKey,
  rollUp,
  type ComponentId,
  type MachineInfo,
  type MetricName,
  type MetricValue,
  type Metrics,
  type NodeOwner,
  type ResourceNode,
  type ResourceNodeKind,
  type UsageThresholds,
} from '@throng/core';
import type { DetailFrame, ResourceSummary } from '@throng/ipc-contract';

export const GIB = 1024 ** 3;
export const MIB = 1024 ** 2;

export const MACHINE: MachineInfo = { logicalProcessors: 8, installedRamBytes: 16 * GIB };

export const THRESHOLDS: UsageThresholds = { cpuWarning: 50, cpuCritical: 80, memoryWarning: 50, memoryCritical: 80 };

/** Figures for a node: unspecified metrics are zero. */
export function metrics(over: Partial<Record<MetricName, MetricValue>> = {}): Metrics {
  return { ...ZERO_METRICS, ...over };
}

export interface NodeSpec {
  id: string;
  kind: ResourceNodeKind;
  label: string;
  own?: Metrics;
  children?: readonly ResourceNode[];
  owner?: Partial<NodeOwner> & { component?: ComponentId };
  estimated?: boolean;
  sharedWith?: string;
  projectState?: 'active' | 'loaded' | 'unloaded';
  panelKind?: string;
  reason?: string;
  process?: ResourceNode['process'];
}

/** A node whose `rolled` is core's `rollUp` of its own figures and its children's. */
export function node(spec: NodeSpec): ResourceNode {
  const children = spec.children ?? [];
  const own = spec.own ?? ZERO_METRICS;
  return {
    id: spec.id,
    kind: spec.kind,
    label: spec.label,
    own,
    rolled: rollUp(own, children.map((c) => c.rolled)),
    children,
    owner: { component: 'projects', ...spec.owner },
    ...(spec.estimated ? { estimated: true } : {}),
    ...(spec.sharedWith ? { sharedWith: spec.sharedWith } : {}),
    ...(spec.projectState ? { projectState: spec.projectState } : {}),
    ...(spec.panelKind ? { panelKind: spec.panelKind } : {}),
    ...(spec.reason ? { reason: spec.reason } : {}),
    ...(spec.process ? { process: spec.process } : {}),
  };
}

/** A live OS process node under a terminal. `createTime` is fixed so `x:<pid>:1` is stable. */
export function proc(
  pid: number,
  imageName: string,
  own: Metrics,
  children: readonly ResourceNode[] = [],
  owner: Partial<NodeOwner> = {},
  extra: Partial<NonNullable<ResourceNode['process']>> = {},
): ResourceNode {
  const key = processKey(pid, 1);
  return node({
    id: `x:${key}`,
    kind: 'process',
    label: imageName,
    own,
    children,
    owner,
    process: { pid, createTime: 1, key, imageName, startedAt: 1_700_000_000_000, ...extra },
  });
}

export interface SampleOptions {
  /** CPU % of the node process in terminal one (default 12). */
  nodeCpu?: number;
  /** False leaves `node.exe` out — the frame after it was killed. Default true. */
  withNode?: boolean;
  /** False leaves the `Notes` editor panel out. Default true. */
  withEditor?: boolean;
  /** CPU % of the shell (default 1). */
  shellCpu?: number;
}

/**
 * Two projects: `Alpha` (active; one tab `Build` with a terminal `Shell` running pwsh → node, plus an
 * editor `Notes`) and `Beta` (unloaded, empty). Components UI, Daemon and Helpers hold one process each.
 */
export function sampleHierarchy(opts: SampleOptions = {}): ResourceNode {
  const nodeProc = proc(300, 'node.exe', metrics({ cpu: opts.nodeCpu ?? 12, memory: 300 * MIB }), [], {
    projectId: 'p1',
    tabId: 't1',
    panelId: 'n1',
  }, { commandLine: 'node server.js --port 3000', executablePath: 'C:/Program Files/nodejs/node.exe' });
  const shell = proc(200, 'pwsh.exe', metrics({ cpu: opts.shellCpu ?? 1, memory: 90 * MIB }), opts.withNode === false ? [] : [nodeProc], {
    projectId: 'p1',
    tabId: 't1',
    panelId: 'n1',
  });
  const buffers = node({
    id: 'b:n1',
    kind: 'buffers',
    label: 'Terminal buffers',
    own: metrics({ memory: 12 * MIB, cpu: NOT_MEASURED, gpu: NOT_MEASURED, ioRead: NOT_MEASURED, ioWrite: NOT_MEASURED }),
    estimated: true,
    owner: { projectId: 'p1', tabId: 't1', panelId: 'n1' },
  });
  const terminal = node({
    id: 'n:n1',
    kind: 'panel',
    label: 'Shell',
    panelKind: 'terminal',
    children: [shell, buffers],
    owner: { projectId: 'p1', tabId: 't1', panelId: 'n1' },
  });
  const editor = node({
    id: 'n:n2',
    kind: 'panel',
    label: 'Notes',
    panelKind: 'editor',
    own: metrics({ memory: 40 * MIB, cpu: NOT_MEASURED, gpu: NOT_MEASURED, ioRead: NOT_MEASURED, ioWrite: NOT_MEASURED }),
    estimated: true,
    owner: { projectId: 'p1', tabId: 't1', panelId: 'n2' },
  });
  const tab = node({
    id: 't:t1',
    kind: 'tab',
    label: 'Build',
    children: opts.withEditor === false ? [terminal] : [terminal, editor],
    owner: { projectId: 'p1', tabId: 't1' },
  });
  const alpha = node({
    id: 'p:p1',
    kind: 'project',
    label: 'Alpha',
    projectState: 'active',
    children: [tab],
    owner: { projectId: 'p1' },
  });
  const beta = node({ id: 'p:p2', kind: 'project', label: 'Beta', projectState: 'unloaded', owner: { projectId: 'p2' } });
  const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [alpha, beta], owner: { component: 'projects' } });
  const ui = node({
    id: 'c:ui',
    kind: 'component',
    label: 'UI',
    children: [proc(10, 'electron.exe', metrics({ cpu: 3, memory: 200 * MIB }), [], { component: 'ui' })],
    owner: { component: 'ui' },
  });
  const daemon = node({
    id: 'c:daemon',
    kind: 'component',
    label: 'Daemon',
    children: [proc(20, 'node.exe', metrics({ cpu: 1, memory: 80 * MIB }), [], { component: 'daemon' })],
    owner: { component: 'daemon' },
  });
  const helpers = node({
    id: 'c:helpers',
    kind: 'component',
    label: 'Helpers',
    children: [proc(30, 'conhost.exe', metrics({ cpu: 0, memory: 6 * MIB }), [], { component: 'helpers' })],
    owner: { component: 'helpers' },
  });
  return node({ id: 'root', kind: 'root', label: 'throng', children: [ui, daemon, helpers, projects], owner: { component: 'ui' } });
}

export function frame(tick: number, hierarchy: ResourceNode, over: Partial<DetailFrame> = {}): DetailFrame {
  return { tick, at: 1_700_000_000_000 + tick * 2000, stale: false, hierarchy, held: [], machine: MACHINE, ...over };
}

export function summary(total: Metrics, over: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    tick: 1,
    at: 1_700_000_000_000,
    stale: false,
    total,
    components: [
      { id: 'ui', rolled: metrics({ cpu: 3, memory: 200 * MIB }) },
      { id: 'daemon', rolled: metrics({ cpu: 1, memory: 80 * MIB }) },
      { id: 'helpers', rolled: metrics({ cpu: 0, memory: 6 * MIB }) },
      { id: 'projects', rolled: metrics({ cpu: 13, memory: 430 * MIB }) },
    ],
    machine: MACHINE,
    ...over,
  };
}

/**
 * `root` with every node's Network figure set to `value` — what an unelevated throng reads
 * (`unavailable(NETWORK_ELEVATION_REQUIRED)`) or one whose trace failed. Own and rolled alike: the
 * collector rolls a figure that is not a number up as itself.
 */
export function withNetwork(root: ResourceNode, value: MetricValue): ResourceNode {
  return {
    ...root,
    own: { ...root.own, network: value },
    rolled: { ...root.rolled, network: value },
    children: root.children.map((c) => withNetwork(c, value)),
  };
}

/** Walk a hierarchy depth-first. */
export function flatten(n: ResourceNode): ResourceNode[] {
  return [n, ...n.children.flatMap(flatten)];
}
