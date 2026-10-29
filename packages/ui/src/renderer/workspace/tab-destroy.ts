/**
 * The ONE route into a tab's own destroy flow from outside the tab strip (055 FR-063): the Resource
 * Monitor's Destroy Tab runs exactly what the strip's ✕ and menu run — the confirmations
 * (`confirmations.destroyTab`), the last-tab-of-a-sub-workspace handling, and the editor and preview
 * teardown — rather than a second copy of them.
 *
 * Shaped like `panel-destroy.ts`: the flow lives in `tab-group.tsx`, which has the layout, the store and
 * the confirm dialog; each tab it renders registers the flow here by id, and a caller asks by id. A tab
 * nobody has registered — one in another window, or in a project that is not mounted — is refused, so
 * the caller can say so rather than act on nothing.
 */
const registry = new Map<string, () => void>();

/** Register `destroy` as tab `tabId`'s flow. Returns the unregister, which removes THIS registration only. */
export function registerTabDestroy(tabId: string, destroy: () => void): () => void {
  registry.set(tabId, destroy);
  return () => {
    if (registry.get(tabId) === destroy) registry.delete(tabId);
  };
}

/** Run tab `tabId`'s own destroy flow. Returns whether a mounted tab answered. */
export function requestTabDestroy(tabId: string): boolean {
  const destroy = registry.get(tabId);
  if (!destroy) return false;
  destroy();
  return true;
}

/** Whether `tabId` is mounted in this window, i.e. whether {@link requestTabDestroy} would act. */
export function isTabMounted(tabId: string): boolean {
  return registry.has(tabId);
}

/** Tests only: every registration gone. */
export function __resetTabDestroy(): void {
  registry.clear();
}
