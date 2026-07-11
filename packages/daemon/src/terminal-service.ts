import 'reflect-metadata';
import {
  isBusy,
  shouldDeElevate,
  type IElevationState,
  type IPtyHost,
  type PtyExit,
  type PtyHandle,
} from '@throng/core';
import {
  JSON_RPC_INVALID_PARAMS,
  TERMINAL_ATTACH_METHOD,
  TERMINAL_WRITE_METHOD,
  TERMINAL_RESIZE_METHOD,
  TERMINAL_DETACH_METHOD,
  TERMINAL_KILL_METHOD,
  TERMINAL_LIST_METHOD,
  TERMINAL_CAPABILITIES_METHOD,
  TERMINAL_CLOSE_IDLE_METHOD,
  TERMINAL_KILL_ALL_METHOD,
  type TerminalAttachParams,
  type TerminalAttachResult,
  type TerminalCapabilitiesResult,
  type TerminalDetachParams,
  type TerminalKillParams,
  type TerminalListParams,
  type TerminalListResult,
  type TerminalMeta,
  type TerminalOkResult,
  type TerminalResizeParams,
  type TerminalWriteParams,
} from '@throng/ipc-contract';
import { RpcError, type RpcRouter } from './rpc-router.js';
import { TerminalEvents } from './terminal-events.js';
import { TerminalLockManager } from './terminal-lock-manager.js';

/** Bounded scrollback kept per session for reattach replay (~64 KB). */
const MAX_SCROLLBACK = 64 * 1024;

/**
 * Key for a panel presented in a single window that sends no explicit `viewId`
 * (backward compatibility): the panel is treated as having one implicit view, so a
 * one-window terminal is sized to its own dimensions exactly as before (008 FR-009).
 */
const DEFAULT_VIEW_ID = '__default__';

/** The character grid MUST never be driven below one column or one row (008 FR-012). */
const MIN_GRID = 1;

/** One view's most-recently-reported character dimensions. */
interface ViewDims {
  cols: number;
  rows: number;
}

/** A live terminal session — the daemon's in-memory record keyed by panelId. */
interface Session {
  /** Durable identity/tag (Principle III): owning project, panel, cwd. */
  readonly panelId: string;
  readonly projectId: string;
  readonly cwd: string;
  /** Sub-workspace-owned terminal (no owning project → no root lock, FR-028). */
  readonly rootless: boolean;
  /** The PTY host that owns this session — the local (elevated) host, or the
   *  de-elevated agent host for an unchecked terminal in an elevated daemon (FR-025c). */
  readonly host: IPtyHost;
  readonly handle: PtyHandle;
  /**
   * Every attached view's measured dimensions, keyed by `viewId` (008 FR-009). The
   * daemon — the only component that observes every window — sizes the single PTY to
   * the minimum columns and rows across this set, so two different-sized windows can
   * never fight over one grid (the last-writer-wins corruption). NB: session reuse is
   * keyed purely by `panelId`; the launch identity is deliberately NOT part of the
   * record, so a mirror computing a different cwd can never look like a different
   * terminal and reap the running program (008 FR-002).
   */
  readonly views: Map<string, ViewDims>;
  /** The current PTY grid (last value sent to the host); recomputed on view change. */
  grid: ViewDims;
  scrollback: string;
  status: 'running' | 'exited';
  exit?: { code: number | null; signal?: string };
  /** Set when the user deliberately killed it → exit is *not* unexpected (FR-017). */
  userKilled: boolean;
  /** Display labels for the app-close warning (refreshed on reattach). */
  meta?: TerminalMeta;
  readonly disposers: Array<() => void>;
}

function asObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError('Params must be an object', JSON_RPC_INVALID_PARAMS);
  }
  return params as Record<string, unknown>;
}

/** Read a request's `viewId`, defaulting to the single implicit view (008 FR-009). */
function viewIdOf(params: { viewId?: unknown }): string {
  return typeof params.viewId === 'string' && params.viewId ? params.viewId : DEFAULT_VIEW_ID;
}

/**
 * Daemon terminal service (005 Phase C). Owns the in-memory session registry keyed
 * by `panelId`: cold-starts PTYs via the injected `IPtyHost`, streams output as
 * `terminal.output` notifications (and buffers a bounded scrollback for reattach),
 * surfaces exits (`terminal.exit`, marking unexpected ones, FR-017), and holds the
 * project-root lock while a project has open terminals (FR-022). Reattach + the
 * full persistent lifecycle arrive in Phase C·2.
 */
export class TerminalService {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly pty: IPtyHost,
    private readonly events: TerminalEvents,
    private readonly locks: TerminalLockManager,
    private readonly elevation: IElevationState,
    /** De-elevated agent host for mixed mode (FR-025c). When absent, an elevated
     *  daemon spawns every terminal elevated (the pre-mixed-mode behaviour). */
    private readonly deElevatedPty?: IPtyHost,
    /** Test hook: route EVERY terminal through the agent regardless of elevation,
     *  so the agent plumbing can be verified at medium integrity. */
    private readonly forceAgent = false,
    /**
     * Test seam (008 FR-005): artificially delay a COLD-START attach's response by this
     * many ms, simulating a shell that takes seconds to come up, so the client-side
     * `attachTimeoutMs` and the "still starting" retry are verifiable end-to-end. The
     * session is registered BEFORE the delay, so a retry (reuse) returns immediately —
     * exactly the recovery path. Zero (default/production) means no delay.
     */
    private readonly attachColdStartDelayMs = 0,
  ) {}

  /** Pick the PTY host for a terminal: the de-elevated agent for an unchecked
   *  terminal on an elevated daemon (or when forced for testing), else local. */
  private hostFor(runAsAdmin: boolean): IPtyHost {
    const useAgent =
      !!this.deElevatedPty &&
      (this.forceAgent || shouldDeElevate(runAsAdmin, this.elevation.isElevated()));
    return useAgent && this.deElevatedPty ? this.deElevatedPty : this.pty;
  }

  register(router: RpcRouter): void {
    router.register(TERMINAL_ATTACH_METHOD, (p) => this.attach(p));
    router.register(TERMINAL_WRITE_METHOD, (p) => this.write(p));
    router.register(TERMINAL_RESIZE_METHOD, (p) => this.resize(p));
    router.register(TERMINAL_DETACH_METHOD, (p) => this.detach(p));
    router.register(TERMINAL_KILL_METHOD, (p) => this.kill(p));
    router.register(TERMINAL_LIST_METHOD, (p) => this.list(p));
    router.register(TERMINAL_CAPABILITIES_METHOD, () => this.capabilities());
    router.register(TERMINAL_CLOSE_IDLE_METHOD, (p) => this.closeIdle(p));
    router.register(TERMINAL_KILL_ALL_METHOD, (p) => this.killAll(p));
  }

  /** Report daemon capabilities to the UI (FR-025a): currently just elevation. */
  private capabilities(): TerminalCapabilitiesResult {
    return { elevated: this.elevation.isElevated() };
  }

  /** Whether a project has any open terminal (backs the root-edit guard, FR-022). */
  hasOpenTerminals(projectId: string): boolean {
    return this.locks.hasOpenTerminals(projectId);
  }

  /**
   * Kill every terminal owned by a project — called when the project is deleted, so
   * its terminals (and their OS hosts) are torn down rather than leaked. Rootless
   * sub-workspace-owned terminals are unaffected (they carry no owning project).
   */
  killForProject(projectId: string): void {
    for (const session of [...this.sessions.values()]) {
      if (session.projectId === projectId && !session.rootless && session.status === 'running') {
        session.userKilled = true;
        try {
          session.host.kill(session.handle);
        } catch {
          /* best-effort */
        }
      }
    }
  }

  /**
   * Daemon shutdown: kill every live session (reaping each terminal's OS host) and
   * dispose both PTY hosts, so exiting the daemon process never orphans `conhost.exe`
   * hosts or a de-elevated agent. Synchronous — the caller runs it before exit.
   */
  shutdown(): void {
    for (const session of [...this.sessions.values()]) {
      if (session.status === 'running') {
        session.userKilled = true;
        try {
          session.host.kill(session.handle);
        } catch {
          /* best-effort */
        }
      }
    }
    // Sweep any stragglers + tear down the de-elevated agent (its `dispose()` ends the
    // pipe, which makes the agent reap its own terminals and exit).
    try {
      this.pty.dispose?.();
    } catch {
      /* best-effort */
    }
    try {
      this.deElevatedPty?.dispose?.();
    } catch {
      /* best-effort */
    }
  }

  private async attach(rawParams: unknown): Promise<TerminalAttachResult> {
    const params = asObject(rawParams) as unknown as TerminalAttachParams;
    const { panelId, projectId, launch } = params;
    const rootless = params.rootless === true;
    if (typeof panelId !== 'string' || !panelId) {
      throw new RpcError('A non-empty "panelId" is required', JSON_RPC_INVALID_PARAMS);
    }
    if (!launch || typeof launch.file !== 'string' || typeof launch.cwd !== 'string') {
      throw new RpcError('A valid "launch" spec is required', JSON_RPC_INVALID_PARAMS);
    }

    const viewId = viewIdOf(params);
    const explicit = params.explicit === true;

    // A live session already exists for this panel. What happens next turns ENTIRELY on
    // the caller's stated intent (008 FR-002/FR-007) — never on a launch-key comparison,
    // which is the inference that caused the original data loss:
    //   • IMPLICIT attach (mirror / re-render / reconnect) → REUSE the running session,
    //     whatever launch identity it computed. A mirror into a sub-workspace resolving a
    //     different cwd must never reap the running program. Record this view's dimensions
    //     and recompute the shared grid so a second, different-sized window can't corrupt
    //     the first; replay the scrollback into the new view (FR-014/FR-021).
    //   • EXPLICIT re-type (the user deliberately picked a different terminal) → a
    //     user-initiated destroy-then-create (FR-007 explicit request): terminate the old
    //     session, then fall through to cold-start the requested launch below.
    const existing = this.sessions.get(panelId);
    if (existing && existing.status === 'running') {
      if (!explicit) {
        if (params.meta) existing.meta = params.meta; // refresh labels (e.g. a rename)
        existing.views.set(viewId, { cols: params.cols, rows: params.rows });
        this.recomputeGrid(existing);
        // Hand back the shared grid so this joining view conforms its xterm immediately —
        // even when it did not move the minimum (a larger window mirroring a smaller one),
        // so it never renders a full-screen program offset (008 FR-009).
        return { status: 'running', scrollback: existing.scrollback, grid: existing.grid };
      }
      this.terminate(existing);
    }

    // Cold start. Acquire the project-root lock for the first terminal (FR-022) —
    // never for a rootless (sub-workspace-owned) terminal, whose cwd is the user's
    // home directory (FR-028).
    if (!rootless) this.locks.acquire(projectId, launch.cwd);
    // Route to the de-elevated agent for an unchecked terminal on an elevated daemon
    // (FR-025c); otherwise the local host. Fixed per-session for its lifetime.
    const host = this.hostFor(params.runAsAdmin === true);
    const startCols = params.cols > 0 ? params.cols : 80;
    const startRows = params.rows > 0 ? params.rows : 24;
    let handle: PtyHandle;
    try {
      handle = host.start({
        file: launch.file,
        args: Array.isArray(launch.args) ? launch.args : [],
        cwd: launch.cwd,
        cols: startCols,
        rows: startRows,
        runAsAdmin: params.runAsAdmin === true,
      });
    } catch (error) {
      // Launch failure (FR-019): release the lock we just took and surface it.
      if (!rootless) this.locks.release(projectId);
      throw new RpcError(
        `Failed to launch terminal: ${(error as Error).message}`,
        JSON_RPC_INVALID_PARAMS,
      );
    }

    const session: Session = {
      panelId,
      projectId,
      cwd: launch.cwd,
      rootless,
      host,
      handle,
      views: new Map([[viewId, { cols: params.cols, rows: params.rows }]]),
      grid: { cols: startCols, rows: startRows },
      scrollback: '',
      status: 'running',
      userKilled: false,
      meta: params.meta,
      disposers: [],
    };
    session.disposers.push(
      host.onData(handle, (chunk) => {
        session.scrollback = (session.scrollback + chunk).slice(-MAX_SCROLLBACK);
        this.events.publishOutput(panelId, chunk);
      }),
    );
    session.disposers.push(host.onExit(handle, (e) => this.handleExit(session, e)));
    this.sessions.set(panelId, session);
    // Test seam (008 FR-005): simulate a slow-starting shell. The session is already
    // registered, so a client that times out and retries reuses it immediately.
    if (this.attachColdStartDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.attachColdStartDelayMs));
    }
    return { status: 'running', scrollback: '', grid: session.grid };
  }

  /**
   * Recompute the session's single character grid as the minimum columns and minimum
   * rows across every attached view, clamped to at least {@link MIN_GRID} × {@link
   * MIN_GRID} (008 FR-009/FR-012). A PTY resize is transmitted ONLY when the computed
   * grid actually changes (008 FR-010/FR-013), so a focus change or a same-size reflow
   * — which report no new dimensions — never makes the shell repaint. Called on every
   * attach, resize, and detach. With no views the grid is left untouched.
   */
  private recomputeGrid(session: Session): void {
    if (session.views.size === 0) return;
    let cols = Number.POSITIVE_INFINITY;
    let rows = Number.POSITIVE_INFINITY;
    for (const dims of session.views.values()) {
      cols = Math.min(cols, dims.cols);
      rows = Math.min(rows, dims.rows);
    }
    cols = Math.max(MIN_GRID, cols);
    rows = Math.max(MIN_GRID, rows);
    if (cols === session.grid.cols && rows === session.grid.rows) return;
    session.grid = { cols, rows };
    // Tell every view the new grid FIRST, so each conforms its xterm to the minimum
    // before the PTY resize below makes the program repaint (008 FR-009/FR-013). A view
    // rendering at any size other than the shared grid shows a full-screen program
    // offset/wrapped — the alternate screen is painted absolutely and is not reflowed.
    // The notification is written to the events socket before host.resize even fires, and
    // the program's redraw only travels back after the resize round-trips, so a view has
    // always conformed before that redraw output reaches it.
    this.events.publishGrid(session.panelId, cols, rows);
    if (session.status === 'running') {
      try {
        session.host.resize(session.handle, cols, rows);
      } catch {
        /* best-effort — the process may already be gone */
      }
    }
  }

  /**
   * A view of a panel is going away (008 FR-007/FR-010). Remove it from the session's
   * grid set and recompute across the survivors. A detach is NOT a kill: the session is
   * terminated ONLY when its LAST view goes AND the panel is sub-workspace-owned
   * (rootless) — nothing owns it any more. A project-owned panel's session survives its
   * views closing, because the panel lives on in its project (killing it is reserved for
   * an explicit `terminal.kill`, panel-destroy, or project-delete).
   */
  private detach(rawParams: unknown): TerminalOkResult {
    const params = asObject(rawParams) as unknown as TerminalDetachParams;
    const session = this.sessions.get(params.panelId);
    if (!session) return { ok: true };
    session.views.delete(viewIdOf(params));
    if (session.views.size > 0) {
      this.recomputeGrid(session);
      return { ok: true };
    }
    // Last view gone. Terminate only a sub-workspace-owned session (008 FR-007).
    if (session.rootless && session.status === 'running') {
      this.terminate(session);
    }
    return { ok: true };
  }

  /**
   * Tear a session down without publishing a `terminal.exit` (its owning surface is
   * going away, it is not a process failure): run its disposers first — unsubscribing
   * `onExit` so the kill's asynchronous process-exit cannot later fire {@link handleExit}
   * and clobber a new same-panelId session — then delete it, release any lock, and kill
   * the OS host so no ConPTY is orphaned (Principle III resource hygiene).
   */
  private terminate(session: Session): void {
    session.status = 'exited';
    session.userKilled = true;
    for (const dispose of session.disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    if (this.sessions.get(session.panelId) === session) this.sessions.delete(session.panelId);
    if (!session.rootless) this.locks.release(session.projectId);
    try {
      session.host.kill(session.handle);
    } catch {
      /* best-effort — the process may already be gone */
    }
  }

  private handleExit(session: Session, exit: PtyExit): void {
    if (session.status === 'exited') return; // already torn down
    session.status = 'exited';
    session.exit = exit;
    const unexpected = !session.userKilled;
    for (const dispose of session.disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    this.sessions.delete(session.panelId);
    if (!session.rootless) this.locks.release(session.projectId);
    this.events.publishExit(session.panelId, exit.code, exit.signal, unexpected);
  }

  private write(rawParams: unknown): TerminalOkResult {
    const params = asObject(rawParams) as unknown as TerminalWriteParams;
    const session = this.sessions.get(params.panelId);
    if (session && session.status === 'running' && typeof params.data === 'string') {
      session.host.write(session.handle, params.data);
    }
    return { ok: true };
  }

  private resize(rawParams: unknown): TerminalOkResult {
    const params = asObject(rawParams) as unknown as TerminalResizeParams;
    const session = this.sessions.get(params.panelId);
    if (session && session.status === 'running') {
      // Record THIS view's new dimensions and re-derive the shared grid as the minimum
      // across all attached views (008 FR-009/FR-010). The PTY is resized by
      // recomputeGrid only if the minimum actually moved — a view reporting the same, or
      // a larger, size than the current minimum changes nothing.
      session.views.set(viewIdOf(params), { cols: params.cols, rows: params.rows });
      this.recomputeGrid(session);
    }
    return { ok: true };
  }

  private kill(rawParams: unknown): TerminalOkResult {
    const params = asObject(rawParams) as unknown as TerminalKillParams;
    const session = this.sessions.get(params.panelId);
    if (session && session.status === 'running') {
      session.userKilled = true;
      session.host.kill(session.handle);
    }
    return { ok: true };
  }

  private list(rawParams: unknown): TerminalListResult {
    const params = (rawParams && typeof rawParams === 'object' ? rawParams : {}) as TerminalListParams;
    const sessions = [];
    for (const session of this.sessions.values()) {
      if (params.projectId && session.projectId !== params.projectId) continue;
      sessions.push({
        panelId: session.panelId,
        projectId: session.projectId,
        status: session.status,
        // Probing child pids is expensive (per-session ConPTY helper) — only when
        // explicitly requested, so a plain count (e.g. the app-close prompt) is fast.
        busy: params.includeBusy ? this.isBusy(session) : false,
        meta: session.meta,
      });
    }
    return { sessions };
  }

  private isBusy(session: Session): boolean {
    if (session.status !== 'running') return false;
    try {
      return isBusy(session.host.listChildPids(session.handle));
    } catch {
      return true; // safe default: never silently treat a possibly-busy shell as idle
    }
  }

  /**
   * Close idle sessions (no running command) — busy ones keep running in the
   * background (FR-015b / Principle III). Optionally scoped to one project. Used on
   * project/app close. Returns the panelIds closed.
   */
  private closeIdle(rawParams: unknown): { closed: string[] } {
    const projectId = asProjectId(rawParams);
    const closed: string[] = [];
    for (const session of [...this.sessions.values()]) {
      if (projectId && session.projectId !== projectId) continue;
      if (session.status === 'running' && !this.isBusy(session)) {
        session.userKilled = true;
        session.host.kill(session.handle);
        closed.push(session.panelId);
      }
    }
    return { closed };
  }

  /**
   * Kill every session (the app-close "terminate all" choice, FR-015e). Optionally
   * scoped to one project. Returns the panelIds killed.
   */
  private killAll(rawParams: unknown): { killed: string[] } {
    const projectId = asProjectId(rawParams);
    const killed: string[] = [];
    for (const session of [...this.sessions.values()]) {
      if (projectId && session.projectId !== projectId) continue;
      if (session.status === 'running') {
        session.userKilled = true;
        session.host.kill(session.handle);
        killed.push(session.panelId);
      }
    }
    return { killed };
  }
}

function asProjectId(params: unknown): string | undefined {
  if (params && typeof params === 'object' && 'projectId' in params) {
    const id = (params as { projectId?: unknown }).projectId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return undefined;
}
