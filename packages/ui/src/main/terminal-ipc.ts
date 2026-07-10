import { homedir } from 'node:os';
import { BrowserWindow, clipboard, ipcMain, Menu, type WebContents } from 'electron';
import { resolveLaunchSpec } from '@throng/core';
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
  params: string;
  cols: number;
  rows: number;
  /** Display labels for the app-close warning (flavourLabel is filled in here). */
  meta?: { projectName?: string; tabName?: string; panelName?: string };
}

type AttachEnvelope =
  | ({ ok: true } & TerminalAttachResult)
  | { ok: false; stillStarting?: boolean; error: { code: number | null; message: string } };

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
}): void {
  const { daemonClient, shellDetection, attachTimeoutMs } = deps;

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
      const cwd = req.projectRoot ?? (req.rootless ? homedir() : null);
      if (cwd === null) {
        return { ok: false, error: { code: null, message: 'No active project root to start the terminal in' } };
      }
      const launch = resolveLaunchSpec({ file: flavour.file, args: flavour.args }, req.params, cwd);
      // The attach RPC gets the shell-launch budget, NOT the health-check ping budget
      // (008 FR-004): a shell can take seconds to come up, and reusing the ping budget is
      // exactly what surfaced a spurious connection timeout in a fresh sub-workspace.
      const result = await daemonClient.call<TerminalAttachResult>(
        'terminal.attach',
        {
          panelId: req.panelId,
          projectId: req.projectId,
          launch,
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
      return { ok: true, ...result };
    } catch (error) {
      // A timeout is NOT a failure (008 FR-005): the daemon may still be launching the
      // shell, and any existing session keeps running. Surface it as a non-fatal
      // "still starting" state so the renderer can offer a retry instead of reverting
      // the panel to the type form or presenting a hard error.
      if (error instanceof RpcTimeoutError) {
        return { ok: false, stillStarting: true, error: { code: null, message: 'still starting' } };
      }
      const err = error as { code?: number; message?: string };
      return { ok: false, error: { code: err.code ?? null, message: err.message ?? 'terminal attach failed' } };
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

  // Native (OS) right-click menu for the inline terminal: Copy the xterm selection,
  // Paste the clipboard into the live shell.
  ipcMain.handle(
    'throng:terminal:contextMenu',
    (event, payload: { panelId: string; selection: string }) => {
      const selection = typeof payload?.selection === 'string' ? payload.selection : '';
      const hasSelection = selection.length > 0;
      const menu = Menu.buildFromTemplate([
        {
          label: 'Copy',
          enabled: hasSelection,
          click: () => {
            if (hasSelection) clipboard.writeText(selection);
          },
        },
        {
          label: 'Paste',
          click: () => {
            const text = clipboard.readText();
            if (text) void daemonClient.call('terminal.write', { panelId: payload.panelId, data: text }).catch(() => {});
          },
        },
      ]);
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      menu.popup(win ? { window: win } : {});
    },
  );

  // OSC 52 clipboard write (a program inside the terminal — Claude Code, tmux, vim —
  // copies to the system clipboard). The sandboxed renderer decodes the sequence and
  // relays the plain text here, the only place that can reach the OS clipboard.
  ipcMain.handle('throng:terminal:clipboardWrite', (_e, text: string) => {
    if (typeof text === 'string' && text.length > 0) clipboard.writeText(text);
    return { ok: true };
  });
}
