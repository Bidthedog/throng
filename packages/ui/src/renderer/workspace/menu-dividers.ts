/**
 * Turning a menu LEVEL's declared sections into the rows the renderer draws (033 US5, FR-048/FR-050).
 *
 * `ContextMenu` calls this once per level — including inside every submenu — so a divider is only
 * ever the RENDERING of a boundary between two of `groupBySection`'s groups, never a decoration a
 * builder placed by hand (M2, M3). Two consequences fall out of the data rather than out of a
 * special case someone has to remember: a menu whose items all share one section comes back with no
 * divider at all (M4), and because empty groups are dropped in core, the result can neither begin
 * nor end with one (M5).
 *
 * It lives in its own module, apart from the component, so the derivation can be asserted directly
 * by `packages/ui/tests/unit/menu-sections.test.ts` — SC-010's "one check that enumerates the menus"
 * needs the real join, not a re-implementation of it. Pure; the type import is erased.
 */
import { groupBySection } from '@throng/core';
import type { MenuAction, MenuItem } from './context-menu.js';

/** Join a level's sections with one divider per boundary. */
export function withDividers(actions: readonly MenuAction[]): MenuItem[] {
  const groups = groupBySection(actions, (action) => action.section);
  const rows: MenuItem[] = [];
  for (const group of groups) {
    if (rows.length > 0) rows.push({ separator: true });
    rows.push(...group);
  }
  return rows;
}
