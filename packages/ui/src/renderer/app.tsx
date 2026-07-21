import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  activeContextLabel,
  effectiveActivePanelId,
  moveFocus,
  cycleOrder,
  nextInCycle,
  type Direction,
  type LayoutNode,
} from '@throng/core';
import { resolveScoped, type ScopeInput } from './keybindings/scope.js';
import { EditorChrome } from './editor/editor-chrome.js';
import { SearchKeybindings } from './search/search-keybindings.js';
import { useCapabilities } from './panel-type/use-capabilities.js';
import { ProjectsPanel } from './sidebar/projects-panel.js';
import { SubworkspacesPanel } from './sidebar/subworkspaces-panel.js';
import { useProjects } from './state/projects-store.js';
import { WorkspaceProvider, useWorkspace } from './state/workspace-store.js';
import { useServices } from './composition-root.js';
import { TabGroup } from './workspace/tab-group.js';
import { focusPanel } from './workspace/panel-focus.js';
import { setActivePane } from './workspace/active-pane.js';
import { chordKey, isBackquote } from './config/chord-key.js';
import { DetachProvider } from './workspace/detach-context.js';
import { PanelRenameSync } from './workspace/panel-rename-sync.js';
import { PanelDestroySync } from './workspace/panel-destroy-sync.js';
import { PanelStateSync } from './workspace/panel-state-sync.js';
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
  useKeybindings,
} from './config/config-store.js';
import { Spinner, useDelayedFlag } from './common/loading.js';
import { StatusBar } from './statusbar/status-bar.js';
import { Chevron } from './panes/chevron.js';
import { VerticalPanelStack } from './panes/vertical-panel-stack.js';
import { FileExplorerPane } from './panes/file-explorer-pane.js';
import { usePersistedBool } from './panes/use-persisted-bool.js';
import { TitleBar } from './title-bar/title-bar.js';

/** Fixed width (px) of a collapsed side-pane rail. Sized so the 22px collapse
 *  button (pinned 5px from the outer edge) has an equal 5px margin on both sides. */
const RAIL_WIDTH = 32;

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
 * Resolves keyboard accelerators (zoom / fullscreen / pane toggles) from the user's
 * live keybindings (FR-033) on real DOM keydown events. Zoom/fullscreen dispatch
 * over the preload bridge; the pane toggles call back into the App. Shift is ignored
 * when matching because the default zoom bindings encode the produced character
 * (e.g. "Ctrl++" is Ctrl+Shift+"="). The latest toggle callbacks are read through a
 * ref so the listener isn't re-subscribed on every render.
 */
function KeybindingsHandler({
  onToggleProjects,
  onToggleExplorer,
}: {
  onToggleProjects: () => void;
  onToggleExplorer: () => void;
}): null {
  const keybindings = useKeybindings();
  const ws = useWorkspace();
  const cbRef = useRef({ onToggleProjects, onToggleExplorer });
  cbRef.current = { onToggleProjects, onToggleExplorer };
  // The workspace store is read through a ref so the keydown listener isn't
  // re-subscribed on every layout change (012 — per-type zoom routes to it).
  const wsRef = useRef(ws);
  wsRef.current = ws;
  useEffect(() => {
    // The id of the active panel — the target of per-panel zoom (012, per-instance).
    // undefined when there is no active panel, in which case a zoom command no-ops.
    const activePanelId = (): string | undefined => {
      const layout = wsRef.current.layout;
      if (!layout) return undefined;
      const tab = layout.tabs.find((t) => t.id === layout.activeTabId);
      return tab ? effectiveActivePanelId(tab) : undefined;
    };
    // What the scope provider needs to answer "which context is the keyboard in?" (016).
    const scopeInput = (): ScopeInput => {
      const layout = wsRef.current.layout;
      return { tabs: layout?.tabs, activeTabId: layout?.activeTabId ?? null };
    };
    // The active tab's split tree + active panel — the input to move-focus (012, US3).
    const activeFocus = (): { tabId: string; root: LayoutNode; activeId: string } | null => {
      const layout = wsRef.current.layout;
      if (!layout) return null;
      const tab = layout.tabs.find((t) => t.id === layout.activeTabId);
      if (!tab) return null;
      const activeId = effectiveActivePanelId(tab);
      if (!activeId) return null;
      return { tabId: tab.id, root: tab.root, activeId };
    };
    // Move the active panel AND transfer DOM focus (012, US3 fix): after changing
    // which panel is active, route real keyboard focus into its input surface so
    // typing follows the indicator — from and to terminals and editors alike.
    const goToPanel = (tabId: string, target: string): void => {
      wsRef.current.setActivePanel(tabId, target);
      setActivePane('workspace'); // a workspace Panel is now active (gates Ctrl+S etc.)
      focusPanel(target); // move the caret / input into the target view
    };
    const dispatchMove = (dir: Direction): void => {
      const f = activeFocus();
      if (!f) return;
      const target = moveFocus(f.root, f.activeId, dir); // null at the edge → stay put
      if (target && target !== f.activeId) goToPanel(f.tabId, target);
    };
    const dispatchCycle = (step: 1 | -1): void => {
      const f = activeFocus();
      if (!f) return;
      const target = nextInCycle(cycleOrder(f.root), f.activeId, step);
      if (target !== f.activeId) goToPanel(f.tabId, target);
    };
    // Actions this handler owns. Only these are intercepted (and stopped) in the
    // capture phase; anything else (editor.save, file.*, plain typing) is left for
    // the focused widget — so Ctrl+S in an editor and Ctrl+C in a terminal still work.
    const HANDLED: ReadonlySet<string> = new Set([
      'zoom.in',
      'zoom.out',
      'zoom.reset',
      'panel.zoomIn',
      'panel.zoomOut',
      'panel.zoomReset',
      'focus.left',
      'focus.right',
      'focus.up',
      'focus.down',
      'focus.cycle',
      'focus.cycleBack',
      'view.fullscreen',
      'view.toggleProjects',
      'view.toggleExplorer',
    ]);
    const onKeyDown = (e: KeyboardEvent): void => {
      // Shift is deliberately dropped for most keys (the produced character already
      // encodes it, e.g. "Ctrl++" is Ctrl+Shift+"="). The BACKTICK key is the
      // exception: it is normalised from its physical key and its Shift state IS the
      // signal that distinguishes focus.cycle from focus.cycleBack across layouts.
      const backtick = isBackquote(e);
      // Window-level chords are live in every scope (012, FR-024b) — including from inside an
      // editor's find bar, so the user can always move focus out of wherever they are. The
      // HANDLED gate below is what keeps this listener to zoom/focus/view and nothing else.
      const action = resolveScoped(
        keybindings,
        {
          key: chordKey(e),
          ctrl: e.ctrlKey,
          alt: e.altKey,
          ...(backtick ? { shift: e.shiftKey } : {}),
        },
        scopeInput(),
      );
      if (!action || !HANDLED.has(action)) return;
      // Capture phase: stop the focused terminal/editor from ALSO acting on the chord
      // (e.g. Git Bash turning Ctrl+Alt+Arrow into an escape sequence), then handle it.
      e.preventDefault();
      e.stopPropagation();
      switch (action) {
        case 'zoom.in':
          window.throng?.zoomBy?.(1);
          break;
        case 'zoom.out':
          window.throng?.zoomBy?.(-1);
          break;
        case 'zoom.reset':
          window.throng?.zoomReset?.();
          break;
        // Per-panel zoom (012, per-instance) — routed to the active panel by id.
        case 'panel.zoomIn': {
          const id = activePanelId();
          if (id) wsRef.current.bumpZoom(id, 1);
          break;
        }
        case 'panel.zoomOut': {
          const id = activePanelId();
          if (id) wsRef.current.bumpZoom(id, -1);
          break;
        }
        case 'panel.zoomReset': {
          const id = activePanelId();
          if (id) wsRef.current.resetZoom(id);
          break;
        }
        // Keyboard move-focus (012, US3) — routed to the active tab's split tree.
        case 'focus.left':
          dispatchMove('left');
          break;
        case 'focus.right':
          dispatchMove('right');
          break;
        case 'focus.up':
          dispatchMove('up');
          break;
        case 'focus.down':
          dispatchMove('down');
          break;
        case 'focus.cycle':
          dispatchCycle(1);
          break;
        case 'focus.cycleBack':
          dispatchCycle(-1);
          break;
        case 'view.fullscreen':
          window.throng?.fullscreenToggle?.();
          break;
        case 'view.toggleProjects':
          cbRef.current.onToggleProjects();
          break;
        case 'view.toggleExplorer':
          cbRef.current.onToggleExplorer();
          break;
        default:
          break;
      }
    };
    // Capture phase (third arg true): runs BEFORE the focused widget's own key
    // handlers, so move-focus/zoom chords are intercepted even inside a terminal.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [keybindings]);
  return null;
}

/**
 * The application-drawn title bar for the MAIN window (007, FR-001/003/005): the
 * app/active-context identity (the same signal `TitleManager` sends to the OS
 * taskbar) plus the dominant project colour, and the cog (main window only). The
 * OS title bar is gone (frameless window); this bar is its replacement.
 */
function AppTitleBar(): ReactElement {
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
    restoreFailed ? 'The previous layout could not be restored; a fresh workspace was opened.' : null,
    'restore-notice',
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
  let leftW = leftShown ? sidebarWidth.value : RAIL_WIDTH;
  let rightW = rightShown ? explorerWidth.value : RAIL_WIDTH;
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
  });
  coordRef.current = {
    userLeft: leftVisible.value,
    userRight: rightToggle.value,
    sidebarW: sidebarWidth.value,
    explorerW: explorerWidth.value,
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
      const occLeft = c.userLeft ? c.sidebarW : RAIL_WIDTH;
      const occRight = c.userRight ? c.explorerW : RAIL_WIDTH;
      let needRight = false;
      let needLeft = false;
      if (occLeft + occRight + WORKSPACE_MIN_WIDTH > total) {
        if (c.userRight) {
          needRight = true; // Explorer collapses first
          if (c.userLeft && c.sidebarW + RAIL_WIDTH + WORKSPACE_MIN_WIDTH > total) needLeft = true;
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

  // Live theme from the user config (hot-reloads when themes/*.json changes).
  const activeTheme = useActiveTheme();

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
            <EditorChrome />
            <SearchKeybindings />
            <KeybindingsHandler onToggleProjects={toggleLeft} onToggleExplorer={toggleRight} />
            <WorkspacePane />
            <section
              className={`pane pane--explorer${rightShown ? '' : ' pane--collapsed'}`}
              data-testid="file-explorer-pane"
            >
              <button
                type="button"
                className="pane-collapse pane-collapse--right"
                data-testid={rightShown ? 'pane-hide-right' : 'pane-show-right'}
                title={`${rightShown ? 'Hide' : 'Show'} Files & Folders`}
                onClick={toggleRight}
              >
                <Chevron dir={rightShown ? 'right' : 'left'} />
              </button>
              {rightShown ? (
                <FileExplorerPane onResizeStart={explorerWidth.start} resizing={explorerWidth.dragging} />
              ) : (
                <div className="pane-rail" data-testid="pane-rail-right">
                  <span className="pane-rail__label">Files &amp; Folders</span>
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
