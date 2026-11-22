/**
 * 074 FR-086a — the preview panels with no Find at all: a body with no text (an Image or SVG Preview,
 * `findable: false`). Find is not offered on their body or header menus, and the `search.find` chord is consumed and
 * does nothing. FR-086d gives a provider that cannot offer the exact Find none, never a lesser one, so there is no
 * disabled Find. Provider-neutral: the preview panel registers its own id from its view's flag, and the surfaces ask by
 * panel id alone.
 */
const absent = new Set<string>();

/** Mark `panelId` as offering no Find (`true`), or offering it again (`false`). */
export function setPanelFindAbsent(panelId: string, value: boolean): void {
  if (value) absent.add(panelId);
  else absent.delete(panelId);
}

/** FR-086a — whether panel `panelId` offers no Find at all (its body has no text). */
export function isPanelFindAbsent(panelId: string): boolean {
  return absent.has(panelId);
}
