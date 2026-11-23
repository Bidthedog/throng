/**
 * The **Copy Path** submenu: one builder for every menu that offers it, so the File Explorer's row (US9, #156) and a
 * preview's body menu (074 FR-028, FR-068a) cannot drift apart. Four forms — absolute and relative, each with
 * Windows (`\`) and POSIX (`/`) separators; relative is against the project root. Every form copies a path to the
 * clipboard, so the parent and each leaf carry the shared `copy` glyph (023).
 */
import type { pathForms } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';

/** Put `text` on the clipboard exactly as given. */
export function copyPathText(text: string): void {
  void window.throng?.clipboard?.write({ text, mode: 'verbatim' });
}

/** The four forms of one path, as `pathForms` gives them. */
export type PathForms = ReturnType<typeof pathForms>;

export function copyPathSubmenu(forms: PathForms, section: MenuAction['section'], copy: (text: string) => void = copyPathText): MenuAction {
  return {
    label: 'Copy Path',
    icon: 'copy',
    section,
    submenu: [
      { label: 'Absolute (Windows)', icon: 'copy', section, onClick: () => copy(forms.absWin) },
      { label: 'Absolute (POSIX)', icon: 'copy', section, onClick: () => copy(forms.absPosix) },
      { label: 'Relative (Windows)', icon: 'copy', section, onClick: () => copy(forms.relWin) },
      { label: 'Relative (POSIX)', icon: 'copy', section, onClick: () => copy(forms.relPosix) },
    ],
  };
}

/**
 * The same submenu with the ABSOLUTE forms only (#681), for a project's own root folder — whose relative
 * forms would always be `.`. Derived from {@link copyPathSubmenu}, so label, glyphs and leaf labels stay its.
 */
export function copyAbsolutePathSubmenu(
  forms: PathForms,
  section: MenuAction['section'],
  copy: (text: string) => void = copyPathText,
): MenuAction {
  const full = copyPathSubmenu(forms, section, copy);
  return { ...full, submenu: full.submenu?.filter((leaf) => leaf.label?.startsWith('Absolute')) };
}
