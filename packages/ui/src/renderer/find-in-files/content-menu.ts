/**
 * The Find in Files panel's CONTENT context menu (043 T076, FR-025a).
 *
 * Constitution VI: every discrete command and state toggle a panel offers appears in that panel's
 * own menu, in the correct section, showing its chord where one is bound and its state where it is
 * a toggle. This feature introduces nine such commands at once, which is why the rule binds it
 * immediately rather than adding a tenth entry to the constitution's list of known gaps.
 *
 * The panel's toolbar icons and this menu are TWO ROUTES TO ONE ACTION, never two implementations:
 * every item below calls the same store mutator the icon beside it calls. Scrolling and moving
 * between rows stay exempt as navigational input.
 *
 * ══ WHERE EACH ITEM SITS, AND WHY (R20) ══
 *
 * Adjudicated once against the closed vocabulary in `@throng/core`:
 *
 *   - **Run / Cancel → `viewState`.** They act on the PANEL's run state. The earlier reading — that
 *     they map to nothing — dissolves once `content` is read as the RESULT ROW's content, which is
 *     a file's text. Starting a search changes no text anywhere.
 *   - **Toggle replace, grouping, collapse/expand all → `viewState`.** Toggles and presentation
 *     over results already found; the same family as the explorer's Collapse All Children.
 *   - **Change scope → `navigate`.** It names WHERE something is, which is the test that puts Copy
 *     Path there rather than the one that would make it a view toggle.
 *   - **Replace All / in file / one match → `content`.** The only items here that change text.
 *
 * ══ WHY THE COMMIT ITEMS ARE DRAWN WHILE REPLACE IS OFF ══
 *
 * Principle VI's own test is "would any future state enable it?", and the enabling state is one
 * click away — the replace toggle is two rows above them in this same menu. Hiding them would make
 * the menu change shape under a user who can flip that state from inside it. They are also disabled
 * whenever no commit handler is supplied — which now means the command has nothing to do: Replace
 * All with nothing pending (FR-084), and the two narrow rows over a row or file already committed
 * (T233). A row that called nothing would be worse than a row that says it cannot.
 */
import { firstBinding, type Grouping, type Keybindings } from '@throng/core';
import { openInMenuActions, type OpenInTarget } from '../editor/open-in-targets.js';
import type { MenuAction } from '../workspace/context-menu.js';

/** The panel's own commands — the same mutators its toolbar controls call. */
export interface FindInFilesMenuActions {
  run: () => void;
  cancel: () => void;
  toggleReplace: () => void;
  setGrouping: (grouping: Grouping) => void;
  /** FR-030 — put the caret in the scope control, which is where the scope is changed. */
  focusScope: () => void;
  /** FR-025a's collapse/expand ALL, as one action with a direction (FR-034). */
  setAllCollapsed: (collapsed: boolean) => void;
}

/**
 * The three commit granularities (FR-049), each ABSENT exactly when it has nothing to do.
 *
 * Optional per granularity rather than one optional bag, because each is available on its own
 * terms — Replace All while anything is pending, the two narrow ones for the row the menu names —
 * and a bag would make "two of the three are available" unrepresentable.
 */
export interface FindInFilesCommitActions {
  /**
   * Absent when there is nothing to replace (FR-084) as well as before the wave that wired it.
   *
   * The two absences mean the same thing to this module and to the reader of the menu — the command
   * cannot be performed — so they are one state rather than two, and the row is drawn and disabled
   * either way (Constitution VI). What decides it for FR-084 is the panel's, because the panel is
   * what knows which matches are still pending.
   */
  replaceAll?: () => void;
  replaceInFile?: () => void;
  replaceMatch?: () => void;
  /**
   * The row the two narrow granularities are aimed at, so their labels can NAME it.
   *
   * A bare "Replace in File" is a write action whose target is invisible: three files are listed,
   * the menu is open over one of them, and the row says nothing about which one it will rewrite.
   * The absence of this is the reason a stale reading position was unrecoverable rather than merely
   * wrong — nothing on screen contradicted a menu pointed at the wrong file.
   *
   * Absent exactly when the handlers are: no row was pointed at, so there is nothing to name and
   * the rows are drawn disabled under their generic labels.
   */
  target?: { relPath: string };
}

export interface FindInFilesMenuArgs {
  /** Whether a scan is running RIGHT NOW — Run and Cancel are one row, as in the toolbar. */
  running: boolean;
  replaceEnabled: boolean;
  grouping: Grouping;
  /** Read LIVE, so a rebound chord shows on the next right-click rather than the next restart. */
  keybindings: Keybindings;
  actions: FindInFilesMenuActions;
  commit?: FindInFilesCommitActions;
  openIn?: FindInFilesOpenIn;
}

/**
 * The Open In targets for the row the menu was opened on (043 FR-087).
 *
 * ══ WHY THIS ARRIVES AS DATA RATHER THAN AS A FUNCTION TO CALL ══
 *
 * The three targets are the file explorer's, unchanged — 006 FR-030's submenu as 006 FR-072, FR-082
 * and FR-098 left it — and 043 FR-087 requires them DERIVED FROM ONE DESCRIPTION rather than
 * re-authored here. So this module does not decide what the targets are, what they are called, or
 * which of them are available: it receives them already decided and lays them out.
 *
 * That the description arrives from outside is also what keeps the panel free of the workspace
 * store. `describeOpenInTargets` needs a layout, the editor state and an answer from main; the
 * panel's chrome has all three and the panel has none, by a decision this feature made when the
 * double-click opener was first registered.
 */
export interface FindInFilesOpenIn {
  /**
   * Empty exactly when the menu names no file — the toolbar, a group heading, the status line, the
   * empty space below the last row — and also when no chrome is mounted to answer.
   *
   * Both are the same fact to this module and to the reader of the menu: there is nothing to open.
   * The row is drawn and disabled either way (FR-087d).
   */
  targets: readonly OpenInTarget[];
  pick: (target: OpenInTarget) => void;
}

/** A toggle's label states what it currently IS — the editor's Word Wrap idiom, unchanged. */
const checked = (label: string, on: boolean): string => (on ? `${label} ✓` : label);

export function findInFilesContentMenu(args: FindInFilesMenuArgs): MenuAction[] {
  const { running, replaceEnabled, grouping, keybindings, actions, commit, openIn } = args;

  /*
   * ── Navigate: Open In (FR-087) ────────────────────────────────────────────────────────────────
   *
   * WHY `navigate` AND NOT `contextual`. Section 0's test is *"would this item be absent if the
   * pointer were elsewhere?"*, and taken alone that catches this row: an Open In over a result row
   * is absent over the toolbar. It still goes in `navigate`, for three reasons that agree —
   *
   *   1. the vocabulary table names "Open In" in the navigate row, by name;
   *   2. the explorer's identical items have declared `navigate` since 033 US5, and the whole point
   *      of FR-087 is that the two menus offer the same command;
   *   3. THIS MENU ALREADY SETTLED THE SAME SHAPE THE SAME WAY. Its three commit granularities are
   *      row-scoped too — two of them name the file they are aimed at — and they sit in `content`,
   *      because that is what they DO. A section is chosen by what an item does, not by what caused
   *      it to be drawn.
   *
   * Recorded because the Contextual test genuinely does fire here, and the next reader will ask.
   */
  const openInRows = openIn ? openInMenuActions(openIn.targets, openIn.pick) : [];
  const openInItem: MenuAction = {
    label: 'Open In',
    testId: 'menu-item-Open In',
    icon: 'send',
    section: 'navigate',
    // FR-087d — drawn and disabled when the menu names no file, exactly as the commit rows above
    // are. A menu that changes shape depending on where in the panel it was opened teaches nothing
    // about what the panel can do, and a future state enables this one: right-click a row.
    disabled: openInRows.length === 0,
    submenu: openInRows.length > 0 ? openInRows : undefined,
  };

  /*
   * A commit row is live only when replace is disclosed AND something is wired to perform it. Both
   * conditions, because they fail for different reasons and a user needs to be able to tell the
   * difference by flipping the toggle.
   */
  /*
   * The test id comes from the ACTION, never from the label.
   *
   * The two narrow labels name the file they are aimed at, so they change with the pointer — and a
   * test id derived from the label would change with it, which would make the id a statement about
   * the current selection rather than about which command this row is.
   */
  const commitItem = (
    action: string,
    label: string,
    handler: (() => void) | undefined,
  ): MenuAction => ({
    label,
    testId: `menu-item-${action}`,
    icon: 'replaceAll',
    section: 'content',
    disabled: !replaceEnabled || handler === undefined,
    onClick: () => handler?.(),
  });

  const target = commit?.target;

  return [
    // ── Content: the only items that change a file's text (FR-049) ────────────────────────────
    commitItem('Replace All', 'Replace All', commit?.replaceAll),
    commitItem(
      'Replace in File',
      // The generic wording survives only where there is no file to name, which is exactly when the
      // row is disabled — so a live row never says "File" and means one in particular.
      target ? `Replace in ${target.relPath}` : 'Replace in File',
      commit?.replaceInFile,
    ),
    commitItem(
      'Replace Match',
      /*
       * The file, and NOT the match's line number.
       *
       * The line would identify one match of three in the same file, and it is tempting — but a
       * line number is a displayed QUANTITY (constitution 4.5.0, widened by 5.4.0), so it would
       * have to come through `formatGrouped`, and `find-in-files-grouping-view-only.test.ts` lists
       * this module among those that may not call it. That list is right: this file builds a menu
       * and has no figure to show. Which match is already answered on screen — the row the menu was
       * opened from is the one carrying `aria-current` — and the file is the part that was invisible.
       */
      target ? `Replace Match in ${target.relPath}` : 'Replace Match',
      commit?.replaceMatch,
    ),

    // ── Navigate: where a result goes (FR-087), then where the search looks (FR-030) ──────────
    /*
     * Open In LEADS the group. The section's position is fixed by the vocabulary; the order within
     * it is this builder's, and it goes first because it is the only item here scoped to the row the
     * user just right-clicked. "Change scope" is a panel-wide field, and burying the row's own
     * action under it would put the reason the menu was opened second.
     */
    openInItem,
    {
      // No chord: the scope control has no command of its own — it is a field, and this row is the
      // menu's route to it. Advertising `search.findInFiles`' chord here would name a keystroke
      // that starts a search instead.
      label: 'Change scope',
      testId: 'menu-item-Change scope',
      icon: 'searchScope',
      section: 'navigate',
      onClick: () => actions.focusScope(),
    },

    // ── View & state: the panel's run state, its toggles and its presentation ─────────────────
    /*
     * Run and Cancel are ONE row, and it leads the group.
     *
     * One row because they are one control in the toolbar and one fact about the panel: a menu
     * offering both would say the search can be started and stopped in the same moment. Leading
     * because it is the panel's primary command — the section's ORDER is fixed by the vocabulary,
     * the order within it is the builder's, and burying Run under three grouping toggles would put
     * the least-used items first.
     */
    running
      ? {
          label: 'Cancel search',
          testId: 'menu-item-Cancel search',
          icon: 'dismiss',
          section: 'viewState',
          onClick: () => actions.cancel(),
        }
      : {
          label: 'Run search',
          testId: 'menu-item-Run search',
          icon: 'search',
          section: 'viewState',
          // The chord that INVOKES find in files, which is the rebindable route to the same thing
          // (FR-043a names the run command and the chord as the two explicit runs).
          shortcut: firstBinding(keybindings, 'search.findInFiles'),
          onClick: () => actions.run(),
        },
    {
      // FR-046 — the panel-level action FR-029d points at. Replace in files has no menu item of its
      // own; this toggle is the item that satisfies the every-panel-action rule for it.
      label: checked('Replace', replaceEnabled),
      testId: 'menu-item-Replace',
      icon: 'replace',
      section: 'viewState',
      shortcut: firstBinding(keybindings, 'search.replaceInFiles'),
      onClick: () => actions.toggleReplace(),
    },
    {
      label: checked('Group by file', grouping === 'file'),
      testId: 'menu-item-Group by file',
      icon: 'file',
      section: 'viewState',
      onClick: () => actions.setGrouping('file'),
    },
    /*
     * There were three grouping rows. FR-073 withdrew "Group by folder", and no `formatGrouped` call
     * arrived with the edit — `find-in-files-grouping-view-only.test.ts` lists this module among
     * those forbidden to call it, and removing a row is exactly the kind of edit that would slip one
     * past. Nothing here shows a figure; the two rows below are toggles.
     */
    {
      label: checked('Group by folder and file', grouping === 'fileAndFolder'),
      testId: 'menu-item-Group by folder and file',
      icon: 'folderOpen',
      section: 'viewState',
      onClick: () => actions.setGrouping('fileAndFolder'),
    },
    {
      label: 'Collapse all',
      testId: 'menu-item-Collapse all',
      icon: 'collapseAll',
      section: 'viewState',
      onClick: () => actions.setAllCollapsed(true),
    },
    {
      label: 'Expand all',
      testId: 'menu-item-Expand all',
      icon: 'expandAll',
      section: 'viewState',
      onClick: () => actions.setAllCollapsed(false),
    },
  ];
}
