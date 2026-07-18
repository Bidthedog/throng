import { useEffect, useRef } from 'react';
import { collectPanels } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';

/**
 * A moved document's new path, into the PERSISTED layout — for every editor panel in this window,
 * not just the ones on screen (019, FR-008 · #87).
 *
 * The re-point itself belongs to the authority in UI main (`markMoved`); this is the one place that
 * writes the result into the layout blob, so a restart reopens each panel on the file where it
 * actually lives.
 *
 * ## Why it cannot live in the panel
 *
 * `use-editor`'s `onSync` subscription is created by the editor's mount effect and torn down when it
 * unmounts — and only the ACTIVE tab's `SplitTree` is mounted (`tab-group.tsx`). So a panel sitting
 * in a background tab has already run `offSync()` and never hears `movedTo` at all: move a file
 * while a second tab is focused and its persisted config keeps the OLD path, for ever. Its remount
 * adopts the authority's `absPath` into the view, which hides the defect from anyone looking at the
 * screen and does nothing whatsoever for the layout — the panel still reopens on the ghost path
 * after a restart, where it is missing, dirty, and one Ctrl+S away from re-creating the file the
 * move emptied. A per-panel listener is STRUCTURALLY INCAPABLE of covering FR-008.
 *
 * Mounted once per window, inside the WorkspaceProvider (via `EditorChrome`, in the main window and
 * every sub-workspace window). `movedTo` is broadcast to every window, and each one patches its own
 * layout: a window whose layout does not hold the panel changes nothing, which is the same door
 * `PanelRenameSync` uses for cross-window renames.
 */
export function MovedPathSync(): null {
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(
    () =>
      window.throng?.editor?.onSync?.((msg) => {
        if (typeof msg.movedTo !== 'string') return;
        const { layout, updatePanelConfig } = wsRef.current;
        const panel = layout?.tabs
          .flatMap((tab) => collectPanels(tab.root))
          .find((p) => p.id === msg.panelId);
        // Not in this window, not an editor, or already up to date. Checked rather than written
        // blindly: `updatePanelConfig` builds a new layout whatever it finds, and each new layout
        // schedules a `workspace.save` — so a blind write would have every window persist its whole
        // layout on every move of a file it has never heard of.
        if (!panel || panel.kind !== 'editor') return;
        if ((panel.config as { filePath?: string } | undefined)?.filePath === msg.movedTo) return;
        // The config write rides the store's existing debounced `workspace.save`, exactly as a
        // Save-As's does — this is the same fact about the same panel, arriving by a different door.
        updatePanelConfig(msg.panelId, { filePath: msg.movedTo });
      }),
    [],
  );
  return null;
}
