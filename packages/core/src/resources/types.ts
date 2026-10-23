/**
 * The resource monitor's model (055). Every value here is recomputed each tick; nothing is
 * persisted. See `specs/055-resource-monitor/data-model.md`.
 */

/** A process's identity: pid alone is reused by Windows, pid + create time is not. */
export type ProcessKey = string;

export function processKey(pid: number, createTime: number): ProcessKey {
  return `${pid}:${createTime}`;
}

/** One row of the platform's process table, read in one call per tick (research R2). */
export interface ProcessReading {
  readonly pid: number;
  /** The parent at creation; may name a process that has since exited, or a reused pid. */
  readonly ppid: number;
  /**
   * When the process started, as an exact integer in the platform's units (whole ms since 1601 on
   * Windows) — never a float past 2^53, or two identities compare equal. With `pid`, the {@link ProcessKey}.
   */
  readonly createTime: number;
  readonly imageName: string;
  /** User + kernel time, cumulative, in 100-ns ticks. */
  readonly cpuTime: number;
  /** Private working set in bytes — Task Manager's default memory column. */
  readonly privateWorkingSet: number;
  /** Cumulative bytes of ALL file and device I/O (research R3) — labelled "I/O", never "disk". */
  readonly ioReadBytes: number;
  readonly ioWriteBytes: number;
  /** Creation time in epoch ms, where the platform converts it. */
  readonly startedAt?: number;
}

export interface MachineInfo {
  readonly logicalProcessors: number;
  readonly installedRamBytes: number;
}

/** The figure exists but could not be read, and why (FR-011, FR-044). Never shown as zero. */
export interface Unavailable {
  readonly kind: 'unavailable';
  readonly reason: string;
}

/** No validated method produces this figure (FR-012), or a rate has had one reading only. */
export interface NotMeasured {
  readonly kind: 'notMeasured';
}

export type MetricValue = number | Unavailable | NotMeasured;

export const METRIC_NAMES = ['cpu', 'memory', 'gpu', 'ioRead', 'ioWrite'] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

/**
 * One node's figures. `cpu` and `gpu` are % of the machine; `memory` bytes; `ioRead`/`ioWrite`
 * bytes per second. `partial` names, per metric, why a rolled-up total is missing a part of its
 * subtree (a child that could not be read).
 */
export type Metrics = { readonly [M in MetricName]: MetricValue } & {
  readonly partial?: Partial<Record<MetricName, string>>;
};

export type ComponentId = 'ui' | 'daemon' | 'helpers' | 'projects';

/** What one of throng's own processes is for (FR-102); the user's processes have no role. */
export type ThrongRole =
  | 'main'
  | 'window'
  | 'gpu'
  | 'utility'
  | 'daemon'
  | 'conhost'
  | 'lock-helper'
  | 'collector'
  | 'deelevation-agent';

export type ResourceNodeKind =
  | 'root'
  | 'component'
  | 'project'
  | 'tab'
  | 'panel'
  | 'buffers'
  | 'process'
  | 'limitation';

export type ProjectLoadState = 'active' | 'loaded' | 'unloaded';

export interface NodeOwner {
  readonly component: ComponentId;
  readonly projectId?: string;
  readonly tabId?: string;
  readonly panelId?: string;
}

export interface NodeProcess {
  readonly pid: number;
  readonly createTime: number;
  readonly key: ProcessKey;
  readonly imageName: string;
  readonly commandLine?: string;
  readonly executablePath?: string;
  /** Why the command line and path could not be read, when they could not (FR-080). */
  readonly unavailableReason?: string;
  /** Epoch ms. */
  readonly startedAt?: number;
}

/**
 * One node at any level. `id` is stable across ticks: `c:<component>`, `p:<projectId>`,
 * `t:<tabId>`, `n:<panelId>`, `b:<panelId>`, `x:<ProcessKey>`, `l:<reason-slug>`, `root`.
 */
export interface ResourceNode {
  readonly id: string;
  readonly kind: ResourceNodeKind;
  readonly label: string;
  /** This node's own figures — zero for UI elements (project, tab, component). */
  readonly own: Metrics;
  /** `own` plus every descendant's `rolled` (FR-022). */
  readonly rolled: Metrics;
  readonly children: readonly ResourceNode[];
  /** True for panel and buffer estimates (FR-024, FR-024b). */
  readonly estimated?: boolean;
  /** Set on a linked editor panel whose document another panel owns. */
  readonly sharedWith?: string;
  readonly owner: NodeOwner;
  readonly process?: NodeProcess;
  readonly projectState?: ProjectLoadState;
  /** The panel kind, on panel nodes ("terminal", "editor", "preview", …). */
  readonly panelKind?: string;
  /** Why a limitation node exists (FR-080). */
  readonly reason?: string;
  /** On the top process of one of throng's own roles — what it is for (FR-102). */
  readonly role?: ThrongRole;
}
