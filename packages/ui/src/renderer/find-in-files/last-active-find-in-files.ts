/**
 * The last Find in Files panel a search was sent to, per tab (043 FR-021, FR-022).
 *
 * A plain non-reactive module store, exactly like `editor/last-active-editor.ts` and for the same
 * reason: it is read once, at open time, and nothing re-renders when it changes.
 *
 * Keyed by TAB, which is FR-022 made structural rather than remembered. The preference is evaluated
 * within the current Tab only, so a per-window "last panel" would answer the wrong question the
 * moment the user switched tabs — it would hand the search to a panel the user cannot see, in a tab
 * they are not looking at.
 */
const byTab = new Map<string, string>();

export function setLastActiveFindInFiles(tabId: string, panelId: string): void {
  byTab.set(tabId, panelId);
}

export function getLastActiveFindInFiles(tabId: string): string | undefined {
  return byTab.get(tabId);
}

/** The panel is gone. Forget it, so a destroyed id can never be handed a search. */
export function forgetFindInFilesPanel(panelId: string): void {
  for (const [tabId, id] of byTab) {
    if (id === panelId) byTab.delete(tabId);
  }
}

/** Test seam — drops every tab's memory. Never called by application code. */
export function __resetLastActiveFindInFiles(): void {
  byTab.clear();
}
