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

export interface KeybindingOps {
  selectedRelPaths: string[];
  primarySelected: TargetNode | null;
  beginRename: () => void;
  cut: (relPaths: string[]) => void;
  copy: (relPaths: string[]) => void;
  clearClipboard: () => void;
  paste: (target: TargetNode | null) => void;
  remove: (relPaths: string[]) => void;
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
      const action = resolveAction(keybindings, {
        key: e.key,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
      });
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
        default:
          break;
      }
    },
    [keybindings, ops],
  );
}
