/**
 * Which preview panels a layout must lose — the two renderer predicates over `removePanelsWhere`
 * (044 FR-063, FR-064, FR-067; research R19; data-model §8, §9).
 *
 * Both name a persisted preview's file the one way every consumer does, `previewPathOf(config)` (the
 * history's current entry, else `filePath` — attach's precedence), so the restore filter, the provider
 * sync and main's unloaded-layout purge cannot disagree about which file a panel is. Both take the
 * registry as a parameter (FR-070): nothing here names a provider.
 */
import {
  PREVIEW_KIND,
  collectPanels,
  enabledProviderFor,
  previewPathOf,
  removePanelsWhere,
  type Panel,
  type PreviewPanelConfig,
  type PreviewProviderRegistry,
  type PreviewSettings,
  type WorkspaceLayout,
} from '@throng/core';
import { getPreviewState } from './preview-store.js';

const pathOf = (panel: Panel): string | undefined => previewPathOf(panel.config as PreviewPanelConfig | undefined);

/**
 * FR-067 — a restored preview whose file has no ENABLED provider: the provider is disabled, or no longer
 * registered at all, or the panel names no file. Such a preview is never mounted.
 */
export function isUnrestorablePreview(
  panel: Panel,
  registry: PreviewProviderRegistry,
  previews: PreviewSettings,
): boolean {
  if (panel.kind !== PREVIEW_KIND) return false;
  const path = pathOf(panel);
  return path === undefined || enabledProviderFor(registry, previews, path) === undefined;
}

/**
 * The restore filter (FR-067, FR-064): `layout` without its unrestorable previews, removed as closing
 * them by hand would. Returns `layout` itself when there is nothing to remove, so a caller can tell
 * whether to write the result back.
 */
export function withoutUnrestorablePreviews(
  layout: WorkspaceLayout,
  registry: PreviewProviderRegistry,
  previews: PreviewSettings,
  newPanelId: () => string,
): WorkspaceLayout {
  return removePanelsWhere(layout, (p) => isUnrestorablePreview(p, registry, previews), newPanelId);
}

/**
 * FR-063 — is `panel` a preview of one of `providerIds`?
 *
 * The provider main's run REPORTS for it wins where this window has one (`preview-store`): that is the
 * field main's `dropProvider` matched on. A preview in a tab that never mounted has no mirror, so its
 * persisted file is matched through the registry instead.
 */
export function isPreviewOfProviders(
  panel: Panel,
  providerIds: ReadonlySet<string>,
  registry: PreviewProviderRegistry,
): boolean {
  if (panel.kind !== PREVIEW_KIND) return false;
  const live = getPreviewState(panel.id)?.providerId;
  if (live !== undefined) return providerIds.has(live);
  const path = pathOf(panel);
  const id = path === undefined ? undefined : registry.forPath(path)?.id;
  return id !== undefined && providerIds.has(id);
}

/**
 * FR-064 controller ruling (044 US4 fix round 1, item 2) — does removing every panel whose id is in
 * `ids` leave `layout` with nothing? True only when EVERY panel across every tab is one of `ids`: a
 * layout with anything left over — another preview, a plain panel, however few — is not emptied. Both
 * `PreviewProviderSync` and the restore filter (`workspace-store.tsx`) ask this the same way, so an open
 * sub-workspace window's last panel(s) closing and a sub-workspace record restoring to nothing agree on
 * when that means destroying the sub-workspace rather than leaving an empty panel behind.
 */
export function emptiesLayout(layout: WorkspaceLayout, ids: ReadonlySet<string>): boolean {
  const panels = layout.tabs.flatMap((tab) => collectPanels(tab.root) as Panel[]);
  return panels.length > 0 && panels.every((p) => ids.has(p.id));
}
