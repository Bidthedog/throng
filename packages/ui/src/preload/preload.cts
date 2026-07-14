// Sandboxed preload (CommonJS — emitted as preload.cjs). Runs in the isolated
// world and is the only bridge between the Electron main process and the
// renderer (Principle: clean sandbox boundary). Exposes the daemon health.ping
// outcome to the landing page (US3, T030).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('throng', {
  // The host OS family, so the renderer can render paths with native separators
  // (FR-101) — Windows uses '\\', everything else '/'.
  osName: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  getDaemonStatus: () => ipcRenderer.invoke('throng:getDaemonStatus'),
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
    // Phase C — session commands (request/response → daemon) and push streams.
    attach: (req: unknown) => ipcRenderer.invoke('throng:terminal:attach', req),
    write: (panelId: string, data: string) => ipcRenderer.invoke('throng:terminal:write', panelId, data),
    resize: (panelId: string, cols: number, rows: number, viewId?: string) =>
      ipcRenderer.invoke('throng:terminal:resize', panelId, cols, rows, viewId),
    // A view is going away (008 FR-007/FR-010): remove it from the daemon's grid set.
    // Not a kill — the daemon terminates only the last view of a sub-workspace panel.
    detach: (panelId: string, viewId?: string) =>
      ipcRenderer.invoke('throng:terminal:detach', panelId, viewId),
    kill: (panelId: string) => ipcRenderer.invoke('throng:terminal:kill', panelId),
    list: (projectId?: string) => ipcRenderer.invoke('throng:terminal:list', projectId),
    // Daemon capabilities (FR-025a): { elevated } — gates the "run as admin" control.
    capabilities: () => ipcRenderer.invoke('throng:terminal:capabilities'),
    contextMenu: (payload: { panelId: string; selection: string }) =>
      ipcRenderer.invoke('throng:terminal:contextMenu', payload),
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
    onChange: (cb: (evt: { relDir: string }) => void) => {
      const handler = (_event: unknown, evt: { relDir: string }): void => cb(evt);
      ipcRenderer.on('throng:files:changed', handler);
      return () => ipcRenderer.removeListener('throng:files:changed', handler);
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
    revert: (panelId: string) => ipcRenderer.invoke('throng:editor:revert', panelId),
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
