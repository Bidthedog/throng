import { useEffect, useRef } from 'react';
import { useWorkspace } from '../state/workspace-store.js';

/**
 * Applies cross-window Panel renames (003 clone-sync): when a Panel is renamed in
 * any window, the same Panel — identified by its shared id — is renamed in this
 * window's layout too, in real time. `renamePanel` is a no-op if the Panel isn't
 * present here, so a window only updates the Panels it actually shows; the local
 * change then autosaves, keeping the project + every sub-workspace in step.
 *
 * Mounted inside a WorkspaceProvider (main window + each sub-workspace window). The
 * rename is applied locally only — it does NOT re-broadcast — so there is no loop.
 */
export function PanelRenameSync(): null {
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  useEffect(
    () => window.throng?.panel?.onRenamed?.((id, title) => wsRef.current.renamePanel(id, title)),
    [],
  );
  return null;
}
