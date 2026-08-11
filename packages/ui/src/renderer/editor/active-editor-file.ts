/**
 * The file the user is actually working in — the absolute path of the ACTIVE panel's editor, or
 * null (#188).
 *
 * Two stores have half the answer each: the workspace layout knows which panel of which tab is
 * active, and the per-panel editor store knows what that panel has open. This joins them, and is
 * deliberately null for anything that is not an editor showing a file — a terminal, a placeholder,
 * an unsaved document — so a caller that follows it leaves its state alone rather than blanking it.
 */
import { collectPanels, effectiveActivePanelId } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useEditorState } from './editor-state.js';

export function useActiveEditorFilePath(): string | null {
  const { layout } = useWorkspace();
  const tab = layout?.tabs.find((t) => t.id === layout.activeTabId);
  const activeId = tab ? (effectiveActivePanelId(tab) ?? null) : null;
  const activePanel = tab && activeId ? collectPanels(tab.root).find((p) => p.id === activeId) : undefined;
  // Subscribed unconditionally (hooks cannot be skipped); an id no editor owns simply has no state.
  const editor = useEditorState(activeId ?? '');
  if (activePanel?.kind !== 'editor') return null;
  return editor?.filePath ?? null;
}
