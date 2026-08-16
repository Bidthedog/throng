import { homedir } from 'node:os';
import { ipcMain, type WebContents } from 'electron';
import { statSync } from 'node:fs';
import {
  resolveLaunchSpec,
  resolveStartDirectory,
  fallbackToReport,
  isTransportFailure,
  type IClipboard,
  type FailureCause,
} from '@throng/core';
import type { TerminalAttachResult } from '@throng/ipc-contract';
import { RpcTimeoutError, type DaemonClient } from './daemon-client.js';
import type { ShellDetectionService } from './shell-detection-service.js';
import { createSerializer } from './attach-serializer.js';

/** What the renderer sends to (re)attach a Terminal Panel. */
interface AttachRequest {
  panelId: string;
  projectId: string;
  projectRoot: string | null;
  /** The view (one window's presentation of this panel) attaching (008 FR-009). */
  viewId?: string;
  /**
   * The user EXPLICITLY re-typed this panel to a different terminal (008 FR-002/FR-007).
   * An explicit re-type is a user-initiated destroy-then-create: any running session for
   * this panel is terminated and the new flavour is cold-started. Absent/false ⇒ an
   * IMPLICIT attach (a mirror, a re-render, a reconnect), which always reuses a running
   * session whatever launch identity it computes — that reuse is what prevents the data
   * loss, so intent is stated by the caller, never inferred from a key comparison.
   */
  explicit?: boolean;
  /** Sub-workspace-owned Panel (no project): launch at the user's home dir (FR-028). */
  rootless?: boolean;
  /** Launch elevated (only honoured in an elevated daemon, FR-025). */
  runAsAdmin?: boolean;
  flavourId: string;
  shellArguments: string;
  /** 025 FR-001: the command the shell should run on cold start. */
  startupCommand?: string;
  /** 025 FR-028: the directory this panel last worked in, if any. */
  rememberedCwd?: string;
  /** 033 FR-033: where this panel was CREATED to start — the folder right-clicked in the tree.
   *  Used only when nothing has been remembered yet, and resolved by the same rules. */
  startDirectory?: string;
  cols: number;
  rows: number;
  /** Display labels for the app-close warning (flavourLabel is filled in here). */
  meta?: { projectName?: string; tabName?: string; panelName?: string };
}

type AttachEnvelope =
  | ({
      ok: true;
      /**
       * The remembered directory that no longer exists, when the terminal fell back to the project
       * root because of it (029 FR-005b). Absent on every ordinary start.
       */
      cwdFallback?: string;
    } & TerminalAttachResult)
  | {
      ok: false;
      stillStarting?: boolean;
      error: { code: number | null; message: string };
      /** The classified reason, where the daemon could derive one (029, FR-003/FR-011). */
      cause?: FailureCause;
    };

/**
 * Narrow the RPC error's opaque `data` slot to a cause.
 *
 * It crosses a process boundary as JSON, so it arrives as `unknown` and is checked rather than cast:
 * a malformed payload must degrade to "no cause" — which means today's behaviour — and never crash
 * the attach path it is trying to describe.
 */
function isFailureCause(value: unknown): value is FailureCause {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<FailureCause>;
  return typeof c.kind === 'string' && typeof c.subject === 'string' && typeof c.raw === 'string';
}

/**
 * Terminal command bridge (005 Phase C). The sandboxed renderer reaches terminals
 * only through these channels. UI main resolves the `LaunchSpec` here — looking up
 * the flavour's executable/args (never exposed to the renderer) and combining them
 * with the user's params + the project root — then forwards to the daemon. A
 * missing flavour or null root surfaces as a tagged error (FR-019).
 */
export function registerTerminalIpc(deps: {
  daemonClient: DaemonClient;
  shellDetection: ShellDetectionService;
  /** Attach budget (008 FR-004): the terminal.attach RPC uses this, not the ping budget. */
  attachTimeoutMs: number;
  /**
   * The OS clipboard, THROUGH THE SEAM (016, FR-013a).
   *
   * These three call sites used Electron's `clipboard` module directly. Leaving them would have
   * made the abstraction a fiction — an "every OS clipboard access goes through IClipboard" claim
   * with three counter-examples in the same process. An ESLint rule now confines that module to
   * `electron-clipboard.ts`, because the drift these three prove is exactly what happens again
   * otherwise.
   */
  clipboard: IClipboard;
}): void {
  const { daemonClient, shellDetection, attachTimeoutMs, clipboard } = deps;

  // Window-close detach backstop (008 FR-008a). When a window (a sub-workspace, or the
  // main window) is torn down, its renderer is destroyed WITHOUT running React effect
  // cleanup, so the per-view `terminal.detach` the renderer would normally send never
  // fires. Without a backstop the daemon's grid would stay pinned to a departed view's
  // size, and a sub-workspace-owned panel's session would never terminate. So UI main
  // tracks which views each webContents attached and detaches them when it is destroyed
  // (which also covers a crashed/force-closed renderer). `detach` is idempotent, so a
  // clean unmount that already detached simply no-ops here.
  const viewsByWebContents = new Map<number, Map<string, { panelId: string; viewId?: string }>>();
  const viewKey = (panelId: string, viewId?: string): string => `${panelId}::${viewId ?? ''}`;

  const detachView = (panelId: string, viewId?: string): void => {
    void daemonClient.call('terminal.detach', { panelId, viewId }).catch(() => ({ ok: false }));
  };

  const trackView = (wc: WebContents, panelId: string, viewId?: string): void => {
    let views = viewsByWebContents.get(wc.id);
    if (!views) {
      views = new Map();
      viewsByWebContents.set(wc.id, views);
      wc.once('destroyed', () => {
        const held = viewsByWebContents.get(wc.id);
        viewsByWebContents.delete(wc.id);
        if (!held) return;
        for (const { panelId: p, viewId: v } of held.values()) detachView(p, v);
      });
    }
    views.set(viewKey(panelId, viewId), { panelId, viewId });
  };

  const untrackView = (wc: WebContents, panelId: string, viewId?: string): void => {
    viewsByWebContents.get(wc.id)?.delete(viewKey(panelId, viewId));
  };

  // Attaches are serialized: the daemon cold-starts PTYs one at a time, so firing a
  // project's worth of attaches in parallel would make the later ones race (and blow)
  // the same RPC timeout while the daemon is still busy with the earlier ones. The
  // queue gives each terminal its own timeout window, starting when its load starts.
  const serializeAttach = createSerializer();

  const doAttach = async (req: AttachRequest): Promise<AttachEnvelope> => {
    try {
      const flavour = (await shellDetection.listFlavours()).find((f) => f.id === req.flavourId);
      if (!flavour) {
        return { ok: false, error: { code: null, message: `Flavour "${req.flavourId}" is not available on this machine` } };
      }
      // A sub-workspace-owned (rootless) Panel has no project root — its terminal
      // launches at the user's home directory (FR-028). Otherwise a null root is an
      // error (no active project to start in).
      const root = req.projectRoot ?? (req.rootless ? homedir() : null);
      if (root === null) {
        return { ok: false, error: { code: null, message: 'No active project root to start the terminal in' } };
      }
      // 025 FR-028/FR-030: reopen where this panel was last working. Resolved HERE rather than in
      // the renderer because it needs the filesystem, and a remembered directory that is gone or
      // has escaped its project falls back to the root — never an error dialog.
      const dirExists = (p: string): boolean => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      };
      /*
       * 033 FR-032/FR-034 (T078) — ONE value changes here: which directory is REQUESTED.
       *
       * A panel opened from the tree (Open In → Terminal) carries a `startDirectory`; a panel that
       * has been running carries a `rememberedCwd`. Memory wins when both exist, because by then the
       * user has moved the shell themselves and the folder they right-clicked days ago is history.
       *
       * Everything downstream is deliberately UNTOUCHED, and that is the point: the containment
       * check, the existence check, the fallback to the root and the report below already hold for a
       * remembered directory, so a start directory inherits all four by being handed to the same
       * resolver rather than by a second implementation agreeing with the first.
       */
      const requestedCwd = req.rememberedCwd ?? req.startDirectory;
      const cwd = resolveStartDirectory(root, requestedCwd, dirExists);
      /*
       * 029 FR-005b — the fallback is no longer SILENT.
       *
       * 025 chose silence deliberately, and was right that this must never be an error dialog: the
       * terminal starts, nothing is lost, and interrupting the user would be nagging. But silence has
       * its own cost, which #204's cycle exposes — restore a project root while a subfolder stays
       * deleted and the user finds a shell at the root with no explanation, which reads as
       * "remember-my-directory is broken". A quiet line in the panel is the middle the requirement
       * asks for: informative, not modal, and not a failure.
       *
       * Only reported when a directory was actually REMEMBERED and is actually GONE. A cwd that
       * escaped its project also falls back, but that is a boundary throng enforces on purpose and
       * announcing it would be noise.
       */
      const cwdFallback = fallbackToReport(requestedCwd, cwd, dirExists);
      // 025 FR-010: the flavour decides HOW a Startup Command is handed to it — `cmd` keeps its
      // session with /K, PowerShell with -NoExit, bash by re-execing itself. A flavour with no
      // recipe falls back to writing the command into the PTY once it is ready (FR-012), which is
      // what `launch.writeOnReady` carries back to the renderer.
      const launch = resolveLaunchSpec(
        {
          id: flavour.id,
          file: flavour.file,
          args: flavour.args,
          commandRecipe: flavour.commandRecipe,
          shellIntegration: flavour.shellIntegration,
          shellIntegrationEnv: flavour.shellIntegrationEnv,
        },
        req.shellArguments,
        cwd,
        req.startupCommand,
      );
      // The attach RPC gets the shell-launch budget, NOT the health-check ping budget
      // (008 FR-004): a shell can take seconds to come up, and reusing the ping budget is
      // exactly what surfaced a spurious connection timeout in a fresh sub-workspace.
      const result = await daemonClient.call<TerminalAttachResult>(
        'terminal.attach',
        {
          panelId: req.panelId,
          projectId: req.projectId,
          launch: {
            ...launch,
            /*
             * #209 — the environment the shell is built from comes from HERE.
             *
             * This process was launched by the user's current session; the daemon may have been
             * launched by one that ended days ago and is reused whenever its build id still
             * matches. Sending ours at attach time is the only way the daemon can spawn a shell
             * with an environment that is actually current — a process cannot re-read its
             * parent's after the fact.
             */
            baseEnv: { ...process.env } as Record<string, string>,
          },
          viewId: req.viewId,
          // Carry the caller's stated intent (008 FR-002/FR-007). An explicit re-type
          // terminates a running session and cold-starts the new flavour; an implicit
          // attach always reuses a running session.
          explicit: req.explicit === true,
          rootless: req.rootless === true,
          runAsAdmin: req.runAsAdmin === true,
          cols: req.cols,
          rows: req.rows,
          meta: { ...req.meta, flavourLabel: flavour.label },
        },
        attachTimeoutMs,
      );
      return { ok: true, ...result, ...(cwdFallback ? { cwdFallback } : {}) };
    } catch (error) {
      // A timeout is NOT a failure (008 FR-005): the daemon may still be launching the
      // shell, and any existing session keeps running. Surface it as a non-fatal
      // "still starting" state so the renderer can offer a retry instead of reverting
      // the panel to the type form or presenting a hard error.
      if (error instanceof RpcTimeoutError) {
        return { ok: false, stillStarting: true, error: { code: null, message: 'still starting' } };
      }
      /*
       * 029 — carry the CAUSE the daemon classified (contract §4).
       *
       * It cannot be re-derived here: `code` on the wire is a numeric JSON-RPC code, not an errno,
       * and the errno only ever existed where the throw happened. Absent (an unclassifiable launch
       * failure — a missing flavour, a broken shell path) is meaningful, not a gap: the panel then
       * reverts exactly as it does today, which is FR-003's second arm.
       */
      const err = error as { code?: number; message?: string; data?: unknown };
      const message = err.message ?? 'terminal attach failed';
      /*
       * A TRANSPORT failure is the daemon being gone, and it must be said so — FR-001.
       *
       * `DaemonClient` rejects a lost connection with the errno as the entire message (`ENOENT`,
       * `daemon-unreachable`, `invalid-response`) and no `data`, because the throw never reached the
       * daemon's router. Left unclassified, that arrived at the panel as "no cause", which
       * `startFailurePreservesPanelType` correctly reads as "revert" — and the panel's type and
       * config were stripped and persisted. Open throng while its daemon is down and every
       * configured terminal is gone for good.
       *
       * So the classification happens where the knowledge is. The daemon cannot classify a failure
       * it never received; this is the one place that can distinguish a daemon which REFUSED from a
       * daemon which was never reached. `isTransportFailure` is the same rule the renderer uses to
       * decide what to SAY, so the two cannot drift apart.
       */
      const cause = isFailureCause(err.data)
        ? err.data
        : isTransportFailure(message)
          ? ({ kind: 'daemon-stopped', subject: 'throng', raw: message } satisfies FailureCause)
          : undefined;
      return {
        ok: false,
        error: { code: err.code ?? null, message },
        ...(cause ? { cause } : {}),
      };
    }
  };

  ipcMain.handle('throng:terminal:attach', (event, req: AttachRequest): Promise<AttachEnvelope> => {
    const sender = event.sender;
    return serializeAttach(() => doAttach(req)).then((res) => {
      // Only track a view once its session is actually attached, so the backstop never
      // detaches a view that failed to attach.
      if (res.ok) trackView(sender, req.panelId, req.viewId);
      return res;
    });
  });

  ipcMain.handle('throng:terminal:write', (_e, panelId: string, data: string) =>
    daemonClient.call('terminal.write', { panelId, data }).catch(() => ({ ok: false })),
  );
  ipcMain.handle(
    'throng:terminal:resize',
    (_e, panelId: string, cols: number, rows: number, viewId?: string) =>
      daemonClient.call('terminal.resize', { panelId, viewId, cols, rows }).catch(() => ({ ok: false })),
  );
  // A view is going away (008 FR-007/FR-010). Detach removes it from the daemon's grid
  // set; the daemon terminates the session only for the last view of a sub-workspace-
  // owned panel — a detach is never a kill.
  ipcMain.handle('throng:terminal:detach', (event, panelId: string, viewId?: string) => {
    untrackView(event.sender, panelId, viewId); // a clean unmount handles its own detach
    return daemonClient.call('terminal.detach', { panelId, viewId }).catch(() => ({ ok: false }));
  });
  // 028 (#162/#163): force the running program to redraw. A tab switch unmounts every panel, so a
  // returning tab rebuilds its terminal from a replayed byte tail — which cannot represent a
  // full-screen program's screen. Only the program can, and it redraws only when the window changes.
  ipcMain.handle('throng:terminal:repaint', (_e, panelId: string) =>
    daemonClient.call('terminal.repaint', { panelId }).catch(() => ({ ok: false })),
  );
  ipcMain.handle('throng:terminal:kill', (_e, panelId: string) =>
    daemonClient.call('terminal.kill', { panelId }).catch(() => ({ ok: false })),
  );
  ipcMain.handle('throng:terminal:list', (_e, projectId?: string) =>
    daemonClient.call('terminal.list', { projectId }).catch(() => ({ sessions: [] })),
  );

  // Daemon capabilities (FR-025a): whether the terminal-hosting daemon is elevated,
  // gating the "run as admin" checkbox AND the status-bar ADMIN pill (FR-025e).
  // Defaults to not-elevated on any failure so the control stays disabled rather than
  // falsely enabled. Test seam: THRONG_FAKE_ELEVATED=1 forces elevated so the pill /
  // checkbox are verifiable without a real UAC/elevated run (mirrors THRONG_FORCE_PTY_AGENT).
  ipcMain.handle('throng:terminal:capabilities', () =>
    process.env.THRONG_FAKE_ELEVATED === '1'
      ? Promise.resolve({ elevated: true })
      : daemonClient.call('terminal.capabilities', {}).catch(() => ({ elevated: false })),
  );

  // The inline terminal's right-click menu is the app's THEMED ContextMenu, built and
  // handled in the renderer (terminal-panel.tsx) — Copy writes the xterm selection to the
  // OS clipboard via `terminal.writeClipboard`, Paste reads `clipboard.paste` and writes it
  // to the shell via `terminal.write`. The former native (Electron) menu was deleted: it
  // ignored the theme, which is the whole of the complaint it answered.

  // OSC 52 clipboard write (a program inside the terminal — Claude Code, tmux, vim —
  // copies to the system clipboard). The sandboxed renderer decodes the sequence and
  // relays the plain text here, the only place that can reach the OS clipboard.
  ipcMain.handle('throng:terminal:clipboardWrite', (_e, text: string) => {
    if (typeof text === 'string' && text.length > 0) clipboard.writeText(text);
    return { ok: true };
  });
}
