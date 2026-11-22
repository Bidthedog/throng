/**
 * 054 FR-001, FR-002 — the preview recency a restored tab starts from, so Last Active reuses a restored
 * preview exactly as if the user had focused it.
 *
 * The persisted `Tab.previewRecency` leads when the layout has one. A layout saved before 054 has none: the
 * tab's focused preview leads. Every other preview in the tab follows in layout order, because Last Active is
 * per type (FR-007): a list naming only a Markdown preview would leave a restored image preview no candidate
 * for the next image (maintainer, 2026-11-22). Ids that no longer name a preview in the tab are dropped. Pure.
 */
import { collectPanels } from './invariants.js';
import type { Tab } from './model.js';

export function initialPreviewRecency(tab: Tab, isPreview: (panelId: string) => boolean): string[] {
  const inTab = collectPanels(tab.root)
    .map((p) => p.id)
    .filter(isPreview);
  const present = new Set(inTab);
  const persisted = (tab.previewRecency ?? []).filter((id) => present.has(id));
  const lead =
    persisted.length > 0 ? persisted : tab.activePanelId !== undefined && present.has(tab.activePanelId) ? [tab.activePanelId] : [];
  return [...lead, ...inTab.filter((id) => !lead.includes(id))];
}
