import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, type WebContents } from 'electron';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  parseAppSettings,
  parseKeybindings,
  THRONG_THEME,
  type IConfigSettings,
  type IConfigStore,
  type IFileWatcher,
  type IUiSettings,
  type Theme,
} from '@throng/core';
import { createUiContainer, UI_TYPES } from './composition-root.js';
import { broadcastToWindows, senderWebContentsId } from './broadcast.js';
import { readConfigPayload, startConfigWatcher, type ConfigPayload } from './config-watcher.js';
import { acquireSingleInstance } from './single-instance.js';
import { ensureDaemon } from './daemon-lifecycle.js';
import { DaemonRpcError, type DaemonClient } from './daemon-client.js';
import { ElectronDisplayInfo } from './electron-display-info.js';
import { loadWindowState, saveWindowState } from './window-state.js';
import { registerGhostIpc } from './ghost-window.js';
import { WindowManager } from './window-manager.js';
import { NodeFileSystem } from './node-file-system.js';
import { NodeFileWatcher } from './node-file-watcher.js';
import { ElectronShellIntegration } from './electron-shell-integration.js';
import { FilesService } from './files-service.js';
import { ExplorerWatcher } from './explorer-watcher.js';
import { registerFilesIpc } from './files-ipc.js';
import { EditorService } from './editor-service.js';
import { EditorRecovery } from './editor-recovery.js';
import { EditorCoordinator } from './editor-coordinator.js';
import { registerEditorIpc } from './editor-ipc.js';
import { WindowsShellDetection, WindowsElevation } from '@throng/platform-windows';
import { createShellDetectionService } from './shell-detection-service.js';
import { DaemonEvents } from './daemon-events.js';
import { registerTerminalIpc } from './terminal-ipc.js';

/** Result envelope for the generic renderer RPC bridge — preserves JSON-RPC
 *  error codes across the contextBridge boundary (002 / research D10). */
type RpcEnvelope =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: number | null; message: string } };

async function invokeDaemon(
  daemonClient: DaemonClient,
  method: string,
  params: unknown,
): Promise<RpcEnvelope> {
  try {
    const result = await daemonClient.call<unknown>(method, params);
    return { ok: true, result };
  } catch (error) {
    const code = error instanceof DaemonRpcError ? error.code : null;
    return { ok: false, error: { code, message: (error as Error).message } };
  }
}

function resolveFromHere(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/**
 * Ensure the user-scoped config documents exist with documented defaults on
 * first run (FR-031, research D1). `read` creates each absent file from its
 * defaults; an existing (possibly hand-edited) file is left in place.
 */
async function ensureDefaultConfig(store: IConfigStore): Promise<void> {
  await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings);
  await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
  await store.read({ kind: 'theme', name: THRONG_THEME.name }, THRONG_THEME, (raw) =>
    raw && typeof raw === 'object' ? { ...THRONG_THEME, ...(raw as Partial<Theme>) } : THRONG_THEME,
  );
}

// Zoom is handled in-process because removing the native menu (below) also
// removed its zoomIn/zoomOut/resetZoom accelerators. setZoomLevel is the single
// source of truth so keyboard, mouse wheel, and middle-click all stay in sync.
const ZOOM_STEP = 0.5;
const ZOOM_LIMIT = 5;

function zoomBy(webContents: WebContents, steps: number): void {
  const next = webContents.getZoomLevel() + steps * ZOOM_STEP;
  webContents.setZoomLevel(Math.min(Math.max(next, -ZOOM_LIMIT), ZOOM_LIMIT));
}

function resetZoom(webContents: WebContents): void {
  webContents.setZoomLevel(0);
}

// Keyboard accelerators (zoom / fullscreen) are resolved in the RENDERER against
// the user's keybindings document (so edits to keybindings.json apply live + across
// sessions, and the keys are real DOM events). The renderer forwards the resulting
// action here over IPC; acting on the sending frame's webContents/window keeps each
// window independent. Mouse-driven zoom (Ctrl+wheel / Ctrl+middle-click) uses the
// same zoom IPC.
function registerZoomIpc(): void {
  ipcMain.on('throng:zoomBy', (event, steps: number) => {
    if (typeof steps === 'number' && Number.isFinite(steps)) {
      zoomBy(event.sender, steps);
    }
  });
  ipcMain.on('throng:zoomReset', (event) => {
    resetZoom(event.sender);
  });
  ipcMain.on('throng:fullscreenToggle', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) window.setFullScreen(!window.isFullScreen());
  });
}

// Floor: both side panes auto-collapse to their rails (32 each) when the window is
// too narrow for them, so the hard minimum only needs the two rails + the workspace
// minimum (480). Works comfortably at half a 1920 screen (one pane stays expanded).
const MIN_WIDTH = 600;
// Tall enough that the left pane's three panels (Projects 120 + Sub-workspaces 160
// + Terminals 160 mins) always fit above the status bar without any going below
// its minimum.
const MIN_HEIGHT = 560;

/** Compute the initial window options from saved geometry (clamped to a visible
 *  display, FR-028/047) or the configured defaults. */
function initialWindowOptions(
  settings: IUiSettings,
  displayInfo: ElectronDisplayInfo,
  statePath: string,
): Electron.BrowserWindowConstructorOptions {
  const saved = loadWindowState(statePath);
  if (saved) {
    const bounds = displayInfo.clampToVisible({
      x: saved.x,
      y: saved.y,
      width: Math.max(saved.width, MIN_WIDTH),
      height: Math.max(saved.height, MIN_HEIGHT),
    });
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }
  // First run (no saved geometry): centre on the PRIMARY display so the window is
  // never placed on a secondary/absent monitor where the user can't find it
  // (multi-monitor "the app does nothing" fix).
  const centred = displayInfo.centerOnPrimary(settings.window.width, settings.window.height);
  return { x: centred.x, y: centred.y, width: centred.width, height: centred.height };
}

async function createMainWindow(
  settings: IUiSettings,
  displayInfo: ElectronDisplayInfo,
  statePath: string,
): Promise<BrowserWindow> {
  const saved = loadWindowState(statePath);
  const window = new BrowserWindow({
    ...initialWindowOptions(settings, displayInfo, statePath),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'throng',
    backgroundColor: '#10131a',
    webPreferences: {
      preload: resolveFromHere('../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (saved?.maximized) window.maximize();

  // Persist window geometry on close so size + position are restored (FR-047).
  window.on('close', () => {
    const bounds = window.getNormalBounds();
    saveWindowState(statePath, { ...bounds, maximized: window.isMaximized() });
  });

  await window.loadFile(resolveFromHere('../renderer/index.html'));
  return window;
}

/**
 * Create a detached sub-workspace window (US7 / FR-013, Constitution XI). The
 * sub-workspace id is carried in the loaded URL's query (`?sw=<id>`); the renderer
 * reads it and mounts the sub-workspace variant (reusing the workspace renderer).
 * Per-window bounds persistence + off-display clamp land in a later slice (T079);
 * for now it opens at a sensible default size.
 */
interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function createSubWorkspaceWindow(id: string, bounds?: WindowBounds): BrowserWindow {
  const window = new BrowserWindow({
    ...(bounds ?? { width: 900, height: 640 }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'throng — Sub-workspace',
    backgroundColor: '#10131a',
    webPreferences: {
      preload: resolveFromHere('../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void window.loadFile(resolveFromHere('../renderer/index.html'), { query: { sw: id } });
  return window;
}

// Name the app "throng" BEFORE any getPath('userData') / single-instance call, so
// Electron's per-user data (recovery temps, window state) lives in %APPDATA%\throng
// — alongside the daemon's throng.db — instead of the dev-default %APPDATA%\Electron.
app.setName('throng');

// Single-instance: a second launch focuses the existing window and exits, rather
// than starting a rival instance that would fracture project/terminal ownership.
const isPrimaryInstance = acquireSingleInstance(app, () => {
  const [existing] = BrowserWindow.getAllWindows();
  if (existing) {
    // Recover a window the user "lost" — e.g. left on a now-disconnected monitor:
    // move it onto a visible display before focusing, so a second launch un-hides
    // it rather than silently doing nothing.
    const di = new ElectronDisplayInfo(() => screen.getAllDisplays());
    const b = existing.getBounds();
    if (!di.isVisible(b)) {
      const v = di.clampToVisible(b);
      existing.setBounds({ x: v.x, y: v.y, width: v.width, height: v.height });
    }
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
  }
});

if (isPrimaryInstance)
  app.whenReady().then(async () => {
  // No application commands exist in the bootstrap, so remove Electron's
  // auto-generated native menu bar (File/Edit/View/Window/Help). A real
  // in-window menu is part of the later workspace UI (FR-007).
  Menu.setApplicationMenu(null);

  const container = createUiContainer();
  const settings = container.get<IUiSettings>(UI_TYPES.UiSettings);
  const daemonClient = container.get<DaemonClient>(UI_TYPES.DaemonClient);

  // Persistent detached daemon (US3): connect to a running daemon or spawn one and
  // wait until it is ready — BEFORE the window loads, so the first RPC/terminal
  // call finds it up. Detached + unref'd, it outlives this UI (Principle III: open
  // terminals keep running). A failure here is non-fatal: the app still runs and
  // getDaemonStatus will report unavailable.
  try {
    await ensureDaemon({
      pipeName: settings.pipeName,
      daemonEntry: resolveFromHere('../../../daemon/dist/main.js'),
      pingTimeoutMs: settings.pingTimeoutMs,
      // FR-025b: if we're elevated but an existing daemon isn't, retire + respawn it
      // elevated (an elevated app spawns an elevated daemon) so terminals can run admin.
      appElevated: new WindowsElevation().isElevated(),
    });
  } catch (error) {
    console.error('[throng-ui] daemon did not start:', (error as Error).message);
  }

  // First-run: create the user config files (settings/keybindings/theme) under
  // %USERPROFILE%\.throng\ from documented defaults (FR-031).
  const configStore = container.get<IConfigStore>(UI_TYPES.ConfigStore);
  const configSettings = container.get<IConfigSettings>(UI_TYPES.ConfigSettings);
  const fileWatcher = container.get<IFileWatcher>(UI_TYPES.FileWatcher);
  await ensureDefaultConfig(configStore);

  // The renderer pulls the current config (settings + theme + keybindings) on
  // mount (FR-031); it then receives a fresh payload whenever a config file
  // changes (hot-reload, FR-030/033). The renderer resolves keyboard accelerators
  // from the pushed keybindings.
  ipcMain.handle('throng:config:get', () => readConfigPayload(configStore));
  // Cache the parsed settings in UI main so services (e.g. the editor) can read
  // injected config (Principle X) without a renderer round-trip; kept fresh by the
  // config watcher below.
  let currentSettings = (await readConfigPayload(configStore)).settings;
  const broadcast = (payload: ConfigPayload): void => {
    currentSettings = payload.settings;
    broadcastToWindows(BrowserWindow.getAllWindows(), 'throng:config', payload);
  };
  startConfigWatcher({ store: configStore, watcher: fileWatcher, config: configSettings, broadcast });

  // Renderer asks for the daemon health.ping outcome through the preload bridge.
  ipcMain.handle('throng:getDaemonStatus', () => daemonClient.getStatus());

  // Generic JSON-RPC bridge: the renderer calls daemon methods (projects.*,
  // workspace.*) through the preload `invoke`, which routes here. Errors are
  // returned as a tagged envelope so JSON-RPC codes survive the IPC boundary.
  // Durable state lives in the daemon's SQLite store — there is no projects.json
  // snapshot (removed; a real import/export feature will come later).
  ipcMain.handle('throng:rpc', async (_event, method: string, params: unknown) => {
    return invokeDaemon(daemonClient, method, params);
  });

  // Native folder picker for a project's root folder (FR-034). Returns the chosen
  // absolute path, or null if the dialog was cancelled.
  ipcMain.handle('throng:pickFolder', async (event): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = owner
      ? await dialog.showOpenDialog(owner, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  // Native save-location chooser for a new editor document (006, T041). The
  // confinement guard in editor-service still refuses an out-of-tree pick, so this
  // dialog is a convenience, not the security boundary.
  ipcMain.handle(
    'throng:editor:chooseSavePath',
    async (
      event,
      req: { defaultDir?: string; defaultName?: string } | undefined,
    ): Promise<string | null> => {
      const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      // Pre-fill the file-name field with the Panel's name for a new document
      // (FR-083), inside the default directory when one is supplied.
      const dir = req?.defaultDir;
      const name = req?.defaultName;
      const defaultPath = dir ? (name ? join(dir, name) : dir) : name;
      const options = { defaultPath };
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },
  );

  // The renderer sets a workspace-summary window title (FR-040).
  ipcMain.on('throng:setTitle', (event, title: string) => {
    if (typeof title === 'string') {
      BrowserWindow.fromWebContents(event.sender)?.setTitle(title);
    }
  });

  // Mouse-driven zoom (Ctrl+wheel / Ctrl+middle-click) forwarded by the renderer.
  registerZoomIpc();

  // Cursor-following drag ghost as an OS window (FR-001) so it stays visible at
  // and beyond the app's edge.
  registerGhostIpc();

  // File Explorer tree (004): the renderer (sandboxed) reaches the filesystem
  // only through these `files.*` channels. Recycle-Bin + reveal use Electron's
  // built-in `shell`; confinement to the active project root is enforced by the
  // service on resolved real paths (research D1/D5).
  const fileSystem = new NodeFileSystem((p) => shell.trashItem(p));
  const shellIntegration = new ElectronShellIntegration(shell);
  // Watch the active project's root and push change signals to every window so
  // the file tree stays live-synced with external + in-app edits (US2).
  const explorerWatcher = new ExplorerWatcher(new NodeFileWatcher(150), (evt) => {
    broadcastToWindows(BrowserWindow.getAllWindows(), 'throng:files:changed', evt);
  });
  const filesService = new FilesService(fileSystem, shellIntegration);
  registerFilesIpc(filesService, explorerWatcher);

  // Editor panels (006): UI-main-owned, NOT daemon-backed. File I/O via the same
  // IFileSystem; the app-wide open-document registry, dirty-file lock, recovery
  // temps, and cross-window mirror live in the coordinator; the sandboxed renderer
  // reaches them only through the `editor.*` bridge (peer of `files.*`, no daemon).
  const editorService = new EditorService(fileSystem, () => currentSettings);
  const editorRecovery = new EditorRecovery(join(app.getPath('userData'), 'recovery'));
  const editorCoordinator = new EditorCoordinator(editorService, editorRecovery, {
    recoveryDebounceMs: 400,
    // Soft external-change detection (FR-028): a per-doc folder watch so a file
    // edited/deleted outside throng is reconciled (reload if clean, warn if dirty).
    fileWatcher: new NodeFileWatcher(150),
    // Mirror an edit (content + dirty) to every OTHER window (FR-034), like the
    // panel-*-sync broadcasts.
    relaySync: (fromWebContentsId, msg) => {
      broadcastToWindows(BrowserWindow.getAllWindows(), 'throng:editor:sync', msg, fromWebContentsId);
    },
    // Raise the window that already owns an open file and focus its Panel (FR-011a).
    focusEditor: (windowId, panelId) => {
      const win = BrowserWindow.getAllWindows().find((w) => String(w.webContents.id) === windowId);
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
      win.webContents.send('throng:editor:focus', { panelId });
    },
  });
  registerEditorIpc(editorCoordinator);
  // Deleting a file that is open in an editor marks that editor dirty (FR-099): the
  // buffer survives so the user can save it back (re-creating the file) or discard.
  filesService.setOnDeleted((absPaths) => editorCoordinator.markDeleted(absPaths));

  // Terminal flavours (005 Phase B): UI main owns shell detection (inline, like
  // the FS seams above), merging the machine's built-ins with settings.terminals.
  // The sandboxed renderer reaches it only through this channel (no daemon).
  const shellDetectionService = createShellDetectionService({
    detection: new WindowsShellDetection(),
    configStore,
  });
  ipcMain.handle('throng:terminal:listFlavours', () => shellDetectionService.listFlavours());

  // Live terminals (005 Phase C): the renderer's terminal.* commands route to the
  // daemon (UI main resolves the launch spec); daemon output/exit notifications
  // arrive over a long-lived events socket and are forwarded to every window.
  registerTerminalIpc({ daemonClient, shellDetection: shellDetectionService });
  const daemonEvents = new DaemonEvents(settings.pipeName);
  daemonEvents.start();
  app.on('will-quit', () => daemonEvents.stop());

  // Window geometry persistence (FR-047) restored onto a visible display (FR-028).
  const displayInfo = new ElectronDisplayInfo(() => screen.getAllDisplays());
  const statePath = join(app.getPath('userData'), 'window-state.json');

  // The main window plus every detached sub-workspace window form a single
  // focus/raise group; closing the main window closes them all (Constitution XI).
  const windowManager = new WindowManager();
  const mainWindow = await createMainWindow(settings, displayInfo, statePath);
  windowManager.registerMain(mainWindow);

  // App-close warning with running terminals (FR-015). Intercept the main window
  // close: if the daemon reports running sessions, ask the renderer for the
  // three-choice decision (leave running / terminate all / cancel) and act on it;
  // with none (or the daemon unreachable), close normally.
  let allowClose = false;
  // The running terminals (with display metadata) for the close warning. Returns
  // null when the query itself fails (daemon hiccup) — the caller then still WARNS
  // rather than silently closing, so a running terminal is never lost to an error.
  interface RunningTerminal {
    panelId: string;
    meta?: { projectName?: string; tabName?: string; panelName?: string; flavourLabel?: string };
  }
  const runningTerminals = async (): Promise<RunningTerminal[] | null> => {
    try {
      const { sessions } = await daemonClient.call<{
        sessions: Array<{ panelId: string; status: string; meta?: RunningTerminal['meta'] }>;
      }>('terminal.list', {});
      const running = (Array.isArray(sessions) ? sessions : [])
        .filter((s) => s.status === 'running')
        .map((s) => ({ panelId: s.panelId, meta: s.meta }));
      console.log(`[throng] app-close: ${running.length} running terminal(s)`);
      return running;
    } catch (error) {
      console.error('[throng] app-close: terminal.list failed:', (error as Error).message);
      return null; // unknown → warn to be safe
    }
  };
  mainWindow.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    // Immediately show a blocking overlay (spinner + wait cursor) so the click gives
    // instant feedback, THEN resolve into the warning or the closing message once we
    // know whether any terminals are running.
    mainWindow.webContents.send('throng:appClose:begin');
    void (async () => {
      const terminals = await runningTerminals();
      if (terminals && terminals.length === 0) {
        // Definitely nothing to warn about: keep the blocking overlay, then quit.
        mainWindow.webContents.send('throng:appClose:closing', { message: 'Closing throng…' });
        allowClose = true;
        setTimeout(() => {
          if (!mainWindow.isDestroyed()) mainWindow.close();
        }, 250);
      } else {
        // Some terminals, or null (query failed → assume terminals may be running).
        mainWindow.webContents.send('throng:appClose:prompt', {
          count: terminals?.length ?? null,
          terminals: terminals ?? [],
        });
      }
    })();
  });
  ipcMain.on('throng:appClose:choice', (_event, choice: unknown) => {
    if (choice !== 'terminate' && choice !== 'leave') return; // cancel/unknown → stay open
    void (async () => {
      if (choice === 'terminate') {
        try {
          await daemonClient.call('terminal.killAll', {});
        } catch {
          /* best-effort; still allow the close */
        }
      }
      allowClose = true;
      mainWindow.close();
    })();
  });

  // Lazy reopen (FR-013): the renderer asks to open a sub-workspace by id. If a
  // window is already open for it, raise + focus it; otherwise restore its saved
  // bounds (clamped onto a visible display, FR-017a / Constitution XI) and open it.
  ipcMain.on('throng:subworkspace:open', (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) return;
    void (async () => {
      const existing = windowManager.getChild(id);
      if (existing && !existing.isDestroyed()) {
        const win = existing as BrowserWindow;
        if (win.isMinimized()) win.restore();
        win.focus();
        return;
      }

      // Restore the persisted window bounds, clamped onto a currently-visible
      // display so a window saved on an unplugged monitor still appears (FR-017a).
      let restored: WindowBounds | undefined;
      try {
        const { subWorkspaces } = await daemonClient.call<{
          subWorkspaces: Array<{ id: string; bounds?: WindowBounds }>;
        }>('workspace.loadSubWorkspaces', {});
        const saved = subWorkspaces.find((s) => s.id === id)?.bounds;
        if (saved) {
          restored = displayInfo.clampToVisible({
            x: saved.x,
            y: saved.y,
            width: Math.max(saved.width, MIN_WIDTH),
            height: Math.max(saved.height, MIN_HEIGHT),
          });
        }
      } catch {
        /* fall back to the default size if the bounds can't be read */
      }

      const win = createSubWorkspaceWindow(id, restored);
      windowManager.registerChild(id, win);

      // Persist bounds on move/resize (debounced) and on close (FR-017a).
      let timer: ReturnType<typeof setTimeout> | null = null;
      const persistBounds = (): void => {
        if (win.isDestroyed()) return;
        const b = win.getNormalBounds();
        void daemonClient
          .call('subworkspace.updateBounds', {
            id,
            bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
          })
          .catch(() => {
            /* best-effort; bounds restore is non-critical */
          });
      };
      const schedulePersist = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(persistBounds, 300);
      };
      win.on('move', schedulePersist);
      win.on('resize', schedulePersist);
      win.on('close', () => {
        if (timer) clearTimeout(timer);
        persistBounds();
      });
    })();
  });

  // Close a sub-workspace window (e.g. when it is deleted from the list).
  ipcMain.on('throng:subworkspace:close', (_event, id: unknown) => {
    if (typeof id !== 'string') return;
    const child = windowManager.getChild(id);
    if (child && !child.isDestroyed()) child.close();
  });

  // Cross-window content sync: a window edited a sub-workspace's content; tell
  // every OTHER window so an open sub-workspace window re-reads its layout and the
  // main window refreshes its cached sub-workspaces. The sender is excluded — a
  // window applies its own edit locally, so echoing it back would needlessly
  // remount the very window that made the change (and could interrupt an edit).
  ipcMain.on('throng:subworkspace:changed', (event, id: unknown) => {
    if (typeof id !== 'string') return;
    broadcastToWindows(
      BrowserWindow.getAllWindows(),
      'throng:subworkspace:changed:push',
      id,
      senderWebContentsId(event.sender) ?? undefined,
    );
  });

  // Cross-window projects sync: a project was created/renamed/recoloured/deleted in
  // one window; tell every OTHER window so their projects list (and the derived
  // sub-workspace owner labels) refresh live, without a reload.
  ipcMain.on('throng:projects:changed', (event) => {
    broadcastToWindows(
      BrowserWindow.getAllWindows(),
      'throng:projects:changed:push',
      undefined,
      senderWebContentsId(event.sender) ?? undefined,
    );
  });

  // Cross-window Panel identity sync (003): a Panel was renamed in one window;
  // tell every window so the same Panel (by id) is renamed everywhere it appears.
  ipcMain.on('throng:panel:rename', (_event, payload: unknown) => {
    const p = payload as { id?: unknown; title?: unknown } | null;
    if (!p || typeof p.id !== 'string' || typeof p.title !== 'string') return;
    broadcastToWindows(BrowserWindow.getAllWindows(), 'throng:panel:renamed', { id: p.id, title: p.title });
  });

  // Cross-window Panel destroy cascade (005 FR-026): a Panel was destroyed in one
  // window; tell every window so the same Panel (by id) is removed everywhere it
  // appears — the owning project and every sub-workspace mirroring it.
  ipcMain.on('throng:panel:destroy', (_event, payload: unknown) => {
    const p = payload as { id?: unknown } | null;
    if (!p || typeof p.id !== 'string') return;
    broadcastToWindows(BrowserWindow.getAllWindows(), 'throng:panel:destroyed', { id: p.id });
  });

  // Cross-window Panel STATE sync (005): a Panel's type-selection form draft, its
  // confirmed type+config changed in one window — relay to every OTHER window so a
  // cloned Panel mirrors it (form + type; selection is window-local).
  ipcMain.on('throng:panel:draft', (event, payload: unknown) => {
    const p = payload as { id?: unknown; draft?: unknown } | null;
    if (!p || typeof p.id !== 'string') return;
    broadcastToWindows(
      BrowserWindow.getAllWindows(),
      'throng:panel:drafted',
      { id: p.id, draft: p.draft },
      senderWebContentsId(event.sender) ?? undefined,
    );
  });
  ipcMain.on('throng:panel:type', (event, payload: unknown) => {
    const p = payload as { id?: unknown; kind?: unknown; config?: unknown } | null;
    if (!p || typeof p.id !== 'string' || typeof p.kind !== 'string') return;
    broadcastToWindows(
      BrowserWindow.getAllWindows(),
      'throng:panel:typed',
      { id: p.id, kind: p.kind, config: p.config },
      senderWebContentsId(event.sender) ?? undefined,
    );
  });
  // NB: no `throng:panel:active` relay — the active/selected Panel is deliberately
  // window-local (revised 2026-07-02: sub-workspace focus is independent).

  // Drag-onto-a-sub-workspace-window (US7): the renderer can't see other OS
  // windows, so on a drop outside its own window it asks which sub-workspace
  // window (if any) is under the cursor. Returns that sub-workspace's id or null.
  ipcMain.handle('throng:subworkspace:atPoint', () => {
    const p = screen.getCursorScreenPoint();
    // Topmost-first so overlapping windows resolve to the one on top.
    for (const id of windowManager.childIdsByFocus()) {
      const child = windowManager.getChild(id);
      if (child && !child.isDestroyed()) {
        const b = (child as BrowserWindow).getBounds();
        if (p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height) return id;
      }
    }
    return null;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(settings, displayInfo, statePath).then((w) =>
        windowManager.registerMain(w),
      );
    }
  });
});

// FR-005: closing the UI window shuts the UI down cleanly (no orphaned
// processes in this iteration). The daemon has its own lifecycle.
if (isPrimaryInstance)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
