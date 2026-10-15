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
 * ══ WHERE A TAB OR PANEL LIVES ══
 *
 * A tab or panel mounted in THIS window runs its flow here. One held by another window — a
 * sub-workspace — is routed there through main (`routeAction`), where that window's own confirmations
 * apply; it is enabled whenever its project is the ACTIVE one, because only the active project's layout
 * is open and reported. Any other project, loaded or not, has nothing open, and the row says to switch
 * to it.
 */
import { createContext, useContext, useMemo, useRef, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react';
import { actionsFor, type ResourceAction, type ResourceActionId, type ResourceNode } from '@throng/core';
import type { MenuSection } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { useAppSettings } from '../config/config-store.js';
import { useContextMenu } from '../context-menu-provider.js';
import { useUnloadProject } from '../sidebar/use-unload-project.js';
import { isPanelMounted, requestPanelDestroy } from '../workspace/panel-destroy.js';
import { isTabMounted, requestTabDestroy } from '../workspace/tab-destroy.js';
import type { MenuAction } from '../workspace/context-menu.js';
import { useKillProcesses } from './kill-confirm.js';
import { getSessionSnapshot, isEnded, setNotice } from './monitor-session.js';

export interface ActionRow {
  readonly id: ResourceActionId;
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
  const unload = useUnloadProject();
  const kill = useKillProcesses();
  const { openMenu: openContextMenu } = useContextMenu();

  const projectOf = (node: ResourceNode): ResourceNode | undefined => {
    const tree = getSessionSnapshot().tree;
    const projectId = node.owner.projectId;
    return tree === null || projectId === undefined ? undefined : find(tree, `p:${projectId}`);
  };

  /*
   * Only the ACTIVE project's layout is open in a window and reported to main (the main window holds one
   * layout; research R12), so a tab or panel is destroyable when this window has it registered, or when
   * its project is the active one — in which case it is open here or in a sub-workspace window that
   * reports it, and the request can be routed. A project that is merely loaded has nothing open, and
   * routing there could only fail.
   */
  const isMounted = (node: ResourceNode): boolean => {
    if (node.kind === 'tab' && isTabMounted(node.owner.tabId ?? bare(node.id))) return true;
    if (node.kind === 'panel' && isPanelMounted(node.owner.panelId ?? bare(node.id))) return true;
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

  const route = async (action: 'destroyTab' | 'destroyPanel', id: string, label: string): Promise<void> => {
    const ok = (await window.throng?.resources?.routeAction?.({ action, id })) ?? false;
    if (!ok) setNotice({ heading: `Couldn't destroy ${label}`, lines: ['It is not open in any window.'] });
  };

  const run = (id: ResourceActionId, node: ResourceNode): void => {
    switch (id) {
      case 'unloadProject':
        unload({ id: node.owner.projectId ?? bare(node.id), name: node.label });
        return;
      case 'unloadProjectOther':
        unload(
          { id: node.owner.projectId ?? bare(node.id), name: node.label },
          settings.projects.unloadTerminalAction === 'keepRunning' ? 'endTerminals' : 'keepRunning',
        );
        return;
      case 'destroyTab': {
        const tabId = node.owner.tabId ?? bare(node.id);
        if (!requestTabDestroy(tabId)) void route('destroyTab', tabId, node.label);
        return;
      }
      case 'destroyPanel': {
        const panelId = node.owner.panelId ?? bare(node.id);
        if (!requestPanelDestroy(panelId)) void route('destroyPanel', panelId, node.label);
        return;
      }
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

  const rowsFor = (node: ResourceNode): ActionRow[] =>
    actionsFor(node, { isEnded: (n) => isEnded(n.id), isMounted }).map((a) => ({
      id: a.id,
      label: labelOf(a),
      icon: ICON[a.id],
      section: SECTION[a.id],
      enabled: a.enabled,
      ...(reasonFor(a, node) !== undefined ? { reason: reasonFor(a, node) as string } : {}),
      run: () => run(a.id, node),
    }));

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
