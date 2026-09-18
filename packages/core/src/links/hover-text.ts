import type { ClickTarget } from './default-action.js';

/**
 * 045 FR-105 — the link tooltip's wording (`contracts/menus-and-gestures.md` §7.4). One function,
 * shared by the terminal's `hoveredLinkTipText` and the editor's link tooltip, so the two panel types
 * cannot word the same link differently (FR-104).
 *
 * It names the gesture AND where it goes. With the default link action retired (FR-112) the click
 * rule (FR-110) makes a file link's destination knowable, so the wording no longer stops at "to
 * open":
 *
 *   web                                   `Ctrl+Click to open in system browser` (024, unchanged)
 *   file whose click is editor / preview  `Ctrl+Click to open`
 *   file or folder whose click is OS      `Ctrl+Click to show in OS Explorer`
 *
 * `chord` is the caller's — `Cmd` on macOS. A web link never passes through the click rule
 * (`data-model.md` §13.1), so it has no click result and takes `null`.
 */
export function linkHoverText(
  kind: 'web' | 'file',
  clickResult: ClickTarget | null,
  chord: string,
): string {
  if (kind === 'web') return `${chord}+Click to open in system browser`;
  return clickResult === 'osExplorer'
    ? `${chord}+Click to show in OS Explorer`
    : `${chord}+Click to open`;
}
