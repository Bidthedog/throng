import { useEffect, useRef, useState, type ReactElement } from 'react';
import { resolveAction, activeContextLabel } from '@throng/core';
import { EditorChrome } from './editor/editor-chrome.js';
import { useCapabilities } from './panel-type/use-capabilities.js';
import { ProjectsPanel } from './sidebar/projects-panel.js';
import { SubworkspacesPanel } from './sidebar/subworkspaces-panel.js';
import { useProjects } from './state/projects-store.js';
import { WorkspaceProvider, useWorkspace } from './state/workspace-store.js';
import { useServices } from './composition-root.js';
import { TabGroup } from './workspace/tab-group.js';
import { DetachProvider } from './workspace/detach-context.js';
import { PanelRenameSync } from './workspace/panel-rename-sync.js';
import { PanelDestroySync } from './workspace/panel-destroy-sync.js';
import { PanelStateSync } from './workspace/panel-state-sync.js';
import { RestoreNotice } from './workspace/restore-notice.js';
import { AppClosePrompt } from './app-close-prompt.js';
import { useResize } from './util/use-resize.js';
import { ThemeProvider } from './theme/theme-provider.js';
import { useActiveTheme, useAppSettings, useKeybindings } from './config/config-store.js';
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
    window.throng?.setTitle?.(`throng — ${label}${elevated ? ' [ADMIN]' : ''}`);
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
  const cbRef = useRef({ onToggleProjects, onToggleExplorer });
  cbRef.current = { onToggleProjects, onToggleExplorer };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const action = resolveAction(keybindings, { key: e.key, ctrl: e.ctrlKey, alt: e.altKey });
      if (!action) return;
      e.preventDefault();
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
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
  const identity = `throng — ${[project, context].filter(Boolean).join(' · ')}${
    elevated ? ' [ADMIN]' : ''
  }`;
  return <TitleBar identity={identity} colour={activeProject?.colour} showCog />;
}

/**
 * The Workspace Pane (Principle XI / FR-010): the active project's tab group of
 * split placeholder Panels, or an empty state when no project is selected.
 */
function WorkspacePane(): ReactElement {
  const { layout, restoreFailed } = useWorkspace();
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
      {restoreFailed ? <RestoreNotice /> : null}
      <TabGroup />
    </main>
  );
}

export function App(): ReactElement {
  const { activeProject } = useProjects();
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
          <div
            ref={shellRef}
            className={`throng-shell${sidebarWidth.dragging || explorerWidth.dragging ? ' throng-shell--no-anim' : ''}`}
            data-testid="throng-shell"
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
            <PanelRenameSync />
            <PanelDestroySync />
            <PanelStateSync />
            <EditorChrome />
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
