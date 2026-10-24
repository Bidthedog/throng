/**
 * What can be done to a node, in the context menu and in the detail pane's action row (055 FR-062 –
 * FR-066).
 *
 * ══ THE ROWS ARE `actionsFor`'S; THE COMMANDS ARE THE ONES THRONG ALREADY HAS ══
 *
 * Which rows a node gets, and which are disabled and why, is core's `actionsFor`. What each runs is the
 * command throng already has — Unload Project (`use-unload-project`), Destroy Tab (`tab-destroy`) and
 * Destroy Panel (`panel-destroy`) with their own confirmations — and only the two kills are new
 * (`kill-confirm`). The monitor adds no variant of any of them (FR-063). Throng's own components have no
 * rows at all: absent, not disabled.
 *
 * ══ WHERE A PROJECT, TAB OR PANEL LIVES ══
 *
 * The monitor is its own window and holds none of them (FR-086), so every one of these is ROUTED through
 * main (`routeAction`) to the window that owns it, where that window's own confirmations apply: Unload
 * Project to the main window, Destroy Tab and Destroy Panel to whichever window holds the tab or panel.
 * A tab or panel is enabled whenever its project is the ACTIVE one, because only the active project's
 * layout is open and reported. Any other project, loaded or not, has nothing open, and the row says to
 * switch to it.
 */
import { createContext, useContext, useMemo, useRef, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react';
import { actionsFor, type ResourceAction, type ResourceActionId, type ResourceNode } from '@throng/core';
import type { MenuSection } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { useAppSettings } from '../config/config-store.js';
import { useContextMenu } from '../context-menu-provider.js';
import type { UnloadVariant } from '../sidebar/use-unload-project.js';
import type { MenuAction } from '../workspace/context-menu.js';
import { useKillProcesses } from './kill-confirm.js';
import { getSessionSnapshot, isEnded, requestCatchUp, setNotice } from './monitor-session.js';
import type { RoutedAction } from './route-action.js';

/** A row's action: core's (FR-063) or the monitor's Activate (FR-110). */
export type ActionRowId = ResourceActionId | 'activate';

export interface ActionRow {
  readonly id: ActionRowId;
  readonly label: string;
  readonly icon: string;
  readonly section: MenuSection;
  readonly enabled: boolean;
  /** Why it is disabled; also the row's hover text then. */
  readonly reason?: string;
  readonly run: () => void;
}

const ICON: Readonly<Record<ResourceActionId, string>> = {
  unloadProject: 'unload',
  unloadProjectOther: 'unload',
  destroyTab: 'destroy',
  destroyPanel: 'destroy',
  killProcess: 'resourceKill',
  killBelow: 'resourceKillBelow',
};

const LABEL: Readonly<Record<Exclude<ResourceActionId, 'unloadProjectOther'>, string>> = {
  unloadProject: 'Unload Project',
  destroyTab: 'Destroy Tab',
  destroyPanel: 'Destroy Panel',
  killProcess: 'Kill Process',
  killBelow: 'Kill All Below',
};

const SECTION: Readonly<Record<ResourceActionId, MenuSection>> = {
  unloadProject: 'viewState',
  unloadProjectOther: 'viewState',
  destroyTab: 'destroy',
  destroyPanel: 'destroy',
  killProcess: 'destroy',
  killBelow: 'destroy',
};

function find(root: ResourceNode, id: string): ResourceNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return undefined;
}

/** `p:<id>`, `t:<id>`, `n:<id>` → `<id>`, preferring what the node's owner already says. */
const bare = (id: string): string => id.slice(2);

export function useNodeActions(): {
  rowsFor: (node: ResourceNode) => ActionRow[];
  openMenu: (event: ReactMouseEvent, node: ResourceNode) => void;
} {
  const settings = useAppSettings();
  const kill = useKillProcesses();
  const { openMenu: openContextMenu } = useContextMenu();

  const projectOf = (node: ResourceNode): ResourceNode | undefined => {
    const tree = getSessionSnapshot().tree;
    const projectId = node.owner.projectId;
    return tree === null || projectId === undefined ? undefined : find(tree, `p:${projectId}`);
  };

  /*
   * Only the ACTIVE project's layout is open in a window and reported to main (the main window holds one
   * layout; research R12), so a tab or panel is destroyable when its project is the active one — it is
   * then open in the main window or in a sub-workspace window that reports it, and the request can be
   * routed. The monitor is its own window and holds no tab or panel itself (R14). A project that is
   * merely loaded has nothing open, and routing there could only fail.
   */
  const isMounted = (node: ResourceNode): boolean => {
    if (node.kind !== 'tab' && node.kind !== 'panel') return true;
    return projectOf(node)?.projectState === 'active';
  };

  /** Why a destroy is unavailable, naming what to do about it: switch to the project that holds it. */
  const reasonFor = (a: ResourceAction, node: ResourceNode): string | undefined => {
    if (a.enabled) return undefined;
    if (a.id !== 'destroyTab' && a.id !== 'destroyPanel') return a.reason;
    const project = projectOf(node)?.label;
    const what = a.id === 'destroyTab' ? 'tab' : 'panel';
    return project === undefined ? a.reason : `Switch to ${project} to destroy this ${what}`;
  };

  /** Run an action in the window that owns it; a route no window answers raises the monitor's one notice. */
  const route = async (req: RoutedAction, failure: { heading: string; lines: string[] }): Promise<void> => {
    const ok = (await window.throng?.resources?.routeAction?.(req)) ?? false;
    if (ok) requestCatchUp();
    else setNotice(failure);
  };

  const run = (id: ResourceActionId, node: ResourceNode): void => {
    switch (id) {
      case 'unloadProject':
      case 'unloadProjectOther': {
        const project = { id: node.owner.projectId ?? bare(node.id), name: node.label };
        const variant: UnloadVariant | undefined =
          id === 'unloadProject' ? undefined : settings.projects.unloadTerminalAction === 'keepRunning' ? 'endTerminals' : 'keepRunning';
        void route(
          { action: 'unloadProject', ...project, ...(variant !== undefined ? { variant } : {}) },
          { heading: `Couldn't unload ${node.label}`, lines: ['The main window did not take the request.'] },
        );
        return;
      }
      case 'destroyTab':
        void route(
          { action: 'destroyTab', id: node.owner.tabId ?? bare(node.id) },
          { heading: `Couldn't destroy ${node.label}`, lines: ['It is not open in any window.'] },
        );
        return;
      case 'destroyPanel':
        void route(
          { action: 'destroyPanel', id: node.owner.panelId ?? bare(node.id) },
          { heading: `Couldn't destroy ${node.label}`, lines: ['It is not open in any window.'] },
        );
        return;
      case 'killProcess':
        void kill(node, 'process');
        return;
      case 'killBelow':
        void kill(node, 'below');
        return;
    }
  };

  const labelOf = (a: ResourceAction): string => {
    if (a.id !== 'unloadProjectOther') return LABEL[a.id];
    return settings.projects.unloadTerminalAction === 'keepRunning'
      ? 'Unload Project and End Terminals'
      : 'Unload Project and Keep Terminals Running';
  };

  /*
   * A row is not redrawn for a capture that prints the same figures (SC-010), so the node its handlers
   * closed over can be a capture or more old: a process started since is not under it. Every action is
   * decided, and run, on the node as the session holds it NOW.
   */
  const liveNode = (node: ResourceNode): ResourceNode => {
    const tree = getSessionSnapshot().tree;
    return (tree === null ? undefined : find(tree, node.id)) ?? node;
  };

  /**
   * Activate (FR-110): go to a project, a tab, a panel — or a process's panel — in the window holding it.
   * Absent on throng's own nodes (FR-062), on an ended process, on the "No project" group and on a process
   * outside any panel. Enabled everywhere else: the receiving window switches project first.
   */
  const activateRow = (node: ResourceNode): ActionRow | null => {
    if (node.owner.component !== 'projects' || isEnded(node.id)) return null;
    const what = node.kind === 'project' ? 'project' : node.kind === 'tab' ? 'tab' : node.kind === 'panel' || node.kind === 'process' ? 'panel' : null;
    const projectId = node.owner.projectId ?? (node.kind === 'project' ? bare(node.id) : undefined);
    if (what === null || projectId === undefined || projectId === '' || node.id === 'p:') return null;
    const tabId = node.kind === 'tab' ? (node.owner.tabId ?? bare(node.id)) : node.owner.tabId;
    const panelId = node.kind === 'panel' ? (node.owner.panelId ?? bare(node.id)) : node.owner.panelId;
    // A process outside any panel (a lock helper, say) has nowhere to go.
    if (what === 'panel' && (tabId === undefined || panelId === undefined)) return null;
    const req: RoutedAction = {
      action: 'activate',
      projectId,
      ...(what !== 'project' && tabId !== undefined ? { tabId } : {}),
      ...(what === 'panel' && panelId !== undefined ? { panelId } : {}),
    };
    return {
      id: 'activate',
      label: `Go to ${what}`,
      icon: 'activate',
      section: 'navigate',
      // Always offered: Activate switches project FIRST, so a tab of a project that is not the active one is
      // reached too. Only a route no window takes fails, and says so in the monitor's notice (FR-086).
      enabled: true,
      run: () =>
        void route(req, { heading: `Couldn't go to ${node.label}`, lines: ['It is not open in any window.'] }),
    };
  };

  const rowsFor = (stale: ResourceNode): ActionRow[] => {
    const node = liveNode(stale);
    const rows: ActionRow[] = actionsFor(node, { isEnded: (n) => isEnded(n.id), isMounted }).map((a) => ({
      id: a.id,
      label: labelOf(a),
      icon: ICON[a.id],
      section: SECTION[a.id],
      enabled: a.enabled,
      ...(reasonFor(a, node) !== undefined ? { reason: reasonFor(a, node) as string } : {}),
      run: () => run(a.id, liveNode(node)),
    }));
    const go = activateRow(node);
    return go === null ? rows : [...rows, go];
  };

  const openMenu = (event: ReactMouseEvent, node: ResourceNode): void => {
    const rows = rowsFor(node);
    // Throng's own nodes, ended processes and unloaded projects have nothing to offer: no menu at all,
    // and the browser's own is not wanted either.
    event.preventDefault();
    if (rows.length === 0) return;
    const items: MenuAction[] = rows.map((r) => ({
      label: r.label,
      icon: r.icon,
      section: r.section,
      disabled: !r.enabled,
      ...(r.reason !== undefined ? { title: r.reason } : {}),
      onClick: r.run,
    }));
    openContextMenu(event.clientX, event.clientY, items);
  };

  return { rowsFor, openMenu };
}

type NodeActions = ReturnType<typeof useNodeActions>;

const NodeActionsContext = createContext<NodeActions | null>(null);

/**
 * Makes the node actions available to the breakdown and the detail pane below it. A provider rather
 * than a hook in each, because the actions need the confirmation dialog, the context menu and the
 * project commands — and the breakdown and detail pane are drawn, and tested, without any of those.
 * Outside a provider there are simply no actions.
 */
export function NodeActionsProvider({ children }: { children: ReactNode }): ReactElement {
  const actions = useNodeActions();
  // Always the latest closures, behind one stable object: rows are memoised on their props.
  const latest = useRef(actions);
  latest.current = actions;
  const stable = useMemo<NodeActions>(
    () => ({
      rowsFor: (node) => latest.current.rowsFor(node),
      openMenu: (event, node) => latest.current.openMenu(event, node),
    }),
    [],
  );
  return <NodeActionsContext value={stable}>{children}</NodeActionsContext>;
}

export function useNodeActionsContext(): NodeActions | null {
  return useContext(NodeActionsContext);
}

/** The detail pane's action row: the same rows as the menu, as titled icon controls. */
export function NodeActionBar({ node }: { node: ResourceNode }): ReactElement | null {
  const actions = useNodeActionsContext();
  if (actions === null) return null;
  const rows = actions.rowsFor(node);
  if (rows.length === 0) return null;
  return (
    <div className="detail-pane__actions" data-testid="detail-actions" role="toolbar" aria-label="Actions">
      {rows.map((r) => (
        <IconButton
          key={r.id}
          token={r.icon}
          title={r.enabled ? r.label : (r.reason ?? r.label)}
          testId={`detail-action-${r.id}`}
          className="icon-button detail-pane__action"
          disabled={!r.enabled}
          onClick={r.run}
        />
      ))}
    </div>
  );
}
