/**
 * Pane-scoped keyboard handling for file operations (004, T050, FR-021).
 * Resolves the focused key event against the user's keybindings and dispatches
 * the matching `file.*` action — but only while the File Explorer Pane has
 * focus (the handler is attached to the pane), so Ctrl+C/X/V never hijack the
 * rest of the app. Keys are ignored while an inline rename input is focused.
 */
import { useCallback, type KeyboardEvent } from 'react';
import { resolveAction, type TargetNode } from '@throng/core';
import { useKeybindings } from '../config/config-store.js';
import { resolveKeydown } from '../config/chord-key.js';

export interface KeybindingOps {
  selectedRelPaths: string[];
  primarySelected: TargetNode | null;
  beginRename: () => void;
  cut: (relPaths: string[]) => void;
  copy: (relPaths: string[]) => void;
  clearClipboard: () => void;
  paste: (target: TargetNode | null) => void;
  remove: (relPaths: string[]) => void;
  /** 024 US3 (#85): reverse / re-apply the last file operation. */
  undoFileOp: () => void;
  redoFileOp: () => void;
  /**
   * 044 FR-005 — `preview.open` over the tree: the preview of the selected FILE. Its chord is live in
   * the explorer scope (`COMMAND_SCOPES`), and the selection lives here, so the tree dispatches it.
   */
  openPreview?: (node: TargetNode | null) => void;
}

/**
 * 044 FR-005 — the file `preview.open` names from the tree's selection, or `null`: a folder, the root
 * node or no selection has no preview (FR-003's "absent on folders").
 */
export function previewTargetFor(node: TargetNode | null, rootFolder: string): string | null {
  if (node === null || node.kind !== 'file' || node.relPath === '') return null;
  return `${rootFolder}/${node.relPath}`;
}

export function useExplorerKeybindings(ops: KeybindingOps): (e: KeyboardEvent) => void {
  const keybindings = useKeybindings();
  return useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return; // editing
      // Escape cancels a pending cut/copy and clears the clipboard.
      if (e.key === 'Escape') {
        ops.clearClipboard();
        return;
      }
      // Explicitly the EXPLORER scope: this handler is attached to the tree, so by construction
      // it only fires while the tree has focus. Ctrl+X here cuts a FILE — the same chord cuts a
      // LINE inside an editor, and the scope is what keeps the two apart (016, FR-017b0).
      const action = resolveKeydown(e, (ev) => resolveAction(keybindings, ev, 'explorer'));
      if (action === 'preview.open' && ops.openPreview) {
        e.preventDefault();
        ops.openPreview(ops.primarySelected);
        return;
      }
      if (!action || !action.startsWith('file.')) return;
      e.preventDefault();
      switch (action) {
        case 'file.rename':
          ops.beginRename();
          break;
        case 'file.cut':
          ops.cut(ops.selectedRelPaths);
          break;
        case 'file.copy':
          ops.copy(ops.selectedRelPaths);
          break;
        case 'file.paste':
          ops.paste(ops.primarySelected);
          break;
        case 'file.delete':
          ops.remove(ops.selectedRelPaths);
          break;
        // Ctrl+Z / Ctrl+Y in the TREE undo a file operation. The same chords undo typing inside an
        // editor, and the two never contend: their scopes are disjoint (016, FR-017b0).
        case 'file.undo':
          ops.undoFileOp();
          break;
        case 'file.redo':
          ops.redoFileOp();
          break;
        default:
          break;
      }
    },
    [keybindings, ops],
  );
}
