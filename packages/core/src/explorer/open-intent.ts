/**
 * Open-on-click decision (004, FR-026/FR-027/FR-028, research D7). Pure.
 * A folder click toggles expansion; a file click opens (emitting an open-file
 * intent) when the click matches the configured mode, otherwise just selects.
 * No OS/DOM.
 */
import type { EditorOpenOnClick } from '../config/app-settings.js';
import type { NodeKind } from './node.js';

export type ClickAction = 'open' | 'select' | 'toggle';

/**
 * Decide what a click does. `clickCount` is 1 for a single click, 2 for a
 * double click. Folders always toggle. Files open on a click that matches the
 * trigger (single→1, double→2), else select.
 *
 * The parameter is named after the setting that actually feeds it —
 * `editor.openOnClick` (`file-tree.tsx:270` → `tree-node.tsx:47-49`). It was
 * called `openMode` after `explorer.openMode`, a setting that never reached this
 * function, and that name is literally how #95 hid: a search for the inert
 * setting's consumer appeared to find one (019 US5, C2). `'none'` is handled by
 * an early return upstream, so it never arrives here and behaviour is unchanged.
 */
export function decideClick(
  openOnClick: EditorOpenOnClick,
  kind: NodeKind,
  clickCount: number,
): ClickAction {
  if (kind === 'folder') return 'toggle';
  if (openOnClick === 'single') return clickCount >= 1 ? 'open' : 'select';
  return clickCount >= 2 ? 'open' : 'select';
}
