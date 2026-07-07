import { useEffect, useRef } from 'react';
import { useWorkspace } from '../state/workspace-store.js';
import { useDetach } from './detach-context.js';

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
        wsRef.current.removePanel(id);
        detachRef.current?.purgePanel(id);
      }),
    [],
  );
  return null;
}
