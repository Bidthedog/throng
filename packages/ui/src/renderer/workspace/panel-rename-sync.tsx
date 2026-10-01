import { useEffect, useRef } from 'react';
import { useWorkspace } from '../state/workspace-store.js';

/**
 * Applies cross-window Panel title changes (003 clone-sync): when throng RETITLES a Panel in any
 * window — because its content-derived name was taken by a panel in another project or
 * sub-workspace — the same Panel, identified by its shared id, is retitled here too, in real time.
 * `retitlePanel` is a no-op if the Panel isn't present, so a window only updates the Panels it
 * actually shows; the local change then autosaves, keeping the project + every sub-workspace in step.
 *
 * 048 (FR-036) removed the OTHER channel this component used to apply: a user's rename of a panel.
 * Nothing renames a panel any more, so only throng's own retitling is synchronised (kept, FR-036).
 * The file keeps its old name so the two window roots that mount it stay untouched.
 *
 * Mounted inside a WorkspaceProvider (main window + each sub-workspace window). The handler does not
 * re-broadcast, and the main process does not echo a notification back to its sender, so there is no
 * loop.
 */
export function PanelRenameSync(): null {
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  useEffect(
    () => window.throng?.panel?.onRetitled?.((id, title) => wsRef.current.retitlePanel(id, title)),
    [],
  );
  return null;
}
