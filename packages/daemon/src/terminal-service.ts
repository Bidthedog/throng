import 'reflect-metadata';
import {
  TERMINAL_END_TIMEOUT_MS,
  foregroundProcess,
  normaliseCommand,
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
  createWindowTitleScan,
  scanWindowTitle,
  type WindowTitleScan,
  createNegotiationScan,
  scanKeyboardNegotiation,
  type NegotiationScan,
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
  type TerminalCloseIdleResult,
  type TerminalDetachParams,
  type TerminalEndFailure,
  type TerminalKillAllParams,
  type TerminalKillAllResult,
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

/**
 * 053 `{arch}` — the longest an observation waits on an executable's architecture (Principle XII).
 * A read that has not answered by then publishes `null`; the host caches the eventual answer, so a
 * later pass sees it and republishes, because a change of arch alone is a change.
 */
const ARCH_READ_LIMIT_MS = 250;

/**
 * 051 FR-005 — how long a terminal whose end FAILED still counts its exit as the end throng asked
 * for. A timed-out end's `taskkill` may still land a moment later, and that exit is the user's own
 * doing, not an unexpected one (005 FR-017). Past this, the terminal is an ordinary running one.
 */
export const END_SETTLE_GRACE_MS = 2000;

/** One view's most-recently-reported character dimensions. */
interface ViewDims {
  cols: number;
  rows: number;
}

/** A live terminal session — the daemon's in-memory record keyed by panelId. */
interface Session {
  /** This session among every session one panel id has had: what its exit names (051 MT-01). */
  readonly id: number;
  /** Durable identity/tag (Principle III): owning project, panel, cwd. */
  readonly panelId: string;
  readonly projectId: string;
  readonly cwd: string;
  /**
   * Whether the spawned process's working directory is the terminal's (#387). False for a session
   * spawned away from its start directory, whose process cwd names the launcher's install folder.
   */
  readonly processCwdObservable: boolean;
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
   * When this session's shell was spawned, epoch ms (#280). Command capture uses it to reject a
   * candidate that started BEFORE the shell — which cannot be its child, and is the signature of
   * a recycled pid still named by some unrelated process's stale `ParentProcessId`.
   */
  readonly shellStartedAt: number;
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
   * What the program has negotiated about the KEYBOARD (#290) — kitty CSI-u flags and the DEC
   * private modes, plus any half-read escape sequence carried across a chunk boundary.
   *
   * Tracked here for the same reason as `altScreen` directly above: the daemon reads every byte
   * whether or not a view exists, and a panel in a background tab is unmounted, so a program that
   * un-negotiates while nobody is looking would otherwise never be heard. A rebuilt view used to
   * work this out for itself from the store PLUS the replayed tail, which double-counted every
   * push and left the protocol stuck on. See `negotiation-scan.ts`.
   */
  negotiation: NegotiationScan;
  /**
   * 053 — the window title the program last set (OSC 0/2), followed for the same reason: a view that
   * re-attaches rebuilds from a bounded tail, empty on the alternate screen, which may no longer hold
   * the sequence. Every attach hands it back, so the new view's header names the program as before.
   */
  windowTitle: WindowTitleScan;
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
  /**
   * Set while an end throng asked for is in flight or has succeeded → the exit is *not* unexpected
   * (FR-017). Reset when that end fails (051 FR-005), so a later genuine exit is unexpected again.
   */
  userKilled: boolean;
  /**
   * 051 — the in-flight end, resolving to the failure reason or `null`. Non-null ⇔ this is an
   * ENDING terminal: never reattached (FR-004), never probed for busy.
   */
  ending: Promise<string | null> | null;
  /** 051 FR-004 — its panel was given a fresh terminal while this one was ending; its exit is not published. */
  superseded: boolean;
  /** 051 FR-015a — a failure of the in-flight end is escalated rather than left running. */
  escalate: boolean;
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
  private nextSessionId = 1;
  /** 051 FR-004 — ending sessions whose panel already has a fresh terminal; still ended at shutdown. */
  private readonly endingSessions = new Set<Session>();
  /** 051 FR-015 — every end and escalation started and not yet settled; shutdown waits for them. */
  private readonly inFlight = new Set<Promise<unknown>>();
  /** 051 FR-015a — set once shutdown begins: from then on a failed end is escalated, never reattached. */
  private shuttingDown = false;
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
    /**
     * 051 FR-013a — how long an end may take before it counts as failed, and the bound on every
     * wait at shutdown. Injected from the one constant (`TERMINAL_END_TIMEOUT_MS`) by the
     * composition root; a test substitutes its own.
     */
    private readonly endTimeoutMs: number = TERMINAL_END_TIMEOUT_MS,
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
  private readonly lastCommand = new Map<string, { command: string | null; arch: string | null }>();
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
      if (s.status === 'running' && s.processCwdObservable) byPid.set(s.handle.pid, s.panelId);
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
    const running = [...this.sessions.values()].filter((s) => s.status === 'running' && !s.ending);
    if (running.length === 0) return;
    // Before any reading starts: a window title that arrived after this cannot be the prompt's (053 FR-003).
    const observedAt = Date.now();
    // 051 FR-041 — the attached processes of every terminal on a host, in ONE request per host.
    // `null` is a request that FAILED, which is not the same as a terminal with nothing attached.
    const attachedByHost = new Map<IPtyHost, Promise<Map<number, ChildProcess[]> | null>>();
    for (const s of running) {
      if (attachedByHost.has(s.host) || !s.host.listAttachedProcesses) continue;
      const handles = running.filter((o) => o.host === s.host).map((o) => o.handle);
      attachedByHost.set(s.host, s.host.listAttachedProcesses(handles).catch(() => null));
    }
    await Promise.all(running.map((s) => this.observeCommand(s, attachedByHost.get(s.host), observedAt)));
  }

  /** Observe one session's foreground command and publish it if it changed. */
  private async observeCommand(
    session: Session,
    attachedOnHost?: Promise<Map<number, ChildProcess[]> | null>,
    observedAt: number = Date.now(),
  ): Promise<void> {
    let children: ChildProcess[];
    let attachedOnThisHost: Map<number, ChildProcess[]> | null | undefined;
    try {
      [children, attachedOnThisHost] = await Promise.all([
        session.host.listChildProcesses(session.handle),
        attachedOnHost,
      ]);
    } catch {
      return; // FR-019e: keep the last known value rather than clearing it.
    }
    const chosen = foregroundProcess(
      session.handle.pid,
      children,
      session.shellImage,
      session.shellStartedAt,
      attachedOnThisHost?.get(session.handle.pid),
    );
    const command = chosen === null ? null : normaliseCommand(chosen.commandLine);
    // 051 FR-042 — a failed attached request cannot say "nothing is running": the command may be
    // one only it could see. Keep the last value rather than clearing it (025 FR-019e).
    if (command === null && attachedOnThisHost === null) return;
    const arch = chosen === null ? null : await this.readArch(session.host, chosen.executablePath);
    // The observation is async: if the panel has a newer terminal by now, this one's result is not its.
    if (this.sessions.get(session.panelId) !== session) return;
    const last = this.lastCommand.get(session.panelId);
    if (last && last.command === command && last.arch === arch) return;
    this.lastCommand.set(session.panelId, { command, arch });
    this.events.publishCommand(session.panelId, command, arch, observedAt);
  }

  /**
   * 053 `{arch}` — the architecture of `path` through the host, or `null` when the host cannot read
   * one, there is no path, or the read has not answered within {@link ARCH_READ_LIMIT_MS}. Never
   * throws, and never holds a lock.
   */
  private async readArch(host: IPtyHost, path: string | undefined): Promise<string | null> {
    if (!path || !host.executableArch) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ARCH_READ_LIMIT_MS);
      timer.unref?.();
    });
    try {
      return await Promise.race([host.executableArch(path).catch(() => null), limit]);
    } finally {
      clearTimeout(timer);
    }
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
        // The project is going: nothing could ever reattach a terminal whose end failed, so a
        // failure escalates rather than leaving a process no surface can reach (Principle III).
        void this.beginEnd(session, true);
      }
    }
  }

  /**
   * Daemon shutdown (051 FR-015, FR-015a): end every live session — and every ending one — and
   * WAIT, within the end limit, for each to settle. A failure is escalated to a forced end of the
   * whole tree, never left to reattach, and anything that survives that is logged. Then dispose
   * both hosts: the local one sweeps any host process never attributed, and the agent's close
   * makes the agent do the same for its own terminals.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const live = [...this.sessions.values(), ...this.endingSessions].filter((s) => s.status === 'running');
    await Promise.all(live.map((session) => this.beginEnd(session, true)));
    await Promise.all([...this.inFlight]);
    for (const host of [this.pty, this.deElevatedPty]) {
      try {
        await host?.dispose?.();
      } catch {
        /* best-effort */
      }
    }
  }

  /** Remember a settling end so shutdown can wait for it (FR-015). */
  private track<T>(promise: Promise<T>): Promise<T> {
    this.inFlight.add(promise);
    const forget = (): void => void this.inFlight.delete(promise);
    promise.then(forget, forget);
    return promise;
  }

  /**
   * Start ending a session — the one path every end takes (051 R2/R4). Returns at once; the promise
   * resolves to the failure reason, or `null` when the end completed (or was escalated with nothing
   * surviving). Never rejects.
   *
   * - Success: the observed exit publishes as user-initiated (005 FR-017) through `handleExit`.
   * - Failure, escalating (shutdown, Terminate all, project delete, a superseded or detached
   *   session): a forced end of the whole tree; survivors are logged and become the reason.
   * - Failure otherwise: the session is an ordinary running terminal again and reattaches on the
   *   next load (FR-005).
   *
   * A second request for a session already ending returns the same promise; whether that end
   * escalates on failure is decided WHEN it fails, so shutdown starting meanwhile still counts.
   */
  private beginEnd(session: Session, escalate = false): Promise<string | null> {
    if (session.ending) {
      if (escalate) session.escalate = true;
      return session.ending;
    }
    session.userKilled = true;
    session.escalate = escalate;
    const ending = session.host.end(session.handle, this.endTimeoutMs).then(
      () => null,
      async (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        if (session.escalate || session.superseded || this.shuttingDown) {
          const { survivors } = await session.host.forceEnd(session.handle, this.endTimeoutMs);
          for (const { pid, name } of survivors) {
            console.warn(`[terminal] ${session.panelId}: still running after a forced end: pid ${pid} (${name || 'unknown'})`);
          }
          return survivors.length > 0 ? `${reason}; ${survivors.length} of its processes could not be ended` : null;
        }
        // FR-005: an ordinary terminal again — once an exit from the end's own late kill has had
        // its chance to arrive (review finding 6).
        const settle = setTimeout(() => {
          if (session.status === 'running' && !session.ending) session.userKilled = false;
        }, END_SETTLE_GRACE_MS);
        settle.unref?.();
        return reason;
      },
    );
    const settled = ending.finally(() => {
      if (session.ending === settled) session.ending = null;
    });
    session.ending = settled;
    return this.track(settled);
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
    if (existing && existing.status === 'running' && existing.ending) {
      // 051 FR-004 — throng is already ending this one: never hand it back to a panel. The panel
      // gets a fresh terminal below, as it does after an End Terminals Unload; the ending session
      // finishes on its own, unpublished, and is escalated if its end fails (R4).
      existing.superseded = true;
      this.sessions.delete(panelId);
      this.endingSessions.add(existing);
    } else if (existing && existing.status === 'running') {
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
        // 053 — a re-attaching view starts with no command (a mounting panel drops the one it showed), and
        // the daemon publishes only a change: hand it the running one in the answer, so a project switch
        // names the command, and the program's title, from the view's first frame.
        const observed = this.lastCommand.get(panelId);
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
          sessionId: existing.id,
          scrollback: replay,
          windowTitle: existing.windowTitle.title,
          ...(observed ? { command: observed.command, arch: observed.arch } : {}),
          grid: existing.grid,
          redrawn,
          altScreen: existing.altScreen,
          keyboard: existing.negotiation.state,
          mouse: existing.negotiation.mouseModes,
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
        await this.locks.acquire(projectId, launch.cwd);
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
    /*
     * Read BEFORE the spawn, deliberately (#280). This is the floor command capture compares
     * candidate start times against, so it must not be LATER than the shell's own OS creation
     * time — a value read after `start()` returns includes however long the spawn took, and a
     * genuine early child could then fall below it and be discarded as an impostor. Read first
     * and the floor is guaranteed no later than the shell, which is the safe direction to err.
     */
    const shellStartedAt = Date.now();
    try {
      handle = host.start({
        file: launch.file,
        args: Array.isArray(launch.args) ? launch.args : [],
        ...(typeof launch.commandLine === 'string' ? { commandLine: launch.commandLine } : {}),
        ...(launch.env && typeof launch.env === 'object' ? { env: launch.env } : {}),
        // #209 — build the shell from the LAUNCHER's environment, not this daemon's, which is a
        // snapshot of whichever session first started it and may be days stale.
        ...(launch.baseEnv && typeof launch.baseEnv === 'object' ? { baseEnv: launch.baseEnv } : {}),
        // #387 — a launcher that never leaves its launch directory is spawned elsewhere.
        cwd: typeof launch.spawnCwd === 'string' ? launch.spawnCwd : launch.cwd,
        cols: startCols,
        rows: startRows,
        runAsAdmin: params.runAsAdmin === true,
      });
    } catch (error) {
      // Launch failure (FR-019): release the lock we just took and surface it.
      if (!rootless) await this.locks.release(projectId);
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
      id: this.nextSessionId++,
      panelId,
      projectId,
      cwd: launch.cwd,
      processCwdObservable: typeof launch.spawnCwd !== 'string',
      rootless,
      host,
      handle,
      shellImage: launch.file,
      shellStartedAt,
      views: new Map([[viewId, { cols: params.cols, rows: params.rows }]]),
      grid: { cols: startCols, rows: startRows },
      scrollback: '',
      altScreen: false,
      negotiation: createNegotiationScan(),
      windowTitle: createWindowTitleScan(),
      gridStale: false,
      status: 'running',
      userKilled: false,
      ending: null,
      superseded: false,
      escalate: false,
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
        // #290 — the other half a rebuilt view must be TOLD rather than left to infer.
        session.negotiation = scanKeyboardNegotiation(session.negotiation, chunk);
        session.windowTitle = scanWindowTitle(session.windowTitle, chunk);
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
    // 053 — what was last published for this panel belonged to its previous terminal. Kept, it would
    // swallow this one's first observation whenever that matched (a remembered command relaunched after
    // End Terminals or a restart), and the panel — which dropped the old value as it mounted — would name
    // no command until it changed. An exit clears the cwd but not the command; a new terminal clears both.
    this.lastCwd.delete(panelId);
    this.lastCommand.delete(panelId);
    // Test seam (008 FR-005): simulate a slow-starting shell. The session is already
    // registered, so a client that times out and retries reuses it immediately.
    if (this.attachColdStartDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.attachColdStartDelayMs));
    }
    return { status: 'running', sessionId: session.id, scrollback: '', grid: session.grid };
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
    if (!session.rootless) void this.locks.release(session.projectId);
    // The surface that owned it is gone, so a failed end is escalated: nothing could reattach it.
    void this.beginEnd(session, true);
  }

  private handleExit(session: Session, exit: PtyExit): void {
    if (session.status === 'exited') return; // already torn down
    session.status = 'exited';
    session.exit = exit;
    const current = this.sessions.get(session.panelId) === session;
    if (current) this.lastCwd.delete(session.panelId); // stop reporting a dead shell's cwd
    const unexpected = !session.userKilled;
    for (const dispose of session.disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    // A superseded session's panel already has a fresh terminal (051 FR-004): it is not this
    // session's to remove from the map, nor to report an exit on.
    if (current) this.sessions.delete(session.panelId);
    this.endingSessions.delete(session);
    if (session.superseded) {
      if (!session.rootless) void this.locks.release(session.projectId);
      return;
    }
    // The exit is reported once the lock has gone (051 R7): the order the UI has always seen —
    // folder released, then told — without the release stopping every other terminal.
    const released = session.rootless ? Promise.resolve() : this.locks.release(session.projectId);
    void released
      .catch(() => {})
      .then(() => {
        // A release can take seconds (the folder is polled until free), and the panel may have been
        // given a fresh terminal meanwhile: this exit is no longer its terminal's (051 MT-01).
        const now = this.sessions.get(session.panelId);
        if (now && now !== session) return;
        this.events.publishExit(session.panelId, exit.code, exit.signal, unexpected, session.id);
      });
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
    // 051 FR-003 — acknowledged at once; the outcome arrives as the exit. Escalated on failure: this
    // is the panel being closed or destroyed, so FR-005's reattach would have nothing to reattach to
    // and the terminal would be orphaned (Principle III; review finding 1).
    if (session && session.status === 'running') void this.beginEnd(session, true);
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
    const listed = [...this.sessions.values()].filter(
      (session) => !params.projectId || session.projectId === params.projectId,
    );
    // Probing child pids reads the process table — only when explicitly requested, so a plain count
    // (e.g. the app-close prompt) is free. When requested, every probe is awaited TOGETHER, so one
    // OS read answers all of them (046, 051 FR-011).
    const busy = params.includeBusy
      ? await Promise.all(listed.map((session) => this.probeBusy(session)))
      : listed.map(() => false);
    const sessions = [];
    for (const [i, session] of listed.entries()) {
      sessions.push({
        panelId: session.panelId,
        projectId: session.projectId,
        status: session.status,
        busy: busy[i] ?? false,
        // 046: a rootless session belongs to a sub-workspace window, not the project, and a
        // project-scoped closeIdle/killAll never touches it — so Unload must not count or name it.
        rootless: session.rootless,
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

  /**
   * The busy classification from a CURRENT answer (046), for Unload's count and `closeIdle`.
   * Awaited all together, a host serves them from ONE read (051 FR-011). A probe that fails or times
   * out counts as busy — never silently treat a possibly-busy shell as idle (FR-012). An ENDING
   * session is not asked: it is going, so it is not busy with anything the caller could keep.
   */
  private async probeBusy(session: Session): Promise<boolean> {
    if (session.status !== 'running' || session.ending) return false;
    try {
      return isBusy(await session.host.probeChildPids(session.handle));
    } catch {
      return true;
    }
  }

  /**
   * Close idle sessions (no running command) — busy ones keep running in the
   * background (FR-015b / Principle III). Optionally scoped to one project. Used on
   * project/app close and by Unload's Keep running (046 FR-034). Returns the panelIds closed.
   *
   * The busy probe runs HERE, at call time, not when the renderer counted busy sessions for its
   * dialog: a process that ended while the dialog was open leaves an idle shell, and that shell is
   * closed like any other rather than kept alive on a stale count (Principle III).
   */
  private async closeIdle(rawParams: unknown): Promise<TerminalCloseIdleResult> {
    const inScope = sessionScope(rawParams);
    const candidates = [...this.sessions.values()].filter((s) => inScope(s) && s.status === 'running' && !s.ending);
    const busy = await Promise.all(candidates.map((session) => this.probeBusy(session)));
    const closed: string[] = [];
    for (const [i, session] of candidates.entries()) {
      // Re-checked after the await: the session may have exited, or been replaced, meanwhile.
      if (busy[i] || session.status !== 'running' || this.sessions.get(session.panelId) !== session) continue;
      void this.beginEnd(session);
      closed.push(session.panelId);
    }
    return { closed };
  }

  /**
   * End every session in scope (the app-close "terminate all" choice, FR-015e; Unload's End
   * terminals, 046 FR-034) and resolve with the OUTCOME once every end has settled (051 FR-002,
   * FR-005) — concurrently, within one end limit (two with `escalate`), while the daemon keeps
   * serving every other request (FR-001).
   */
  private async killAll(rawParams: unknown): Promise<TerminalKillAllResult> {
    const inScope = sessionScope(rawParams);
    const escalate = (rawParams as TerminalKillAllParams | undefined)?.escalate === true;
    const ending = [...this.sessions.values()].filter((s) => inScope(s) && s.status === 'running');
    const outcomes = await Promise.all(ending.map((session) => this.beginEnd(session, escalate)));
    const failed: TerminalEndFailure[] = [];
    for (const [i, session] of ending.entries()) {
      const reason = outcomes[i];
      if (reason) failed.push({ panelId: session.panelId, reason });
    }
    return { killed: ending.map((s) => s.panelId), failed };
  }
}

/**
 * Which sessions a `closeIdle` / `killAll` call covers (contracts/unload.md §3).
 *
 * No `projectId` → every session, rootless included and `exceptPanelIds` ignored: that is app
 * close, and anything it skipped would outlive throng (Principle III). With a `projectId` (Unload) →
 * that project's sessions, minus the panels a sub-workspace window holds (`exceptPanelIds`, FR-037)
 * and minus `rootless` sessions, which belong to a sub-workspace window rather than to the project.
 */
function sessionScope(params: unknown): (session: Pick<Session, 'projectId' | 'panelId' | 'rootless'>) => boolean {
  const projectId = asProjectId(params);
  if (!projectId) return () => true;
  const except = new Set(asExceptPanelIds(params));
  return (session) => session.projectId === projectId && !session.rootless && !except.has(session.panelId);
}

function asExceptPanelIds(params: unknown): string[] {
  if (params && typeof params === 'object' && 'exceptPanelIds' in params) {
    const ids = (params as { exceptPanelIds?: unknown }).exceptPanelIds;
    if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === 'string');
  }
  return [];
}

function asProjectId(params: unknown): string | undefined {
  if (params && typeof params === 'object' && 'projectId' in params) {
    const id = (params as { projectId?: unknown }).projectId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return undefined;
}
