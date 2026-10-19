/**
 * Resource monitor contracts (055): the daemon's `resources.roster` RPC, the UI main ↔ collector
 * protocol, and the payloads UI main relays to the renderer. See
 * `specs/055-resource-monitor/contracts/`.
 */
import type { ComponentId, MachineInfo, Metrics, ProcessKey, ProjectLoadState, ResourceNode } from '@throng/core';

// ── Daemon RPC ──────────────────────────────────────────────────────────────────────────────────

export const RESOURCES_ROSTER_METHOD = 'resources.roster';

export interface RosterTerminal {
  readonly panelId: string;
  readonly projectId: string | null;
  /** The shell's OS pid; `null` until an agent-hosted terminal has reported it. */
  readonly osPid: number | null;
  readonly conhostPid: number | null;
  /**
   * The command poller's latest console-attached processes for this terminal, `[]` before the first
   * poll. Each carries its epoch-ms start time (0 when unknown): the collector attributes one only
   * when the reading's start time matches, so a reused pid is never taken for it.
   */
  readonly attached: readonly { readonly pid: number; readonly startedAt: number }[];
  /** Characters the daemon holds as this terminal's scrollback (FR-024b). */
  readonly scrollbackChars: number;
}

export interface RosterLock {
  readonly path: string;
  readonly projectId: string;
  readonly pid: number | null;
  readonly panelIds: readonly string[];
}

/** `resources.roster` result: a pure read of daemon memory — no OS query (contract §1). */
export interface DaemonRoster {
  readonly daemonPid: number;
  readonly agentPid: number | null;
  readonly terminals: readonly RosterTerminal[];
  readonly locks: readonly RosterLock[];
}

// ── UI main's merge, handed to the collector ────────────────────────────────────────────────────

export type RosterUiRole = 'main' | 'window' | 'gpu' | 'utility';

export interface RosterUiProcess {
  readonly pid: number;
  readonly role: RosterUiRole;
  /** e.g. "Main window", "Preferences", "GPU". */
  readonly label: string;
}

export interface ResourceRoster {
  /** `null` when the daemon cannot be reached (FR-044). */
  readonly daemonPid: number | null;
  readonly agentPid: number | null;
  readonly terminals: readonly RosterTerminal[];
  readonly locks: readonly RosterLock[];
  readonly ui: readonly RosterUiProcess[];
  /**
   * Set when the daemon could not be read this tick and these are its last good entries: the epoch ms
   * they were read at. Attribution stays as it was rather than collapsing (FR-021, FR-044).
   */
  readonly daemonStaleSince?: number;
}

export interface WorkspaceContextProject {
  readonly id: string;
  readonly name: string;
  readonly state: ProjectLoadState;
  readonly listOrder: number;
}

export interface WorkspaceContextTab {
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly subWorkspaceName: string | null;
  readonly mounted: boolean;
}

export interface WorkspaceContextPanel {
  readonly id: string;
  readonly tabId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly kind: string;
  readonly mounted: boolean;
}

/** Every project added to throng, and the tabs and panels the user has open (FR-020c). */
export interface WorkspaceContext {
  readonly projects: readonly WorkspaceContextProject[];
  readonly tabs: readonly WorkspaceContextTab[];
  readonly panels: readonly WorkspaceContextPanel[];
}

export type EstimateSource = 'main' | 'renderer' | 'daemon';

/** Memory attributed to a panel, moved out of the process that holds it (FR-024, FR-024b). */
export interface PanelEstimate {
  readonly panelId: string;
  /** `buffers` for a terminal's scrollback; `panel` for an editor's or preview's own figure. */
  readonly target: 'panel' | 'buffers';
  readonly source: EstimateSource;
  /** The OS pid of the process the memory is moved out of. */
  readonly pid: number;
  readonly memoryBytes: number;
  /** A linked editor panel whose document another panel owns. */
  readonly sharedWith?: string;
}

// ── Collector → UI ──────────────────────────────────────────────────────────────────────────────

export interface ComponentSummary {
  readonly id: ComponentId;
  readonly rolled: Metrics;
}

/** The status bar's data: four totals plus their split by component (FR-040, FR-042). */
export interface ResourceSummary {
  readonly tick: number;
  /** Epoch ms of the reading. */
  readonly at: number;
  /** True when the latest tick failed and these are the previous figures (Edge Cases). */
  readonly stale: boolean;
  /** With `stale`: the epoch ms of the newest reading these figures fully reflect, for "N s ago". */
  readonly staleSince?: number;
  readonly total: Metrics;
  readonly components: readonly ComponentSummary[];
  readonly machine: MachineInfo;
}

export interface HeldFolderPanel {
  readonly panelId: string;
  readonly tabName: string;
  readonly panelName: string;
}

export interface HeldFolder {
  readonly path: string;
  readonly projectId: string;
  readonly panels: readonly HeldFolderPanel[];
}

export interface DetailFrame {
  readonly tick: number;
  readonly at: number;
  readonly stale: boolean;
  /** As on `ResourceSummary`. */
  readonly staleSince?: number;
  readonly hierarchy: ResourceNode;
  readonly held: readonly HeldFolder[];
  readonly machine: MachineInfo;
}

export type KillMode = 'process' | 'below';
export type KillOutcome = 'ended' | 'gone' | 'denied' | 'failed';

export interface KillRequest {
  readonly mode: KillMode;
  readonly nodeId: string;
  readonly targets: readonly ProcessKey[];
}

export interface KillTargetResult {
  readonly key: ProcessKey;
  readonly outcome: KillOutcome;
  /** A failure-cause code for `denied`/`failed` (FR-064); never a raw error string. */
  readonly cause?: string;
}

export interface KillResult {
  readonly results: readonly KillTargetResult[];
}

// ── UI main ↔ collector messages (contract §2) ──────────────────────────────────────────────────

export type MainToCollector =
  | { readonly type: 'configure'; readonly intervalSeconds: number; readonly historyMinutes: number }
  /** `requestId` echoes the `needRoster` it answers, so a late reply never ends a newer tick's wait. */
  | { readonly type: 'roster'; readonly roster: ResourceRoster; readonly requestId?: number }
  | { readonly type: 'context'; readonly context: WorkspaceContext }
  | { readonly type: 'estimates'; readonly estimates: readonly PanelEstimate[] }
  | { readonly type: 'detail'; readonly on: boolean }
  | ({ readonly type: 'kill'; readonly requestId: number } & KillRequest);

export type CollectorToMain =
  | { readonly type: 'needRoster'; readonly requestId?: number }
  | { readonly type: 'summary'; readonly summary: ResourceSummary }
  | { readonly type: 'detailFrame'; readonly frame: DetailFrame }
  | ({ readonly type: 'killResult'; readonly requestId: number } & KillResult)
  | { readonly type: 'error'; readonly cause: string };
