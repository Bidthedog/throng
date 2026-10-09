import { useEffect, useRef } from 'react';
import { EDITOR_KIND, collectPanels, movedPanelConfig, type Panel } from '@throng/core';
import { useProjects } from '../state/projects-store.js';
import { getEditorState } from './editor-state.js';
import { useWorkspace } from '../state/workspace-store.js';

/**
 * A moved document's new path, into the PERSISTED layout — for every editor panel in this window,
 * not just the ones on screen (019, FR-008 · #87).
 *
 * The re-point itself belongs to the authority in UI main (`markMoved`); this is the one place that
 * writes the result into the layout blob, so a restart reopens each panel on the file where it
 * actually lives.
 *
 * A document REPLACED by a different file is the same fact arriving by another message (044 FR-110): a
 * panel synced into two windows that loads another file — an in-place open, a Back / Forward step — in
 * one of them, carries the new path on its reset, and the other window's layout follows it here.
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
  const { projects } = useProjects();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  /*
   * 052 FR-007 (research R5) — every editor panel the layout holds, shown or not, follows `throng:files:moved`.
   * A panel in a tab not shown since launch has no coordinator document and so never hears `movedTo`; this pass
   * is what carries its `filePath` (and `movedOut`) into the layout the next save persists. Core's rule, the same
   * one main's walk applies, and idempotent: a mounted editor that already followed its `movedTo` is unchanged.
   * Only `filePath` and `movedOut` are written — a history is `HistoryMirrorSync`'s.
   */
  useEffect(
    () =>
      window.throng?.files?.onMoved?.(({ moves }) => {
        const { layout, updatePanelConfig } = wsRef.current;
        for (const tab of layout?.tabs ?? []) {
          for (const panel of collectPanels(tab.root) as Panel[]) {
            if (panel.kind !== EDITOR_KIND) continue;
            // A panel with a live editor state has a document, and the authority tells it (`movedTo`, handled
            // below) — except a REPLACED one, whose path is another file's now and which must not follow it
            // (052 R6). Only panels nobody has mounted have no state, and only they need this pass.
            if (getEditorState(panel.id) !== undefined) continue;
            const root = projectsRef.current.find((p) => p.id === panel.originProjectId)?.rootFolder;
            const next = movedPanelConfig(panel, moves, root);
            if (next === null) continue;
            const held = panel.config as { filePath?: string; movedOut?: unknown } | undefined;
            const filePath = typeof next.filePath === 'string' ? next.filePath : undefined;
            const movedOut = next.movedOut === true;
            const pathChanged = filePath !== undefined && filePath !== held?.filePath;
            if (!pathChanged && (held?.movedOut === true) === movedOut) continue;
            updatePanelConfig(panel.id, {
              ...(filePath !== undefined ? { filePath } : {}),
              movedOut: movedOut ? true : undefined,
            });
          }
        }
      }),
    [],
  );

  useEffect(
    () =>
      window.throng?.editor?.onSync?.((msg) => {
        // 052 R7 — a Replace linked this panel to the owner's document, or unlinked it. The panel id is the
        // owner's identity and never moves, so the link is written as given and never rewritten by a move.
        // Checked against the held config first, like everything below: a repeat writes nothing.
        if (msg.linkedTo !== undefined) {
          const linkedLayout = wsRef.current.layout;
          const linkedPanel = linkedLayout?.tabs
            .flatMap((tab) => collectPanels(tab.root))
            .find((p) => p.id === msg.panelId);
          if (linkedPanel?.kind === 'editor') {
            const heldLink = (linkedPanel.config as { linkedTo?: string } | undefined)?.linkedTo;
            const nextLink = msg.linkedTo ?? undefined;
            if (heldLink !== nextLink) wsRef.current.updatePanelConfig(msg.panelId, { linkedTo: nextLink });
          }
        }
        // 052 T024 — the replaced state rides the layout too: written while it stands, removed when it clears.
        if (typeof msg.replaced === 'boolean') {
          const replacedPanel = wsRef.current.layout?.tabs
            .flatMap((tab) => collectPanels(tab.root))
            .find((p) => p.id === msg.panelId);
          if (replacedPanel?.kind === 'editor') {
            const heldReplaced = (replacedPanel.config as { replaced?: true } | undefined)?.replaced === true;
            if (heldReplaced !== msg.replaced) {
              wsRef.current.updatePanelConfig(msg.panelId, { replaced: msg.replaced ? true : undefined });
            }
          }
        }
        // A move names the new path; so does a REPLACEMENT, which may be a different file put into the
        // panel from another window it is synced to (044 FR-110) — the same fact about the same panel.
        const filePath = typeof msg.movedTo === 'string' ? msg.movedTo : msg.reset?.filePath;
        if (typeof filePath !== 'string') return;
        // 050 FR-035 — the move took the file out of the project (true), or an undo / redo brought it back
        // (false); `undefined` is an ordinary move that leaves the flag as it is.
        const movedOut = typeof msg.movedTo === 'string' ? msg.movedOut : undefined;
        const { layout, updatePanelConfig } = wsRef.current;
        const panel = layout?.tabs
          .flatMap((tab) => collectPanels(tab.root))
          .find((p) => p.id === msg.panelId);
        // Not in this window, not an editor, or already up to date. Checked rather than written
        // blindly: `updatePanelConfig` builds a new layout whatever it finds, and each new layout
        // schedules a `workspace.save` — so a blind write would have every window persist its whole
        // layout on every move of a file it has never heard of.
        if (!panel || panel.kind !== 'editor') return;
        // Every reset names its path, and nearly all of them name the one already held (a revert, a
        // reload, a resync), so this check is what keeps those from writing anything.
        const held = panel.config as { filePath?: string; movedOut?: boolean } | undefined;
        const flagUnchanged = movedOut === undefined || (held?.movedOut === true) === movedOut;
        if (held?.filePath === filePath && flagUnchanged) return;
        // The config write rides the store's existing debounced `workspace.save`, exactly as a
        // Save-As's does — this is the same fact about the same panel, arriving by a different door.
        // `movedOut` is written as true or REMOVED (undefined drops out of the persisted JSON).
        updatePanelConfig(
          msg.panelId,
          movedOut === undefined ? { filePath } : { filePath, movedOut: movedOut ? true : undefined },
        );
      }),
    [],
  );
  return null;
}
