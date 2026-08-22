// Sandboxed preload (CommonJS — emitted as preload.cjs). Runs in the isolated
// world and is the only bridge between the Electron main process and the
// renderer (Principle: clean sandbox boundary). Exposes the daemon health.ping
// outcome to the landing page (US3, T030).
import { contextBridge, ipcRenderer, webUtils } from 'electron';

/**
 * Theme bootstrap (issue 132) — kill the flash of the default theme.
 *
 * The renderer reads the saved theme asynchronously over config IPC AFTER React
 * mounts, so every window/modal painted its first frame in the built-in default
 * theme and then swapped — a visible flash on the main window, sub-workspace
 * windows, the preferences editor and every modal. The preload runs in the
 * renderer's context BEFORE its scripts and before first paint, so here we pull the
 * active theme SYNCHRONOUSLY from main and apply it to `<html>` — CSS custom
 * properties (allowed by the page CSP's `style-src 'unsafe-inline'`) plus the
 * `data-theme` attribute — so the very first frame is already the saved theme. The
 * renderer's ThemeProvider re-applies the same values on mount (a no-op visually)
 * and keeps handling hot-reload. An inline `<script>` could not do this: the CSP is
 * `script-src 'self'`, which blocks inline scripts — the preload is the only
 * pre-paint hook available.
 */
function applyBootstrapTheme(): void {
  let boot: { name?: unknown; vars?: unknown; colorScheme?: unknown } | undefined;
  try {
    boot = ipcRenderer.sendSync('throng:theme:bootstrap') as typeof boot;
  } catch {
    // Main not ready or no handler — the renderer still themes itself on mount; only
    // the pre-paint guard is lost, so we degrade to the old behaviour rather than crash.
    return;
  }
  if (!boot || typeof boot !== 'object') return;
  const vars = boot.vars;
  const name = boot.name;
  const colorScheme = boot.colorScheme;

  const paint = (): boolean => {
    const root = document.documentElement;
    if (!root) return false;
    if (vars && typeof vars === 'object') {
      for (const [prop, value] of Object.entries(vars as Record<string, string>)) {
        if (typeof value === 'string') root.style.setProperty(prop, value);
      }
    }
    if (typeof name === 'string') root.dataset.theme = name;
    // The document's colour-scheme, from the SAVED theme's lightness (issue 132). Set inline so it
    // overrides the stylesheet's fallback BEFORE first paint — otherwise Chromium paints its viewport
    // canvas backdrop dark on a light theme (over the native background), which is the flash of black
    // that the token paint + themed native background alone never removed.
    if (colorScheme === 'light' || colorScheme === 'dark') root.style.colorScheme = colorScheme;
    return true;
  };

  // `document.documentElement` exists this early in an Electron renderer, but if the
  // document is somehow not ready yet, apply as soon as it is (still before paint).
  if (!paint()) document.addEventListener('DOMContentLoaded', paint, { once: true });
}

applyBootstrapTheme();

contextBridge.exposeInMainWorld('throng', {
  // The host OS family, so the renderer can render paths with native separators
  // (FR-101) — Windows uses '\\', everything else '/'.
  osName: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  getDaemonStatus: () => ipcRenderer.invoke('throng:getDaemonStatus'),
  /*
   * 029 / #182 — daemon liveness, PUSHED.
   *
   * `getDaemonStatus` above is a one-shot pull, and it had no consumer at all: nothing ever asked,
   * so nothing ever noticed. Detection has to arrive without the user doing anything (FR-006), which
   * a pull cannot provide.
   */
  /*
   * 030 FR-006 — every notice reaches the diagnostic log, whatever the user chose to SEE.
   *
   * One-way and fire-and-forget by design (`send`, not `invoke`): there is no reply, no promise and
   * no error handed back. A diagnostics write that failed must never become a user-facing failure,
   * which would be a notice that raises a notice because it could not log the first one.
   *
   * The record arrives already composed by `noticeLogRecord()` in core — the level derived from the
   * severity and the subject formatted — because main applies no policy of its own; it writes what
   * it is given, at a level the threshold is not allowed to filter (FR-006b).
   */
  notices: {
    log: (record: unknown) => ipcRenderer.send('throng:notices:log', record),
  },
  /** 029 FR-013 — panel id -> what a user calls it, so main can NAME a throng lock holder. */
  panels: {
    publishIdentities: (list: unknown) => ipcRenderer.send('throng:panels:identities', list),
  },
  daemon: {
    state: () => ipcRenderer.invoke('throng:daemon:state'),
    restart: () => ipcRenderer.invoke('throng:daemon:restart'),
    onState: (cb: (s: unknown) => void) => {
      const h = (_e: unknown, s: unknown): void => cb(s);
      ipcRenderer.on('throng:daemon:state', h);
      return () => ipcRenderer.removeListener('throng:daemon:state', h);
    },
  },
  // Generic JSON-RPC bridge to the daemon (projects.* / workspace.*). Returns a
  // tagged { ok, result } | { ok, error } envelope; the renderer's typed clients
  // unwrap it (002 / research D10).
  invoke: (method: string, params: unknown) => ipcRenderer.invoke('throng:rpc', method, params),
  // Native folder picker for a project's root folder (FR-034). Optionally opens at
  // a requested start folder (011, FR-040/043).
  pickFolder: (opts?: { defaultPath?: string | string[] }) =>
    ipcRenderer.invoke('throng:pickFolder', opts),
  // Set the window title to a workspace summary (FR-040).
  setTitle: (title: string) => ipcRenderer.send('throng:setTitle', title),
  // Mouse-driven zoom: the renderer can't reach webContents from the sandbox,
  // so it relays Ctrl+wheel / Ctrl+middle-click to the main process.
  zoomBy: (steps: number) => ipcRenderer.send('throng:zoomBy', steps),
  zoomReset: () => ipcRenderer.send('throng:zoomReset'),
  // Toggle fullscreen for the sending window (keybinding action, FR-033).
  fullscreenToggle: () => ipcRenderer.send('throng:fullscreenToggle'),
  // App-close with running terminals (005 / FR-015): main asks the renderer to
  // show the three-choice warning; the renderer sends back the chosen action.
  onAppCloseBegin: (cb: () => void) => {
    const handler = (): void => cb();
    ipcRenderer.on('throng:appClose:begin', handler);
    return () => ipcRenderer.removeListener('throng:appClose:begin', handler);
  },
  onAppClosePrompt: (cb: (info: unknown) => void) => {
    const handler = (_event: unknown, info: unknown): void => cb(info);
    ipcRenderer.on('throng:appClose:prompt', handler);
    return () => ipcRenderer.removeListener('throng:appClose:prompt', handler);
  },
  onAppCloseClosing: (cb: (info: { message: string }) => void) => {
    const handler = (_event: unknown, info: { message: string }): void => cb(info);
    ipcRenderer.on('throng:appClose:closing', handler);
    return () => ipcRenderer.removeListener('throng:appClose:closing', handler);
  },
  appCloseChoice: (choice: 'leave' | 'terminate' | 'cancel') =>
    ipcRenderer.send('throng:appClose:choice', choice),
  // The shutdown drain (019 / FR-010, issue #86): before allowing the close, main asks each
  // window to settle its deferred writes and AWAITS the ack. Correlated by `requestId` so a
  // stale ack cannot satisfy a later drain.
  onAppCloseDrain: (cb: (req: { requestId: string }) => void) => {
    const handler = (_event: unknown, req: { requestId: string }): void => cb(req);
    ipcRenderer.on('throng:appClose:drain', handler);
    // Announce that this window CAN answer, at the only moment that is true: a listener now
    // exists. Main drains the windows that said this and no others — a window with no preload
    // (the drag ghost) or one whose script has not evaluated yet never says it, and so is never
    // waited on. This is what keeps `getAllWindows()` honest without reciting window kinds.
    ipcRenderer.send('throng:appClose:drainReady');
    return () => ipcRenderer.removeListener('throng:appClose:drain', handler);
  },
  appCloseDrained: (req: { requestId: string }) =>
    ipcRenderer.send('throng:appClose:drained', req),
  // Cursor-following drag ghost as an OS window (FR-001): start on drag begin,
  // stop on drop. The main process tracks the cursor and positions the window.
  dragGhost: {
    start: (kind: 'panel' | 'tab', title: string) =>
      ipcRenderer.send('throng:ghost:start', { kind, title }),
    move: () => ipcRenderer.send('throng:ghost:tick'),
    // Show/hide a drop-target hint on the ghost (empty string hides it). `warn`
    // styles it red for an invalid drop (e.g. a sub-workspace-owned panel dragged
    // out of its window — FR-030).
    hint: (text: string, warn = false) => ipcRenderer.send('throng:ghost:hint', { text, warn }),
    stop: () => ipcRenderer.send('throng:ghost:stop'),
  },
  // Detached sub-workspace windows (US7). The main process owns multi-window
  // creation + the focus group; `changed` is a cross-window content-sync signal so
  // an open sub-workspace window re-reads after another window edits it.
  subWorkspace: {
    open: (id: string) => ipcRenderer.send('throng:subworkspace:open', id),
    // Which sub-workspace window (if any) is under the cursor right now — used to
    // resolve a drag that drops onto another window. Returns the id or null.
    atPoint: (): Promise<string | null> => ipcRenderer.invoke('throng:subworkspace:atPoint'),
    // Close the window for a sub-workspace (e.g. when it is deleted).
    close: (id: string) => ipcRenderer.send('throng:subworkspace:close', id),
    // Tell every window a sub-workspace's content changed (added-to / edited).
    notifyChanged: (id: string) => ipcRenderer.send('throng:subworkspace:changed', id),
    // Subscribe to those change pushes; returns an unsubscribe function.
    onChanged: (cb: (id: string) => void) => {
      const handler = (_event: unknown, id: string): void => cb(id);
      ipcRenderer.on('throng:subworkspace:changed:push', handler);
      return () => ipcRenderer.removeListener('throng:subworkspace:changed:push', handler);
    },
    /*
     * An open that could not complete (#287).
     *
     * `open` is fire-and-forget — `send`, not `invoke` — so before this there was no way for the
     * renderer to learn that a request had failed, even in principle. A throw in the main-side path
     * left the user with no window, no error and a button that appeared inert.
     */
    onOpenFailed: (cb: (failure: { id: string; reason: string }) => void) => {
      const handler = (_event: unknown, failure: { id: string; reason: string }): void =>
        cb(failure);
      ipcRenderer.on('throng:subworkspace:openFailed', handler);
      return () => ipcRenderer.removeListener('throng:subworkspace:openFailed', handler);
    },
  },
  // Cross-window projects sync: notify every window a project changed (create /
  // rename / recolour / delete), so their projects lists refresh live.
  projects: {
    notifyChanged: (): void => ipcRenderer.send('throng:projects:changed'),
    onChanged: (cb: () => void) => {
      const handler = (): void => cb();
      ipcRenderer.on('throng:projects:changed:push', handler);
      return () => ipcRenderer.removeListener('throng:projects:changed:push', handler);
    },
  },
  // Cross-window Panel identity sync (003): renaming a Panel in one window renames
  // the same Panel (by id) everywhere it appears — project + sub-workspaces.
  panel: {
    notifyRenamed: (id: string, title: string) =>
      ipcRenderer.send('throng:panel:rename', { id, title }),
    onRenamed: (cb: (id: string, title: string) => void) => {
      const handler = (_event: unknown, p: { id: string; title: string }): void => cb(p.id, p.title);
      ipcRenderer.on('throng:panel:renamed', handler);
      return () => ipcRenderer.removeListener('throng:panel:renamed', handler);
    },
    // The same Panel, a DIFFERENT act (#184/#218): throng moved the name because it clashed with a
    // panel elsewhere in the application. Every window must show the new name, and NO window may
    // record it as the user's choice — hence its own channel rather than a flag on the rename.
    notifyRetitled: (id: string, title: string) =>
      ipcRenderer.send('throng:panel:retitle', { id, title }),
    onRetitled: (cb: (id: string, title: string) => void) => {
      const handler = (_event: unknown, p: { id: string; title: string }): void => cb(p.id, p.title);
      ipcRenderer.on('throng:panel:retitled', handler);
      return () => ipcRenderer.removeListener('throng:panel:retitled', handler);
    },
    // A Panel was destroyed in one window; tell every window so the same Panel
    // (by id) is removed everywhere it appears — project + sub-workspaces (FR-026).
    notifyDestroyed: (id: string) => ipcRenderer.send('throng:panel:destroy', { id }),
    onDestroyed: (cb: (id: string) => void) => {
      const handler = (_event: unknown, p: { id: string }): void => cb(p.id);
      ipcRenderer.on('throng:panel:destroyed', handler);
      return () => ipcRenderer.removeListener('throng:panel:destroyed', handler);
    },
    // A Panel's type-selection FORM draft changed (live sync across windows): the
    // same untyped Panel's form mirrors its selected type + inputs everywhere.
    notifyDraft: (id: string, draft: unknown) => ipcRenderer.send('throng:panel:draft', { id, draft }),
    onDraft: (cb: (id: string, draft: unknown) => void) => {
      const handler = (_event: unknown, p: { id: string; draft: unknown }): void => cb(p.id, p.draft);
      ipcRenderer.on('throng:panel:drafted', handler);
      return () => ipcRenderer.removeListener('throng:panel:drafted', handler);
    },
    // A Panel was CONFIRMED as a type in one window; every window applies the same
    // kind+config so its clone leaves the form and shows the typed body.
    notifyTyped: (id: string, kind: string, config: unknown) =>
      ipcRenderer.send('throng:panel:type', { id, kind, config }),
    onTyped: (cb: (id: string, kind: string, config: unknown) => void) => {
      const handler = (_event: unknown, p: { id: string; kind: string; config: unknown }): void =>
        cb(p.id, p.kind, p.config);
      ipcRenderer.on('throng:panel:typed', handler);
      return () => ipcRenderer.removeListener('throng:panel:typed', handler);
    },
    // NB: the active/selected Panel is deliberately NOT relayed (revised
    // 2026-07-02) — selection/focus is window-local.
  },
  // Custom title bar window controls (007): the frameless windows draw their own
  // min/max/close; these relay to the sender's BrowserWindow (FR-002/004).
  window: {
    minimize: () => ipcRenderer.send('throng:window:minimize'),
    maximize: () => ipcRenderer.send('throng:window:maximize'),
    close: () => ipcRenderer.send('throng:window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('throng:window:isMaximized'),
    onMaximizeChange: (cb: (maximized: boolean) => void) => {
      const handler = (_event: unknown, maximized: boolean): void => cb(maximized);
      ipcRenderer.on('throng:window:maximizeChanged', handler);
      return () => ipcRenderer.removeListener('throng:window:maximizeChanged', handler);
    },
  },
  // Cog → preferences (007, main window only): create-or-focus the single shared
  // preferences window on the chosen tab (FR-005/008/009/010).
  openPreferences: (tab: 'settings' | 'keybindings' | 'themes') =>
    ipcRenderer.send('throng:preferences:open', tab),
  // The preferences renderer subscribes to tab switches when the window is reused.
  onPreferencesTab: (cb: (tab: 'settings' | 'keybindings' | 'themes') => void) => {
    const handler = (_event: unknown, tab: 'settings' | 'keybindings' | 'themes'): void => cb(tab);
    ipcRenderer.on('throng:preferences:tab', handler);
    return () => ipcRenderer.removeListener('throng:preferences:tab', handler);
  },
  /*
   * The close gate (032, FR-018). Main asks before it closes the preferences window; the renderer
   * answers `false` only while the JSON editor holds a document that is not valid, and shows the
   * user why — with a *Discard changes and close* escape, so the window is never a trap.
   *
   * Gated in MAIN rather than on the close button because Alt+F4, the taskbar and every internal
   * teardown path reach `win.close()` without passing through any React handler.
   */
  onPreferencesCloseRequest: (cb: (payload: { requestId: number }) => void) => {
    const handler = (_event: unknown, payload: { requestId: number }): void => cb(payload);
    ipcRenderer.on('throng:preferences:closeRequest', handler);
    return () => ipcRenderer.removeListener('throng:preferences:closeRequest', handler);
  },
  replyPreferencesClose: (payload: { requestId: number; allow: boolean }) =>
    ipcRenderer.send('throng:preferences:closeReply', payload),
  // About throng (020, FR-003/FR-003a): the About surface pulls the product version,
  // build id and full licence text from main (never hardcoded in the renderer), and
  // opens the licence link in the user's default browser.
  // #123 — open the folder holding throng's logs and crash reports in the OS file manager.
  diagnostics: {
    openLogs: (): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('throng:diagnostics:openLogs'),
  },
  about: {
    // Cog → About throng (020, FR-003): create-or-focus the single shared, app-modal
    // About window. This is the discoverable entry point — throng draws its own title
    // bar (`frame: false`), so the native application menu never renders on screen.
    open: () => ipcRenderer.send('throng:about:open'),
    // US4 (#139): the STATIC identity — fast, paints the dialog immediately. The third-party
    // packages list is fetched separately via getThirdParty() so the dialog never blocks on it.
    get: (): Promise<{
      version: string;
      author: string;
      repoUrl: string;
      buildId: string;
      licenseText: string;
    }> => ipcRenderer.invoke('throng:about:get'),
    getThirdParty: (): Promise<
      Array<{
        name: string;
        version: string;
        license: string;
        licenseUrl: string;
        projectUrl: string;
      }>
    > => ipcRenderer.invoke('throng:about:getThirdParty'),
    openExternal: (url: string) => ipcRenderer.send('throng:openExternal', url),
  },
  // 024 US7 (#159): open an http(s) URL in the system browser through the OS open-external seam
  // (hoisted from the `about` namespace so a terminal link isn't routed through an About-scoped API).
  // The main process re-validates the scheme; a non-http(s) URL opens nowhere.
  openExternal: (url: string) => ipcRenderer.send('throng:openExternal', url),
  // A window learns it has been blurred by the app-modal preferences window (US10/FR-035) — the
  // deterministic "a child window took focus" signal the hover-suppression gate needs.
  onWindowBlurred: (cb: (blurred: boolean) => void) => {
    const handler = (_event: unknown, blurred: boolean): void => cb(blurred);
    ipcRenderer.on('throng:window:blurred', handler);
    return () => ipcRenderer.removeListener('throng:window:blurred', handler);
  },
  // User config (settings + active theme): pull on mount, then subscribe to
  // hot-reload pushes when the JSON files change (FR-030/031/033).
  config: {
    get: () => ipcRenderer.invoke('throng:config:get'),
    onChange: (cb: (payload: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown): void => cb(payload);
      ipcRenderer.on('throng:config', handler);
      return () => ipcRenderer.removeListener('throng:config', handler);
    },
    // Preferences editor (007): the renderer→main write path. `write` persists a
    // config document as raw JSON (validated + confined in main); the existing
    // hot-reload watcher then live-applies it (immediate-apply, FR-016/017/042).
    write: (id: unknown, json: string) => ipcRenderer.invoke('throng:config:write', id, json),
    /*
     * The KEY-SCOPED write (032, FR-001). A caller says what changed and never assembles a document,
     * so it cannot assemble a stale one — which is the entire mechanism behind #249 and #260.
     *
     * A second channel rather than a changed one: the whole-document write has legitimate remaining
     * callers (the JSON tab, where replacing the file IS the operation the user asked for), and
     * overloading one channel with two meanings is how the two got confused to begin with.
     */
    writePatch: (id: unknown, changes: unknown) =>
      ipcRenderer.invoke('throng:config:writePatch', id, changes),
    // Raw on-disk text of a config document, for the JSON editor (007 US5/FR-043).
    readRaw: (id: unknown): Promise<string> => ipcRenderer.invoke('throng:config:readRaw', id),
    // Theme file management + discovery for the Themes tab (handlers land with the
    // Themes/fonts/icon-pack phases — the surface is exposed here up front).
    listThemes: (): Promise<string[]> => ipcRenderer.invoke('throng:config:listThemes'),
    renameTheme: (from: string, to: string) =>
      ipcRenderer.invoke('throng:config:renameTheme', from, to),
    deleteTheme: (name: string) => ipcRenderer.invoke('throng:config:deleteTheme', name),
    // Feature 014: real "Restore All Themes to Default" (010 FR-008) — resets every edited
    // built-in to shipped values and recreates deleted built-ins, atomically; customs untouched.
    restoreAllThemes: (): Promise<{ ok: boolean; failedPath?: string; error?: string }> =>
      ipcRenderer.invoke('throng:config:restoreAllThemes'),
    // Feature 014: restore/recreate a single built-in theme (FR-005/005a).
    restoreTheme: (name: string): Promise<{ ok: boolean; failedPath?: string; error?: string }> =>
      ipcRenderer.invoke('throng:config:restoreTheme', name),
    // Feature 015: the granular reset controls. Feature 010 shipped these operations
    // and nothing could reach them — until now they were exposed nowhere.
    resetBinding: (action: string): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('throng:config:resetBinding', action),
    resetSetting: (path: string): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('throng:config:resetSetting', path),
    // Settings + key bindings + every BUILT-IN theme, atomically. Custom themes, projects,
    // window layout and workspace state are never touched — hence "preferences", not
    // "everything" (FR-005b).
    resetPreferences: (): Promise<{ ok: boolean; failedPath?: string; error?: string }> =>
      ipcRenderer.invoke('throng:config:resetPreferences'),
    // The per-tab "Reset to Defaults" — one whole editor, restored in main from the record.
    resetSettings: (): Promise<{ ok: boolean; failedPath?: string; error?: string }> =>
      ipcRenderer.invoke('throng:config:resetSettings'),
    resetKeybindings: (): Promise<{ ok: boolean; failedPath?: string; error?: string }> =>
      ipcRenderer.invoke('throng:config:resetKeybindings'),
    // Installed-font typeahead source (cached; may be empty → curated fallback).
    listFonts: (): Promise<string[]> => ipcRenderer.invoke('throng:config:listFonts'),
    // Discovered icon packs ({ name, assetBase }); resolved by the main process.
    listIconPacks: (): Promise<unknown[]> => ipcRenderer.invoke('throng:config:listIconPacks'),
  },
  // Typed panels — Terminal (005). Phase B: list the Flavour dropdown's catalogue
  // (machine-detected built-ins ∪ user-defined), owned by UI main (no daemon).
  terminal: {
    listFlavours: () => ipcRenderer.invoke('throng:terminal:listFlavours'),
    // The detected built-ins, with nothing subtracted — the settings picker's catalogue (019).
    listDetectedFlavours: () => ipcRenderer.invoke('throng:terminal:listDetectedFlavours'),
    /*
     * 039 US3 (#237) — reconnect when a missing working directory comes back.
     *
     * `arm` is called by the panel that failed to START on an unresolvable cwd, and only then:
     * `shouldWatchForRecovery` in core decides which failures qualify (FR-035 — never a permission
     * refusal or a bad shell binary). `disarm` is called when the terminal starts by any route, and
     * on unmount, so a watch never outlives the panel that wanted it (FR-042).
     *
     * `onPathBack` delivers ONE message listing EVERY released panel, rather than one per panel.
     * That shape is what makes FR-033 — no notice per recovered panel — achievable rather than a
     * matter of the consumer remembering to batch.
     */
    armReconnect: (panelId: string, projectId: string, target: string) =>
      ipcRenderer.invoke('throng:terminal:armReconnect', panelId, projectId, target),
    disarmReconnect: (panelId: string) =>
      ipcRenderer.invoke('throng:terminal:disarmReconnect', panelId),
    onPathBack: (cb: (evt: { panelIds: string[] }) => void) => {
      const handler = (_e: unknown, evt: { panelIds: string[] }): void => cb(evt);
      ipcRenderer.on('throng:terminal:pathBack', handler);
      return () => ipcRenderer.removeListener('throng:terminal:pathBack', handler);
    },
    // Phase C — session commands (request/response → daemon) and push streams.
    attach: (req: unknown) => ipcRenderer.invoke('throng:terminal:attach', req),
    write: (panelId: string, data: string) => ipcRenderer.invoke('throng:terminal:write', panelId, data),
    resize: (panelId: string, cols: number, rows: number, viewId?: string) =>
      ipcRenderer.invoke('throng:terminal:resize', panelId, cols, rows, viewId),
    // A view is going away (008 FR-007/FR-010): remove it from the daemon's grid set.
    // Not a kill — the daemon terminates only the last view of a sub-workspace panel.
    detach: (panelId: string, viewId?: string) =>
      ipcRenderer.invoke('throng:terminal:detach', panelId, viewId),
    repaint: (panelId: string) => ipcRenderer.invoke('throng:terminal:repaint', panelId),
    kill: (panelId: string) => ipcRenderer.invoke('throng:terminal:kill', panelId),
    list: (projectId?: string) => ipcRenderer.invoke('throng:terminal:list', projectId),
    // Daemon capabilities (FR-025a): { elevated } — gates the "run as admin" control.
    capabilities: () => ipcRenderer.invoke('throng:terminal:capabilities'),
    // OSC 52 clipboard-write from a program running inside the terminal (Claude
    // Code, tmux, vim, …). The sandboxed renderer can't reach the OS clipboard, so
    // it relays the decoded text to the main process (Electron clipboard.writeText).
    writeClipboard: (text: string) => ipcRenderer.invoke('throng:terminal:clipboardWrite', text),
    onOutput: (cb: (e: { panelId: string; data: string }) => void) => {
      const handler = (_event: unknown, e: { panelId: string; data: string }): void => cb(e);
      ipcRenderer.on('throng:terminal:output', handler);
      return () => ipcRenderer.removeListener('throng:terminal:output', handler);
    },
    // The shared grid changed (008 FR-009/FR-013): each view conforms its xterm to it so
    // a full-screen program renders identically in windows of different sizes.
    onGrid: (cb: (e: { panelId: string; cols: number; rows: number }) => void) => {
      const handler = (_event: unknown, e: { panelId: string; cols: number; rows: number }): void => cb(e);
      ipcRenderer.on('throng:terminal:grid', handler);
      return () => ipcRenderer.removeListener('throng:terminal:grid', handler);
    },
    // A terminal's shell working directory changed (012) — shown in the panel title.
    onCwd: (cb: (e: { panelId: string; cwd: string }) => void) => {
      const handler = (_event: unknown, e: { panelId: string; cwd: string }): void => cb(e);
      ipcRenderer.on('throng:terminal:cwd', handler);
      return () => ipcRenderer.removeListener('throng:terminal:cwd', handler);
    },
    // 025 FR-019: which command currently holds a terminal — the twin of onCwd above.
    onCommand: (cb: (e: { panelId: string; command: string | null }) => void) => {
      const handler = (_event: unknown, e: { panelId: string; command: string | null }): void => cb(e);
      ipcRenderer.on('throng:terminal:command', handler);
      return () => ipcRenderer.removeListener('throng:terminal:command', handler);
    },
    onExit: (cb: (e: { panelId: string; code: number | null; unexpected: boolean }) => void) => {
      const handler = (_event: unknown, e: { panelId: string; code: number | null; unexpected: boolean }): void =>
        cb(e);
      ipcRenderer.on('throng:terminal:exit', handler);
      return () => ipcRenderer.removeListener('throng:terminal:exit', handler);
    },
  },
  // File Explorer tree (004): read directories + perform file operations,
  // confined to the active project root by the main process. `onChange` pushes a
  // live-sync signal when the watched root changes (external or in-app).
  files: {
    setRoot: (root: string | null) => ipcRenderer.send('throng:files:setRoot', root),
    list: (relDir: string) => ipcRenderer.invoke('throng:files:list', relDir),
    rename: (relPath: string, newName: string) =>
      ipcRenderer.invoke('throng:files:rename', relPath, newName),
    move: (srcRelPaths: string[], destRelDir: string) =>
      ipcRenderer.invoke('throng:files:move', srcRelPaths, destRelDir),
    copy: (srcRelPaths: string[], destRelDir: string) =>
      ipcRenderer.invoke('throng:files:copy', srcRelPaths, destRelDir),
    delete: (relPaths: string[], mode: 'recycle' | 'permanent') =>
      ipcRenderer.invoke('throng:files:delete', relPaths, mode),
    newFolder: (destRelDir: string) => ipcRenderer.invoke('throng:files:newFolder', destRelDir),
    newFile: (destRelDir: string) => ipcRenderer.invoke('throng:files:newFile', destRelDir),
    reveal: (relPath: string) => ipcRenderer.invoke('throng:files:reveal', relPath),
    // 024 US3 (#85): the undo engine's world-check — is this path still inside the project?
    exists: (relPath: string): Promise<boolean> =>
      ipcRenderer.invoke('throng:files:exists', relPath),
    // 024 US3 (#85): undo of a delete — restore a trashed item to its original path.
    restore: (relPath: string, deletedAt: number) =>
      ipcRenderer.invoke('throng:files:restore', relPath, deletedAt),
    onChange: (cb: (evt: { relDir: string }) => void) => {
      const handler = (_event: unknown, evt: { relDir: string }): void => cb(evt);
      ipcRenderer.on('throng:files:changed', handler);
      return () => ipcRenderer.removeListener('throng:files:changed', handler);
    },
    // 026 / #186 (FR-010a): live sync has stopped and could not be restarted. The peer of
    // `onChange` — the message that says no more of those are coming. Without it the tree simply
    // freezes, which is indistinguishable from a project where nothing is happening.
    onWatchFailed: (cb: (evt: { root: string; reason: string }) => void) => {
      const handler = (_event: unknown, evt: { root: string; reason: string }): void => cb(evt);
      ipcRenderer.on('throng:files:watchFailed', handler);
      return () => ipcRenderer.removeListener('throng:files:watchFailed', handler);
    },
  },
  // 033 US1 (contracts/file-index.md §3): the project file index that seeds Quick Open. NEW
  // channels rather than additions to `files.*` — that surface carries ONE process-wide root, and
  // this index is keyed BY root so two windows on two projects never see each other's sets (I4).
  // `subscribe` answers `building` while the walk is in flight and `ready` with the whole set once
  // it is done; everything after that arrives on `onUpdate` as a delta.
  //
  // 033 FR-069 — `includeHidden` is part of the SUBSCRIPTION, not a filter applied afterwards. A
  // root has two indices and this says which one is wanted; every push echoes the flag back so a
  // window holding both can tell them apart.
  fileIndex: {
    subscribe: (root: string, includeHidden = false) =>
      ipcRenderer.invoke('throng:fileIndex:subscribe', { root, includeHidden }),
    unsubscribe: (root: string, includeHidden = false) =>
      ipcRenderer.send('throng:fileIndex:unsubscribe', { root, includeHidden }),
    // Returns an unsubscriber, matching every other push channel's idiom (I3).
    onUpdate: (
      cb: (evt: {
        root: string;
        includeHidden: boolean;
        status: 'building' | 'ready';
        paths?: string[];
        added?: string[];
        removed?: string[];
      }) => void,
    ) => {
      const handler = (
        _event: unknown,
        evt: {
          root: string;
          includeHidden: boolean;
          status: 'building' | 'ready';
          paths?: string[];
          added?: string[];
          removed?: string[];
        },
      ): void => cb(evt);
      ipcRenderer.on('throng:fileIndex:update', handler);
      return () => ipcRenderer.removeListener('throng:fileIndex:update', handler);
    },
  },
  // The OS clipboard (016, FR-013a): the sandboxed renderer cannot reach it, so it says WHAT to
  // copy and what SHAPE it is, and UI main writes it and remembers. The shape is app-global — one
  // record — which is what lets a block cut in one file paste as a block in another window.
  clipboard: {
    write: (entry: { text: string; mode: string }) =>
      ipcRenderer.invoke('throng:clipboard:write', entry),
    /** What a paste should insert, and how — decided against the LIVE clipboard, never cached. */
    paste: () => ipcRenderer.invoke('throng:clipboard:paste'),
  },
  // Editor panels (006): UI-main-owned editor coordination — a peer of files.*,
  // NOT daemon RPC. The renderer reads/saves and reports edits through here; the
  // dirty-file lock, recovery temps, one-buffer registry, and cross-window mirror
  // all live in the main-process coordinator.
  editor: {
    /** Read + decode a file for an editor (registers it in the one-buffer registry). */
    load: (req: unknown) => ipcRenderer.invoke('throng:editor:load', req),
    /**
     * The absolute path of a File the user dragged in from the operating system (018 / US9, FR-066a).
     *
     * THIS IS THE ONE LINE END-TO-END TESTS CANNOT REACH, and it is stated here rather than hidden.
     * Electron 43 removed the non-standard `File.path`, so an OS path can only come from `webUtils`,
     * which is available only in the preload. A File synthesised in the renderer is NOT an OS file and
     * this returns '' for it — so a fabricated drop event cannot exercise the real extraction, and no
     * test in this feature pretends that it does.
     *
     * Everything downstream is a pure, path-taking function. That is why the seam is here: the
     * untestable part is one adapter, not a system.
     */
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    /**
     * Decide whether a dropped path may be opened into this document (018 / US9).
     *
     * The renderer says "this path was dropped on me". It does NOT get to say whether that is allowed:
     * MAIN resolves the symlinks and applies the confinement rule, because a renderer-side check is a
     * suggestion, not a boundary.
     */
    resolveDrop: (req: unknown) => ipcRenderer.invoke('throng:editor:resolveDrop', req),
    /** Register a new/known document (unpathed new doc, or a restored panel). */
    register: (meta: unknown) => ipcRenderer.send('throng:editor:register', meta),
    /** Dispatch an edit this view has ALREADY shown its user, to the document's authority
     *  (016, FR-028f). Replaces 006's `notifyDirty`, which pushed the whole document. */
    dispatch: (req: unknown) => ipcRenderer.send('throng:editor:dispatch', req),
    /** Undo/redo the document's last change — performed by the authority, because the undo
     *  stack belongs to the DOCUMENT and is shared by every view of it (FR-026c). */
    undo: (req: unknown) => ipcRenderer.send('throng:editor:undo', req),
    redo: (req: unknown) => ipcRenderer.send('throng:editor:redo', req),
    /** Discard unsaved changes back to the content on disk (FR-075). */
    setWordWrap: (panelId: string, on: boolean) =>
      ipcRenderer.send('throng:editor:setWordWrap', { panelId, on }),
    wordWrap: (panelId: string, seedDefault: boolean) =>
      ipcRenderer.invoke('throng:editor:wordWrap', { panelId, seedDefault }),
    revert: (panelId: string) => ipcRenderer.invoke('throng:editor:revert', panelId),
    /** Re-READ the path from disk — the operation `revert` deliberately is not (027 / #161). */
    reload: (panelId: string) => ipcRenderer.invoke('throng:editor:reload', panelId),
    /** A remount asking whether the document's path still reads (027 / #161). */
    verifyPath: (panelId: string) => ipcRenderer.send('throng:editor:verifyPath', panelId),
    /** The authority's current text + version, for a view that has fallen out of step. */
    resync: (panelId: string) => ipcRenderer.invoke('throng:editor:resync', panelId),
    /** Restore crash-recovered content into the authority, dirty vs the disk file (FR-102). */
    restoreRecovered: (panelId: string, text: string, history?: unknown) =>
      ipcRenderer.invoke('throng:editor:restoreRecovered', { panelId, text, history }),
    /** THIS panel's crash snapshot — never the whole recovery directory (FR-027b). */
    recoverOne: (panelId: string) => ipcRenderer.invoke('throng:editor:recoverOne', panelId),
    /** Current UI-main content for a panel (moved panel / mirror / restore). */
    getContent: (panelId: string) => ipcRenderer.invoke('throng:editor:getContent', panelId),
    /** Native save-location chooser for a new document (constrained by confinement). */
    chooseSavePath: (req: unknown) => ipcRenderer.invoke('throng:editor:chooseSavePath', req),
    /** Save one document (Ctrl+S). `absPath` sets a new location for a new doc. */
    save: (req: unknown) => ipcRenderer.invoke('throng:editor:save', req),
    /** Save-All by scope (FR-023); skips + reports unpathed docs. */
    saveAll: (req: unknown) => ipcRenderer.invoke('throng:editor:saveAll', req),
    /** App-wide one-buffer: focus the existing editor for a path, else open new. */
    openInto: (req: unknown) => ipcRenderer.invoke('throng:editor:openInto', req),
    /** Is the file already open in an editor anywhere? (disables Open-In). */
    isOpen: (absPath: string) => ipcRenderer.invoke('throng:editor:isOpen', absPath),
    /** Open documents summary (indicators / menus). */
    list: () => ipcRenderer.invoke('throng:editor:list'),
    /** Launch-time recovery: in-progress content by panelId (FR-042). */
    recover: () => ipcRenderer.invoke('throng:editor:recover'),
    /** Files open in sub-workspace-owned editors (project-overlap guard, FR-038). */
    subWorkspaceFiles: () => ipcRenderer.invoke('throng:editor:subWsFiles'),
    /** Tear down a document (Panel destroy/close): release lock + clean temp. */
    destroy: (panelId: string) => ipcRenderer.send('throng:editor:destroy', panelId),
    /**
     * The authority's stream for a document shown in this window (016, FR-028f).
     *
     * `change` is one ordered canonical change, which EVERY view applies — including the
     * one that sent it, which needs the acknowledgement to advance its version. `reset`
     * means the document was replaced wholesale. The rest is state no change describes.
     */
    onSync: (
      cb: (msg: {
        panelId: string;
        change?: unknown;
        reset?: unknown;
        dirty?: boolean;
        deleted?: boolean;
        externalChange?: boolean;
        wordWrap?: boolean;
        /** throng moved the file: the document's new absolute path (019, FR-002). */
        movedTo?: string;
      }) => void,
    ) => {
      const handler = (
        _event: unknown,
        msg: {
          panelId: string;
          change?: unknown;
          reset?: unknown;
          dirty?: boolean;
          deleted?: boolean;
          externalChange?: boolean;
        wordWrap?: boolean;
          movedTo?: string;
        },
      ): void => cb(msg);
      ipcRenderer.on('throng:editor:sync', handler);
      return () => ipcRenderer.removeListener('throng:editor:sync', handler);
    },
    /** UI main asks this window to focus a Panel (already-open file was opened). */
    onFocus: (cb: (msg: { panelId: string }) => void) => {
      const handler = (_event: unknown, msg: { panelId: string }): void => cb(msg);
      ipcRenderer.on('throng:editor:focus', handler);
      return () => ipcRenderer.removeListener('throng:editor:focus', handler);
    },
  },
});
