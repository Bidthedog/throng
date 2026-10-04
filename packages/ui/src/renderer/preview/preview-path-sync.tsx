/**
 * A preview's `config.filePath`, in THIS window's layout, follows the file its run shows (044 T150;
 * contracts/navigation-history.md §3 Path changes, §6; contracts/preview-ipc.md §2; FR-066, FR-090a,
 * FR-013c).
 *
 * Mounted once per window by `EditorChrome`. Two broadcasts reach every window:
 *
 * - **`throng:preview:pathChanged { panelId, filePath }`** — a link followed, a history step, a restore whose
 *   history beat a stale path, a parented preview following its document through a Save As.
 * - **`throng:files:moved { moves }`** — a file or folder moved in-app; each preview's path is carried along.
 *
 * Each window writes the PREVIEWS its layout holds, mounted or not — a background tab's preview is not on
 * screen to hear anything itself — and nothing else: an identical path, a panel another window holds, or an
 * editor is left alone. Editors follow their moves through `MovedPathSync`, which listens to editor sync
 * messages; those never name a preview, which is why this exists beside it rather than inside it.
 */
import { useEffect, useRef } from 'react';
import { PREVIEW_KIND, collectPanels, rewritePaths, type Panel } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';

function previewPathOfPanel(panel: Panel): string | undefined {
  const filePath = (panel.config as { filePath?: unknown } | undefined)?.filePath;
  return typeof filePath === 'string' ? filePath : undefined;
}

export function PreviewPathSync(): null {
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(() => {
    const previewsHere = (): Panel[] =>
      (wsRef.current.layout?.tabs ?? [])
        .flatMap((tab) => collectPanels(tab.root) as Panel[])
        .filter((p) => p.kind === PREVIEW_KIND);

    const heldMovedOut = (panel: Panel): boolean => (panel.config as { movedOut?: unknown } | undefined)?.movedOut === true;

    const offPath = window.throng?.preview?.onPathChanged?.((evt) => {
      const panel = previewsHere().find((p) => p.id === evt.panelId);
      if (!panel) return;
      // 050 FR-035 — the move took the file out of the project (true), or an undo / redo brought it back
      // (false); absent leaves the flag as it is. Written as true or REMOVED (`undefined` drops out of the
      // persisted JSON), so a project shown later shows the moved notice without reading the file.
      const flagUnchanged = evt.movedOut === undefined || heldMovedOut(panel) === evt.movedOut;
      if (previewPathOfPanel(panel) === evt.filePath && flagUnchanged) return;
      wsRef.current.updatePanelConfig(
        panel.id,
        evt.movedOut === undefined
          ? { filePath: evt.filePath }
          : { filePath: evt.filePath, movedOut: evt.movedOut ? true : undefined },
      );
    });

    // The run's own word, for a preview this window views: a moved-out notice sets the flag, and an
    // update carrying no notice at all clears a flag a former moved-out left behind.
    const offUpdate = window.throng?.preview?.onUpdate?.((update) => {
      const panel = previewsHere().find((p) => p.id === update.panelId);
      if (!panel) return;
      if (update.notice?.kind === 'moved-out') {
        if (heldMovedOut(panel) && previewPathOfPanel(panel) === update.notice.movedTo) return;
        wsRef.current.updatePanelConfig(panel.id, { filePath: update.notice.movedTo, movedOut: true });
      } else if (update.notice === null && heldMovedOut(panel)) {
        wsRef.current.updatePanelConfig(panel.id, { filePath: update.filePath, movedOut: undefined });
      }
    });

    const offMoved = window.throng?.files?.onMoved?.(({ moves }) => {
      for (const panel of previewsHere()) {
        const filePath = previewPathOfPanel(panel);
        if (filePath === undefined) continue;
        // The history reducer's own path rule, over a one-entry history: a file moved, or a folder holding it.
        const single = { entries: [{ filePath }], index: 0 };
        const moved = rewritePaths(single, moves);
        const next = moved.entries[0]?.filePath;
        if (moved === single || next === undefined || next === filePath) continue;
        wsRef.current.updatePanelConfig(panel.id, { filePath: next });
      }
    });

    return () => {
      offPath?.();
      offUpdate?.();
      offMoved?.();
    };
  }, []);

  return null;
}
