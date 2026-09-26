/**
 * A project row's right-click menu (046 US4/US5, contracts/menus.md §1; T072, T081).
 *
 * Sections: content (Edit, Rename) · destroy (Remove) · viewState (Move to Category, then the two
 * Unload rows). contracts/menus.md §6 (FR-081): **Unload Project** runs the live
 * `projects.unloadTerminalAction` preference, and the second row names and runs its OPPOSITE — "Unload
 * Project and End Terminals" under keepRunning, "Unload Project and Keep Terminals Running" under
 * endTerminals — so no row duplicates another (006 FR-030) and neither needs a dialog (FR-111). Both are
 * always DRAWN — the constitution (Principle VI) disables rather than hides a row an application state
 * could still enable, and FR-038 is exactly that: a control present but disabled on an unloaded
 * project rather than absent.
 *
 * `Move to Category ▸` (FR-053) lists every OTHER category the caller passes — this builder does not
 * filter out the project's own category itself; the caller already knows which one that is and
 * excludes it, exactly as `projects-panel-menu.test.ts` (T060, pre-US5) and `menu-sections.test.ts`
 * (T061/T079) pin it. Every row in the submenu, New Category… included, is sectioned `navigate` — the
 * SAME section for the whole level, exactly the reasoning `open-in-targets.ts`'s own comment gives
 * ("every row says navigate", divider-free): the contract's order is categories THEN New Category…,
 * and `MENU_SECTION_ORDER` places `create` ahead of `navigate`, so giving New Category… its own
 * `create` section would have reordered it to the FRONT instead of leaving it last.
 */
import type { MenuAction } from '../workspace/context-menu.js';

export interface ProjectMenuCategoryOption {
  id: string;
  name: string;
}

export interface ProjectMenuArgs {
  /** Whether the project is currently loaded (FR-038) — gates the two Unload rows. */
  loaded: boolean;
  /** The LIVE `projects.unloadTerminalAction` — picks the second Unload row's label and variant (FR-081). */
  defaultAction: 'keepRunning' | 'endTerminals';
  onEdit: () => void;
  onRename: () => void;
  onRemove: () => void;
  /** Runs Unload. `undefined` for the plain row (the user's configured default action). */
  onUnload: (variant?: 'keepRunning' | 'endTerminals') => void;
  /** Every category the project could move to — its own already excluded by the caller (FR-053). */
  categories: ProjectMenuCategoryOption[];
  onMoveToCategory: (categoryId: string) => void;
  onNewCategory: () => void;
}

export function projectMenu(args: ProjectMenuArgs): MenuAction[] {
  const { loaded, defaultAction, onEdit, onRename, onRemove, onUnload, categories, onMoveToCategory, onNewCategory } =
    args;
  const opposite = defaultAction === 'keepRunning' ? 'endTerminals' : 'keepRunning';
  const oppositeLabel =
    opposite === 'endTerminals' ? 'Unload Project and End Terminals' : 'Unload Project and Keep Terminals Running';

  return [
    { label: 'Edit', icon: 'editVisual', section: 'content', onClick: onEdit },
    { label: 'Rename', icon: 'rename', section: 'content', onClick: onRename },
    { label: 'Remove', icon: 'destroy', section: 'destroy', onClick: onRemove },
    {
      label: 'Move to Category',
      icon: 'category',
      section: 'viewState',
      submenu: [
        ...categories.map((category) => ({
          label: category.name,
          section: 'navigate' as const,
          onClick: () => onMoveToCategory(category.id),
        })),
        { label: 'New Category…', icon: 'add', section: 'navigate' as const, onClick: onNewCategory },
      ],
    },
    {
      label: 'Unload Project',
      icon: 'unload',
      section: 'viewState',
      disabled: !loaded,
      onClick: () => onUnload(undefined),
    },
    {
      label: oppositeLabel,
      icon: 'unload',
      section: 'viewState',
      disabled: !loaded,
      onClick: () => onUnload(opposite),
    },
  ];
}
