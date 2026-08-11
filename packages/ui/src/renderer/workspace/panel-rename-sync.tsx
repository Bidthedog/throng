import { useEffect, useRef } from 'react';
import { useWorkspace } from '../state/workspace-store.js';

/**
 * Applies cross-window Panel name changes (003 clone-sync): when a Panel's name changes in any
 * window, the same Panel — identified by its shared id — changes here too, in real time.
 * `renamePanel`/`retitlePanel` are no-ops if the Panel isn't present, so a window only updates the
 * Panels it actually shows; the local change then autosaves, keeping the project + every
 * sub-workspace in step.
 *
 * TWO channels, because two different things happen to a panel's name and only one of them is the
 * user's (#184/#218):
 *
 *  - **renamed** — the user typed it. Applied with `renamePanel`, which marks the panel manually
 *    titled, so the name outranks the terminal's live title and the editor's file name everywhere it
 *    appears, and "Reset Name" is offered on all of them.
 *  - **retitled** — throng moved it, because the name was taken by a panel in another project or
 *    sub-workspace. Applied with `retitlePanel`, which changes only what is DISPLAYED: the panel is
 *    still free to name itself after its own content, and "Reset Name" stays disabled because there
 *    is nothing the user chose to undo.
 *
 * Collapsing the two into one channel is what produced #218: an adjustment arrived as a rename and
 * branded panels nobody had renamed.
 *
 * Mounted inside a WorkspaceProvider (main window + each sub-workspace window). Neither handler
 * re-broadcasts, and the main process no longer echoes a notification back to its sender, so there
 * is no loop.
 */
export function PanelRenameSync(): null {
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  useEffect(
    () => window.throng?.panel?.onRenamed?.((id, title) => wsRef.current.renamePanel(id, title)),
    [],
  );
  useEffect(
    () => window.throng?.panel?.onRetitled?.((id, title) => wsRef.current.retitlePanel(id, title)),
    [],
  );
  return null;
}
