/**
 * Typed settings abstractions (Principle X / [Gap C]). Configuration is exposed
 * to components only through these injected interfaces — never read ad hoc from
 * the environment deep inside business logic. Concrete values are bound per
 * process in that process's composition root, from documented defaults that are
 * overridable without code changes.
 */

/** Persistence-store configuration (consumed by `persistence` and `daemon`). */
export interface IPersistenceSettings {
  /** Absolute path to the embedded SQLite database file. */
  databasePath: string;
}

/** Daemon process configuration (consumed by `daemon`). */
export interface IDaemonSettings {
  /** Named-pipe address the daemon listens on (e.g. `\\.\pipe\throng.daemon`). */
  pipeName: string;
  /** Maximum time, in milliseconds, the daemon may take to become ready. */
  startupTimeoutMs: number;
  /** Time, in milliseconds, the de-elevated PTY agent has to connect before the launch is
   *  declared failed (019 FR-012). */
  agentConnectTimeoutMs: number;
  /** Time, in milliseconds, from connect for a started terminal to ack `started` (019 FR-013).
   *  Separate from the connect budget so a slow connect does not consume the readiness
   *  allowance (C7) — worst case 30s. */
  agentReadyTimeoutMs: number;
}

/** UI main-process configuration (consumed by `ui`). */
export interface IUiSettings {
  /** Named-pipe address the UI client connects to (matches the daemon's). */
  pipeName: string;
  /** Initial main-window dimensions. */
  window: {
    width: number;
    height: number;
  };
  /** Maximum time, in milliseconds, to await a daemon ping before reporting unavailable. */
  pingTimeoutMs: number;
  /**
   * Maximum time, in milliseconds, to await a terminal `attach` (008 FR-004). Sized for
   * launching an interactive shell — several seconds — and therefore SEPARATE from and
   * much larger than {@link pingTimeoutMs} (a lightweight health check). Reusing the
   * ping budget for attach is exactly what made a slow-starting shell report a spurious
   * connection timeout. Exceeding this budget is a non-fatal "still starting" state, not
   * an error, and never terminates the running session (008 FR-005).
   */
  attachTimeoutMs: number;
  /**
   * Maximum time, in milliseconds, to await every window's shutdown drain before closing
   * anyway (019 FR-010).
   *
   * A **BACKSTOP for an unresponsive window, never the mechanism**: the close waits on the
   * renderer's drain ACK, not on this clock. Issue #86 was a close racing a debounce on a
   * timer, and widening a timer is that same accident wearing a bigger coat (FR-011) — so
   * this budget exists only so a wedged renderer cannot hold the app open forever.
   */
  shutdownDrainTimeoutMs: number;
}

/**
 * Workspace/docking configuration (Principle X, 002 / data-model §5). Injected
 * into the UI main and renderer composition roots; defaults documented and
 * overridable, never read ad hoc inside components.
 */
export interface IWorkspaceSettings {
  /** Debounce, in ms, before a layout change is persisted via `workspace.save` (research D4). */
  autosaveDebounceMs: number;
  /** Default size of a newly created sub-workspace (tear-off) window (US4). */
  defaultSubWindow: {
    width: number;
    height: number;
  };
}

/**
 * User-scoped application configuration locations (003 / research D1). Injected
 * into the UI main composition root; the concrete `IConfigStore`/`IFileWatcher`
 * operate under `configRoot`. Defaults to `%USERPROFILE%\.throng`, overridable
 * (e.g. a temp dir in tests).
 */
export interface IConfigSettings {
  /** Absolute path to the user config directory (holds settings/keybindings/themes). */
  configRoot: string;
  /** Debounce, in ms, applied to config-file change events before re-read (research D3). */
  hotReloadDebounceMs: number;
}
