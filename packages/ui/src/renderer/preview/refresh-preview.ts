/**
 * Refresh a preview (044 FR-028; contracts/preview-ipc.md §1 `refresh`).
 *
 * Main re-reads the preview's source — the document for a parented preview, the file on disk for a
 * standalone one — and answers with the update it made, ignoring the update delay. The answer is applied
 * here as well as pushed to every viewer, so the window that asked shows it without waiting for the push;
 * the store's revision rule makes the two arrivals one.
 *
 * One function for the header's Refresh and the file notice's Try again (which IS Refresh), so the two
 * cannot re-read in different ways.
 */
import { applyPreviewUpdate } from './preview-store.js';

/** How many times each panel has been refreshed in this window. */
const refreshes = new Map<string, number>();

/**
 * 074 FR-072, FR-071b — how many times `panelId` has been refreshed. An HTML page names it on its asset URLs, so a
 * Refresh fetches the page's stylesheets, fonts and images again while a live edit, which names the same count,
 * updates the page in place without fetching anything.
 */
export function previewRefreshCount(panelId: string): number {
  return refreshes.get(panelId) ?? 0;
}

/** Ask main to refresh `panelId`'s preview and apply its answer. `false` with no preview bridge. */
export async function refreshPreviewPanel(panelId: string): Promise<boolean> {
  const bridge = window.throng?.preview;
  if (!bridge) return false;
  // Counted before asking: the re-read may arrive by the push before this answer, and must draw with the new count.
  refreshes.set(panelId, previewRefreshCount(panelId) + 1);
  const res = await bridge.refresh(panelId);
  if (res.update) applyPreviewUpdate(res.update);
  return true;
}
