/**
 * Open-on-click decision (004, FR-026/FR-027/FR-028, research D7). Pure.
 * A folder click toggles expansion; a file click opens (emitting an open-file
 * intent) when the click matches the configured mode, otherwise just selects.
 * No OS/DOM.
 */
import type { OpenMode } from '../config/app-settings.js';
import type { NodeKind } from './node.js';

export type ClickAction = 'open' | 'select' | 'toggle';

/**
 * Decide what a click does. `clickCount` is 1 for a single click, 2 for a
 * double click. Folders always toggle. Files open on a click that matches the
 * mode (single→1, double→2), else select.
 */
export function decideClick(openMode: OpenMode, kind: NodeKind, clickCount: number): ClickAction {
  if (kind === 'folder') return 'toggle';
  if (openMode === 'single') return clickCount >= 1 ? 'open' : 'select';
  return clickCount >= 2 ? 'open' : 'select';
}
