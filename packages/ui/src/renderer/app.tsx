import { useEffect, useRef, useState, type ReactElement } from 'react';
import { activeContextLabel, effectiveActivePanelId } from '@throng/core';
import { MAIN_WINDOW_CAPABILITIES, WindowDispatcher } from './keybindings/window-dispatcher.js';
import { EditorChrome } from './editor/editor-chrome.js';
import { NavigationChrome } from './navigate/navigation-chrome.js';
import { TransientScrim } from './common/transient-scrim.js';
import { FindInFilesChrome } from './find-in-files/find-in-files-chrome.js';
import { SearchKeybindings } from './search/search-keybindings.js';
import { useCapabilities } from './panel-type/use-capabilities.js';
import { ProjectsPanel } from './sidebar/projects-panel.js';
import { SubworkspacesPanel } from './sidebar/subworkspaces-panel.js';
import { useProjects } from './state/projects-store.js';
import { WorkspaceProvider, useWorkspace } from './state/workspace-store.js';
import { useServices } from './composition-root.js';
import { TabGroup } from './workspace/tab-group.js';
import { requestPanelFocus } from './workspace/panel-focus.js';
import { consumeProjectSwitchPendingFor, setActivePane } from './workspace/active-pane.js';
import { MouseZoomHandler } from './workspace/mouse-zoom.js';
import { DetachProvider } from './workspace/detach-context.js';
import { PanelRenameSync } from './workspace/panel-rename-sync.js';
import { PanelDestroySync } from './workspace/panel-destroy-sync.js';
import { PanelStateSync } from './workspace/panel-state-sync.js';
import { PanelNameSync } from './workspace/panel-name-sync.js';
import { useErrorNotice } from './common/notification.js';
import { windowTitle } from './common/window-title.js';
import { HoverSuppression } from './common/use-hover-suppression.js';
import { AppClosePrompt } from './app-close-prompt.js';
import { useResize } from './util/use-resize.js';
import { ThemeProvider } from './theme/theme-provider.js';
import {
  useActiveTheme,
  useAppSettings,
  useConfigLoaded,
} from './config/config-store.js';
import { Spinner, useDelayedFlag } from './common/loading.js';
import { StatusBar } from './statusbar/status-bar.js';
import { Chevron } from './panes/chevron.js';
import { VerticalPanelStack } from './panes/vertical-panel-stack.js';
import { FileExplorerPane } from './panes/file-explorer-pane.js';
import { usePersistedBool } from './panes/use-persisted-bool.js';
import { TitleBar } from './title-bar/title-bar.js';
import { useConfigWriteFailureNotices } from './config/config-write-notices.js';
import { railWidthPx } from './panes/rail-width.js';


/** The middle (workspace) pane never shrinks below this; the side panes yield to
 *  preserve it (right/Explorer first, then the left sidebar). The app's minimum
 *  window width (main.ts) is sized so this still holds with both sides at min. */
const WORKSPACE_MIN_WIDTH = 480;

/** Shared minimum width (px) for the left sidebar and right Explorer panes. */
const SIDE_PANE_MIN_WIDTH = 250;


/**
 * Keeps the window title a live view of the active context (FR-040): the active
 * project name, the active Tab · Panel (the same `activeContextLabel` the status bar
 * uses, so they can't drift), and a trailing `[ADMIN]` marker when throng runs
 * elevated (the same daemon-capability signal as the status-bar pill, FR-025e). No
 * path and no project/tab/panel totals. "No project" when nothing is open.
 */
function TitleManager(): null {
  const { activeProject } = useProjects();
  const { layout } = useWorkspace();
  const { elevated } = useCapabilities();
  useEffect(() => {
    const project = activeProject?.name ?? 'No project';
    const context = layout ? activeContextLabel(layout) : '';
    const label = [project, context].filter(Boolean).join(' · ');
    // Fold [ADMIN] into the middle BEFORE the suffix, so the title still ends ` — throng`.
    window.throng?.setTitle?.(windowTitle(`${label}${elevated ? ' [ADMIN]' : ''}`));
  }, [activeProject, layout, elevated]);
  return null;
}

/**
 * The MAIN window's mount of the shared window dispatcher (048 R5, FR-090): the pane toggles and
 * reveals act on `App()`'s own persisted pane state, so they are threaded in here. The dispatcher
 * itself — every window chord, split mode, the Open Link chord — is
 * `keybindings/window-dispatcher.tsx`, the same code a sub-workspace window mounts.
 *
 * Kept under its old name because a component test presses chords "through the main window's
 * handler" by mounting it.
 */
export function KeybindingsHandler({
  onToggleProjects,
  onToggleExplorer,
  onRevealLeft,
  onRevealRight,
}: {
  onToggleProjects: () => void;
  onToggleExplorer: () => void;
  /** 046 US2 (FR-017) — reveal the sidebar/File Explorer pane if hidden; a no-op if already shown. */
  onRevealLeft: () => void;
  onRevealRight: () => void;
}): ReactElement {
  return (
    <WindowDispatcher
      capabilities={MAIN_WINDOW_CAPABILITIES}
      onToggleProjects={onToggleProjects}
      onToggleExplorer={onToggleExplorer}
      onRevealLeft={onRevealLeft}
      onRevealRight={onRevealRight}
    />
  );
}

/**
 * Route DOM focus into the active panel when the user SWITCHES tabs or projects (issue 144).
 *
 * The active editor restores its caret on remount, but making that caret LIVE needs DOM focus — and
 * on a PROJECT switch the click lands on the (focusable) project button in the sidebar while the new
 * project's editor mounts behind an async layout load, so a focus fired inside that mount is lost in
 * the churn (position comes back; the caret does not). This watches the SETTLED layout instead: when
 * the active tab changes between two real tabs — a tab OR project switch — it asks the active panel to
 * take focus as soon as it is mounted ({@link requestPanelFocus} parks the request until then).
 *
 * The trigger is a change of ACTIVE TAB, which is exactly what a project/tab switch does and a plain
 * file-open does NOT: opening a file in the tree replaces the active editor's document but keeps the
 * active tab, so this never fires there and the tree stays focused for F2-rename (the constraint that
 * shaped the mount-time gate in use-editor.ts). Opening the first project (null→tab) is a genuine,
 * user-initiated navigation — startup auto-opens nothing, so the first non-null tab is always a click
 * — so it fires there too. A panel that is a bare placeholder registers no focus callback, so
 * requesting its focus is a harmless no-op; only a real input surface (editor/terminal) is focused.
 */
export function PanelFocusSync(): null {
  const { layout } = useWorkspace();
  const activeTabId = layout?.activeTabId ?? null;
  const activeTab = layout?.tabs.find((t) => t.id === activeTabId);
  const activePanelId = activeTab ? effectiveActivePanelId(activeTab) : null;
  const prevTabRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevTabRef.current;
    prevTabRef.current = activeTabId;
    /*
     * FR-082 (046 iterate round 1) — a PROJECT switch (a click/Enter on a project row, or the
     * project.next/previous chord — `projects-store.tsx`'s `switchProject` marks every one of them)
     * never claims the workspace on its own; the active pane stays exactly where it was.
     *
     * Fix-round-2 (branch review hypothesis) — consumed as soon as THIS project's layout settles
     * (`layout?.projectId` matches the switch's own target), decoupled from the `activeTabId !==
     * null && … && activePanelId` focus-delivery guard below. Consuming it only INSIDE that guard
     * left the mark stuck for a switch into a project with no tabs (or whose active tab holds no
     * panel), which never satisfies it: the mark then wrongly suppressed the workspace claim for
     * whatever activeTabId change came next.
     */
    if (consumeProjectSwitchPendingFor(layout?.projectId ?? null)) return;
    if (activeTabId !== null && prev !== activeTabId && activePanelId) {
      /*
       * US2 fix round 1 (review finding 1, FR-014/FR-015) — the same pairing `open-in-editor.ts`,
       * `open-preview.ts` and `tab-group.tsx` already make at THEIR point of delivering focus into a
       * panel. Before this, a same-project tab switch (Ctrl+Tab, `tab-picker.tsx`) left the active
       * pane on whatever claimed it last (a pointerdown/focus on the Projects pane, FR-015) even once
       * focus genuinely moved into a workspace Panel here — so `EditorKeybindings`'s
       * `getActivePane() !== 'workspace'` gate (editor-chrome.tsx) stayed shut and Ctrl+S was a no-op
       * until the user clicked inside the editor by hand. A tab switch within the SAME project
       * reaching here is the same fact: real focus is about to move into a workspace Panel, so the
       * pane it belongs to is what must be live.
       */
      setActivePane('workspace');
      requestPanelFocus(activePanelId);
    }
  }, [activeTabId, activePanelId, layout?.projectId]);
  return null;
}

/**
 * The application-drawn title bar for the MAIN window (007, FR-001/003/005): the
 * app/active-context identity (the same signal `TitleManager` sends to the OS
 * taskbar) plus the dominant project colour, and the cog (main window only). The
 * OS title bar is gone (frameless window); this bar is its replacement.
 */
export function AppTitleBar(): ReactElement {
  const { activeProject } = useProjects();
  const { layout } = useWorkspace();
  const { elevated } = useCapabilities();
  const project = activeProject?.name ?? 'No project';
  const context = layout ? activeContextLabel(layout) : '';
  const identity = windowTitle(
    `${[project, context].filter(Boolean).join(' · ')}${elevated ? ' [ADMIN]' : ''}`,
  );
  return <TitleBar identity={identity} colour={activeProject?.colour} showCog />;
}

/**
 * The Workspace Pane (Principle XI / FR-010): the active project's tab group of
 * split placeholder Panels, or an empty state when no project is selected.
 */
function WorkspacePane(): ReactElement {
  const { layout, restoreFailed } = useWorkspace();

  // 018 / FR-051 — the restore notice was the fifth idiom, and the only NON-DISMISSABLE one: a
  // stateless component with no dismiss path, so the only way to be rid of it was to make the
  // condition it reported stop being true. It is an ordinary notice now, and it can be dismissed.
  useErrorNotice(
    restoreFailed ? 'A fresh workspace was opened instead.' : null,
    'restore-notice',
    /*
     * NO SUBJECT (030 FR-019/FR-027). What failed to restore is the WHOLE previous layout — every
     * tab and every panel in it, none of which exists to be named, because the failure is precisely
     * that they could not be brought back. `NoticeSubject` names one thing; there is no one thing
     * here, and naming the project would say a project failed when the project opened fine.
     */
    { kind: 'none' },
    undefined,
    'restore your previous layout',
  );

  if (!layout) {
    return (
      <main className="pane pane--workspace" data-testid="workspace-pane">
        <div className="workspace-empty" data-testid="workspace-no-project">
          <p>No project selected. Create a project to open its workspace.</p>
        </div>
      </main>
    );
  }
  return (
    <main className="pane pane--workspace" data-testid="workspace-pane" data-project={layout.projectId}>
      {/* 018 / FR-051 — the RESTORE NOTICE was the fifth idiom and the only NON-DISMISSABLE one: a
          stateless component with no dismiss path at all, so the only way to be rid of it was to
          make the condition it reported stop being true. It is an ordinary notice now, and it can
          be dismissed like every other. Its colours were hard-coded outright (#3a3320 on #ffe08a). */}
      <TabGroup />
    </main>
  );
}

/**
 * Whether the shell has the data it needs to render fully-formed (issue 132
 * follow-up). Both signals are single mount-time IPC round-trips: the config
 * payload (theme, settings, keybindings AND icon packs) and the project list.
 * Holding the shell until both land means the window never shows the default theme
 * being corrected, the project list flashing "No projects yet" then filling, or
 * every icon swapping from a fallback glyph to its pack art — all three resolve
 * from these two loads. Bounded by a timeout so a slow/unreachable daemon falls
 * through to the eager render rather than hanging the window.
 */
function useAppReady(): boolean {
  const configLoaded = useConfigLoaded();
  const { loading: projectsLoading } = useProjects();
  const dataReady = configLoaded && !projectsLoading;
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (dataReady) return undefined;
    const timer = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(timer);
  }, [dataReady]);
  return dataReady || timedOut;
}

/**
 * The themed holding surface shown while {@link useAppReady} is false. It is just
 * the app background (the preload already painted the saved theme), so a fast load
 * shows a calm themed frame and then the finished UI. A spinner appears only if the
 * wait outlasts a short delay, so a normal-speed launch never flashes one.
 */
function AppLoading(): ReactElement {
  const showSpinner = useDelayedFlag(250);
  return (
    <div className="throng-loading" data-testid="app-loading" aria-busy>
      {showSpinner ? <Spinner label="Loading throng" /> : null}
    </div>
  );
}

export function App(): ReactElement {
  /*
   * The main window reports its own failed config writes (032, US3 / spec 030's G-09 finding).
   *
   * `onConfigWriteFailed`'s listener set is module-scoped and each window loads its own instance, so
   * a subscriber mounted in the Preferences window cannot hear a failure raised here. The main
   * window really does write settings — creating a project calls `persistLastProjectFolder` — so
   * until now a write that failed here was published into a registry nothing was listening to, and
   * the user was told nothing at all.
   *
   * Sub-workspace windows deliberately do NOT mount this: they issue no configuration write of any
   * kind, so a subscriber there could never fire.
   */
  useConfigWriteFailureNotices();

  const { activeProject } = useProjects();
  const appReady = useAppReady();
  const { workspace } = useServices();
  // Side panes share a 250px min; the max is user-configurable per pane in
  // settings.json (panes.projects.maxWidth / panes.fileExplorer.maxWidth).
  const settings = useAppSettings();
  const sidebarWidth = useResize({
    initial: 260,
    min: SIDE_PANE_MIN_WIDTH,
    max: settings.panes.projects.maxWidth,
    axis: 'x',
    storageKey: 'throng.sidebarWidth',
  });
  const explorerWidth = useResize({
    initial: 320,
    min: SIDE_PANE_MIN_WIDTH,
    max: settings.panes.fileExplorer.maxWidth,
    axis: 'x',
    invert: true, // handle is on the pane's leading (left) edge
    storageKey: 'throng.explorerWidth',
  });

  // Enforce a lowered configured max live (e.g. after a settings hot-reload).
  const sidebarSet = sidebarWidth.set;
  const explorerSet = explorerWidth.set;
  useEffect(() => {
    if (sidebarWidth.value > sidebarWidth.max) sidebarSet(sidebarWidth.max);
  }, [sidebarWidth.value, sidebarWidth.max, sidebarSet]);
  useEffect(() => {
    if (explorerWidth.value > explorerWidth.max) explorerSet(explorerWidth.max);
  }, [explorerWidth.value, explorerWidth.max, explorerSet]);

  // Side-pane visibility (FR-007/009). Left shows by default (even with no
  // project, so a project can be selected); the right File Explorer pane shows by
  // default only when a project is active, and defaults collapsed otherwise — but
  // the user may still expand it to its empty placeholder.
  const projectActive = Boolean(activeProject);
  const leftVisible = usePersistedBool('throng.sidebarVisible', true);
  const explorerPref = usePersistedBool('throng.explorerVisible', true);
  const explorerNoProject = usePersistedBool('throng.explorerVisibleNoProject', false);
  const rightToggle = projectActive ? explorerPref : explorerNoProject;

  // When the window is too narrow to fit both expanded side panes (even at their
  // min width) plus the workspace minimum, panes auto-collapse to their rail —
  // Explorer (right) first, then the sidebar (left) — and auto-restore when the
  // window widens again (only panes the user actually wants expanded). These flags
  // are derived purely from width below, so the restore is automatic.
  const [autoLeft, setAutoLeft] = useState(false);
  const [autoRight, setAutoRight] = useState(false);
  const [shellWidth, setShellWidth] = useState(0);
  const leftShown = leftVisible.value && !autoLeft;
  const rightShown = rightToggle.value && !autoRight;

  // Render-time width clamp: a shown pane that doesn't fit at its set width (e.g.
  // the user expanded it while the window is narrower than its width + workspace
  // clearance) renders at a sensible width — reduced toward its min, Explorer first
  // — instead of crushing the workspace. This is display-only (the stored width is
  // untouched), so the pane grows back to its set width when the window widens.
  // Live theme from the user config (hot-reloads when themes/*.json changes).
  const activeTheme = useActiveTheme();
  // #381 — a collapsed rail is sized around its collapse control, which grows with the icon size.
  const railWidth = railWidthPx(activeTheme.sizes?.iconPx ?? 16);

  let leftW = leftShown ? sidebarWidth.value : railWidth;
  let rightW = rightShown ? explorerWidth.value : railWidth;
  if (shellWidth > 0) {
    let over = leftW + rightW + WORKSPACE_MIN_WIDTH - shellWidth;
    if (over > 0 && rightShown) {
      const next = Math.max(SIDE_PANE_MIN_WIDTH, rightW - over);
      over -= rightW - next;
      rightW = next;
    }
    if (over > 0 && leftShown) {
      leftW = Math.max(SIDE_PANE_MIN_WIDTH, leftW - over);
    }
  }
  const leftCol = `${leftW}px`;
  const rightCol = `${rightW}px`;

  // Width coordinator: keep the middle (workspace) pane at WORKSPACE_MIN_WIDTH by
  // auto-collapsing the side panes (Explorer/right first, then the sidebar/left) to
  // their rails when they no longer fit at the USER'S SET WIDTHS — the panes are
  // never shrunk, only collapsed. They auto-restore when the window widens again.
  //
  // CRITICAL: this only recomputes on an actual shell WIDTH change (ResizeObserver),
  // never on a user toggle — otherwise expanding a pane at the minimum window size
  // would be undone on the same tick (flash / no-op). A user's explicit expand
  // therefore sticks (the workspace yields below its min if it must). State is read
  // through a ref so the observer always sees current values without re-subscribing.
  const shellRef = useRef<HTMLDivElement>(null);
  const coordRef = useRef({
    userLeft: leftVisible.value,
    userRight: rightToggle.value,
    sidebarW: sidebarWidth.value,
    explorerW: explorerWidth.value,
    railW: railWidth,
  });
  coordRef.current = {
    userLeft: leftVisible.value,
    userRight: rightToggle.value,
    sidebarW: sidebarWidth.value,
    explorerW: explorerWidth.value,
    railW: railWidth,
  };
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const coordinate = (): void => {
      const total = el.clientWidth;
      if (total <= 0) return;
      setShellWidth(total); // drives the render-time width clamp above
      const c = coordRef.current;
      // Footprint of each pane at the user's set width (or a rail when collapsed).
      const occLeft = c.userLeft ? c.sidebarW : c.railW;
      const occRight = c.userRight ? c.explorerW : c.railW;
      let needRight = false;
      let needLeft = false;
      if (occLeft + occRight + WORKSPACE_MIN_WIDTH > total) {
        if (c.userRight) {
          needRight = true; // Explorer collapses first
          if (c.userLeft && c.sidebarW + c.railW + WORKSPACE_MIN_WIDTH > total) needLeft = true;
        } else if (c.userLeft) {
          needLeft = true; // Explorer already a rail → collapse the sidebar
        }
      }
      setAutoRight(needRight);
      setAutoLeft(needLeft);
    };
    coordinate();
    const ro = new ResizeObserver(coordinate);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Collapse-button handlers reflect the EFFECTIVE state. Showing a pane clears its
  // auto-collapse flag and records the user's intent; because the coordinator above
  // does NOT run on this state change, the pane opens and stays open even at the
  // minimum window size (the workspace simply gets smaller).
  const toggleLeft = (): void => {
    if (leftShown) leftVisible.set(false);
    else {
      setAutoLeft(false);
      leftVisible.set(true);
    }
  };
  const toggleRight = (): void => {
    if (rightShown) rightToggle.set(false);
    else {
      setAutoRight(false);
      rightToggle.set(true);
    }
  };
  // 046 US2 (FR-017) — IDEMPOTENT reveal, over the same setters the collapse buttons use: a no-op
  // when the pane is already shown, so `focus.explorer` / `focus.projects` never hide a pane that
  // was already open the way a plain toggle would.
  const revealLeft = (): void => {
    if (!leftShown) {
      setAutoLeft(false);
      leftVisible.set(true);
    }
  };
  const revealRight = (): void => {
    if (!rightShown) {
      setAutoRight(false);
      rightToggle.set(true);
    }
  };

  return (
    <ThemeProvider theme={activeTheme}>
      <WorkspaceProvider client={workspace} activeProjectId={activeProject?.id ?? null}>
        <DetachProvider>
        <div className="throng-root">
          <AppTitleBar />
          {!appReady ? <AppLoading /> : null}
          <div
            ref={shellRef}
            className={`throng-shell${sidebarWidth.dragging || explorerWidth.dragging ? ' throng-shell--no-anim' : ''}`}
            data-testid="throng-shell"
            hidden={!appReady}
            style={{ gridTemplateColumns: `${leftCol} 1fr ${rightCol}` }}
          >
            {/* The collapse button is absolutely pinned to the pane's top-outer
                corner, rendered in BOTH states so it never moves or resizes when
                collapsing (FR #3). Expanded: it sits next to the panel title (which
                is padded to clear it) and no rail strip exists. Collapsed: only the
                rail (button + rotated label) remains. */}
            <aside
              className={`pane pane--sidebar${leftShown ? '' : ' pane--collapsed'}`}
              data-testid="sidebar-pane"
            >
              <button
                type="button"
                className="pane-collapse pane-collapse--left"
                data-testid={leftShown ? 'pane-hide-left' : 'pane-show-left'}
                title={`${leftShown ? 'Hide' : 'Show'} Projects & Sub-workspaces`}
                onClick={toggleLeft}
              >
                <Chevron dir={leftShown ? 'left' : 'right'} />
              </button>
              {leftShown ? (
                <>
                  <div className="pane-sidebar__body">
                    <VerticalPanelStack
                      storageKey="throng.sidebarPanelSizes"
                      panels={[
                        {
                          key: 'projects',
                          minHeight: 120,
                          defaultHeight: 340,
                          dividerTestId: 'sidebar-vresize',
                          render: () => <ProjectsPanel />,
                        },
                        {
                          key: 'subworkspaces',
                          minHeight: 160,
                          defaultHeight: 180,
                          className: 'sidebar-panel--subworkspaces',
                          dividerTestId: 'sidebar-vresize-sub',
                          render: () => <SubworkspacesPanel />,
                        },
                      ]}
                    />
                  </div>
                  <div
                    className={`resize-handle resize-handle--vertical${sidebarWidth.dragging ? ' resize-handle--active' : ''}`}
                    data-testid="sidebar-hresize"
                    onPointerDown={sidebarWidth.start}
                    aria-hidden
                  />
                </>
              ) : (
                <div className="pane-rail" data-testid="pane-rail-left">
                  <span className="pane-rail__label">Projects &amp; Sub-workspaces</span>
                </div>
              )}
            </aside>
            <TitleManager />
            <HoverSuppression />
            <PanelRenameSync />
            <PanelDestroySync />
            <PanelStateSync />
      <PanelNameSync />
            <PanelFocusSync />
            <EditorChrome />
            {/* 043 — the one registration that turns the two chords, the toolbar control and the
                folder menu item into an opened panel. A sub-workspace window is its own renderer
                realm and mounts its own copy. */}
            <FindInFilesChrome />
            {/* 033 (#219) — the navigation modals. Mounted in BOTH window shells; the
                sub-workspace's copy is in `subworkspace-app.tsx` (Assumption 6). */}
            <TransientScrim />
            <NavigationChrome />
            <SearchKeybindings />
            <KeybindingsHandler
              onToggleProjects={toggleLeft}
              onToggleExplorer={toggleRight}
              onRevealLeft={revealLeft}
              onRevealRight={revealRight}
            />
            {/* 046 iterate round 1 (T118/T119, FR-106) — Ctrl+wheel / Ctrl+middle-click zoom the
                panel under the pointer. A sub-workspace window is its own renderer realm and
                mounts its own copy (`subworkspace-app.tsx`). */}
            <MouseZoomHandler />
            <WorkspacePane />
            <section
              className={`pane pane--explorer${rightShown ? '' : ' pane--collapsed'}`}
              data-testid="file-explorer-pane"
            >
              <button
                type="button"
                className="pane-collapse pane-collapse--right"
                data-testid={rightShown ? 'pane-hide-right' : 'pane-show-right'}
                title={`${rightShown ? 'Hide' : 'Show'} File Explorer`}
                onClick={toggleRight}
              >
                <Chevron dir={rightShown ? 'right' : 'left'} />
              </button>
              {rightShown ? (
                <FileExplorerPane onResizeStart={explorerWidth.start} resizing={explorerWidth.dragging} />
              ) : (
                <div className="pane-rail" data-testid="pane-rail-right">
                  <span className="pane-rail__label">File Explorer</span>
                </div>
              )}
            </section>
          </div>
          <StatusBar />
          <AppClosePrompt />
        </div>
        </DetachProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
