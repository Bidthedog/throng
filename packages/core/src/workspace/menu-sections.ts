/**
 * One section vocabulary for every context menu (033 US5 — FR-047 to FR-050,
 * contracts/menu-sections.md §1; Constitution Principle VI, v4.6.0, which is
 * CANONICAL for the sections and their order).
 *
 * A menu is only browsable if its items are grouped, and grouping only teaches
 * the user anything if every menu groups the same way — so where an item sits
 * is a property of the application, not a choice each menu makes for itself.
 * Sections and their order therefore live here, in core, where no menu can hold
 * a different opinion (M7).
 *
 * Note what is deliberately NOT here: dividers. A divider is the rendering of a
 * boundary between two groups, never a decoration placed by hand, so the
 * renderer joins the groups this module returns. "A single-section menu carries
 * no divider" then falls out of the data — one group has no boundary — rather
 * than out of a special case somebody has to remember (FR-050, M4).
 *
 * Pure. No DOM.
 */

/** The application's menu sections. See `MENU_SECTION_ORDER` for their order. */
export type MenuSection =
  /** Present only because of what the pointer is over. Leads the menu. */
  | 'contextual'
  /** Acts on the item's content or its name: Rename, Cut, Copy, Paste, Undo, Redo. */
  | 'content'
  /** Makes something new: New File, New Folder. */
  | 'create'
  /** Removes something: Delete, Destroy Tab, Destroy Panel. */
  | 'destroy'
  /** Takes you somewhere, or names where something is: Open In, Copy Path, Go To Line. */
  | 'navigate'
  /** Toggles and per-surface state: Zoom, Word Wrap, Set Language, Reset Name, Hide. */
  | 'viewState'
  /** Whole-application destinations: Settings, Key Bindings, Themes, About. */
  | 'application';

/**
 * The fixed order every menu draws its sections in. Stated once, here.
 * Destroy is third — ahead of Navigate and View & state — as the constitution
 * and FR-047 both have it, and as the Files & Folders menu the vocabulary was
 * derived from has always shipped.
 */
export const MENU_SECTION_ORDER: readonly MenuSection[] = [
  'contextual',
  'content',
  'create',
  'destroy',
  'navigate',
  'viewState',
  'application',
] as const;

/**
 * Groups `items` into one array per section, in `MENU_SECTION_ORDER`, keeping
 * each section's items in the order they were given (FR-053).
 *
 * Empty sections are dropped, so the joined result can neither begin nor end
 * with a divider (M5), and a menu whose items fall in a single section comes
 * back as exactly ONE group (M4).
 */
export function groupBySection<T>(
  items: readonly T[],
  of: (item: T) => MenuSection,
): T[][] {
  const bySection = new Map<MenuSection, T[]>();
  for (const item of items) {
    const section = of(item);
    const group = bySection.get(section);
    if (group) group.push(item);
    else bySection.set(section, [item]);
  }

  const groups: T[][] = [];
  for (const section of MENU_SECTION_ORDER) {
    const group = bySection.get(section);
    if (group && group.length > 0) groups.push(group);
  }
  return groups;
}
