import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, type WebContents } from 'electron';
import {
  parseAppSettings,
  parseKeybindings,
  resolveColour,
  type AppSettings,
  ZOOM_STEP,
  ZOOM_MIN_LEVEL,
  ZOOM_MAX_LEVEL,
  type IConfigSettings,
  type IConfigStore,
  type IFileWatcher,
  type IFontEnumeration,
  type IUiSettings,
  type ShippedDefaults,
  type Theme,
} from '@throng/core';
import type { IClipboard } from '@throng/core';
import { createUiContainer, UI_TYPES } from './composition-root.js';
import { appIcon } from './app-icon.js';
import { isSafeExternalUrl } from './external-url.js';
import { ShippedDefaultsService } from './shipped-defaults-service.js';
import { broadcastToWindows, senderWebContentsId } from './broadcast.js';
import { readConfigPayload, startConfigWatcher, type ConfigPayload } from './config-watcher.js';
import { registerConfigWriteIpc, registerConfigManagementIpc } from './config-write-ipc.js';
import { FileConfigStore } from './config-store.js';
import { FontCache } from './font-cache.js';
import { IconPackService } from './icon-pack-service.js';
import { registerWindowControlsIpc, wireWindowMaximizeEvents } from './window-controls-ipc.js';
import {
  openPreferences,
  isPreferencesOpen,
  isPreferencesTab,
  type PreferencesWindowDeps,
} from './preferences-window.js';
import { buildAppMenu } from './app-menu.js';
import { openAbout, type AboutWindowDeps } from './about-window.js';
import { acquireSingleInstance } from './single-instance.js';
import { ensureDaemon } from './daemon-lifecycle.js';
import { DaemonRpcError, type DaemonClient } from './daemon-client.js';
import { ElectronDisplayInfo } from './electron-display-info.js';
import { loadWindowState, saveWindowState } from './window-state.js';
import { registerGhostIpc, setGhostTheme } from './ghost-window.js';
import { WindowManager } from './window-manager.js';
import { NodeFileSystem } from './node-file-system.js';
import { resolvePickerDefaultPath } from './pick-folder.js';
import { NodeFileWatcher } from './node-file-watcher.js';
import { ElectronShellIntegration } from './electron-shell-integration.js';
import { FilesService } from './files-service.js';
import { ExplorerWatcher } from './explorer-watcher.js';
import { registerFilesIpc } from './files-ipc.js';
import { EditorService } from './editor-service.js';
import { EditorRecovery } from './editor-recovery.js';
import { EditorCoordinator } from './editor-coordinator.js';
import { registerEditorIpc } from './editor-ipc.js';
import { registerClipboardIpc } from './clipboard-ipc.js';
import type { ClipboardService } from './clipboard-service.js';
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
 * The daemon's stamped build id (020, FR-006) — the SAME `dist/BUILD_ID` file the
 * daemon-staleness check reads (daemon-lifecycle). Shown in the About dialog beside
 * the product version so two builds of one version stay distinguishable. Returns
 * 'unknown' when the build was not stamped (a partial tsc-only build).
 */
function readBuildId(buildIdPath: string): string {
  try {
    return readFileSync(buildIdPath, 'utf8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The full AGPL-3.0 licence text for the About dialog (020, FR-003a) — read from the
 * repo-root `LICENSE` in dev, and from the packaged copy at run time. The candidates
 * are tried in order; the licence is never pasted into source. Falls back to a
 * pointer at the canonical URL if no copy is found.
 */
function readLicenseText(candidates: string[]): string {
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  return 'Licence text unavailable in this build. See https://www.gnu.org/licenses/agpl-3.0.html';
}

/**
 * The single authoritative product version + author for the About dialog (020, FR-001/003).
 *
 * NOT `app.getVersion()`: running unpackaged (`electron packages/ui/dist/main/main.js`) that
 * returns Electron's OWN version (e.g. 43.0.0), not the product's. The product version lives in
 * exactly one place — the ROOT `package.json` `version` — which electron-builder also injects as
 * the packaged app's manifest, so reading it directly is correct in dev AND when packaged. The
 * copyright holder is that manifest's `author` (kept in one place, not hardcoded in the renderer).
 */
function readProductInfo(candidates: string[]): {
  version: string;
  author: string;
  repoUrl: string;
} {
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
        version?: string;
        author?: unknown;
        repository?: string | { url?: string };
      };
      const author =
        typeof pkg.author === 'string'
          ? pkg.author
          : ((pkg.author as { name?: string } | undefined)?.name ?? '');
      // Canonical https repo URL from package.json `repository` (git+https://x.git -> https://x).
      const rawRepo = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
      const repoUrl = rawRepo
        .replace(/^git\+/, '')
        .replace(/^git:\/\//, 'https://')
        .replace(/\.git$/, '')
        .replace(/#.*$/, '');
      if (pkg.version) return { version: pkg.version, author, repoUrl };
    } catch {
      /* try the next candidate */
    }
  }
  return { version: '0.0.0', author: '', repoUrl: '' };
}

/** One shipped third-party dependency in the About dialog's licence list (020, FR-003a). */
interface ThirdPartyLicence {
  name: string;
  version: string;
  license: string;
  licenseUrl: string;
  projectUrl: string;
}

/**
 * The third-party licence manifest shown in the About dialog (020, FR-003a) — generated at build
 * time by scripts/generate-licenses.mjs from the shipped runtime dependencies. Read from the UI's
 * built output (dev and packaged). Missing → an empty list rather than a crash.
 */
function readThirdPartyLicences(candidates: string[]): ThirdPartyLicence[] {
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as ThirdPartyLicence[];
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

/**
 * First run = the settings document doesn't exist yet. Used to choose between
 * seeding the whole user configuration from the shipped-defaults record (010) and
 * running the additive-only upgrade against an existing configuration.
 */
async function isFirstRun(store: IConfigStore): Promise<boolean> {
  try {
    await readFile(store.pathOf({ kind: 'settings' }), 'utf8');
    return false;
  } catch {
    return true;
  }
}

// Zoom is handled in-process because removing the native menu (below) also
// removed its zoomIn/zoomOut/resetZoom accelerators. setZoomLevel is the single
// source of truth so keyboard, mouse wheel, and middle-click all stay in sync.
// The step and bounds come from the shared @throng/core zoom range (012, DRY) so
// the app-wide global zoom and the per-panel-type zoom behave identically.
function zoomBy(webContents: WebContents, steps: number): void {
  const next = webContents.getZoomLevel() + steps * ZOOM_STEP;
  webContents.setZoomLevel(Math.min(Math.max(next, ZOOM_MIN_LEVEL), ZOOM_MAX_LEVEL));
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
    // Suffix-form brand (US9/FR-033). The renderer overwrites this with the live
    // `<project · context> — throng` once mounted; this is only the pre-content title.
    title: 'No project — throng',
    icon: appIcon(),
    backgroundColor: '#10131a',
    // The application draws its own full-width title bar + window controls (007,
    // FR-001/002); there is no OS-drawn title bar in addition.
    frame: false,
    webPreferences: {
      preload: resolveFromHere('../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  wireWindowMaximizeEvents(window);
  // If preferences is open (app-modal), a window created afterwards must also be
  // non-interactive so the prefs window stays the only interactive surface (FR-013).
  if (isPreferencesOpen()) window.setEnabled(false);
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
    title: 'Sub-workspace — throng',
    icon: appIcon(),
    backgroundColor: '#10131a',
    // Sub-workspace windows share the custom title bar (007, FR-007) — no OS frame.
    frame: false,
    webPreferences: {
      preload: resolveFromHere('../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  wireWindowMaximizeEvents(window);
  if (isPreferencesOpen()) window.setEnabled(false); // stay app-modal (FR-013)
  void window.loadFile(resolveFromHere('../renderer/index.html'), { query: { sw: id } });
  return window;
}

// Name the app "throng" BEFORE any getPath('userData') / single-instance call, so
// Electron's per-user data (recovery temps, window state) lives in %APPDATA%\throng
// — alongside the daemon's throng.db — instead of the dev-default %APPDATA%\Electron.
app.setName('throng');

/**
 * The windows that can answer the shutdown drain (019 FR-010, issue #86) — by webContents id.
 *
 * A renderer announces itself the instant it registers the drain handler, at its entry point.
 * REGISTERED AT MODULE SCOPE, and this is load-bearing rather than tidy: a listener installed
 * next to the drain itself is installed AFTER `createMainWindow`, and the main window's
 * announcement — sent while that very `await` is loading its renderer — arrives before anyone
 * is listening and is dropped forever. Measured: the main window then answered no drain at all,
 * and the layout tests this feature exists for went red while every other window stayed green.
 * The listener must exist before a window can, and only module scope guarantees that.
 */
const drainableWindows = new Set<number>();
ipcMain.on('throng:appClose:drainReady', (event) => {
  const contents = event.sender;
  if (drainableWindows.has(contents.id)) return; // a reload re-announces; one entry, one cleanup
  drainableWindows.add(contents.id);
  contents.once('destroyed', () => drainableWindows.delete(contents.id));
});

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
  // Clear Electron's auto-generated File/Edit/View bar up front. The real
  // application menu — a single Help → About throng item (020, FR-003) — is built
  // and set below, once its dependencies (the resolved paths + main window) exist.
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

  // Shipped defaults (010): on first run, seed the entire user configuration
  // (settings, keybindings, every built-in theme) plus the version marker from the
  // authoritative record; otherwise run the additive-only upgrade (add newly-shipped
  // themes + materialise newly-added theme properties) gated on the version marker —
  // which NEVER overwrites a value the user already has (a later deletion of a
  // default sticks; only "Restore All Themes" recreates it).
  const configStore = container.get<IConfigStore>(UI_TYPES.ConfigStore);
  const configSettings = container.get<IConfigSettings>(UI_TYPES.ConfigSettings);
  const fileWatcher = container.get<IFileWatcher>(UI_TYPES.FileWatcher);
  const shipped = container.get<ShippedDefaults>(UI_TYPES.ShippedDefaults);
  const shippedService = container.get<ShippedDefaultsService>(UI_TYPES.ShippedDefaultsService);
  if (await isFirstRun(configStore)) {
    const seeded = await shippedService.seed();
    if (!seeded.ok)
      console.error('[throng-ui] shipped-defaults seed failed:', seeded.failedPath, seeded.error);
  } else {
    // Defensive: recreate the singleton documents if a user deleted one (sourced
    // from the record), then apply the additive upgrade when the version advanced.
    await configStore.read({ kind: 'settings' }, shipped.settings, parseAppSettings);
    await configStore.read({ kind: 'keybindings' }, shipped.keybindings, parseKeybindings);
    if ((await shippedService.readAppliedVersion()) !== shipped.version) {
      const upgraded = await shippedService.upgrade();
      if (!upgraded.ok)
        console.error('[throng-ui] shipped-defaults upgrade failed:', upgraded.failedPath, upgraded.error);
    }
  }

  /*
   * The icon-pack service must exist BEFORE the first config payload is read, because 017 puts the
   * loaded packs ON that payload — they ride the same channel as the theme that selects them, so no
   * frame can pair a new theme with an old pack's icons.
   *
   * Seeding is awaited so both bundled packs are on disk before anything reads them.
   */
  const iconPackService = new IconPackService(join(configSettings.configRoot, 'icon-packs'));
  await iconPackService.ensureReadme();
  await iconPackService.ensureBundledPacks();

  // The renderer pulls the current config (settings + theme + keybindings + icon packs) on
  // mount (FR-031); it then receives a fresh payload whenever a config file
  // changes (hot-reload, FR-030/033). The renderer resolves keyboard accelerators
  // from the pushed keybindings.
  ipcMain.handle('throng:config:get', () =>
    readConfigPayload(configStore, () => iconPackService.listIconPacks()),
  );
  // Cache the parsed settings in UI main so services (e.g. the editor) can read
  // injected config (Principle X) without a renderer round-trip; kept fresh by the
  // config watcher below.
  const initialPayload = await readConfigPayload(configStore, () =>
    iconPackService.listIconPacks(),
  );
  let currentSettings = initialPayload.settings;
  // Keep the OS-level drag ghost (a separate window that can't consume the app's
  // CSS vars) styled from the active theme so it follows the theme instead of
  // staying the default blue (FR-030). Seed it now + refresh on every config change.
  const pushGhostTheme = (theme: Theme): void =>
    setGhostTheme({
      surface: resolveColour(theme, 'surface'),
      surfaceActive: resolveColour(theme, 'surfaceActive'),
      text: resolveColour(theme, 'text'),
      accent: resolveColour(theme, 'accent'),
      border: resolveColour(theme, 'border'),
    });
  pushGhostTheme(initialPayload.theme);
  /**
   * Set once the editor coordinator exists (it is built further down, after the daemon).
   *
   * FR-027c: turning `persistUndoHistory` OFF must purge what is ALREADY on disk. Waiting for the
   * next keystroke to overwrite each snapshot would leave the user's cut text lying there for as
   * long as they left the document alone — and someone who has just turned this off because they cut
   * a secret into a file is the last person who should have to keep typing to make it go away.
   */
  /**
   * Things that need to react to a settings CHANGE, rather than merely read the current settings.
   *
   * The config watcher is started here, but the services that care are built further down (the
   * editor coordinator needs the daemon first), so they subscribe once they exist.
   */
  const onSettingsChanged: Array<(prev: AppSettings, next: AppSettings) => void> = [];
  const broadcast = (payload: ConfigPayload): void => {
    const previous = currentSettings;
    currentSettings = payload.settings;
    pushGhostTheme(payload.theme);
    for (const react of onSettingsChanged) react(previous, payload.settings);
    broadcastToWindows(BrowserWindow.getAllWindows(), 'throng:config', payload);
  };
  startConfigWatcher({
    store: configStore,
    watcher: fileWatcher,
    config: configSettings,
    broadcast,
    loadIconPacks: () => iconPackService.listIconPacks(),
  });

  // Preferences editor (007): the renderer→main config write path. A validated,
  // confined write lands on disk atomically; the watcher above then rebroadcasts
  // `throng:config`, which live-applies the change (immediate-apply, FR-016/042).
  registerConfigWriteIpc(configStore);

  // Themes tab (007): theme-file management + installed-font cache + icon-pack
  // discovery. Font enumeration runs in the BACKGROUND (never awaited on the
  // startup path — SC-010) and writes %APPDATA%\throng\fonts.json; the picker
  // reads that cache (or a curated fallback). Icon packs are discovered under the
  // per-user config icon-packs\ directory.
  const fontCache = new FontCache(
    container.get<IFontEnumeration>(UI_TYPES.FontEnumeration),
    app.getPath('userData'),
  );
  fontCache.populateInBackground();
  registerConfigManagementIpc({
    store: configStore as FileConfigStore,
    shippedDefaults: shippedService,
    listFonts: () => fontCache.read(),
    listIconPacks: () => iconPackService.listIconPacks(),
  });

  // Custom title bar (007): window min/max/close relays (each targets its sender
  // window) + the cog → preferences entry point. The cog opens the single shared,
  // always-on-top, movable preferences window on the requested tab (FR-002/009/010).
  registerWindowControlsIpc();
  const preferencesDeps: PreferencesWindowDeps = {
    indexHtml: resolveFromHere('../renderer/index.html'),
    preloadPath: resolveFromHere('../preload/preload.cjs'),
    // Resolved lazily at open time: `mainWindow` is created further below in this
    // same startup scope, so this closure captures the current main window (FR-013/013a).
    getMainWindow: () => (mainWindow.isDestroyed() ? null : mainWindow),
  };
  ipcMain.on('throng:preferences:open', (_event, tab: unknown) => {
    openPreferences(isPreferencesTab(tab) ? tab : 'settings', preferencesDeps);
  });

  // Nullable ref to the main window, for the About menu's parent (see below). The
  // `const mainWindow` further down is in its temporal dead zone while the menu is
  // being wired, so the About window cannot read it directly.
  let mainWindowRef: BrowserWindow | null = null;

  // About throng (020, FR-003/FR-003a): the cog menu's "About throng" item opens the
  // shared app-modal About window. The product version + author are read from the ROOT
  // package.json (the single source, FR-001) — deliberately NOT app.getVersion(), which
  // returns Electron's own version when unpackaged (see readProductInfo); the build id
  // from the daemon's stamped BUILD_ID (FR-006); and the full AGPL-3.0 licence from the
  // bundled LICENSE (FR-003a). None of these is hardcoded in the renderer.
  const productInfo = readProductInfo([
    resolveFromHere('../../../../package.json'),
    join(app.getAppPath(), 'package.json'),
  ]);
  const aboutInfo = {
    version: productInfo.version,
    author: productInfo.author,
    repoUrl: productInfo.repoUrl,
    buildId: readBuildId(resolveFromHere('../../../daemon/dist/BUILD_ID')),
    licenseText: readLicenseText([
      resolveFromHere('../../../../LICENSE'),
      join(app.getAppPath(), 'LICENSE'),
      join(process.resourcesPath, 'LICENSE'),
    ]),
    thirdParty: readThirdPartyLicences([
      resolveFromHere('../third-party-licenses.json'),
      join(app.getAppPath(), 'packages/ui/dist/third-party-licenses.json'),
    ]),
  };
  ipcMain.handle('throng:about:get', () => aboutInfo);
  // The licence link opens in the user's default browser — no in-app navigation, so
  // the sandboxed About window is never replaced by a view of gnu.org (https only).
  ipcMain.on('throng:openExternal', (_event, url: unknown) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  // The application menu is set NOW (early), but the main window is created further
  // below, so the About window's parent is resolved through a nullable ref rather
  // than the later `const mainWindow` — the menu is clickable before that const is
  // initialised, and reading it then is a temporal-dead-zone crash. The ref is
  // assigned the moment the main window exists (see below); until then About opens
  // unparented, which is harmless.
  const aboutDeps: AboutWindowDeps = {
    indexHtml: resolveFromHere('../renderer/index.html'),
    preloadPath: resolveFromHere('../preload/preload.cjs'),
    getMainWindow: () =>
      mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null,
  };
  Menu.setApplicationMenu(buildAppMenu(() => openAbout(aboutDeps)));
  // The DISCOVERABLE entry point (020, FR-003): the cog menu's "About throng" item.
  // throng draws its own title bar (`frame: false`), so the native application menu
  // above never renders on screen — the cog is where users actually reach About.
  ipcMain.on('throng:about:open', () => openAbout(aboutDeps));

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

  // Native folder picker for a project's root folder (FR-034). Opens at the
  // caller's requested `defaultPath` when it resolves to a real directory, else at
  // the user's profile/home folder (011, FR-043). Returns the chosen absolute path,
  // or null if the dialog was cancelled.
  ipcMain.handle(
    'throng:pickFolder',
    async (event, opts?: { defaultPath?: string | string[] }): Promise<string | null> => {
      const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const defaultPath = resolvePickerDefaultPath(
        opts?.defaultPath,
        app.getPath('home'),
        (p) => existsSync(p) && statSync(p).isDirectory(),
      );
      const result = owner
        ? await dialog.showOpenDialog(owner, { properties: ['openDirectory'], defaultPath })
        : await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath });
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    },
  );

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
    // FR-027c. Read at write time, from the LIVE settings — turning it off must take effect on the
    // very next snapshot, not on the next restart.
    persistUndoHistory: () => currentSettings.editor.persistUndoHistory,
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
  /**
   * FR-027c: turning `persistUndoHistory` OFF purges what is ALREADY on disk.
   *
   * At the moment it is turned off — not at the next keystroke. Waiting for the next snapshot to
   * overwrite each file would leave the user's cut text lying there for as long as they left the
   * document alone, and someone who has just turned this off because they cut a secret into a file
   * is the last person who should have to keep typing to be rid of it.
   */
  onSettingsChanged.push((previous, next) => {
    if (previous.editor.persistUndoHistory && !next.editor.persistUndoHistory) {
      void editorCoordinator.purgePersistedHistories();
    }
  });
  /**
   * …and again at STARTUP, if the setting is already off.
   *
   * The subscriber above only fires on the true → false TRANSITION, which the app can easily never
   * see: the user turns it off and quits; or edits settings.json while throng is closed; or throng
   * dies before the purge lands. In every one of those cases the histories sitting on disk — holding
   * whatever the user cut out of their files — would survive indefinitely, waiting for the panel to
   * be edited again. A setting that means "do not keep my deleted text on disk" has to be true of
   * the disk as it is found, not only of the moment it was changed.
   */
  if (!currentSettings.editor.persistUndoHistory) {
    void editorCoordinator.purgePersistedHistories();
  }
  registerEditorIpc(editorCoordinator, {
    // MAIN's own view of which projects exist, straight from the daemon that owns them (018 / US9).
    // The renderer no longer supplies the roots that parameterise its own confinement check — it asks
    // about a file, and main decides against facts the renderer cannot author.
    listProjects: async () => {
      const result = await daemonClient.call<{ projects: { id: string; rootFolder: string }[] }>(
        'projects.list',
        {},
      );
      return result.projects.map((p) => ({ id: p.id, rootFolder: p.rootFolder }));
    },
  });
  // The OS clipboard, behind the seam (016, FR-013a) — one app-global record of what throng last
  // copied and what SHAPE it was, so a block cut in one window pastes as a block in another.
  registerClipboardIpc(container.get<ClipboardService>(UI_TYPES.ClipboardService));
  // Deleting a file that is open in an editor marks that editor dirty (FR-099): the
  // buffer survives so the user can save it back (re-creating the file) or discard.
  filesService.setOnDeleted((absPaths) => editorCoordinator.markDeleted(absPaths));
  // Moving one that is open re-points it instead (019, #87): the move is BRACKETED — announced
  // before the first `fs.move` and again after the last — so the folder watch can never read the
  // file's absence as a deletion and dirty a buffer nobody edited.
  filesService.setOnMoveStarted((absPaths) => editorCoordinator.beginMove(absPaths));
  filesService.setOnMoved((moves) => editorCoordinator.markMoved(moves));

  // Terminal flavours (005 Phase B): UI main owns shell detection (inline, like
  // the FS seams above), merging the machine's built-ins with settings.terminals.
  // The sandboxed renderer reaches it only through this channel (no daemon).
  const shellDetectionService = createShellDetectionService({
    detection: new WindowsShellDetection(),
    configStore,
  });
  ipcMain.handle('throng:terminal:listFlavours', () => shellDetectionService.listFlavours());
  // The RAW detected built-ins — what this machine HAS, not what it will offer to launch (019,
  // C10). The settings editor's picker is built from this; the panel's Flavour dropdown never is.
  ipcMain.handle('throng:terminal:listDetectedFlavours', () =>
    shellDetectionService.listDetectedFlavours(),
  );

  // Live terminals (005 Phase C): the renderer's terminal.* commands route to the
  // daemon (UI main resolves the launch spec); daemon output/exit notifications
  // arrive over a long-lived events socket and are forwarded to every window.
  registerTerminalIpc({
    daemonClient,
    shellDetection: shellDetectionService,
    attachTimeoutMs: settings.attachTimeoutMs,
    // Through the seam (016, FR-013a) — never Electron's clipboard module directly.
    clipboard: container.get<IClipboard>(UI_TYPES.Clipboard),
  });
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
  // Now the main window exists, the About menu can parent to it (see the nullable
  // ref above — set here so a menu click before this point opens About unparented
  // rather than crashing on the not-yet-initialised `const mainWindow`).
  mainWindowRef = mainWindow;

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
  // ── The shutdown drain (019 / FR-010, issue #86) ──────────────────────────────────────
  //
  // Ask EVERY window to settle its deferred writes, and AWAIT the acks before allowing the
  // close. The layout blob — split structure AND per-panel zoom — rides a 400ms debounce, and
  // the ordinary close fired on a 250ms timer, so a decision the user had just watched the app
  // accept died with the renderer. Terminate All survived only because its prompt detained the
  // user past the debounce.
  //
  // Correctness must not depend on how long a dialog detains someone, so the close now waits
  // on the ACK, not on a clock. Widening the 250ms timer past the debounce would preserve the
  // bug's shape and merely widen the accident; FR-011 refuses it explicitly.
  //
  // The drain NAMES NO WINDOWS — it asks `getAllWindows()`, exactly as `relaySync` does.
  // Sub-workspace windows carry their own layout writes on the same close-all cascade (C6);
  // the preferences window carries config writes and is Electron-parented rather than in the
  // cascade at all; and the workspace window itself writes config too. Every enumeration
  // anyone attempted omitted one of them, so this asks the list instead of reciting it.
  //
  // What the list is filtered on is CAN THIS WINDOW ANSWER — not what kind of window it is.
  // `getAllWindows()` also returns the drag ghost: a real BrowserWindow with NO PRELOAD,
  // loaded from a `data:` URL and merely HIDDEN on drop, so it lives for the rest of the
  // session. It has no `window.throng`, never registers the drain handler, and can never ack —
  // asking it cost EVERY subsequent close the full budget, and a session containing one drag
  // is the ordinary session. The cure is not a list of window kinds (C23 refuses that: every
  // such list omitted somebody) and not a wider timer (FR-011 refuses that): a window is
  // drained iff its renderer TOLD US it is listening (`drainableWindows`, populated at module
  // scope). A window that has not said so has no drain handler, and therefore no deferred write,
  // to settle — the announcement is sent when the handler is registered, at the renderer's entry
  // point, before React mounts and so before any write can be scheduled. Ordering, not timing.
  const drainAllWindows = async (): Promise<void> => {
    const windows = BrowserWindow.getAllWindows().filter(
      (w) => !w.isDestroyed() && drainableWindows.has(w.webContents.id),
    );
    await Promise.all(
      windows.map(
        (win) =>
          new Promise<void>((resolve) => {
            const requestId = randomUUID();
            let settled = false;
            const done = (why?: string): void => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              ipcMain.removeListener('throng:appClose:drained', onAck);
              // …and the same for the death-watch below, whichever of the two fired first. (It
              // is `once`, so a window that DIED has already dropped it — and its webContents
              // must not be touched afterwards.)
              if (!win.isDestroyed()) win.webContents.removeListener('destroyed', onDestroyed);
              if (why) console.warn(`[throng] app-close: drain ${why}`);
              resolve();
            };
            // Correlated by `requestId`: a stale ack from an earlier drain cannot satisfy
            // this one.
            const onAck = (_event: unknown, req: unknown): void => {
              if ((req as { requestId?: string })?.requestId === requestId) done();
            };
            const onDestroyed = (): void => done();
            // A BACKSTOP, never the mechanism: a wedged or crashed renderer must not hold the
            // app open forever. A lapsed budget logs and closes anyway.
            const timer = setTimeout(
              () => done(`budget lapsed after ${settings.shutdownDrainTimeoutMs}ms — closing anyway`),
              settings.shutdownDrainTimeoutMs,
            );
            ipcMain.on('throng:appClose:drained', onAck);
            // A window that died mid-drain owes nothing: skip it rather than wait out its budget.
            win.webContents.once('destroyed', onDestroyed);
            if (win.isDestroyed()) {
              done();
              return;
            }
            win.webContents.send('throng:appClose:drain', { requestId });
          }),
      ),
    );
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
        // THE EXIT THAT LOST THE WRITE (#86): no prompt to stall on, so nothing here ever
        // outlived the 400ms debounce. Drain first, and only then allow the close.
        await drainAllWindows();
        allowClose = true;
        // The 250ms beat REMAINS, and is no longer a correctness device: it lets the
        // "Closing throng…" overlay paint. The close waits on the drain above, not on it.
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
      // BOTH exits drain — 'terminate' and 'leave' alike. These are the paths that survive
      // by ACCIDENT today, the prompt having detained the user past the debounce, and a fix
      // that drained only the broken exit would leave the two halves disagreeing on how long
      // a dialog must be read for. They agree by construction now.
      await drainAllWindows();
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
