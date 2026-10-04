/**
 * Fill ONE empty panel with a dropped file (047 FR-077, R18; 050 FR-038, R25).
 *
 * A file dropped on an empty panel, and a file dropped on the tab strip's + (which fills the new tab's
 * own empty panel), are the same gesture at a place, so they share one rule: the file opens in the view
 * its provider's DEFAULT OPEN ACTION names (044 FR-052; core's `defaultOpenActionFor`, which a disabled
 * provider or an unclaimed file answers `editor`) — a preview when that is Preview, an editor otherwise.
 *
 * The preview is asked for through the one `preview.open` command with `intoPanelId` naming THAT panel
 * and `mode: 'new'`, so main never reuses another preview instead. With no project to ask on behalf of
 * (a sub-workspace's own panel holding a path outside every project) it is an editor, exactly as
 * `open-router.ts` falls back.
 */
import { defaultOpenActionFor, type PreviewProviderRegistry, type PreviewSettings } from '@throng/core';
import { requestPreviewOpen } from '../preview/open-preview.js';
import type { useWorkspace } from '../state/workspace-store.js';

/**
 * The project a Preview-default file would be previewed for, or `null` when the file opens as an
 * editor (its default action is not Preview, or there is no project to ask on behalf of).
 */
export function previewProjectForDrop(
  registry: PreviewProviderRegistry,
  previews: PreviewSettings,
  absPath: string,
  ownerProjectId: string | undefined,
  owningProjectFor: (absPath: string) => string | null,
): string | null {
  if (defaultOpenActionFor(registry, previews, absPath) !== 'preview') return null;
  return ownerProjectId ?? owningProjectFor(absPath);
}

/** The `preview.open` request that puts a preview INTO the empty panel `panelId` — never another one. */
export function previewIntoPanelIntent(
  panelId: string,
  absPath: string,
  projectId: string,
): Parameters<typeof requestPreviewOpen>[0] {
  return { absPath, projectId, target: { mode: 'new' }, intoPanelId: panelId };
}

/**
 * Open `absPath` in the empty panel `panelId`: a preview into it when `previewProjectId` names a
 * project, else the panel becomes an editor on the file.
 */
export function openFileInEmptyPanel(
  ws: Pick<ReturnType<typeof useWorkspace>, 'setPanelType'>,
  panelId: string,
  absPath: string,
  previewProjectId: string | null,
): void {
  if (previewProjectId) {
    void requestPreviewOpen(previewIntoPanelIntent(panelId, absPath, previewProjectId));
    return;
  }
  ws.setPanelType(panelId, 'editor', { filePath: absPath });
  window.throng?.panel?.notifyTyped?.(panelId, 'editor', { filePath: absPath });
}
