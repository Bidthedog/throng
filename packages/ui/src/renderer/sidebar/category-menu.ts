/**
 * A category header's right-click menu (046 US5, contracts/menus.md §2, §6; T080, iterate round 1
 * T120/T138, FR-083).
 *
 * Sections: content (Rename Category) · destroy (Delete Category) · navigate (Move Category Up /
 * Move Category Down) · viewState (the checkable Minimise Category toggle). Delete, Move and
 * Minimise are DRAWN ONLY for a non-default category — absent, not disabled, because no state of
 * the application could ever enable them for the one category that can never be deleted, reordered
 * or minimised (Principle VI, FR-050, FR-083). A default category's menu is therefore a
 * single-section menu with no divider — `withDividers` derives that from there being only one
 * section to bound, not from a special case here.
 *
 * Move Category Up/Down ARE disabled rather than absent on a non-default category, because whether
 * one exists to move to is exactly a state the application can be in: `canMoveUp`/`canMoveDown` are
 * computed by the caller from the live category order (`projects-panel-category-menu.test.ts`, the
 * component layer that actually knows the order) and simply reach `disabled` here.
 *
 * Minimise Category follows the editor's Word Wrap idiom (`content-menu.ts:217-218`): the checkmark
 * lives in the LABEL ("Minimise Category" / "Minimise Category ✓"), and the test id is pinned to the
 * bare label so it stays the same row while the state it reports changes.
 */
import type { MenuAction } from '../workspace/context-menu.js';

export interface CategoryMenuArgs {
  /** The default category cannot be deleted, reordered or minimised by any route (FR-050, FR-083). */
  isDefault: boolean;
  /** The category's current minimised state — drives the checkable toggle's label and icon. */
  minimised: boolean;
  /** Whether there is a non-default category above this one to move it before (FR-083). */
  canMoveUp: boolean;
  /** Whether there is a non-default category below this one to move it after (FR-083). */
  canMoveDown: boolean;
  onRename: () => void;
  onDelete: () => void;
  onToggleMinimised: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function categoryMenu(args: CategoryMenuArgs): MenuAction[] {
  const {
    isDefault,
    minimised,
    canMoveUp,
    canMoveDown,
    onRename,
    onDelete,
    onToggleMinimised,
    onMoveUp,
    onMoveDown,
  } = args;

  const items: MenuAction[] = [
    { label: 'Rename Category', icon: 'rename', section: 'content', onClick: onRename },
  ];

  if (isDefault) return items;

  items.push(
    { label: 'Delete Category', icon: 'destroy', section: 'destroy', onClick: onDelete },
    {
      label: 'Move Category Up',
      icon: 'moveUp',
      section: 'navigate',
      disabled: !canMoveUp,
      onClick: onMoveUp,
    },
    {
      label: 'Move Category Down',
      icon: 'moveDown',
      section: 'navigate',
      disabled: !canMoveDown,
      onClick: onMoveDown,
    },
    {
      label: minimised ? 'Minimise Category ✓' : 'Minimise Category',
      testId: 'menu-item-Minimise Category',
      icon: minimised ? 'expand' : 'collapse',
      section: 'viewState',
      onClick: onToggleMinimised,
    },
  );

  return items;
}
