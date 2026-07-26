/**
 * The link a terminal's context menu should offer, or null (024 US7, #159 / FR-019d). Pure.
 *
 * A link under the pointer yields "Open Link" / "Copy Link Address" — but ONLY when there is no
 * active text selection: an active selection takes priority, and then the menu is the ordinary Copy
 * menu whatever the pointer is over. Returns the URL to offer, or null when a selection exists or no
 * link is under the pointer.
 */
export function terminalLinkTarget(selection: string, hoveredLink: string | null): string | null {
  if (selection.length > 0) return null; // selection wins (FR-019d)
  return hoveredLink && /^https?:\/\//i.test(hoveredLink) ? hoveredLink : null;
}
