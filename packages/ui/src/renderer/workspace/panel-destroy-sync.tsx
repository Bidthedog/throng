import { useEffect, useRef } from 'react';
import { collectPanels, PREVIEW_KIND } from '@throng/core';
import { forgetPreviewPanel } from '../preview/forget-preview-panel.js';
import { purgePanelHistory } from '../navigation/purge-history.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useDetach } from './detach-context.js';
import { destroyPanelSearch } from '../search/search-store.js';
import { destroyFindInFilesPanel } from '../find-in-files/find-in-files-store.js';

/**
 * Applies the cross-window Panel destroy cascade (005 / FR-026): when a Panel is
 * destroyed in any window, the same Panel — identified by its shared id — is removed
 * from this window's layout too. `removePanel` is a no-op if the Panel isn't present
 * here (or is the window's last Panel, which the main workspace keeps), so a window
 * only drops what it actually shows; the local change then autosaves.
 *
 * The main window additionally purges the Panel from every **persisted** (closed or
 * lazy) sub-workspace record and closes any sub-workspace left empty (`purgePanel`,
 * FR-026b) — it is the only window holding the full sub-workspace set. `useDetach`
 * returns null in sub-workspace windows, so they skip that step.
 *
 * Mounted inside a WorkspaceProvider (main window + each sub-workspace window). The
 * removal is applied locally only — it does NOT re-broadcast — so there is no loop.
 */
export function PanelDestroySync(): null {
  const ws = useWorkspace();
  const detach = useDetach();
  const wsRef = useRef(ws);
  const detachRef = useRef(detach);
  wsRef.current = ws;
  detachRef.current = detach;
  useEffect(
    () =>
      window.throng?.panel?.onDestroyed?.((id) => {
        /*
         * 044 FR-042 — a PREVIEW destroyed elsewhere ends here too: main's run goes (the originating
         * window has usually said so already; `destroyed` is idempotent) and this window's mirror of it
         * is forgotten. Asked of the layout BEFORE the removal below takes the panel, and only for a
         * preview — every other kind has no run to end.
         */
        const layout = wsRef.current.layout;
        const removed = layout?.tabs
          .flatMap((t) => collectPanels(t.root))
          .find((p) => p.id === id);
        if (removed?.kind === PREVIEW_KIND) forgetPreviewPanel(id);
        // 044 FR-110 — its history goes with it. Idempotent in main, so the window that destroyed the panel
        // (which purged already) and every window hearing the cascade can all say so.
        if (removed) purgePanelHistory(removed);
        wsRef.current.removePanel(id);
        // The Panel was destroyed elsewhere, so this window's find session on it goes too
        // (043 FR-006). A no-op when this window never had one.
        destroyPanelSearch(id);
        // 043 FR-026 — the PARENT Find in Files panel was destroyed, so this window's synced view
        // of it goes too, results and all (FR-023). `removePanel` above has already taken the view
        // out of the layout; this is the state behind it.
        destroyFindInFilesPanel(id);
        detachRef.current?.purgePanel(id);
      }),
    [],
  );
  return null;
}
