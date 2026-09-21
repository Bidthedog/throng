/**
 * The width of a collapsed side pane's rail (#381).
 *
 * The rail holds nothing but the pane's collapse control, pinned 5px from the outer edge, and is
 * sized to give it an equal 5px margin on both sides. That control's box is derived from the icon
 * size (`panes.css`: glyph + 2px room + 1px border, each side), so the rail must be too — a fixed
 * 32px rail around a control that grows with `sizes.iconPx` would clip it at the rail's edge.
 *
 * 32px at the default icon size of 16, which is what the rail always was.
 */
export const PANE_COLLAPSE_INSET_PX = 5;

/** The collapse control's box at an icon size: the glyph, plus 2px of room and a 1px border each side. */
export function paneCollapseBoxPx(iconPx: number): number {
  return iconPx + (2 + 1) * 2;
}

export function railWidthPx(iconPx: number): number {
  return paneCollapseBoxPx(iconPx) + PANE_COLLAPSE_INSET_PX * 2;
}
