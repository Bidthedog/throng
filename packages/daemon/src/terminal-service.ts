import 'reflect-metadata';
import {
  foregroundCommand,
  isBusy,
  shouldDeElevate,
  type ChildProcess,
  type IElevationState,
  type IProcessCwd,
  type IPtyHost,
  type PtyExit,
  type PtyHandle,
  appendScrollback,
  trackAltScreen,
  classifyFailure,
  type FailureCause,
} from '@throng/core';
import { basename } from 'node:path';
import {
  JSON_RPC_INVALID_PARAMS,
  TERMINAL_ATTACH_METHOD,
  TERMINAL_WRITE_METHOD,
  TERMINAL_RESIZE_METHOD,
  TERMINAL_DETACH_METHOD,
  TERMINAL_REPAINT_METHOD,
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
  type TerminalRepaintParams,
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

/**
 * How long a repaint holds the nudged grid before restoring it (028, #162/#163).
 *
 * Not zero, and not a guess: with both resizes in the same tick, ConPTY had not finished repainting
 * at the intermediate size before the second arrived, and the half-finished repaint left a row of
 * one repeated character — corrupting the screen the repaint existed to repair. The gap gives the
 * program time to act on the first window change. One row is imperceptible for this long.
 */
const REPAINT_RESTORE_MS = 60;

/** How often to poll each live terminal's shell working directory (012 revision). */
const CWD_POLL_MS = 1000;

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
   * The executable this session launched (025 FR-022a). Command observation needs it because a
   * shell may re-exec itself before running anything — Git for Windows' `bash.exe` launcher does
   * it twice — and only the image name distinguishes those links from a real command.
   */
  readonly shellImage: string;
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
  /**
   * Is the program on the ALTERNATE screen (028 follow-up)? Tracked by watching the output stream
   * for the switch sequences, because it decides whether the replay tail is worth anything: a
   * full-screen program's screen is not in the tail, and painting the tail is a flash the user sees
   * for nothing before the program's own redraw overwrites it.
   */
  altScreen: boolean;
  /**
   * The grid is stale because every view has gone (028 follow-up). The next attach MUST push a real
   * resize even when the recomputed grid equals the stored one, because the program needs a window
   * change to redraw and the stored value no longer reflects anything on screen.
   *
   * This is what makes a tab switch cost ONE repaint instead of three: no replayed tail, no
   * nudge-and-restore, just the single resize the rebuild needed anyway.
   */
  gridStale: boolean;
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
  /** In-flight repaint restores, keyed by panelId — also the coalescing guard (028). */
  private readonly repaintTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    /**
     * Process-cwd OS seam (012 revision). When provided, the service polls each live
     * terminal's shell working directory and publishes changes as `terminal.cwd`
     * notifications, so a panel's title shows its live cwd (even when a full-screen
     * program hides the prompt). Optional so existing call sites/tests are unchanged.
     */
    private readonly processCwd?: IProcessCwd,
    /**
     * 025 FR-019c — how often the shared command observation runs, in milliseconds. Injected
     * from `settings.terminals.commandPollMs` rather than read here, so it is a real setting
     * (Principle X) and a test can drive it without waiting a real second.
     */
    private readonly commandPollMs: number = 1000,
  ) {
    if (this.processCwd) {
      this.cwdTimer = setInterval(() => void this.pollCwd(), CWD_POLL_MS);
      this.cwdTimer.unref?.(); // never keep the daemon process alive for polling
    }
    // 025 FR-019a: ONE shared observation covering every terminal, not one per terminal, so
    // tracking ten terminals costs no more than tracking one. Off the critical path, unref'd,
    // and — like the cwd poll above — suspended when nothing is listening (FR-019f).
    this.commandTimer = setInterval(() => void this.pollCommands(), this.commandPollMs);
    this.commandTimer.unref?.();
  }

  /** Last cwd published per panel, so we only emit on an actual change. */
  private readonly lastCwd = new Map<string, string>();
  private readonly cwdTimer?: ReturnType<typeof setInterval>;
  /** Last foreground command published per panel (025). Retained across a detach so the value
   *  FREEZES rather than clearing when nothing is observing (FR-019f). */
  private readonly lastCommand = new Map<string, string | null>();
  private readonly commandTimer?: ReturnType<typeof setInterval>;

  /**
   * Poll every running terminal's shell cwd (012 revision) and publish changes.
   * Skips entirely when nothing is listening or nothing is running. Never throws —
   * the seam omits any process it cannot read (e.g. one that just exited).
   */
  private async pollCwd(): Promise<void> {
    if (this.events.sinkCount === 0) return;
    await this.refreshCwds();
  }

  /**
   * Read every running shell's cwd and publish what changed. Never throws.
   *
   * Split out from the poller so a caller that NEEDS the answer to be current can ask for it
   * (`terminal.list { refreshCwd }`), including when nothing is subscribed. The poller keeps its own
   * guards; this is the work itself.
   */
  private async refreshCwds(): Promise<void> {
    if (!this.processCwd) return;
    const byPid = new Map<number, string>(); // shell pid → panelId
    for (const s of this.sessions.values()) {
      if (s.status === 'running') byPid.set(s.handle.pid, s.panelId);
    }
    if (byPid.size === 0) return;
    let cwds: Map<number, string>;
    try {
      cwds = await this.processCwd.read([...byPid.keys()]);
    } catch {
      return; // a poll failure must never disturb the daemon
    }
    for (const [pid, cwd] of cwds) {
      const panelId = byPid.get(pid);
      if (!panelId || this.lastCwd.get(panelId) === cwd) continue;
      this.lastCwd.set(panelId, cwd);
      this.events.publishCwd(panelId, cwd);
    }
  }

  /**
   * 025 FR-019 — observe which command holds each terminal, on ONE shared pass.
   *
   * Suspended when nothing is listening (FR-019f): with no UI attached the user cannot start a
   * new command, so the last observed value stays accurate and is deliberately frozen rather
   * than cleared. The accepted cost is that a command which DIES unobserved and is then killed
   * uncleanly is still remembered as running (FR-019h) — bounded, documented, and never worse
   * than an unwanted command the user can stop and edit away.
   *
   * Never throws, and never clears a value on failure (FR-019e).
   */
  private async pollCommands(): Promise<void> {
    if (this.events.sinkCount === 0) return;
    const running = [...this.sessions.values()].filter((s) => s.status === 'running');
    if (running.length === 0) return;
    await Promise.all(running.map((s) => this.observeCommand(s)));
  }

  /** Observe one session's foreground command and publish it if it changed. */
  private async observeCommand(session: Session): Promise<void> {
    let children: ChildProcess[];
    try {
      children = await session.host.listChildProcesses(session.handle);
    } catch {
      return; // FR-019e: keep the last known value rather than clearing it.
    }
    const command = foregroundCommand(session.handle.pid, children, session.shellImage);
    if (this.lastCommand.get(session.panelId) === command) return;
    this.lastCommand.set(session.panelId, command);
    this.events.publishCommand(session.panelId, command);
  }

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
    router.register(TERMINAL_REPAINT_METHOD, (p) => this.repaint(p));
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
        /*
         * 028 follow-up — a program on the ALTERNATE screen gets NO replay.
         *
         * Its screen is not in the tail. The tail holds the bytes that painted it, absolute cursor
         * moves and all, and replaying them into a fresh view paints something stale at best and
         * incoherent at worst — which is then immediately overwritten by the redraw the attaching
         * view asks for. The user counts that wasted paint as one of the flashes on a tab switch.
         *
         * The scrollback is not discarded, only withheld from this view: leaving the alt screen
         * makes it worth replaying again, and any later attach gets it.
         */
        const replay = existing.altScreen ? '' : existing.scrollback;
        /*
         * The session was left with no views at all, so this view is a REBUILD (every tab switch
         * unmounts its panels). Force the redraw here rather than letting the view ask for it in a
         * second round-trip: same single nudge, one less hop, and the view is told not to ask again.
         *
         * A same-size resize is NOT used for this. It may never reach the program at all — a window
         * change that changes nothing is entitled to be ignored — and a redraw that sometimes does
         * not happen is worse than one that always costs a nudge.
         */
        let redrawn = false;
        if (existing.gridStale) {
          existing.gridStale = false;
          this.repaintSession(existing);
          redrawn = true;
        }
        return {
          status: 'running',
          scrollback: replay,
          grid: existing.grid,
          redrawn,
          altScreen: existing.altScreen,
        };
      }
      this.terminate(existing);
    }

    // Cold start. Acquire the project-root lock for the first terminal (FR-022) —
    // never for a rootless (sub-workspace-owned) terminal, whose cwd is the user's
    // home directory (FR-028).
    /*
     * 029 / #204 / #181 — a lock failure is a START failure, and it must arrive at the panel as a
     * CAUSE rather than as prose.
     *
     * This used to throw straight out of `create`, so the router wrapped it as
     * `Internal error: Cannot lock "…": the path does not exist` and the panel, holding only a
     * string, could not tell a briefly-absent folder from a configuration that can never be
     * satisfied. It reverted the panel either way, which destroyed the user's terminal
     * configuration for a folder that was coming back.
     */
    if (!rootless) {
      try {
        this.locks.acquire(projectId, launch.cwd);
      } catch (error) {
        throw new RpcError(
          `Failed to launch terminal: ${(error as Error).message}`,
          JSON_RPC_INVALID_PARAMS,
          this.classifyAndLog(error, launch.cwd),
        );
      }
    }
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
        ...(typeof launch.commandLine === 'string' ? { commandLine: launch.commandLine } : {}),
        ...(launch.env && typeof launch.env === 'object' ? { env: launch.env } : {}),
        // #209 — build the shell from the LAUNCHER's environment, not this daemon's, which is a
        // snapshot of whichever session first started it and may be days stale.
        ...(launch.baseEnv && typeof launch.baseEnv === 'object' ? { baseEnv: launch.baseEnv } : {}),
        cwd: launch.cwd,
        cols: startCols,
        rows: startRows,
        runAsAdmin: params.runAsAdmin === true,
      });
    } catch (error) {
      // Launch failure (FR-019): release the lock we just took and surface it.
      if (!rootless) this.locks.release(projectId);
      // 029: carry a cause where the shell's own failure has one — a cwd that vanished between the
      // lock and the spawn, a permission refusal. An unclassifiable launch failure (a missing
      // flavour, a broken shell path) yields `undefined`, and the panel then reverts exactly as it
      // does today (FR-003's second arm, asserted by `terminal-persistence.e2e.ts:81`).
      throw new RpcError(
        `Failed to launch terminal: ${(error as Error).message}`,
        JSON_RPC_INVALID_PARAMS,
        this.classifyAndLog(error, launch.cwd),
      );
    }

    const session: Session = {
      panelId,
      projectId,
      cwd: launch.cwd,
      rootless,
      host,
      handle,
      shellImage: launch.file,
      views: new Map([[viewId, { cols: params.cols, rows: params.rows }]]),
      grid: { cols: startCols, rows: startRows },
      scrollback: '',
      altScreen: false,
      gridStale: false,
      status: 'running',
      userKilled: false,
      meta: params.meta,
      disposers: [],
    };
    // 025 FR-012 — the universal Startup Command fallback, for a flavour with no argv recipe.
    // It lives HERE, on the cold-start path, precisely because a launch spec is only resolved
    // when a terminal is cold-started: a re-attach never reaches this code, so a startup command
    // can never be re-run against a session that is already doing its work (FR-008). No condition
    // to remember, and none to get wrong.
    //
    // The command is written after the shell's FIRST output, not immediately after spawn: a shell
    // that has printed something is a shell that is reading. This is best-effort by nature, which
    // is exactly why it is the fallback and an argv recipe is preferred wherever one exists.
    const writeOnReady = typeof launch.writeOnReady === 'string' ? launch.writeOnReady : '';
    let startupCommandPending = writeOnReady.length > 0;

    session.disposers.push(
      host.onData(handle, (chunk) => {
        session.scrollback = appendScrollback(session.scrollback, chunk, MAX_SCROLLBACK);
        session.altScreen = trackAltScreen(session.altScreen, chunk);
        this.events.publishOutput(panelId, chunk);
        if (startupCommandPending) {
          startupCommandPending = false;
          try {
            host.write(handle, `${writeOnReady}\r`);
          } catch (error) {
            // FR-026b: a throwing `write` produces NO terminal output at all, so unlike a command
            // the shell rejected, the user would otherwise have no way to know their startup
            // command never ran. Surface it as terminal output rather than swallowing it.
            this.events.publishOutput(
              panelId,
              `
[throng] Could not run the startup command: ${(error as Error).message}
`,
            );
          }
        }
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
   * Force the program running in a terminal to redraw its whole screen (028, #162/#163).
   *
   * An inactive tab is not hidden — its panels are unmounted — so a returning tab REBUILDS its
   * terminal and reconstructs the screen from the replayed scrollback tail. For a full-screen
   * program that reconstruction cannot be right: the program paints absolutely, its own state is the
   * only authority for what the screen says, and it redraws when the window changes and at no other
   * time. That is why a divider drag cures the corruption instantly, and why repainting xterm's
   * buffer — which is what is wrong — never does.
   *
   * So a repaint is a grid NUDGE: resize away, resize back. The program receives two window-change
   * signals and redraws in full at the size it already had.
   *
   * ROWS, not columns: a column change makes a shell REFLOW its wrapped lines, which is visible
   * churn on every tab switch; a row change reflows nothing on the normal buffer, and a full-screen
   * program repaints wholesale either way.
   *
   * `session.grid` is deliberately NOT touched and NO grid notification is published — no view's
   * size actually moved, and telling the views otherwise would make every xterm resize twice for
   * nothing. Nothing is written to the pty: a redraw is never `Ctrl+L` or any other keystroke.
   */
  private repaint(rawParams: unknown): TerminalOkResult {
    const params = asObject(rawParams) as unknown as TerminalRepaintParams;
    const session = this.sessions.get(params.panelId);
    // A repaint is best-effort by nature — an unknown panel or a session that has exited is simply
    // nothing to redraw, never an error the user must act on.
    if (!session || session.status !== 'running') return { ok: true };
    // A repaint already in flight for this session: do nothing. Coalescing is not an optimisation
    // here, it is correctness — see the restore delay below. Three rapid Ctrl+F5 presses must not
    // become six interleaved resizes.
    this.repaintSession(session);
    return { ok: true };
  }

  /**
   * The nudge itself, shared by `terminal.repaint` and the rebuild path in `attach` so there is one
   * place for it to be correct.
   */
  private repaintSession(session: Session): void {
    if (session.status !== 'running') return;
    /*
     * ONLY on the alternate screen. This was measured the hard way.
     *
     * The nudge asks a program to repaint by changing its window size, which is the only way to make
     * a full-screen program redraw — it owns every cell, and nothing else can ask. On the NORMAL
     * screen there is no such program: the buffer IS the content, and Windows reflows a console
     * buffer on resize. Measured at a PowerShell and a cmd prompt with 120 lines of output, one
     * Ctrl+F5 left a single row, and everything typed afterwards rendered split across the screen
     * until `clear`. That is a redraw destroying exactly what it was asked to redraw.
     *
     * The normal screen needs nothing from the pty anyway: its content is in the view's own buffer,
     * so a redraw there is a client-side repaint (see the redraw action in the renderer).
     */
    if (!session.altScreen) return;
    if (this.repaintTimers.has(session.panelId)) return;
    const { cols, rows } = session.grid;
    const nudged = Math.max(MIN_GRID, rows - 1);
    if (nudged === rows) return; // already at the floor — a nudge would be a no-op
    try {
      session.host.resize(session.handle, cols, nudged);
    } catch {
      return; // best-effort — the process may already be gone
    }
    /*
     * Restore on a LATER tick, not this one.
     *
     * Both resizes in the same tick is what the first cut of this did, and it corrupted the very
     * screens it was meant to repair: ConPTY had not finished repainting at the intermediate size
     * before the second resize arrived, and the half-finished repaint left a row filled with one
     * repeated character. Caught by the redraw action's own E2E under parallel load, where three
     * rapid presses became six racing resizes.
     *
     * The delay gives the program time to act on the first window change before the second. It is
     * deliberately short — the intermediate size is one row smaller, which is imperceptible — and
     * paired with the in-flight guard above so repeats queue behind it rather than pile on.
     */
    const timer = setTimeout(() => {
      this.repaintTimers.delete(session.panelId);
      if (session.status !== 'running') return;
      try {
        session.host.resize(session.handle, session.grid.cols, session.grid.rows);
      } catch {
        /* best-effort — the process may already be gone */
      }
    }, REPAINT_RESTORE_MS);
    timer.unref?.(); // never keep the daemon alive for a repaint
    this.repaintTimers.set(session.panelId, timer);
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
    // Nothing is presenting this session any more. Whatever the program has on screen is now
    // unobserved, and the next view to arrive will have been built from scratch — so the grid it
    // rejoins at must be pushed as a real window change even if the number is unchanged.
    session.gridStale = true;
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
    this.lastCwd.delete(session.panelId); // a reused panelId must re-publish its cwd
    this.lastCommand.delete(session.panelId); // 025: and its command
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
    this.lastCwd.delete(session.panelId); // stop reporting a dead shell's cwd
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

  /**
   * Classify a launch failure, and RECORD the raw text before the cause replaces it (029, FR-018).
   *
   * The raw errno exists only here — by the time this crosses the RPC it is a numeric JSON-RPC code
   * and a spoken sentence. FR-018 requires it in the diagnostics log as well as the notice's Copy
   * payload, precisely so it survives the notice being dismissed, which is the state a support
   * conversation actually begins in.
   *
   * `console.warn` rather than an injected sink because the daemon calls `attachConsole()` at
   * startup (`main.ts`), which routes it into the same rotating log file everything else here uses.
   * The service has no log of its own and giving it one would be a constructor change for one line.
   */
  private classifyAndLog(error: unknown, cwd: string): FailureCause | undefined {
    const cause = classifyFailure(error, { subject: basename(cwd), operation: 'lock' }) ?? undefined;
    if (cause) console.warn(`[terminal] launch failed: ${cause.raw}`);
    return cause;
  }

  private async list(rawParams: unknown): Promise<TerminalListResult> {
    const params = (rawParams && typeof rawParams === 'object' ? rawParams : {}) as TerminalListParams;
    // FR-013 — a caller naming a lock holder cannot use a cwd that is up to a second old; see
    // `refreshCwd`. Everyone else is served from the poll, unchanged and free.
    if (params.refreshCwd) await this.refreshCwds();
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
        /*
         * 029 FR-013 — where this terminal is actually working.
         *
         * The daemon is the only process that knows, and it already tracks it for FR-027. Publishing
         * it is what lets throng name ITSELF as a lock holder: asking "does a known terminal sit at
         * or under this path?" is a prefix match over state throng already has, with no OS call and
         * no native addon — which is why the throng case ships while the third-party one does not.
         */
        cwd: this.lastCwd.get(session.panelId) ?? session.cwd,
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
