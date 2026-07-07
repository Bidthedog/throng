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
  TERMINAL_KILL_METHOD,
  TERMINAL_LIST_METHOD,
  TERMINAL_CAPABILITIES_METHOD,
  TERMINAL_CLOSE_IDLE_METHOD,
  TERMINAL_KILL_ALL_METHOD,
  type TerminalAttachParams,
  type TerminalAttachResult,
  type TerminalCapabilitiesResult,
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
  /** Identity of what was launched (file+args+cwd+elevation). A reattach with a
   *  DIFFERENT key means the Panel was re-typed → replace, not reuse (FR-020). */
  readonly launchKey: string;
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

/**
 * Stable identity of a terminal launch — what distinguishes "reattach the same
 * terminal" (mirror/reopen) from "this Panel was re-typed to a different terminal".
 * A different flavour resolves to a different file/args; toggling "run as admin"
 * changes the integrity; both must cold-start a NEW terminal rather than reuse.
 */
function launchKeyOf(
  launch: { file: string; args?: unknown; cwd: string },
  runAsAdmin: boolean,
): string {
  const args = Array.isArray(launch.args) ? launch.args : [];
  return JSON.stringify([launch.file, args, launch.cwd, runAsAdmin]);
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

  private attach(rawParams: unknown): TerminalAttachResult {
    const params = asObject(rawParams) as unknown as TerminalAttachParams;
    const { panelId, projectId, launch } = params;
    const rootless = params.rootless === true;
    if (typeof panelId !== 'string' || !panelId) {
      throw new RpcError('A non-empty "panelId" is required', JSON_RPC_INVALID_PARAMS);
    }
    if (!launch || typeof launch.file !== 'string' || typeof launch.cwd !== 'string') {
      throw new RpcError('A valid "launch" spec is required', JSON_RPC_INVALID_PARAMS);
    }

    const launchKey = launchKeyOf(launch, params.runAsAdmin === true);

    // Reattach an already-live session ONLY when it's the same terminal — replay its
    // scrollback; its output keeps flowing to the subscribed events socket (FR-021
    // mirror / reopen). If the launch differs, the Panel was re-typed to a different
    // terminal (e.g. after a client-side attach TIMEOUT left the old session live):
    // reap the stale one and cold-start the requested one below, so the right shell
    // loads rather than the abandoned one (FR-020).
    const existing = this.sessions.get(panelId);
    if (existing && existing.status === 'running') {
      if (existing.launchKey === launchKey) {
        if (params.meta) existing.meta = params.meta; // refresh labels (e.g. a rename)
        return { status: 'running', scrollback: existing.scrollback };
      }
      this.reapForReplace(existing);
    }

    // Cold start. Acquire the project-root lock for the first terminal (FR-022) —
    // never for a rootless (sub-workspace-owned) terminal, whose cwd is the user's
    // home directory (FR-028).
    if (!rootless) this.locks.acquire(projectId, launch.cwd);
    // Route to the de-elevated agent for an unchecked terminal on an elevated daemon
    // (FR-025c); otherwise the local host. Fixed per-session for its lifetime.
    const host = this.hostFor(params.runAsAdmin === true);
    let handle: PtyHandle;
    try {
      handle = host.start({
        file: launch.file,
        args: Array.isArray(launch.args) ? launch.args : [],
        cwd: launch.cwd,
        cols: params.cols > 0 ? params.cols : 80,
        rows: params.rows > 0 ? params.rows : 24,
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
      launchKey,
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
    return { status: 'running', scrollback: '' };
  }

  /**
   * Tear down a stale session so its Panel can be re-typed to a different terminal
   * (FR-020). Unlike {@link handleExit} this publishes NO `terminal.exit` (the Panel
   * is being replaced, not closing) and — crucially — runs the session's disposers
   * first, unsubscribing its `onExit`. That way the kill's asynchronous process-exit
   * cannot later fire `handleExit` and delete the NEW same-panelId session from the
   * registry. The OS host is still killed, so no terminal is orphaned (Constitution VII).
   */
  private reapForReplace(session: Session): void {
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
      session.host.resize(session.handle, params.cols, params.rows);
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
