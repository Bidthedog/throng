// Ambient typing for the preload contextBridge surface (window.throng). The
// preload exposes a generic JSON-RPC `invoke` plus the 001 daemon-status and
// zoom relays. Kept in the renderer so components can rely on it type-safely.

export interface ThrongRpcEnvelope {
  ok: boolean;
  result?: unknown;
  error?: { code: number | null; message: string };
}

declare global {
  interface Window {
    throng?: {
      /** Host OS family for native-separator path display (FR-101). */
      osName?: 'windows' | 'macos' | 'linux';
      /** Cross-window projects-changed sync (create/rename/recolour/delete). */
      projects?: {
        notifyChanged: () => void;
        onChanged: (cb: () => void) => () => void;
      };
      getDaemonStatus?: () => Promise<unknown>;
      /**
       * 030 FR-006 — a notice's record on its way to the diagnostic log. Fire-and-forget: the
       * renderer learns nothing about the write, because a failed diagnostics write must never
       * turn into a second notice.
       */
      notices?: {
        log: (record: import('@throng/core').NoticeLogRecord) => void;
      };
      /** 029 FR-013 — panel id to displayed title, published so main can name a throng holder. */
      panels?: {
        publishIdentities: (
          list: Array<{ panelId: string; panelTitle: string; windowTitle?: string }>,
        ) => void;
      };
      /** 029 / #182 — daemon liveness, pushed rather than pulled. */
      daemon?: {
        state: () => Promise<import('@throng/core').DaemonState>;
        restart: () => Promise<{ ok: boolean; error?: string }>;
        onState: (cb: (s: import('@throng/core').DaemonState) => void) => () => void;
      };
      invoke?: (method: string, params: unknown) => Promise<ThrongRpcEnvelope>;
      pickFolder?: (opts?: { defaultPath?: string | string[] }) => Promise<string | null>;
      setTitle?: (title: string) => void;
      zoomBy?: (steps: number) => void;
      zoomReset?: () => void;
      fullscreenToggle?: () => void;
      // Custom title bar window controls (007): min/max/close for the sender window.
      window?: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
        onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
      };
      // Cog → preferences (007, main window only) + the prefs window's tab-switch push.
      openPreferences?: (tab: 'settings' | 'keybindings' | 'themes') => void;
      onPreferencesTab?: (
        cb: (tab: 'settings' | 'keybindings' | 'themes') => void,
      ) => () => void;
      /** 032 FR-018 — main asks before closing Preferences; an invalid JSON buffer may refuse. */
      onPreferencesCloseRequest?: (cb: (payload: { requestId: number }) => void) => () => void;
      replyPreferencesClose?: (payload: { requestId: number; allow: boolean }) => void;
      // About throng (020, FR-003): version + build id + full licence for the About
      // surface, plus opening the licence link in the user's default browser.
      /** #123 — reveal the logs + crash reports folder in the OS file manager. */
      diagnostics?: {
        openLogs: () => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
      };
      about?: {
        open: () => void;
        // US4 (#139) — static identity only; the third-party list is fetched via getThirdParty().
        get: () => Promise<{
          version: string;
          author: string;
          repoUrl: string;
          buildId: string;
          licenseText: string;
        }>;
        getThirdParty: () => Promise<
          Array<{
            name: string;
            version: string;
            license: string;
            licenseUrl: string;
            projectUrl: string;
          }>
        >;
        openExternal: (url: string) => void;
      };
      // 024 US7 (#159): open an http(s) URL in the system browser (hoisted top-level from `about`).
      openExternal?: (url: string) => void;
      // A window is told when the app-modal preferences window blurs/unblurs it (US10/FR-035).
      onWindowBlurred?: (cb: (blurred: boolean) => void) => () => void;
      // App-close warning when terminals are running (005 / FR-015).
      onAppCloseBegin?: (cb: () => void) => () => void;
      onAppClosePrompt?: (cb: (info: AppClosePromptInfo) => void) => () => void;
      onAppCloseClosing?: (cb: (info: { message: string }) => void) => () => void;
      appCloseChoice?: (choice: 'leave' | 'terminate' | 'cancel') => void;
      // The shutdown drain (019 / FR-010): settle this window's deferred writes and ack.
      // Correlated by `requestId` so a stale ack cannot satisfy a later drain.
      onAppCloseDrain?: (cb: (req: { requestId: string }) => void) => () => void;
      appCloseDrained?: (req: { requestId: string }) => void;
      dragGhost?: {
        start: (kind: 'panel' | 'tab', title: string) => void;
        move: () => void;
        hint: (text: string, warn?: boolean) => void;
        stop: () => void;
      };
      // Detached sub-workspace windows (US7): open/raise, close, and a
      // cross-window content-change signal so an open window re-reads.
      subWorkspace?: {
        open: (id: string) => void;
        atPoint: () => Promise<string | null>;
        close: (id: string) => void;
        notifyChanged: (id: string) => void;
        onChanged: (cb: (id: string) => void) => () => void;
        /** An open that could not complete (#287). `open` is fire-and-forget, so this is the only
         *  way the renderer learns a request failed rather than leaving an inert button. */
        onOpenFailed?: (cb: (failure: { id: string; reason: string }) => void) => () => void;
      };
      // Cross-window Panel identity sync (003): rename the same Panel everywhere.
      panel?: {
        notifyRenamed: (id: string, title: string) => void;
        onRenamed: (cb: (id: string, title: string) => void) => () => void;
        // A name throng moved, not one the user chose (#184/#218) — never marks a panel custom.
        notifyRetitled: (id: string, title: string) => void;
        onRetitled: (cb: (id: string, title: string) => void) => () => void;
        notifyDestroyed: (id: string) => void;
        onDestroyed: (cb: (id: string) => void) => () => void;
        notifyDraft: (id: string, draft: unknown) => void;
        onDraft: (cb: (id: string, draft: unknown) => void) => () => void;
        notifyTyped: (id: string, kind: string, config: unknown) => void;
        onTyped: (cb: (id: string, kind: string, config: unknown) => void) => () => void;
      };
      config?: {
        get: () => Promise<{ settings?: unknown; theme?: unknown; keybindings?: unknown } | null>;
        onChange: (
          cb: (payload: { settings?: unknown; theme?: unknown; keybindings?: unknown }) => void,
        ) => () => void;
        // Preferences editor (007): renderer→main write path + theme/font/icon-pack
        // discovery. `write` persists raw JSON (validated + confined in main) and the
        // hot-reload watcher live-applies it (immediate-apply, FR-016/017/042).
        write?: (id: ThrongConfigDocId, json: string) => Promise<ConfigWriteResult>;
        /**
         * The key-scoped write (032, FR-001). `settings` only — any other document kind is refused
         * with `unsupported-doc` rather than quietly accepted.
         */
        writePatch?: (
          id: ThrongConfigDocId,
          changes: readonly import('@throng/core').ConfigChange[],
        ) => Promise<ConfigWriteResult>;
        readRaw?: (id: ThrongConfigDocId) => Promise<string>;
        listThemes?: () => Promise<string[]>;
        renameTheme?: (
          from: string,
          to: string,
        ) => Promise<{ ok: boolean; error?: 'exists' | 'invalid' }>;
        deleteTheme?: (name: string) => Promise<void>;
        // Feature 014 restore controls (010 FR-008 / FR-005 / FR-005a).
        restoreAllThemes?: () => Promise<{ ok: boolean; failedPath?: string; error?: string }>;
        restoreTheme?: (name: string) => Promise<{ ok: boolean; failedPath?: string; error?: string }>;
        // Feature 015 granular reset controls (010's reset API, finally reachable).
        resetBinding?: (action: string) => Promise<{ ok: boolean; reason?: string }>;
        resetSetting?: (path: string) => Promise<{ ok: boolean; reason?: string }>;
        resetPreferences?: () => Promise<{ ok: boolean; failedPath?: string; error?: string }>;
        resetSettings?: () => Promise<{ ok: boolean; failedPath?: string; error?: string }>;
        resetKeybindings?: () => Promise<{ ok: boolean; failedPath?: string; error?: string }>;
        listFonts?: () => Promise<string[]>;
        listIconPacks?: () => Promise<IconPackInfo[]>;
      };
      // Typed panels — Terminal (005 Phase B): the Flavour dropdown's catalogue
      // (machine-detected built-ins ∪ user-defined), served by UI main.
      terminal?: {
        listFlavours: () => Promise<TerminalFlavourDto[]>;
        /**
         * The built-ins this machine HAS, with nothing subtracted (019, C10) — the settings
         * picker's catalogue, so that hiding a built-in is not a one-way door. The panel's Flavour
         * dropdown must never be built from this: it would offer the flavours the user hid.
         */
        listDetectedFlavours?: () => Promise<DetectedFlavourDto[]>;
        /**
         * 039 US3 (#237) — watch for a terminal's missing working directory to come back.
         *
         * `armReconnect` is called only by a panel whose START FAILED on an unresolvable cwd
         * (`shouldWatchForRecovery` decides which failures qualify — FR-035). `disarmReconnect` is
         * called when the terminal starts by any route and on unmount, so a watch never outlives its
         * panel (FR-042). `onPathBack` delivers ONE message naming EVERY released panel, which is
         * what makes "no notice per recovered panel" (FR-033) a property of the contract rather than
         * of the consumer remembering to batch.
         */
        armReconnect?: (panelId: string, projectId: string, target: string) => Promise<void>;
        disarmReconnect?: (panelId: string) => Promise<void>;
        onPathBack?: (cb: (evt: { panelIds: string[] }) => void) => () => void;
        attach: (req: {
          panelId: string;
          projectId: string;
          projectRoot: string | null;
          /** The view (one window's presentation of this panel) attaching (008 FR-009). */
          viewId?: string;
          /** The user explicitly (re-)typed this panel (008 FR-002/FR-007): destroy + create. */
          explicit?: boolean;
          rootless?: boolean;
          runAsAdmin?: boolean;
          flavourId: string;
          shellArguments: string;
          startupCommand?: string;
          rememberedCwd?: string;
          /** 033 FR-033: the folder this panel was created from (Open In → Terminal). */
          startDirectory?: string;
          cols: number;
          rows: number;
          /**
           * Display labels for the app-close warning (FR-015). UI main's `AttachRequest`
           * declares and forwards this to the daemon (terminal-ipc.ts), and the preload
           * bridge passes the request object through as-is — so it travels at runtime; this
           * type merely completes the bridge's declaration of a field it always carried.
           */
          meta?: { projectName?: string; tabName?: string; panelName?: string };
        }) => Promise<TerminalAttachEnvelope>;
        write: (panelId: string, data: string) => Promise<unknown>;
        resize: (panelId: string, cols: number, rows: number, viewId?: string) => Promise<unknown>;
        /** A view is going away (008 FR-007/FR-010) — remove it from the daemon's grid set. */
        detach: (panelId: string, viewId?: string) => Promise<unknown>;
        /**
         * 028 (#162/#163) — force the running program to redraw its whole screen. A rebuilt view
         * (every tab switch unmounts its panels) cannot reconstruct a full-screen program's screen
         * from the replayed byte tail; only the program can, and it redraws only when the window
         * changes. The daemon nudges the grid and restores it.
         */
        repaint?: (panelId: string) => Promise<unknown>;
        kill: (panelId: string) => Promise<unknown>;
        list: (projectId?: string) => Promise<{ sessions: TerminalSessionDto[] }>;
        // Daemon capabilities (FR-025a): { elevated } gates the "run as admin" control.
        capabilities: () => Promise<{ elevated: boolean }>;
        // OSC 52 clipboard write from a program inside the terminal → OS clipboard.
        writeClipboard: (text: string) => Promise<unknown>;
        onOutput: (cb: (e: { panelId: string; data: string }) => void) => () => void;
        /** The shared grid changed (008 FR-009/FR-013): conform this view's xterm to it. */
        onGrid: (cb: (e: { panelId: string; cols: number; rows: number }) => void) => () => void;
        /** The shell's working directory changed (012): shown in the panel title. */
        onCwd: (cb: (e: { panelId: string; cwd: string }) => void) => () => void;
        /** 025 FR-019: the terminal's current foreground command, or null when idle. */
        onCommand?: (cb: (e: { panelId: string; command: string | null }) => void) => () => void;
        onExit: (
          cb: (e: { panelId: string; code: number | null; unexpected: boolean }) => void,
        ) => () => void;
      };
      // File Explorer tree (004): directory reads + file operations, confined to
      // the active project root by the main process; `onChange` is the live-sync push.
      files?: {
        setRoot: (root: string | null) => void;
        list: (
          relDir: string,
        ) => Promise<{ entries: FileTreeEntry[] } | FilesFailure>;
        rename: (relPath: string, newName: string) => Promise<FilesOkOrError>;
        move: (srcRelPaths: string[], destRelDir: string) => Promise<FilesOkOrError>;
        copy: (srcRelPaths: string[], destRelDir: string) => Promise<FilesOkOrError>;
        delete: (relPaths: string[], mode: 'recycle' | 'permanent') => Promise<FilesOkOrError>;
        newFolder: (destRelDir: string) => Promise<{ relPath: string } | FilesFailure>;
        newFile: (destRelDir: string) => Promise<{ relPath: string } | FilesFailure>;
        reveal: (relPath: string) => Promise<FilesOkOrError>;
        /** 024 US3 (#85): does this path exist inside the project? The undo world-check. */
        exists?: (relPath: string) => Promise<boolean>;
        /** 024 US3 (#85): restore a trashed item to its original path. */
        restore?: (relPath: string, deletedAt: number) => Promise<FilesOkOrError>;
        onChange: (cb: (evt: { relDir: string }) => void) => () => void;
        /** 026 / #186 — live sync stopped and could not be restarted (FR-010a). */
        onWatchFailed?: (cb: (evt: { root: string; reason: string }) => void) => () => void;
      };
      /**
       * 033 US1 — the project file index behind Quick Open (contracts/file-index.md §3).
       *
       * Its only renderer-side consumer is `navigate/use-file-index.ts` (R1). `subscribe` answers
       * `building` with no paths while the walk is in flight and `ready` with the whole set once it
       * finishes; every later change arrives on `onUpdate` as `added`/`removed` against the set
       * this window was last sent (I2), and `onUpdate` returns an unsubscriber (I3).
       */
      fileIndex?: {
        /**
         * `includeHidden` is part of the subscription KEY (033 FR-069), not a filter applied after
         * the fact: main walks with or without the project's exclusions accordingly, so the two
         * indices genuinely differ rather than one being a subset the renderer trims.
         */
        subscribe: (
          root: string,
          includeHidden?: boolean,
        ) => Promise<{ status: 'building' | 'ready'; paths?: string[] }>;
        unsubscribe: (root: string, includeHidden?: boolean) => void;
        onUpdate: (
          cb: (evt: {
            root: string;
            includeHidden: boolean;
            status: 'building' | 'ready';
            paths?: string[];
            added?: string[];
            removed?: string[];
          }) => void,
        ) => () => void;
      };
      // The OS clipboard (016, FR-013a) — behind the seam, in UI main.
      clipboard?: {
        write: (entry: { text: string; mode: import('@throng/core').ClipboardMode }) => Promise<void>;
        paste: () => Promise<{ text: string; mode: import('@throng/core').ClipboardMode }>;
      };
      // Editor panels (006): UI-main-owned editor coordination (peer of files.*).
      editor?: {
        load: (req: unknown) => Promise<EditorLoadResult>;
        /** The OS path of a dragged-in File. '' for a File the renderer synthesised (018 / US9). */
        getPathForFile: (file: File) => string;
        /** Ask MAIN whether a dropped path may be opened here — never decided renderer-side. */
        resolveDrop: (req: {
          panelId: string;
          ownerKind: 'project' | 'subworkspace';
          ownerProjectId?: string;
          ownerRoot: string | null;
          allProjectRoots: string[];
          tabId: string | null;
          absPath: string;
        }) => Promise<EditorDropResult>;
        register: (meta: unknown) => void;
        /** Send an edit this view has already applied locally, to the document's authority. */
        dispatch: (req: import('@throng/core').DispatchChangeMsg & Record<string, unknown>) => void;
        /** Ask the authority to undo/redo — the stack belongs to the document (FR-026c). */
        undo: (req: { panelId: string; viewId: string }) => void;
        redo: (req: { panelId: string; viewId: string }) => void;
        setWordWrap: (panelId: string, on: boolean) => void;
        wordWrap: (panelId: string, seedDefault: boolean) => Promise<boolean>;
        revert: (panelId: string) => Promise<boolean>;
        /** Re-read the document's path from disk (027 / #161). */
        reload: (
          panelId: string,
        ) => Promise<{ ok: true } | { ok: false; reason: string; error: string }>;
        /** A remount asking whether the document's path still reads (027 / #161). */
        verifyPath?: (panelId: string) => void;
        resync: (panelId: string) => Promise<import('@throng/core').ResetDocumentMsg | null>;
        /** Restore crash-recovered content into the authority, dirty vs the disk file (FR-102). */
        restoreRecovered: (panelId: string, text: string, history?: unknown) => Promise<void>;
        /** THIS panel's crash snapshot — never the whole recovery directory (FR-027b). */
        recoverOne: (
          panelId: string,
        ) => Promise<{ text: string; version: number; history?: unknown } | null>;
        getContent: (
          panelId: string,
        ) => Promise<{
          text: string;
          dirty: boolean;
          /** The authority's version — where a mounting replica starts counting from. */
          version: number;
          absPath: string | null;
          fileMissing: boolean;
          /** The path could not be read when this document was adopted (027 / #161). */
          unloadable?: boolean;
          /** The FILE's own encoding, learnt from its bytes — never the app defaults (FR-023). */
          encoding: import('@throng/core').EncodingId;
          hasBom: boolean;
          lineEnding: import('@throng/core').LineEndingId;
        } | null>;
        chooseSavePath: (req: {
          defaultDir?: string;
          defaultName?: string;
        }) => Promise<string | null>;
        save: (req: unknown) => Promise<EditorSaveResult>;
        saveAll: (req: unknown) => Promise<EditorSaveAllResult>;
        openInto: (req: {
          absPath: string;
        }) => Promise<
          { action: 'focus'; panelId: string; windowId: string } | { action: 'open' }
        >;
        isOpen: (absPath: string) => Promise<boolean>;
        list: () => Promise<
          Array<{
            panelId: string;
            absPath: string | null;
            dirty: boolean;
            ownerKind: string;
          }>
        >;
        recover: () => Promise<
          Array<{ panelId: string; text: string; version: number; history?: unknown }>
        >;
        subWorkspaceFiles: () => Promise<Array<{ filePath: string }>>;
        destroy: (panelId: string) => void;
        /** The authority's ordered stream for a document shown in this window (FR-028f). */
        onSync: (
          cb: (msg: {
            panelId: string;
            change?: import('@throng/core').CanonicalChangeMsg;
            reset?: import('@throng/core').ResetDocumentMsg;
            dirty?: boolean;
            deleted?: boolean;
            /** The path became unreadable (true) or readable again (false) — 027 / #161. */
            unloadable?: boolean;
            externalChange?: boolean;
            wordWrap?: boolean;
            /** throng moved the file: the document's new absolute path (019, FR-002). */
            movedTo?: string;
          }) => void,
        ) => () => void;
        onFocus: (cb: (msg: { panelId: string }) => void) => () => void;
      };
    };
  }
}

/** Result of `window.throng.editor.load`. */
export type EditorLoadResult =
  | {
      ok: true;
      text: string;
      encoding: 'utf8';
      hasBom: boolean;
      lineEnding: 'lf' | 'crlf' | 'cr';
      relativeFolder: string | null;
    }
  // 018 / US9 — the reasons a load can be REFUSED, kept distinct from the reasons it can FAIL.
  // `out-of-tree` is a file that exists and is not permitted here; `folder` is not a file at all;
  // `not-found` is a genuine absence. They used to collapse into `io`, which is how an ownership
  // refusal came to be announced as a missing file and then suppressed by a preference about missing
  // files — a rejection that says nothing at all (FR-061).
  | {
      ok: false;
      reason: 'binary' | 'too-large' | 'io' | 'out-of-tree' | 'folder' | 'not-found';
      error: string;
    };

/** Result of `window.throng.editor.resolveDrop` — may this dropped path be opened here? (018 / US9.) */
export type EditorDropResult =
  | { ok: true; absPath: string }
  | {
      ok: false;
      reason: 'out-of-tree' | 'folder' | 'too-large' | 'io' | 'not-found';
      error: string;
    };

/** Result of `window.throng.editor.save`. */
export type EditorSaveResult =
  | { ok: true; absPath: string; encoding: 'utf8'; lineEnding: 'lf' | 'crlf' | 'cr' }
  | { ok: false; reason: 'out-of-tree' | 'no-location' | 'io'; error: string };

/** Result of `window.throng.editor.saveAll`. */
export interface EditorSaveAllResult {
  saved: string[];
  skippedUnpathed: string[];
  failed: { panelId: string; reason: string }[];
}

/** Payload for the app-close warning: the running terminals + their labels (FR-015). */
export interface AppCloseTerminal {
  panelId: string;
  meta?: { projectName?: string; tabName?: string; panelName?: string; flavourLabel?: string };
}
export interface AppClosePromptInfo {
  /** Running-terminal count, or null when the count query failed. */
  count: number | null;
  terminals: AppCloseTerminal[];
}

/**
 * One built-in returned by `window.throng.terminal.listDetectedFlavours` (019) — what the machine
 * HAS. It carries neither `source` nor a resolved `defaultShellArguments`: a picker wants neither, and the
 * shape says so.
 */
export interface DetectedFlavourDto {
  id: string;
  label: string;
  file: string;
}

/** One Flavour returned by `window.throng.terminal.listFlavours` (mirrors core TerminalFlavour). */
export interface TerminalFlavourDto {
  id: string;
  label: string;
  file: string;
  args: string[];
  source: 'builtin' | 'user';
  defaultShellArguments: string;
  /** 025 follow-up: can this shell report its working directory as configured? */
  reportsDirectory?: boolean;
}

/** Result of `window.throng.terminal.attach`. */
export type TerminalAttachEnvelope =
  | {
      ok: true;
      status: 'running' | 'exited';
      scrollback: string;
      /** The session's shared grid — the attaching view conforms its xterm to it (008 FR-009). */
      grid?: { cols: number; rows: number };
      /**
       * The daemon already forced the program to redraw as part of this attach (028 follow-up), so
       * this view must NOT ask for another one — every forced redraw is a full-screen repaint the
       * user sees as a flash.
       */
      redrawn?: boolean;
      /** The program owns the alternate screen (028 follow-up) — the view must match, or it
       *  reclaims keys the program owns. */
      altScreen?: boolean;
      /**
       * What the program has negotiated about the keyboard (#290) — the companion to `altScreen`
       * above. A rebuilt view adopts this instead of re-deriving it from the replayed tail, which
       * still contains the sequences that produced it and would count every push a second time.
       */
      keyboard?: import('@throng/core').KittyKeyboardState;
      exit?: { code: number | null };
      /** A remembered directory that no longer exists; the terminal started at the root (FR-005b). */
      cwdFallback?: string;
    }
  // `stillStarting` marks a non-fatal attach timeout (008 FR-005): the session may still
  // be launching; the view shows a "still starting" state with a retry, not a hard error.
  | {
      ok: false;
      stillStarting?: boolean;
      error: { code: number | null; message: string };
      /**
       * The classified reason, where the daemon could derive one (029, FR-003).
       *
       * Its ABSENCE is meaningful: an unclassifiable start failure — a flavour that no longer
       * resolves, a broken shell path — is a configuration the user must re-choose, and the panel
       * reverts to the type-selection form exactly as it does today.
       */
      cause?: import('@throng/core').FailureCause;
    };

/** One session row from `window.throng.terminal.list`. */
export interface TerminalSessionDto {
  panelId: string;
  projectId: string;
  status: 'running' | 'exited';
  busy: boolean;
}

/** One immediate child returned by `window.throng.files.list` (mirrors core DirEntry). */
export interface FileTreeEntry {
  name: string;
  kind: 'file' | 'folder';
  isSymlink: boolean;
  hasChildren?: boolean;
}

/**
 * A file operation that failed (029, FR-018).
 *
 * `error` is the sentence to show. `cause` is the classification main already made — present only
 * when the failure was one of the five kinds. It carries the raw errno, so a spoken sentence does not
 * cost the bug report its evidence, and it carries the kind and subject, from which the notice layer
 * derives the suppression key that collapses a cascade into one notice.
 */
export interface FilesFailure {
  error: string;
  cause?: import('@throng/core').FailureCause;
}

export type FilesOkOrError = { ok: true } | FilesFailure;

/** Config document identity for the preferences write path (mirrors core ConfigDocId). */
export type ThrongConfigDocId =
  | { kind: 'settings' }
  | { kind: 'keybindings' }
  | { kind: 'theme'; name: string };

/** Result of `window.throng.config.write` (FR-016/017/042). */
export type ConfigWriteResult = { ok: true } | { ok: false; error: string; detail?: string };

/** An icon value: a glyph, or a pack-relative image filename (mirrors core IconValue). */
export type IconValueDto = { glyph: string } | { image: string };

/**
 * What an icon token RENDERS AS (017 / #54). `svg` carries sanitised MARKUP, not a path: an SVG
 * inside an `<img>` is an isolated document whose `currentColor` resolves to black instead of to
 * the theme, so inlining is the only way a pack icon can take the theme's colour.
 */
export type IconAssetDto =
  | { kind: 'glyph'; glyph: string }
  | { kind: 'svg'; markup: string }
  | { kind: 'raster'; dataUri: string }
  | { kind: 'missing' };

/**
 * One discovered icon pack (007; assets added by 017).
 *
 * Note there is no `assetBase`: the renderer must not be able to reach the disk on the render path,
 * so it receives loaded assets rather than a directory to read from.
 */
export interface IconPackInfo {
  name: string;
  tokens: Record<string, IconValueDto>;
  assets: Record<string, IconAssetDto>;
  /** Why the pack could not be loaded — shown in the Icons picker (FR-004a). */
  error?: string;
}

export {};
