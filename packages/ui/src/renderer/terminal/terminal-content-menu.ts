/**
 * The terminal's CONTENT context menu (033 US5, T063 — extracted from `terminal-panel.tsx`).
 *
 * Extracted so SC-010 can be asserted below E2E: the unit table drives every menu builder over a
 * table of fixtures, and a menu assembled inside a `useCallback` cannot be driven at all. The
 * extraction moves code without altering a label, an icon, an action or a condition (N6).
 *
 * **One visible change**, and it is deliberate: the separator that used to sit between *Refresh /
 * redraw terminal* and *Try again* is gone. Both are View & state, and FR-050 permits a divider only
 * at a real section boundary.
 *
 * *Why the failure trio is View & state* (adjudicated once, applied in both menus that carry it):
 * each of the three acts on the panel's FAILED STATE — retry it, report it, discard it — rather than
 * on the content. *Copy details* copies a description of that state, not the panel's content.
 *
 * *Why the link items are Contextual and lead the menu*: they are absent when the pointer is not
 * over a link — the constitution's exact test — and Assumption 8 records that demoting them below
 * Copy/Paste was rejected as a behaviour regression shipped under a grouping pass.
 */
import type { MenuAction } from '../workspace/context-menu.js';

export interface TerminalContentMenuActions {
  openLink: (url: string) => void;
  copyLinkAddress: (url: string) => void;
  copySelection: () => void;
  paste: () => void;
  redraw: () => void;
  tryAgain: () => void;
  copyDetails: () => void;
  clearPanelType: () => void;
}

export interface TerminalContentMenuArgs {
  /**
   * The link the menu should act on, or `null`. Resolved by `terminalLinkTarget` at the call site:
   * an active selection takes priority, so a menu opened over a link with text selected is the
   * ordinary Copy menu (024 US7, FR-019d).
   */
  link: string | null;
  /** The xterm selection captured when the user right-clicked — the menu acts on that, not on later. */
  selection: string;
  /** The chord `terminal.redraw` is bound to right now, or undefined when it is unbound. */
  redrawChord?: string;
  /** Whether a start failure is live — the only state in which its three commands are meaningful. */
  startFailure: boolean;
  actions: TerminalContentMenuActions;
}

export function terminalContentMenu(args: TerminalContentMenuArgs): MenuAction[] {
  const { link, selection, redrawChord, startFailure, actions } = args;

  const items: MenuAction[] = [];

  if (link !== null) {
    items.push({
      // No icon: there is no link/open token, and 023's rule is "an icon only where a token
      // exists". "Copy Link Address" is a copy action, so it carries the shared copy glyph.
      label: 'Open Link',
      testId: 'menu-item-Open Link',
      section: 'contextual',
      onClick: () => actions.openLink(link),
    });
    items.push({
      label: 'Copy Link Address',
      icon: 'copy',
      testId: 'menu-item-Copy Link Address',
      section: 'contextual',
      onClick: () => actions.copyLinkAddress(link),
    });
  }

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
    // The paste chord is FIXED (Ctrl+V / Shift+Insert, #142) and lives in the terminal key
    // handler, not the rebindable keybindings — so the shortcut shown is the literal native
    // chord, matching what the user presses. Copy has no chord of its own (Ctrl+C is the
    // shell's interrupt), so it carries no shortcut.
    shortcut: 'Ctrl+V',
    // The SAME paste route as Ctrl+V / Shift+Insert (#142): one implementation reads the
    // clipboard and writes it to the shell exactly once, so no gesture can double-paste and
    // the menu can never drift from the keyboard path.
    onClick: () => actions.paste(),
  });

  items.push({
    // 028 (issue 163) — the deliberate version of the divider nudge users discovered by
    // accident. It asks the running program to redraw: no content, scrollback, selection,
    // cursor, focus or layout changes, and nothing is typed at the shell.
    label: 'Refresh / redraw terminal',
    testId: 'menu-item-Refresh / redraw terminal',
    section: 'viewState',
    shortcut: redrawChord,
    onClick: () => actions.redraw(),
  });

  /*
   * 029 FR-004d — Retry and Clear as MENU ITEMS, not only as icons on the failure badge.
   *
   * The Constitution binds a feature that adds a panel action to add its menu item in the same
   * increment, and FR-004a makes clearing a panel user-invoked for the first time: until now
   * `clearPanelType` only ever ran automatically, as a side effect of a terminal ending. An
   * action reachable solely by an icon on a transient badge is exactly the invisibility that
   * rule exists to prevent.
   *
   * Shown only while a start failure is live, because that is the only state in which either
   * is meaningful — offering "Try again" to a healthy terminal would be noise. The menu itself
   * IS reachable in that state: its `onContextMenu` sits on a div rendered unconditionally, and
   * the failure badge is a sibling of that div rather than a cover.
   */
  if (startFailure) {
    items.push({
      label: 'Try again',
      testId: 'menu-item-Try again',
      section: 'viewState',
      /*
       * The SAME retry the banner's control runs (030 FR-042c) — and it goes THROUGH the banner
       * rather than calling `retryStart()` beside it. Calling `retryStart()` directly re-ran the
       * attach correctly and never touched the banner's retry state, so a menu retry that failed
       * left the banner standing and silent. Same command now means the same call.
       */
      onClick: () => actions.tryAgain(),
    });
    items.push({
      // 030 FR-042c — the banner's THIRD command, in the menu beside the other two. Same text,
      // same assembly, read through a ref so the menu copies the failure as it stands when it OPENS.
      label: 'Copy details',
      testId: 'menu-item-Copy details',
      section: 'viewState',
      onClick: () => actions.copyDetails(),
    });
    items.push({
      label: 'Clear panel type',
      testId: 'menu-item-Clear panel type',
      section: 'viewState',
      onClick: () => actions.clearPanelType(),
    });
  }

  return items;
}
