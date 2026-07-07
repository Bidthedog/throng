import { homedir } from 'node:os';
import { BrowserWindow, clipboard, ipcMain, Menu } from 'electron';
import { resolveLaunchSpec } from '@throng/core';
import type { TerminalAttachResult } from '@throng/ipc-contract';
import type { DaemonClient } from './daemon-client.js';
import type { ShellDetectionService } from './shell-detection-service.js';
import { createSerializer } from './attach-serializer.js';

/** What the renderer sends to (re)attach a Terminal Panel. */
interface AttachRequest {
  panelId: string;
  projectId: string;
  projectRoot: string | null;
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
  | { ok: false; error: { code: number | null; message: string } };

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
}): void {
  const { daemonClient, shellDetection } = deps;

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
      const result = await daemonClient.call<TerminalAttachResult>('terminal.attach', {
        panelId: req.panelId,
        projectId: req.projectId,
        launch,
        rootless: req.rootless === true,
        runAsAdmin: req.runAsAdmin === true,
        cols: req.cols,
        rows: req.rows,
        meta: { ...req.meta, flavourLabel: flavour.label },
      });
      return { ok: true, ...result };
    } catch (error) {
      const err = error as { code?: number; message?: string };
      return { ok: false, error: { code: err.code ?? null, message: err.message ?? 'terminal attach failed' } };
    }
  };

  ipcMain.handle('throng:terminal:attach', (_event, req: AttachRequest): Promise<AttachEnvelope> =>
    serializeAttach(() => doAttach(req)),
  );

  ipcMain.handle('throng:terminal:write', (_e, panelId: string, data: string) =>
    daemonClient.call('terminal.write', { panelId, data }).catch(() => ({ ok: false })),
  );
  ipcMain.handle('throng:terminal:resize', (_e, panelId: string, cols: number, rows: number) =>
    daemonClient.call('terminal.resize', { panelId, cols, rows }).catch(() => ({ ok: false })),
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
