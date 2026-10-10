/**
 * The Outlining submenu (054 FR-010 – FR-014, research R3) — the ONE builder of a Markdown body menu's
 * fold rows, used by the editor's (`editor/content-menu.ts`) and the preview's (`preview/content-menu.ts`).
 *
 * *Supersedes 047 FR-036's placement*: the fold rows used to sit at each menu's top level, written out
 * twice; they now live in one submenu, built here, so the two menus are identical by construction rather
 * than by two authors agreeing (047's "identical menus" property, made structural). The submenu uses the
 * same `MenuAction.submenu` mechanism as Split and Open In.
 *
 * Contract order (contracts/menus-commands-controls-054.md "Outlining submenu"):
 *
 *   Collapse This Hn | Expand This Hn     absent before the first heading
 *   Collapse All Inside This Hn           absent before the first heading
 *   Expand All Inside This Hn             absent before the first heading
 *   Collapse All                          disabled with no headings
 *   Expand All                            disabled with no headings
 *
 * Every row shows its command's current chord (`firstBinding`, read by the caller); an unbound command —
 * the two All Inside commands ship unbound (FR-013) — shows none. The action bodies stay with the caller:
 * the editor folds through its fold commands, the preview through its own fold store, and both act on the
 * linked view (047 FR-033).
 */
import type { MenuAction } from '../workspace/context-menu.js';

export interface OutliningChords {
  collapseSection?: string;
  expandSection?: string;
  collapseAllInside?: string;
  expandAllInside?: string;
  collapseAll?: string;
  expandAll?: string;
}

export interface OutliningArgs {
  /**
   * The innermost section at the point the menu was opened (the clicked point, or the caret for a
   * keyboard-opened menu), or `null` before the first heading — when its four rows are ABSENT (FR-012).
   */
  section: { level: number; collapsed: boolean } | null;
  /** Whether the document has any heading — Collapse All / Expand All are disabled without one. */
  hasSections: boolean;
  collapseSection: () => void;
  expandSection: () => void;
  /** 054 FR-011 — collapse `section` and every section nested beneath it, each individually. */
  collapseAllInside: () => void;
  /** 054 FR-011 — expand the same set. */
  expandAllInside: () => void;
  collapseAll: () => void;
  expandAll: () => void;
  chords?: OutliningChords;
}

/** A row in View & state, with its chord when the command has one. */
function row(label: string, shortcut: string | undefined, onClick: () => void, disabled?: boolean): MenuAction {
  return {
    label,
    section: 'viewState',
    ...(shortcut !== undefined ? { shortcut } : {}),
    ...(disabled !== undefined ? { disabled } : {}),
    onClick,
  };
}

/** The one Outlining row — draw it only for a Markdown document (FR-014). */
export function outliningSubmenu(args: OutliningArgs): MenuAction {
  const chords = args.chords ?? {};
  const rows: MenuAction[] = [];
  const at = args.section;
  if (at) {
    rows.push(
      at.collapsed
        ? row(`Expand This H${at.level}`, chords.expandSection, () => args.expandSection())
        : row(`Collapse This H${at.level}`, chords.collapseSection, () => args.collapseSection()),
      row(`Collapse All Inside This H${at.level}`, chords.collapseAllInside, () => args.collapseAllInside()),
      row(`Expand All Inside This H${at.level}`, chords.expandAllInside, () => args.expandAllInside()),
    );
  }
  rows.push(
    row('Collapse All', chords.collapseAll, () => args.collapseAll(), !args.hasSections),
    row('Expand All', chords.expandAll, () => args.expandAll(), !args.hasSections),
  );
  return { label: 'Outlining', section: 'viewState', submenu: rows };
}
