/**
 * 074 FR-086 — the preview panels whose body the find bar cannot search, and how Find shows on each:
 *
 * - `disabled` — a body drawn inside an opaque, sandboxed frame (an HTML Preview, whose view says `searchable: false`)
 *   has text the panel cannot read: Find is shown DISABLED in its body menu and header menu, never offered and broken.
 * - `absent` (FR-086a, 2026-11-19) — a body with no text at all (an Image or SVG Preview, `findable: false`): Find
 *   is not offered at all.
 *
 * Either way the `search.find` chord is consumed and does nothing. Provider-neutral: the preview panel registers its
 * own id from its view's flags, and the surfaces ask by panel id alone. No provider is named here.
 */
export type UnsearchableFind = 'disabled' | 'absent';

const unsearchable = new Map<string, UnsearchableFind>();

/** Mark `panelId` as one find cannot search (`true` reads `disabled`), or no longer (`false`). */
export function setPanelUnsearchable(panelId: string, value: boolean | UnsearchableFind): void {
  if (value === false) unsearchable.delete(panelId);
  else unsearchable.set(panelId, value === true ? 'disabled' : value);
}

/** Whether find cannot search panel `panelId`'s body, either way. */
export function isPanelUnsearchable(panelId: string): boolean {
  return unsearchable.has(panelId);
}

/** FR-086a — whether panel `panelId` offers no Find at all (its body has no text). */
export function isPanelFindAbsent(panelId: string): boolean {
  return unsearchable.get(panelId) === 'absent';
}
