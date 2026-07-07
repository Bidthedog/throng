/**
 * Per-panel editor action registry (006). An editor view registers its imperative
 * actions (save, get current text, focus) here so the app-level keybinding handler
 * (Ctrl+S / Ctrl+Shift+S, gated on the active pane) can drive the active editor
 * without prop-drilling. Non-reactive by design — actions are stable callbacks.
 */

export interface EditorActions {
  /** Save this document (Ctrl+S). Resolves true on a successful write. */
  save: () => Promise<boolean>;
  /** Save As — always prompt for a new location, even if already pathed (FR-084). */
  saveAs: () => Promise<boolean>;
  /** Whether this document currently has unsaved changes. */
  isDirty: () => boolean;
  /** Load a file into this editor, replacing its current document (open-from-tree). */
  openFile: (absPath: string) => Promise<void>;
  /** Discard all unsaved changes, restoring the loaded/last-saved content (FR-075). */
  revert: () => void;
}

const registry = new Map<string, EditorActions>();

export function registerEditorActions(panelId: string, actions: EditorActions): void {
  registry.set(panelId, actions);
}

export function unregisterEditorActions(panelId: string): void {
  registry.delete(panelId);
}

export function getEditorActions(panelId: string): EditorActions | undefined {
  return registry.get(panelId);
}

/** Is this Panel a live editor (has registered actions)? */
export function isEditorPanel(panelId: string): boolean {
  return registry.has(panelId);
}
