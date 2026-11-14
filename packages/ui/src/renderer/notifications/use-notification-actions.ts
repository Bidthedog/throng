import { useCallback, useEffect, useMemo, useState } from 'react';
import { collectPanels, logCaught, type NotificationActionDescriptor } from '@throng/core';
import { getAttentionMarks } from '../attention/attention-store.js';
import { openFileInTab } from '../editor/editor-open.js';
import { useProjects } from '../state/projects-store.js';
import { useWorkspaceOptional } from '../state/workspace-store.js';
import { useNotifications } from './use-notifications.js';

/**
 * What an entry's action descriptors mean in THIS window (068 FR-031a): whether the target still
 * exists, and how to go there. The panel draws only descriptors whose target exists; the rest are
 * hidden rather than left to fail when pressed.
 *
 * - `goToPanel` exists while the panel is in this window's layout, carries an attention mark, or MAIN says it
 *   exists (068 B18): main finds a panel in another project's saved layout or a sub-workspace window, which this
 *   window cannot see. Going there is main's link route (B16), which needs no mark and routes to whichever
 *   window hosts the panel.
 * - `openFile` exists while its project is the active one — the editor opens into this window's tab.
 * - `openPreferences` always exists.
 */
export function useNotificationActions(): {
  targetExists: (action: NotificationActionDescriptor) => boolean;
  runAction: (action: NotificationActionDescriptor) => void;
} {
  // Optional: with no project open the pane draws without a workspace store, and the panel must still draw.
  const ws = useWorkspaceOptional();
  const { activeProject } = useProjects();
  const layout = ws?.layout ?? null;
  const { entries } = useNotifications();

  // The panels the entries relate to, asked of main whenever the set (or this window's layout) changes.
  const refs = useMemo(() => {
    const seen = new Map<string, { panelId: string; projectId?: string }>();
    for (const e of entries) {
      const panelId = e.origin?.panelId ?? e.actions.find((a) => a.kind === 'goToPanel')?.panelId;
      if (panelId && !seen.has(panelId)) seen.set(panelId, { panelId, ...(e.origin?.projectId ? { projectId: e.origin.projectId } : {}) });
    }
    return [...seen.values()];
  }, [entries]);
  const refsKey = JSON.stringify(refs);
  const [existing, setExisting] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const ask = window.throng?.attention?.panelsExist;
    if (!ask || refs.length === 0) {
      setExisting(new Set());
      return undefined;
    }
    let live = true;
    void ask(refs)
      .then((ids) => {
        if (live) setExisting(new Set(ids));
      })
      .catch((error: unknown) => logCaught('notifications: ask main which panels exist', error));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `refsKey` is `refs`' value; a layout change re-asks
  }, [refsKey, layout]);

  const targetExists = useCallback(
    (action: NotificationActionDescriptor): boolean => {
      switch (action.kind) {
        case 'goToPanel':
          return (
            (layout?.tabs.some((tab) => collectPanels(tab.root).some((p) => p.id === action.panelId)) ?? false) ||
            getAttentionMarks().some((m) => m.panelId === action.panelId) ||
            existing.has(action.panelId)
          );
        case 'openFile':
          return activeProject?.id === action.projectId && layout !== null;
        case 'openPreferences':
          return true;
      }
    },
    [activeProject, layout, existing],
  );

  const runAction = useCallback(
    (action: NotificationActionDescriptor): void => {
      switch (action.kind) {
        case 'goToPanel':
          void window.throng?.attention?.goToPanel?.({
            panelId: action.panelId,
            ...(action.projectId ? { projectId: action.projectId } : {}),
          });
          return;
        case 'openFile': {
          if (!ws || !activeProject || !layout) return;
          const root = activeProject.rootFolder.replace(/[\\/]+$/, '');
          void openFileInTab(ws, layout.activeTabId, `${root}/${action.relPath}`);
          return;
        }
        case 'openPreferences':
          window.throng?.openPreferences?.('settings', action.section);
          return;
      }
    },
    [activeProject, layout, ws],
  );

  return { targetExists, runAction };
}
