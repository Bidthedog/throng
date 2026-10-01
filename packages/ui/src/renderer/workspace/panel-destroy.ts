/**
 * The ONE route from the keyboard into a panel's own destroy flow (048 FR-131, `panel.destroy`).
 *
 * The flow — the unsaved-editor guard, the confirmations, the Destroy/Close verb, the last-panel
 * handling — lives in `panel-placeholder.tsx`, which is what the header ✕ and the menu's Destroy item
 * run. The window dispatcher has no route into a component's state, so each mounted panel registers
 * that flow here under its id, and the chord asks for it by id: the same shape as `panel-focus.ts`
 * and `tab-picker.tsx`. A second copy of the flow in the dispatcher is exactly what this avoids.
 *
 * Module-level (not React state) for the same reason those two are: the keydown listener reaches it
 * without threading refs through the tree.
 */
const registry = new Map<string, () => void>();

/**
 * Register `destroy` as panel `panelId`'s destroy flow. Returns the unregister, which removes THIS
 * registration only — a remount that registered again before the old one's cleanup ran keeps its own.
 */
export function registerPanelDestroy(panelId: string, destroy: () => void): () => void {
  registry.set(panelId, destroy);
  return () => {
    if (registry.get(panelId) === destroy) registry.delete(panelId);
  };
}

/** Run panel `panelId`'s own destroy flow. Returns whether a mounted panel answered. */
export function requestPanelDestroy(panelId: string): boolean {
  const destroy = registry.get(panelId);
  if (!destroy) return false;
  destroy();
  return true;
}

/** Tests only: every registration gone. */
export function __resetPanelDestroy(): void {
  registry.clear();
}
