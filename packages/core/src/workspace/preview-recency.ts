/**
 * 054 FR-001, FR-002 — the preview recency a restored tab starts from, so Last Active reuses a restored
 * preview exactly as if the user had focused it.
 *
 * The persisted `Tab.previewRecency` when the layout has one. A layout saved before 054 has none: the
 * tab's focused preview stands alone, else its previews in layout order. Ids that no longer name a
 * preview in the tab are dropped. Pure.
 */
import { collectPanels } from './invariants.js';
import type { Tab } from './model.js';

export function initialPreviewRecency(tab: Tab, isPreview: (panelId: string) => boolean): string[] {
  const inTab = collectPanels(tab.root)
    .map((p) => p.id)
    .filter(isPreview);
  const present = new Set(inTab);
  const persisted = (tab.previewRecency ?? []).filter((id) => present.has(id));
  if (persisted.length > 0) return persisted;
  if (tab.activePanelId !== undefined && present.has(tab.activePanelId)) return [tab.activePanelId];
  return inTab;
}
