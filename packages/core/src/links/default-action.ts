import type { ResolvedLink } from './types.js';

/**
 * 045 FR-110, FR-111, FR-114 — THE CLICK RULE (`data-model.md` §13.1): what Ctrl+click, the Open
 * Link chord and the plain Open Link item do for a FILE link. One function, so the three gestures
 * and the two panel types cannot disagree (FR-054, FR-104).
 *
 * ══ SUPERSEDED 2026-09-18 ══
 *
 * This used to read FR-050's *Default link action* setting, with FR-039's executable override in
 * front and FR-053's fallback order behind. FR-110 – FR-112 retire all three: the setting is gone
 * (`DefaultLinkAction` and `DEFAULT_LINK_ACTIONS` with it), and what a click does is fixed:
 *
 *   1. a folder                                              → `osExplorer`
 *   2. anything outside the project                          → `osExplorer`
 *   3. previewIsDefault, no position, an enabled preview      → `preview`
 *   4. otherwise                                             → `editor`
 *
 * `link.executable` is NOT read (FR-114): an in-project `deploy.ps1` opens as its text, and an
 * out-of-project one is already shown in the file manager by clause 2. FR-111 — no gesture ever
 * hands a file to the OS default program — is a property of the RESULT TYPE: `osDefaultProgram` is
 * reachable only through the explicit menu item, which does not come through here.
 *
 * `previewIsDefault` is `defaultOpenActionFor(...) === 'preview'`, computed by the caller, which
 * keeps this file free of the preview registry (044 FR-070). Web links never pass through this
 * function: a web link's click is the open-external seam, always.
 */
export type ClickTarget = 'editor' | 'preview' | 'osExplorer';

export function resolveDefaultLinkAction(args: {
  readonly link: ResolvedLink;
  readonly hasPosition: boolean;
  readonly previewIsDefault: boolean;
}): ClickTarget {
  const { link, hasPosition, previewIsDefault } = args;
  if (link.kind === 'folder') return 'osExplorer';
  if (!link.inProject) return 'osExplorer';
  // FR-052: a preview cannot reveal a line and column. A `disabled` provider is drawn so the user
  // can see the way to enable it, not so a click can silently land on it.
  if (previewIsDefault && !hasPosition && link.preview === 'enabled') return 'preview';
  return 'editor';
}
