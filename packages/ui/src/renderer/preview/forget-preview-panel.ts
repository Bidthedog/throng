/**
 * A preview panel no longer exists — tell main, and forget what this window mirrored (044 FR-042,
 * FR-110, contracts/preview-ipc.md §1 `destroyed`).
 *
 * One module for every route that ends a preview in this window: the header's close, closing a Tab or
 * the other Tabs, destroying a sub-workspace from its last Tab or last Panel, a destroy cascaded from
 * another window, and a cleared panel type. `destroyed` drops the run, its watch, its reservation, its
 * path registration and its history in main, and broadcasts `openChanged`; it never prompts and never
 * touches the source document, which is why none of those routes asks anything first. It is idempotent
 * in main, so a window that hears a destroy it caused itself does no harm by repeating it. A route that
 * FORGETS it leaves main believing the file still has its one preview (FR-012): Open Preview greyed and
 * the status-bar button pressed until restart, for a preview nobody can see.
 *
 * NOT for an unmount. A view unmounted by a tab switch or a move DETACHES and re-attaches later
 * (`preview-panel.tsx`); calling this then would destroy a preview the user can still see elsewhere.
 */
import { PREVIEW_KIND, type Panel, type PreviewPanelConfig } from '@throng/core';
import { clearPreviewState } from './preview-store.js';

export function forgetPreviewPanel(panelId: string): void {
  window.throng?.preview?.destroyed(panelId);
  clearPreviewState(panelId);
}

/** Where a preview's view is being removed from. */
export interface PreviewViewPlace {
  /** A sub-workspace window rather than the main one. */
  inSubWorkspace: boolean;
  /** The window's layout project id — a sub-workspace's own synthetic id inside one. */
  layoutProjectId: string | undefined;
}

/**
 * Whether removing THIS VIEW of `panel` ends the preview itself — editors' `killsSession` rule
 * (FR-006a / FR-021), applied to a run.
 *
 * In the main window every view is the preview. In a sub-workspace window only the sub-workspace's OWN
 * panels are, and the ones opened IN this window — which `config.placedInLayoutProjectId` names, because
 * a preview opened here belongs to the real project it previews (its attach is refused outside one,
 * review I-1) and so is indistinguishable by origin from a PROJECT preview synced into this window. That
 * synced one is a second view of a run the project still shows, so closing or clearing it here must
 * leave main's run alone; the one opened here is nobody else's, and forgetting to end it leaves main
 * believing the file still has a preview (FR-012).
 *
 * The placing layout is read from the PANEL, not from this session: the window applying the rule after a
 * relaunch never saw the open, and a run no window holds cannot be ended by hand at all (finding 2).
 */
export function viewEndsPreview(panel: Panel, place: PreviewViewPlace): boolean {
  if (!place.inSubWorkspace) return true;
  if (panel.originProjectId === place.layoutProjectId) return true;
  return (panel.config as PreviewPanelConfig | undefined)?.placedInLayoutProjectId === place.layoutProjectId;
}

/**
 * The preview routes' one call: end the run when this view ends the preview, and otherwise forget only
 * this window's mirror of it. A no-op for any panel that is not a preview.
 */
export function releasePreviewView(panel: Panel, place: PreviewViewPlace): void {
  if (panel.kind !== PREVIEW_KIND) return;
  if (viewEndsPreview(panel, place)) forgetPreviewPanel(panel.id);
  else clearPreviewState(panel.id);
}
