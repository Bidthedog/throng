/**
 * A panel that no longer exists has no navigation history (044 FR-110; contracts/navigation-history.md §7).
 *
 * One call for every route that ENDS an editor or a preview in this window — the header's ✕, a Tab destroy,
 * Destroy Other Tabs, a sub-workspace destroyed from its last Tab or last Panel, a destroy cascaded from
 * another window — so a route added later has one thing to remember rather than a kind check to repeat.
 * Whether the route ends the panel (rather than one view of a synced panel) is the caller's decision, by
 * the same `killsSession` rule it already applies to the document and the preview run. Idempotent in main.
 *
 * NOT for Send to Tab or Sync to: those move or mirror the panel, and its history goes with it.
 */
import { PREVIEW_KIND, type Panel } from '@throng/core';

export function purgePanelHistory(panel: Pick<Panel, 'id' | 'kind'>): void {
  if (panel.kind !== 'editor' && panel.kind !== PREVIEW_KIND) return;
  window.throng?.history?.purge(panel.id);
}
