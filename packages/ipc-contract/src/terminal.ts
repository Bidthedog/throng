// Terminal daemon RPC + streaming notifications (005 Phase C,
// contracts/terminal-rpc.md). Commands are request/response; output/exit are
// JSON-RPC *notifications* (no id) pushed over a long-lived subscribed socket.

// --- Command methods (request → response) ---
export const TERMINAL_ATTACH_METHOD = 'terminal.attach';
export const TERMINAL_WRITE_METHOD = 'terminal.write';
export const TERMINAL_RESIZE_METHOD = 'terminal.resize';
export const TERMINAL_KILL_METHOD = 'terminal.kill';
export const TERMINAL_LIST_METHOD = 'terminal.list';
/** Report daemon capabilities to the UI — currently just its elevation (FR-025a). */
export const TERMINAL_CAPABILITIES_METHOD = 'terminal.capabilities';
/** Close idle (no running command) sessions — busy ones keep running (FR-015b). */
export const TERMINAL_CLOSE_IDLE_METHOD = 'terminal.closeIdle';
/** Kill all sessions (the app-close "terminate all" choice, FR-015e). */
export const TERMINAL_KILL_ALL_METHOD = 'terminal.killAll';
/** Sent by a UI events socket to receive notifications (marks the socket). */
export const TERMINAL_SUBSCRIBE_METHOD = 'terminal.subscribe';

// --- Notification methods (daemon → UI, no id) ---
export const TERMINAL_OUTPUT_NOTIFICATION = 'terminal.output';
export const TERMINAL_EXIT_NOTIFICATION = 'terminal.exit';
export const TERMINAL_FLAVOUR_MISSING_NOTIFICATION = 'terminal.flavourMissing';

/** Resolved at (re)start; never persisted. cwd = project root. */
export interface LaunchSpecDto {
  file: string;
  args: string[];
  cwd: string;
}

/** Display metadata for a session, shown in the app-close warning (FR-015). */
export interface TerminalMeta {
  projectName?: string;
  tabName?: string;
  panelName?: string;
  flavourLabel?: string;
}

export interface TerminalAttachParams {
  panelId: string;
  projectId: string;
  launch: LaunchSpecDto;
  cols: number;
  rows: number;
  /**
   * A sub-workspace-owned terminal with no owning project (FR-028): its cwd is the
   * user's home directory and it takes NO project-root lock (locking home would be
   * wrong). `projectId` is the sub-workspace's synthetic id.
   */
  rootless?: boolean;
  /** Launch this terminal elevated (only honoured in an elevated daemon, FR-025). */
  runAsAdmin?: boolean;
  /** Human-readable labels for the close-warning details (updated on reattach). */
  meta?: TerminalMeta;
}

/** Daemon capabilities the UI queries (FR-025a). */
export interface TerminalCapabilitiesResult {
  /** True iff the terminal-hosting daemon runs elevated (gates "run as admin"). */
  elevated: boolean;
}

export interface TerminalAttachResult {
  status: 'running' | 'exited';
  /** Buffered scrollback to replay into the view on (re)attach. */
  scrollback: string;
  exit?: { code: number | null; signal?: string };
}

export interface TerminalWriteParams {
  panelId: string;
  data: string;
}

export interface TerminalResizeParams {
  panelId: string;
  cols: number;
  rows: number;
}

export interface TerminalKillParams {
  panelId: string;
}

export interface TerminalListParams {
  projectId?: string;
  /**
   * Compute the `busy` flag per session. Off by default because it probes each
   * session's child processes (expensive on Windows/ConPTY) — a plain count/list
   * (e.g. the app-close prompt) must not pay that cost. `busy` is `false` when not
   * requested.
   */
  includeBusy?: boolean;
}

export interface TerminalSessionInfo {
  panelId: string;
  projectId: string;
  status: 'running' | 'exited';
  /** Whether a command is running; only meaningful when listed with includeBusy. */
  busy: boolean;
  /** Display metadata captured at (re)attach, for the app-close warning. */
  meta?: TerminalMeta;
}

export interface TerminalListResult {
  sessions: TerminalSessionInfo[];
}

export interface TerminalOkResult {
  ok: true;
}

// --- Notification payloads ---
export interface TerminalOutputNotification {
  panelId: string;
  data: string;
}

export interface TerminalExitNotification {
  panelId: string;
  code: number | null;
  signal?: string;
  /** True when the process exited without a user-initiated kill (FR-017). */
  unexpected: boolean;
}

export interface TerminalFlavourMissingNotification {
  panelId: string;
  flavourId: string;
}

/** A JSON-RPC 2.0 notification frame (no `id`) — the daemon→UI streaming shape. */
export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: '2.0';
  method: string;
  params: TParams;
}
