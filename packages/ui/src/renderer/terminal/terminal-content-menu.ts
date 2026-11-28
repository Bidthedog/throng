/**
 * The terminal's CONTENT context menu (033 US5, T063 — extracted from `terminal-panel.tsx`).
 *
 * Extracted so SC-010 can be asserted below E2E: the unit table drives every menu builder over a
 * table of fixtures, and a menu assembled inside a `useCallback` cannot be driven at all. The
 * extraction moves code without altering a label, an icon, an action or a condition (N6).
 *
 * v1 review (#732): the body menu holds what acts on the terminal's text: Copy, Paste and Find. Split, Refresh / redraw
 * terminal, the per-terminal toggles and the start failure's three commands are about the panel, so they are the
 * TITLE menu's (`workspace/panel-header-menu.ts`).
 *
 * ══ THIS MENU NO LONGER CARRIES ANY LINK ROW (045 round four, FR-169 – FR-171) ══
 *
 * 024 and 045's earlier rounds had the link run LEAD this menu when the pointer sat on a link. FR-169
 * supersedes that: a right-click (or `menu.open`) over a link with no selection now opens the ONE
 * Link menu (`links/link-menu.ts`, built from core's `buildLinkMenu`) **instead of** this menu
 * entirely — never both, never one leading the other. The call site (`terminal-panel.tsx`) decides
 * which menu to open; this builder only ever draws the ordinary one.
 */
import type { IconKey } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import { fixedShortcut } from '../common/fixed-shortcut.js';

export interface TerminalContentMenuActions {
  copySelection: () => void;
  paste: () => void;
  /** v1 review (#732) — open this terminal's find bar (`search.find`). Absent draws no Find row. */
  find?: () => void;
}

/** 076 FR-005 — one status-bar toggle as its menu item: the label, the resolved value, the chord and the flip. */
export interface TerminalMenuToggle {
  label: string;
  /** The icon its status-bar toggle draws (076 FR-002), struck through on the menu row while off. */
  icon: IconKey;
  on: boolean;
  chord?: string;
  toggle: () => void;
}

export interface TerminalContentMenuArgs {
  /** The xterm selection captured when the user right-clicked — the menu acts on that, not on later. */
  selection: string;
  /** The chord `search.find` is bound to right now, or undefined when it is unbound. */
  findChord?: string;
  actions: TerminalContentMenuActions;
}

export function terminalContentMenu(args: TerminalContentMenuArgs): MenuAction[] {
  const { selection, actions } = args;

  const items: MenuAction[] = [];

  items.push({
    label: 'Copy',
    icon: 'copy',
    section: 'content',
    disabled: selection.length === 0,
    onClick: () => actions.copySelection(),
  });
  items.push({
    label: 'Paste',
    icon: 'paste',
    section: 'content',
    // The paste chord is FIXED (Ctrl+V / Shift+Insert, #142; Cmd+V on macOS) and lives in the terminal
    // key handler, not the rebindable keybindings — so the shortcut shown is the native chord, in this
    // platform's form (`fixedShortcut`). Copy has no chord of its own (Ctrl+C is the
    // shell's interrupt), so it carries no shortcut.
    shortcut: fixedShortcut('paste'),
    // The SAME paste route as Ctrl+V / Shift+Insert (#142): one implementation reads the
    // clipboard and writes it to the shell exactly once, so no gesture can double-paste and
    // the menu can never drift from the keyboard path.
    onClick: () => actions.paste(),
  });

  /*
   * v1 review (#732), superseding 043 FR-015's placement — Find, in Content with Copy and Paste because it acts on the
   * terminal's text. A terminal has Find alone: its find is read-only (FR-013).
   */
  if (actions.find !== undefined) {
    const find = actions.find;
    items.push({
      label: 'Find',
      icon: 'search',
      section: 'content',
      group: 'search',
      shortcut: args.findChord,
      onClick: () => find(),
    });
  }

  return items;
}
