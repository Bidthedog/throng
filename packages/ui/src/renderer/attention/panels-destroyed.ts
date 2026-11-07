/**
 * 057 FR-007 (#541) — tell main that panels are gone for good, so their attention marks and stored
 * flags go with them. For every route that ends panels without the project window's panel ✕, which
 * already reaches main through `panel.notifyDestroyed`: a Tab destroy, Destroy other tabs, and a
 * sub-workspace's own panels (a ✕, its last tab, its last panel).
 *
 * Only panels the route ENDS belong here. A project panel synced into a sub-workspace and closed there
 * is still shown by the project, so its mark stays (the `killsSession` rule every destroy route uses).
 */
export function panelsDestroyed(panelIds: readonly string[]): void {
  if (panelIds.length === 0) return;
  window.throng?.attention?.panelsDestroyed?.([...panelIds]);
}
