/**
 * A preview's retained selection while NO view of it is mounted (049 US5, research R11).
 *
 * Switching tabs or projects unmounts the preview and a window move builds a new one, so the selection travels in a
 * module map the way `editor-view-state.ts` and `terminal-view-state.ts` carry theirs — it must outlive a React
 * remount. The map lives apart from the controller (`preview-selection.ts`) so the hand-off registry
 * (`workspace/panel-state-capture.ts`) can read and seed it without importing a controller that imports the registry.
 */
import type { PanelSnapshotPreviewSelection } from '@throng/core';

/** The selection as text-model offsets, plus the text those offsets named (FR-026: shown only over the same text). */
export type RetainedSelection = PanelSnapshotPreviewSelection;

const store = new Map<string, RetainedSelection>();

export function savePreviewSelection(panelId: string, selection: RetainedSelection): void {
  store.set(panelId, selection);
}

/** Read the saved selection for a panel and consume it (one save, one restore). */
export function takePreviewSelection(panelId: string): RetainedSelection | undefined {
  const selection = store.get(panelId);
  store.delete(panelId);
  return selection;
}

/** Read the saved selection without consuming it (the cross-window hand-off captures an unmounted panel). */
export function peekPreviewSelection(panelId: string): RetainedSelection | undefined {
  return store.get(panelId);
}

/** Write a received selection, only where this window has none for the panel. */
export function seedPreviewSelection(panelId: string, selection: RetainedSelection): void {
  if (!store.has(panelId)) store.set(panelId, selection);
}

export function clearPreviewSelection(panelId: string): void {
  store.delete(panelId);
}
