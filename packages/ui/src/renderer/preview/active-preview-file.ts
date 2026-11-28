/**
 * The source file of the ACTIVE panel's preview, or null (081 FR-061, #724).
 *
 * The preview sibling of `editor/active-editor-file.ts`: the workspace layout knows which panel is
 * active, the preview store knows what that panel shows. Null for anything that is not a preview with
 * a source file, so the tree following it leaves its state alone rather than blanking it (FR-062).
 */
import { collectPanels, effectiveActivePanelId } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { usePreviewState } from './preview-store.js';

export function useActivePreviewFilePath(): string | null {
  const { layout } = useWorkspace();
  const tab = layout?.tabs.find((t) => t.id === layout.activeTabId);
  const activeId = tab ? (effectiveActivePanelId(tab) ?? null) : null;
  const activePanel = tab && activeId ? collectPanels(tab.root).find((p) => p.id === activeId) : undefined;
  // Subscribed unconditionally (hooks cannot be skipped); an id no preview owns has no state.
  const preview = usePreviewState(activeId ?? '');
  // The kind check matters when a panel retyped in place keeps its id and its stale preview state.
  if (activePanel?.kind !== 'preview') return null;
  return preview?.filePath || null;
}
