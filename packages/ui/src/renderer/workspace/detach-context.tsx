import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  addPanelToSubWorkspace,
  addTabToSubWorkspace,
  collectPanels,
  detachPanel,
  detachTab,
  findPanelLocations,
  nextSubWorkspaceName,
  pickUnusedColour,
  stripPanelFromSubWorkspaces,
  type Panel,
  type SubWorkspace,
  type SubWorkspaceBounds,
  type WorkspaceLayout,
} from '@throng/core';
import type { WorkspaceLoadSubsResult } from '@throng/ipc-contract';
import { useWorkspace } from '../state/workspace-store.js';
import { useServices } from '../composition-root.js';
import { useSubWorkspaces } from '../state/subworkspaces-store.js';

/**
 * The "sync" hub for the main window (US7 / 003 clone-and-sync model). Tabs and
 * Panels can be cloned into a **new** sub-workspace (`detachToNew`) or into an
 * **existing** one (`syncToExisting`) — from the context menu or a drag onto a
 * sub-workspace window. Provided only in the main window; `useDetach` returns
 * `null` elsewhere (e.g. inside a sub-workspace window, whose shared TabGroup then
 * shows no sync affordance). `subWorkspaces` carries the full sub-workspaces (with
 * Tabs) so the menus can offer per-Tab targets.
 */
export interface DetachActions {
  subWorkspaces: SubWorkspace[];
  detachToNew: (kind: 'tab' | 'panel', id: string) => void;
  syncToExisting: (kind: 'tab' | 'panel', id: string, subId: string, tabId?: string) => void;
  /** Remove a destroyed Panel from every sub-workspace's persisted record,
   *  deleting any left empty and closing their windows (FR-026/026b). Main-window
   *  authority: it holds/persists the full sub-workspace set. */
  purgePanel: (panelId: string) => void;
}

const DetachContext = createContext<DetachActions | null>(null);

export function useDetach(): DetachActions | null {
  return useContext(DetachContext);
}

const newId = (): string => globalThis.crypto.randomUUID();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A freshly detached window opens at a sensible default size; per-window geometry
// is persisted/restored separately (T079).
const DEFAULT_BOUNDS: SubWorkspaceBounds = { x: 120, y: 120, width: 900, height: 640 };

function findPanel(layout: WorkspaceLayout, panelId: string): Panel | undefined {
  for (const tab of layout.tabs) {
    const panel = collectPanels(tab.root).find((p) => p.id === panelId);
    if (panel) return panel;
  }
  return undefined;
}

export function DetachProvider({ children }: { children: ReactNode }): ReactElement {
  const ws = useWorkspace();
  const { bridge } = useServices();
  const { subWorkspaces, refresh, open, reportError, clearError } = useSubWorkspaces();
  // Full sub-workspaces (with Tabs) for the "Sync to → sub → Tab" menus.
  const [fullSubs, setFullSubs] = useState<SubWorkspace[]>([]);

  const loadFull = useCallback(async () => {
    try {
      const { subWorkspaces: all } = await bridge.invoke<WorkspaceLoadSubsResult>(
        'workspace.loadSubWorkspaces',
        {},
      );
      setFullSubs(all);
    } catch {
      /* leave the cached list on a transient failure */
    }
  }, [bridge]);

  // Load on mount + whenever the sidebar list changes + on any cross-window
  // content-change push (so the menus stay current).
  useEffect(() => {
    void loadFull();
  }, [loadFull, subWorkspaces]);
  // A cross-window edit (e.g. a sub-workspace window added/deleted a Panel or
  // switched its active Tab) must refresh BOTH the full sub-workspaces (menus,
  // drop hint, active-Tab target) and the sidebar list (tab/panel counts).
  useEffect(
    () =>
      window.throng?.subWorkspace?.onChanged(() => {
        void loadFull();
        void refresh();
      }),
    [loadFull, refresh],
  );

  const detachToNew = useCallback<DetachActions['detachToNew']>(
    (kind, id) => {
      void (async () => {
        const layout = ws.layout;
        if (!layout) return;
        const identity = {
          name: nextSubWorkspaceName(subWorkspaces),
          colour: pickUnusedColour(subWorkspaces.map((s) => s.colour)),
        };
        // Cascade each new window so multiple detached windows don't stack exactly
        // on top of each other (which made them indistinguishable to drag onto).
        const offset = (subWorkspaces.length % 8) * 34;
        const bounds = { ...DEFAULT_BOUNDS, x: DEFAULT_BOUNDS.x + offset, y: DEFAULT_BOUNDS.y + offset };
        const subId = newId();
        const ids = { subWorkspace: subId, tab: newId() };
        const result =
          kind === 'tab'
            ? detachTab(layout, id, ids, 'local', bounds, identity)
            : detachPanel(layout, id, ids, 'local', bounds, identity);
        if (!result.subWorkspace) return;

        try {
          // Clone semantics: the main layout is untouched; persist the new
          // sub-workspace (appended to the existing set, which the persist path
          // replaces wholesale) and open its window.
          const { subWorkspaces: existing } = await bridge.invoke<WorkspaceLoadSubsResult>(
            'workspace.loadSubWorkspaces',
            {},
          );
          await bridge.invoke('workspace.persistSubWorkspaces', {
            subWorkspaces: [...existing, result.subWorkspace],
          });
          clearError();
          await refresh();
          open(subId);
        } catch (err) {
          // A swallowed failure here is what made "nothing happens" so baffling —
          // surface it instead (FR: no silent persistence failures).
          reportError(`Couldn't create the sub-workspace: ${messageOf(err)}`);
        }
      })();
    },
    [ws, bridge, subWorkspaces, refresh, open, reportError, clearError],
  );

  const syncToExisting = useCallback<DetachActions['syncToExisting']>(
    (kind, id, subId, tabId) => {
      void (async () => {
        const layout = ws.layout;
        if (!layout) return;
        try {
          // Re-read the authoritative set so the add is against current content.
          const { subWorkspaces: all } = await bridge.invoke<WorkspaceLoadSubsResult>(
            'workspace.loadSubWorkspaces',
            {},
          );
          const target = all.find((s) => s.id === subId);
          if (!target) return;

          let updated: SubWorkspace | null = null;
          if (kind === 'tab') {
            const tab = layout.tabs.find((t) => t.id === id);
            if (tab) updated = addTabToSubWorkspace(target, tab, newId());
          } else {
            const panel = findPanel(layout, id);
            if (panel) updated = addPanelToSubWorkspace(target, panel, { tabId, newTabId: newId() });
          }
          if (!updated) return;

          const next = all.map((s) => (s.id === subId ? updated! : s));
          await bridge.invoke('workspace.persistSubWorkspaces', { subWorkspaces: next });
          clearError();
          // Refresh an open window of the target (if any), the sidebar counts, and
          // the menus. We don't force the window open — the add is non-disruptive.
          window.throng?.subWorkspace?.notifyChanged(subId);
          await refresh();
          await loadFull();
        } catch (err) {
          reportError(`Couldn't sync to the sub-workspace: ${messageOf(err)}`);
        }
      })();
    },
    [ws, bridge, refresh, loadFull, reportError, clearError],
  );

  const purgePanel = useCallback<DetachActions['purgePanel']>(
    (panelId) => {
      void (async () => {
        try {
          const { subWorkspaces: all } = await bridge.invoke<WorkspaceLoadSubsResult>(
            'workspace.loadSubWorkspaces',
            {},
          );
          const affected = findPanelLocations(all, panelId);
          if (affected.length === 0) return; // panel not mirrored anywhere persisted
          const { list, deletedIds } = stripPanelFromSubWorkspaces(all, panelId);
          await bridge.invoke('workspace.persistSubWorkspaces', { subWorkspaces: list });
          // Open windows of surviving affected sub-workspaces reload from the
          // stripped set; windows of emptied (deleted) sub-workspaces are closed.
          for (const id of affected) {
            if (deletedIds.includes(id)) window.throng?.subWorkspace?.close(id);
            else window.throng?.subWorkspace?.notifyChanged(id);
          }
          clearError();
          await refresh();
          await loadFull();
        } catch (err) {
          reportError(`Couldn't update sub-workspaces after destroying a panel: ${messageOf(err)}`);
        }
      })();
    },
    [bridge, refresh, loadFull, reportError, clearError],
  );

  const value = useMemo<DetachActions>(
    () => ({ subWorkspaces: fullSubs, detachToNew, syncToExisting, purgePanel }),
    [fullSubs, detachToNew, syncToExisting, purgePanel],
  );

  return <DetachContext.Provider value={value}>{children}</DetachContext.Provider>;
}
