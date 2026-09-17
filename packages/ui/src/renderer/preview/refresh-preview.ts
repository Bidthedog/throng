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

/** Ask main to refresh `panelId`'s preview and apply its answer. `false` with no preview bridge. */
export async function refreshPreviewPanel(panelId: string): Promise<boolean> {
  const bridge = window.throng?.preview;
  if (!bridge) return false;
  const res = await bridge.refresh(panelId);
  if (res.update) applyPreviewUpdate(res.update);
  return true;
}
