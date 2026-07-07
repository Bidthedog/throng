/**
 * Last-active editor per tab (006 Phase B, FR-010). A file opened from the tree
 * goes into the tab's most-recently-focused editor; if the tab has no editor yet,
 * its single dedicated editor is created. Plain module store (non-reactive) — read
 * at open time.
 */
const byTab = new Map<string, string>();

export function setLastActiveEditor(tabId: string, panelId: string): void {
  byTab.set(tabId, panelId);
}

export function getLastActiveEditor(tabId: string): string | undefined {
  return byTab.get(tabId);
}

export function forgetEditor(panelId: string): void {
  for (const [tabId, id] of byTab) {
    if (id === panelId) byTab.delete(tabId);
  }
}
