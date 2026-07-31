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
  /**
   * Re-READ the file from disk, replacing the document with what is there now (027 / #161, FR-013).
   *
   * Not a rename of {@link revert} and not a synonym for it: revert restores throng's cached belief
   * about the file and refuses when the file is gone, which is precisely the case this one exists
   * to handle. Resolves false when the path still cannot be read.
   */
  reloadFromDisk: () => Promise<boolean>;
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
