/**
 * The Help window (080 FR-048 to FR-052): one throng window showing the guide shipped with the app.
 *
 * ══ ONE WINDOW, BROUGHT FORWARD, NEVER ON TOP ══
 *
 * F1, the cog menu's Help and every (?) call {@link openHelpWindow} with a guide URL. With no window it is created;
 * with one, the page is loaded into it and it is brought to the front (restored, shown, focused). It is never
 * `alwaysOnTop` and has no parent, so it drops behind any window the user clicks. Its bounds are remembered for the
 * session. (GNOME on Wayland may refuse to raise an existing window and show a "ready" notice instead.)
 *
 * ══ TWO DOCUMENTS ══
 *
 * The window loads throng's own renderer (`index.html?help=1`: the title bar and a toolbar of icon buttons) and hosts
 * the guide in a `WebContentsView` below the toolbar. The view has no preload and no Node, is sandboxed, and lives on
 * its own session partition: only that session handles `throng-help:` (read-only, the bundle only, a CSP allowing
 * nothing remote), and its request filter cancels anything else. 044's navigation guard is lifted for the view alone
 * (`exemptFromNavigationGuard`): its own navigation is decided by core's {@link decideHelpNavigation} instead — the
 * guide stays, everything else opens in the OS browser or is refused.
 *
 * ══ BACK, FORWARD, OPEN IN BROWSER (FR-051) ══
 *
 * The toolbar's buttons reach here over IPC, from the Help window's own document only; Alt+Left / Alt+Right arrive
 * through the view's `before-input-event`, and the mouse's back and forward buttons are handled by the guide's own
 * script (`site/assets/site.js`, only under `throng-help:`). Open in browser opens the same page on the website.
 */
import { BrowserWindow, WebContentsView, ipcMain, screen, session, type IpcMainEvent, type Session } from 'electron';
import { HELP_APP_BASE_URL, decideHelpNavigation, logExpected, websiteUrlFor, type IShellIntegration } from '@throng/core';
import { appIcon } from './app-icon.js';
import { HELP_SCHEME, createHelpProtocolHandler } from './help-protocol.js';
import { openFromWindow } from './link-prompt.js';
import { exemptFromNavigationGuard } from './renderer-request-filter.js';
import { revealWhenPainted } from './reveal-when-painted.js';
import { wireWindowMaximizeEvents } from './window-controls-ipc.js';
import type { SecondaryWindowChrome } from './window-chrome.js';
import { denyRendererWindows } from './window-open-guard.js';
import { placeOverParent } from './window-placement.js';
import { historyStepFor, viewBoundsFor, type HelpViewState } from './help-window-model.js';
import { visibleBounds } from './resource-monitor-window.js';

/** The Help view's session partition: in memory, so the guide leaves nothing on disk. */
export const HELP_PARTITION = 'help';

export interface HelpWindowDeps {
  /** The renderer's index.html (loaded with `?help=1`). */
  readonly indexHtml: string;
  /** The sandboxed preload the toolbar's document uses. */
  readonly preloadPath: string;
  /** The shipped guide's folder (`packages/ui/dist/help`). */
  readonly bundleRoot: string;
  /** FR-065 — the website links leave for: throng-ide.com when packaged, the local preview otherwise. */
  readonly websiteRoot: string;
  /** The OS open-external seam: links that leave the guide, and Open in browser. */
  readonly shellIntegration: IShellIntegration;
  readonly log: (line: string) => void;
  readonly backgroundColor?: () => string;
  readonly getMainWindow?: () => BrowserWindow | null;
  readonly chrome?: () => SecondaryWindowChrome;
}

let helpWindow: BrowserWindow | null = null;
let helpView: WebContentsView | null = null;
let helpSession: Session | null = null;
let lastBounds: Electron.Rectangle | null = null;
let toolbarTop = 72;
let ipcWired = false;

function prepareSession(deps: HelpWindowDeps): Session {
  if (helpSession) return helpSession;
  const s = session.fromPartition(HELP_PARTITION);
  s.protocol.handle(HELP_SCHEME, createHelpProtocolHandler({ root: deps.bundleRoot, log: deps.log, websiteRoot: deps.websiteRoot }));
  // Nothing but the shipped guide is ever fetched from this session.
  s.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(details.url.startsWith(`${HELP_SCHEME}:`) || details.url.startsWith('devtools:')) });
  });
  s.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  helpSession = s;
  return s;
}

/** A link leaving the guide: its prompt (FR-070) asks the Help window, where it was followed. */
function openOutside(deps: HelpWindowDeps, url: string): void {
  void openFromWindow(helpWindow, () => deps.shellIntegration.openExternal(url));
}

function sendState(): void {
  if (!helpWindow || helpWindow.isDestroyed() || !helpView) return;
  const contents = helpView.webContents;
  const state: HelpViewState = {
    title: contents.getTitle(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  };
  helpWindow.webContents.send('throng:help:state', state);
}

function step(direction: 'back' | 'forward'): void {
  const history = helpView?.webContents.navigationHistory;
  if (!history) return;
  if (direction === 'back' && history.canGoBack()) history.goBack();
  if (direction === 'forward' && history.canGoForward()) history.goForward();
}

function layout(): void {
  if (!helpWindow || helpWindow.isDestroyed() || !helpView) return;
  const [width, height] = helpWindow.getContentSize();
  helpView.setBounds(viewBoundsFor({ width: width ?? 0, height: height ?? 0 }, toolbarTop));
}

/** Only the Help window's own document drives it; any other window's message is ignored. */
const fromHelpWindow = (event: IpcMainEvent): boolean =>
  helpWindow !== null && !helpWindow.isDestroyed() && event.sender === helpWindow.webContents;

/** Load `url` into the guide view. A load cut short by the next one (a second "?" mid-load) is expected. */
function show(contents: Electron.WebContents, url: string): void {
  contents.loadURL(url).catch((error: unknown) => {
    logExpected('help-window: load', 'a guide page load is aborted when the next Help request replaces it', error);
  });
}

function wireIpc(deps: HelpWindowDeps): void {
  if (ipcWired) return;
  ipcWired = true;
  ipcMain.on('throng:help:back', (event) => {
    if (fromHelpWindow(event)) step('back');
  });
  ipcMain.on('throng:help:forward', (event) => {
    if (fromHelpWindow(event)) step('forward');
  });
  ipcMain.on('throng:help:openInBrowser', (event) => {
    if (!fromHelpWindow(event)) return;
    const website = helpView ? websiteUrlFor(helpView.webContents.getURL(), deps.websiteRoot) : undefined;
    if (website) openOutside(deps, website);
  });
  ipcMain.on('throng:help:layout', (event, top: unknown) => {
    if (fromHelpWindow(event) && typeof top === 'number' && Number.isFinite(top)) {
      toolbarTop = top;
      layout();
    }
  });
  ipcMain.on('throng:help:ready', (event) => {
    if (fromHelpWindow(event)) sendState();
  });
}

function createView(deps: HelpWindowDeps, win: BrowserWindow): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      session: prepareSession(deps),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  const contents = view.webContents;
  exemptFromNavigationGuard(contents);
  contents.on('will-navigate', (event) => {
    const decision = decideHelpNavigation(event.url, deps.websiteRoot);
    if (decision.kind === 'stay') return;
    event.preventDefault();
    if (decision.kind === 'external') openOutside(deps, decision.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideHelpNavigation(url, deps.websiteRoot);
    if (decision.kind !== 'refuse') openOutside(deps, decision.kind === 'external' ? decision.url : (websiteUrlFor(url, deps.websiteRoot) ?? url));
    return { action: 'deny' };
  });
  contents.on('before-input-event', (event, input) => {
    const direction = historyStepFor(input);
    if (direction) {
      event.preventDefault();
      step(direction);
    }
  });
  for (const name of ['did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const) {
    contents.on(name as 'did-navigate', () => sendState());
  }
  win.contentView.addChildView(view);
  return view;
}

/** FR-048 — show `url` (a guide URL under {@link HELP_APP_BASE_URL}) in the one Help window. */
export function openHelpWindow(deps: HelpWindowDeps, url: string = HELP_APP_BASE_URL): BrowserWindow {
  const target = decideHelpNavigation(url).kind === 'stay' ? url : HELP_APP_BASE_URL;
  wireIpc(deps);
  if (helpWindow && !helpWindow.isDestroyed() && helpView) {
    show(helpView.webContents, target);
    if (helpWindow.isMinimized()) helpWindow.restore();
    helpWindow.show();
    helpWindow.moveTop();
    helpWindow.focus();
    return helpWindow;
  }

  const main = deps.getMainWindow?.() ?? null;
  const size = { width: 1100, height: 820 };
  // Where it was last closed this session, unless that is no longer on any screen (as the Resource Monitor does).
  const remembered = lastBounds && visibleBounds(lastBounds, screen.getAllDisplays().map((d) => d.workArea));
  const win = new BrowserWindow({
    ...(remembered ?? { ...size, ...placeOverParent(main && !main.isDestroyed() ? main : undefined, size) }),
    ...(deps.chrome?.() ?? { frame: false }),
    minWidth: 480,
    minHeight: 360,
    title: 'Help — throng',
    icon: appIcon(),
    backgroundColor: deps.backgroundColor?.() ?? '#10131a',
    show: false,
    webPreferences: { preload: deps.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  helpWindow = win;
  wireWindowMaximizeEvents(win);
  denyRendererWindows(win.webContents, deps.shellIntegration);
  revealWhenPainted(win);
  helpView = createView(deps, win);
  win.on('resize', layout);
  win.on('close', () => {
    lastBounds = win.getNormalBounds();
  });
  win.on('closed', () => {
    helpWindow = null;
    helpView = null;
  });
  layout();
  win.loadFile(deps.indexHtml, { query: { help: '1' } }).catch((error: unknown) => {
    deps.log(`help-window: the Help window's toolbar did not load: ${String(error)}`);
  });
  show(helpView.webContents, target);
  return win;
}

/** FR-054 — close the Help window, if open. The main window calls this as it closes: it is the master of every
 *  window throng opens, and the Help window, being unparented so it is never kept on top, is not closed for free. */
/**
 * 080 FR-070 — ready the Help window for a dialog over all of it. Its guide is a separate view drawn over its own
 * page, so a dialog on that page would sit under the guide: the view is swapped for a still of itself until the
 * returned undo runs. Any other window needs nothing.
 */
export async function coverHelpGuide(win: BrowserWindow): Promise<() => void> {
  const view = helpView;
  if (win !== helpWindow || win.isDestroyed() || !view) return () => undefined;
  const still = await view.webContents.capturePage().catch((error: unknown) => {
    logExpected('help-window: capture the guide', 'without a still the dialog shows over the toolbar page alone', error);
    return null;
  });
  if (win.isDestroyed()) return () => undefined;
  win.webContents.send('throng:help:cover', still ? new Uint8Array(still.toPNG()) : null);
  view.setVisible(false);
  win.webContents.focus();
  return () => {
    if (helpView === view && !win.isDestroyed()) {
      view.setVisible(true);
      win.webContents.send('throng:help:cover', null);
    }
  };
}

export function closeHelpWindow(): void {
  if (helpWindow && !helpWindow.isDestroyed()) helpWindow.close();
}

/** Whether the Help window is open. */
export function isHelpWindowOpen(): boolean {
  return helpWindow !== null && !helpWindow.isDestroyed();
}
