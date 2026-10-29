/**
 * The Find in Files panel's CONTENT context menu (043 T076, FR-025a).
 *
 * Constitution v6.0.0, Principle VI: every action a panel offers MUST be reachable — by a mouse click
 * or by a keyboard command. A menu item is one such route and no longer a mandatory one (the
 * v5.10.0 wording demanded an item for every discrete command and toggle). 060 FR-022 takes the
 * latitude where it is earned: **Run search**, **Cancel search** and **Change scope** are not in this
 * menu, because each already has a route a click or a key away —
 *
 *   - run: the run control, `Enter` in the search input, and the find-in-files chord (043 FR-043a);
 *   - cancel: the cancel control, which is also the busy indicator while a scan runs (060 FR-001);
 *   - scope: the scope input, which IS the command (043 FR-030).
 *
 * 060 FR-042 takes it further: the Replace toggle, the exclusions toggle, the grouping rows and the
 * Split submenu left this menu too — the toolbar, the replace chord and the panel header's Split
 * reach each of them. What stays is what is about the pointer, plus the list-wide collapse.
 *
 * Scrolling and moving between rows stay exempt as navigational input.
 *
 * ══ WHERE EACH ITEM SITS, AND WHY (R20) ══
 *
 * Adjudicated once against the closed vocabulary in `@throng/core`:
 *
 *   - **Exclude a heading, collapse/expand all → `viewState`.** Visibility and presentation over
 *     results already found; the same family as the explorer's Collapse All Children.
 *   - **Replace All / in file / one match → `content`.** The only items here that change text.
 *     `content` means the RESULT ROW's content, which is a file's text; starting a search changes
 *     no text anywhere.
 *
 * ══ WHY THE COMMIT ITEMS ARE DRAWN WHILE REPLACE IS OFF ══
 *
 * Principle VI's own test is "would any future state enable it?", and the enabling state is one
 * click away — the replace toggle on the panel's toolbar. Hiding them would make the menu change
 * shape under a user who can flip that state without leaving the panel. They are also disabled
 * whenever no commit handler is supplied — which now means the command has nothing to do: Replace
 * All with nothing pending (FR-084), and the two narrow rows over a row or file already committed
 * (T233). A row that called nothing would be worse than a row that says it cannot.
 */
import { leftTruncatePath } from '@throng/core';
import { openInMenuActions, type OpenInTarget } from '../editor/open-in-targets.js';
import { previewOpenInRows, type PreviewOpenInFacts } from '../preview/preview-open-in.js';
import type { MenuAction } from '../workspace/context-menu.js';

/** The panel's own commands this menu offers — the same mutators the panel calls elsewhere. */
export interface FindInFilesMenuActions {
  /**
   * 060 FR-034 — add the file or folder HEADING the menu was opened on to the project's Hidden to
   * Find & Replace list. Absent exactly when it has nothing to do (the menu names no heading, or the
   * project already excludes it), and the row is then drawn disabled, like the commit rows.
   */
  excludeFromSearch?: () => void;
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
  /** Whether replace is disclosed: the commit rows are live only while it is. */
  replaceEnabled: boolean;
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
  /** 060 FR-048 — the File Explorer's preview rows for the file, from the shared builder; absent draws none. */
  preview?: PreviewOpenInFacts | null;
  pickPreview?: (mode: 'lastActive' | 'new') => void;
}


export function findInFilesContentMenu(args: FindInFilesMenuArgs): MenuAction[] {
  const { replaceEnabled, actions, commit, openIn } = args;

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
  const editorRows = openIn ? openInMenuActions(openIn.targets, openIn.pick) : [];
  // 060 FR-048 — the explorer's preview rows after the editor targets, divided from them as the explorer does.
  const previewRows =
    editorRows.length > 0 && openIn?.preview && openIn.pickPreview
      ? previewOpenInRows(openIn.preview, {
          lastActive: () => openIn.pickPreview?.('lastActive'),
          new: () => openIn.pickPreview?.('new'),
        })
      : [];
  const openInRows =
    previewRows.length > 0 ? [...editorRows.map((row) => ({ ...row, group: 'editor' })), ...previewRows] : editorRows;
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
      // 060 FR-023 — left-truncated, so the end that identifies the file survives a deep path and
      // the label stays a bounded width in a menu whose font is fixed.
      target ? `Replace in ${leftTruncatePath(target.relPath)}` : 'Replace in File',
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
      target ? `Replace Match in ${leftTruncatePath(target.relPath)}` : 'Replace Match',
      commit?.replaceMatch,
    ),

    // ── Navigate: where a result goes (FR-087) ────────────────────────────────────────────────
    // Open In is the only item here: it is scoped to the row the user just right-clicked. Where the
    // SEARCH looks is the scope input's business, not this menu's (060 FR-022).
    openInItem,

    // ── View & state: what the pointer is over, and the list's presentation ───────────────────
    /*
     * 060 FR-042 — no Replace toggle, no exclusions toggle, no grouping rows and no Split submenu
     * here. Each has its own route already: the toolbar's controls, the replace chord, and the panel
     * header's Split (Constitution VI, v6.0.0: every action reachable, not every action in every
     * menu). This menu keeps what is about the pointer — the commit rows, Open In, the exclusion of
     * a heading — and the list-wide Collapse all / Expand all, which have no other route.
     */
    {
      // 060 FR-034 — beside the explorer's "Hide in this project" in spirit: a per-project
      // visibility command, worded as the explorer's twin (FR-033).
      label: 'Exclude from Find in Files in this project',
      testId: 'menu-item-Exclude from Find in Files in this project',
      icon: 'searchExclusions',
      section: 'viewState',
      disabled: actions.excludeFromSearch === undefined,
      onClick: () => actions.excludeFromSearch?.(),
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
