/**
 * Builds the file-tree right-click menu (004, T051, FR-020). Offers the
 * actionable operations + "Open in file explorer"; paste is disabled when the
 * clipboard is empty; the root cannot be renamed/cut/copied/deleted. Structured
 * so more items can be added as the feature grows.
 */
import type { MenuAction } from '../workspace/context-menu.js';
import { copyPathSubmenu } from '../common/copy-path-menu.js';
import { openInRows, openInSubmenu } from './open-in-rows.js';
import type { FileClipboard } from '@throng/core';
import {
  firstBinding,
  formatGrouped,
  pathForms,
  type FlavourOption,
  type Keybindings,
  type PreviewAffordance,
  type TargetNode,
} from '@throng/core';

/** The slice of the shared clipboard (`FileClipboard`, core) that the Paste label reads. */
export interface PasteLabelClipboard {
  readonly items: readonly { readonly absPath: string; readonly projectId: string }[];
}

/**
 * The Paste row's label (050 FR-025a, contracts/ui-surfaces §5): what will land, and where from.
 *
 * One item → its name; several → the count, digit-grouped (constitution 4.5.0); then ` from <project>`
 * when the items came from a project other than the active one. That is the ONLY indicator of a
 * pending clipboard anywhere (FR-025a). A source project whose name cannot be resolved (it has since
 * been removed) drops the suffix rather than printing a blank.
 */
export function pasteLabel(
  clipboard: PasteLabelClipboard | null,
  activeProjectId: string | undefined,
  projectName: (projectId: string) => string | undefined,
): string {
  if (clipboard === null || clipboard.items.length === 0) return 'Paste';
  const [first] = clipboard.items;
  const what =
    clipboard.items.length === 1
      ? `"${first!.absPath.split(/[/\\]/).filter(Boolean).pop() ?? first!.absPath}"`
      : `${formatGrouped(clipboard.items.length)} items`;
  const source = first!.projectId;
  const from = source !== activeProjectId ? projectName(source) : undefined;
  return from ? `Paste ${what} from ${from}` : `Paste ${what}`;
}

export interface ContextMenuOps {
  beginRename: (relPath: string) => void;
  cut: (relPaths: string[]) => void;
  copy: (relPaths: string[]) => void;
  paste: (target: TargetNode) => void;
  remove: (relPaths: string[]) => void;
  reveal: (relPath: string) => void;
  hide: (relPath: string) => void;
  /**
   * 060 FR-033 — add the right-clicked entry to the project's Hidden to Find & Replace list.
   * Optional so a caller with no project to write to simply omits the row.
   */
  excludeFromSearch?: (relPath: string) => void;
  /** Create a new folder under the target (a folder → itself; a file → its parent). */
  newFolder: (target: TargetNode) => void;
  /** Create a new file under the target (a folder → itself; a file → its parent). */
  newFile: (target: TargetNode) => void;
  /** 024 US3 (#85): reverse / re-apply the last file operation. */
  undoFileOp: () => void;
  redoFileOp: () => void;
  /**
   * 033 US3 (FR-031): open a new terminal panel of `flavour`, started at the right-clicked folder —
   * or, for a file, at its parent folder. The launch sequence itself belongs to `file-tree.tsx`
   * (contract §A.2), which is the only place holding the workspace store.
   *
   * Optional so a caller that cannot launch one — no active tab to put a panel in — simply omits it
   * and gets the parent DRAWN AND DISABLED, which is what FR-035 asks for.
   */
  openInTerminal?: (node: TargetNode, flavour: FlavourOption) => void;
  /**
   * 033 US4 (FR-041/FR-042): open this folder's IMMEDIATE child folders, one level.
   *
   * Required, unlike `openInTerminal` — there is no state in which the tree can draw a folder and
   * not be able to expand it, so an optional handler would only invent a way to draw a dead row.
   */
  expandChildren: (relPath: string) => void;
  /** 033 US4 (FR-039): close every expanded descendant, leaving this folder itself open. */
  collapseChildren: (relPath: string) => void;
  /**
   * 043 FR-090: open or reuse the Find in Files panel, reset and scoped to this FILE or folder, with
   * replace shown when `replace` is true (*Find & Replace*) and hidden when it is false (*Find*).
   *
   * Required rather than optional, unlike `openInTerminal`: there is no state in which the tree can
   * draw a node and this route be unavailable. With no project open there is no tree at all, so the
   * menu holding it cannot be opened — FR-029e's note records that its disabled surface is, in
   * practice, the toolbar control alone.
   */
  findInFiles: (relPath: string, replace: boolean) => void;
  /**
   * 067 FR-015 — open this file with the OS default program. Optional so a caller that cannot reach
   * main simply draws no row.
   */
  openInDefaultProgram?: (relPath: string) => void;
  /** 067 FR-045, FR-054 — open the Properties dialog on these items (the selection, or the right-clicked one). */
  properties?: (relPaths: readonly string[]) => void;
}

export function buildContextMenuItems(args: {
  node: TargetNode;
  selectedRelPaths: string[];
  clipboard: FileClipboard;
  /** 050 FR-025a: the Paste row's label, from {@link pasteLabel}. Absent → plain `Paste`. */
  pasteLabel?: string;
  ops: ContextMenuOps;
  /** Editor "Open In" targets for a file (006, FR-011a) — appended under Open In,
   *  after OS File Explorer. Absent for folders/root. */
  openIn?: MenuAction[];
  /** Live keybindings (US1, #125) — the first bound chord of each file.* action is shown in
   *  brackets on its menu item. Absent → no shortcuts (unchanged rendering). */
  keybindings?: Keybindings;
  /** The project's absolute root path (US9, #156) — used to render the "Copy Path" forms. */
  projectRoot?: string;
  /** 024 US3 (#85): whether there is anything to undo / redo, so the items grey themselves
   *  honestly rather than offering an action that would do nothing. */
  undoState?: { canUndo: boolean; canRedo: boolean };
  /**
   * 033 US3 (FR-030): the terminal flavours, from the ONE catalogue `useFlavours()` reads — the same
   * one the panel type-picker offers. Passed in rather than read here because a `.ts` module cannot
   * call a hook, and copying the list into this file is exactly the second copy FR-030 forbids.
   *
   * Absent or empty — no project, no bridge, no detected shell — leaves the Terminal parent drawn
   * and disabled (FR-035).
   */
  flavours?: readonly FlavourOption[];
  /**
   * 044 FR-003, FR-004, FR-012, FR-062 — *Open In → Preview* for a FILE: core's affordance, computed by
   * `file-tree.tsx` at right-click with `preview.isOpen` awaited, and the `preview.open` request for it.
   *
   * Its OWN argument, deliberately not one of the `openIn` targets: those come from
   * `describeOpenInTargets`, which a Find in Files row also draws, and a result row always opens an
   * editor (FR-054, contracts/menus-and-controls.md §5). Absent, or an `absent` affordance, draws no row.
   *
   * 047 US2 (FR-014, contracts/menus-commands-controls.md, the Open In section for a file or folder) draws two
   * rows: `openLastActive`/`openNew` send the explicit `target` override (`{mode:'lastActive'}` /
   * `{mode:'new'}`) rather than letting *editor.previews.openTarget* decide, and carry the
   * `affordance`-based absent/disabled rule — `lastPreviewTitle` is *Last Preview Panel*'s one EXTRA
   * disable (`null`: nothing to reuse in the visible tab) and its label's name (FR-076). 047 FR-075
   * removed the plain *Preview* row, so there is no `open` here.
   */
  /** 067 FR-021 — `explorer.showOpenInOsDefaultProgram`: whether Open in OS Default Program is offered. */
  showOpenInDefaultProgram?: boolean;
  /** 067 FR-001 — the OS clipboard holds a file list, so Paste is available with no internal record. */
  osFiles?: boolean;
  preview?: {
    affordance: PreviewAffordance;
    openLastActive: () => void;
    openNew: () => void;
    /** The header title of the preview panel *Last Preview Panel* would reuse; `null` when there is none. */
    lastPreviewTitle: string | null;
  };
}): MenuAction[] {
  const { node, selectedRelPaths, clipboard, ops, openIn, pasteLabel: pasteText = 'Paste', keybindings, projectRoot, undoState, flavours, preview, showOpenInDefaultProgram = true, osFiles = false } = args;
  // US1 (#125): the first bound chord for an explorer command, or undefined (→ no brackets).
  const sc = (action: string): string | undefined =>
    keybindings ? firstBinding(keybindings, action as never) : undefined;
  const isRoot = node.relPath === '';
  // Operate on the whole selection when the right-clicked node is part of it;
  // otherwise just on that node.
  const targets =
    selectedRelPaths.length > 0 && selectedRelPaths.includes(node.relPath)
      ? selectedRelPaths
      : [node.relPath];

  /*
   * 033 US5 (FR-047 to FR-050): every item declares its SECTION and the four hand-pushed separators
   * are gone. `ContextMenu` derives a divider at each boundary instead — and lands them in exactly
   * the four places the pushed ones occupied, which is the evidence that the vocabulary really was
   * derived from this menu (contracts/menu-sections.md §3.1). Nothing here moved.
   */
  const items: MenuAction[] = [];
  if (!isRoot) {
    // Rename shares the clipboard rows' group, so the one divider inside Content is the one above Undo (#732).
    items.push({ label: 'Rename', icon: 'rename', section: 'content', group: 'clipboard', shortcut: sc('file.rename'), onClick: () => ops.beginRename(node.relPath) });
    // 023 (#127): the clipboard actions now have their own theme tokens (cut/copy/paste), so the
    // reserved icon column finally renders a glyph rather than sitting blank.
    items.push({ label: 'Cut', icon: 'cut', section: 'content', group: 'clipboard', shortcut: sc('file.cut'), onClick: () => ops.cut(targets) });
    items.push({ label: 'Copy', icon: 'copy', section: 'content', group: 'clipboard', shortcut: sc('file.copy'), onClick: () => ops.copy(targets) });
  }
  items.push({ label: pasteText, icon: 'paste', section: 'content', group: 'clipboard', disabled: clipboard === null && !osFiles, shortcut: sc('file.paste'), onClick: () => ops.paste(node) });
  // v1 review (#732): Undo / Redo are their own group, straight below the clipboard group, as in every content menu.
  // 024 US3 (#85): undo/redo the last file OPERATION. Disabled — not hidden — when the stack is
  // empty: an action that exists and is unavailable teaches what the menu can do; one that vanishes
  // teaches nothing (and leaves the user wondering whether undo exists at all).
  items.push({
    label: 'Undo',
    icon: 'undo',
    section: 'content',
    group: 'history',
    disabled: !(undoState?.canUndo ?? false),
    shortcut: sc('file.undo'),
    onClick: () => ops.undoFileOp(),
  });
  items.push({
    label: 'Redo',
    icon: 'redo',
    section: 'content',
    group: 'history',
    disabled: !(undoState?.canRedo ?? false),
    shortcut: sc('file.redo'),
    onClick: () => ops.redoFileOp(),
  });

  // Create section.
  items.push({ label: 'New File', icon: 'add', section: 'create', onClick: () => ops.newFile(node) });
  items.push({ label: 'New Folder', icon: 'newFolder', section: 'create', shortcut: sc('file.newFolder'), onClick: () => ops.newFolder(node) });

  // Destructive section. The root has none, and an EMPTY group draws no divider — which is why the
  // tree's empty space still opens with two boundaries rather than four (M5).
  if (!isRoot) {
    // 069 FR-055: the rubbish bin, the same icon as the toolbar's Delete. `section` is the menu's destructive group, not an icon.
    items.push({ label: 'Delete', icon: 'deleteFile', section: 'destroy', shortcut: sc('file.delete'), onClick: () => ops.remove(targets) });
  }

  /*
   * Location section (US5/#158, FR-018a): one Open In submenu, built by `openInRows` — the SAME builder the
   * Link menu calls over a local file or folder (081 FR-050), so the two cannot drift. The explorer's node is
   * always in the project and resolved; its root-relative performers are bound to the right-clicked node here,
   * whatever absolute path the builder hands back.
   *
   * 067 FR-015, FR-019, FR-021 — Open in OS Default Program on exactly one selected file, when the setting
   * offers it. 044 FR-003 — the preview rows for a file. 033 FR-029 — Terminal for files and folders alike;
   * the children ARE the flavour catalogue. 043 FR-090 — Search, for a file, a folder or the root.
   */
  const absPath = projectRoot === undefined ? node.relPath : isRoot ? projectRoot : `${projectRoot}/${node.relPath}`;
  const openInDefaultProgram = ops.openInDefaultProgram;
  const openInTerminal = ops.openInTerminal;
  const openInItems = openInRows(
    { absPath, kind: node.kind === 'folder' ? 'folder' : 'file', inProject: true, binary: false, pending: false },
    {
      osExplorer: () => ops.reveal(node.relPath),
      ...(showOpenInDefaultProgram && !isRoot && targets.length === 1 && openInDefaultProgram !== undefined
        ? { osDefaultProgram: () => openInDefaultProgram(node.relPath) }
        : {}),
      ...(openIn !== undefined ? { editorRows: openIn } : {}),
      ...(preview !== undefined ? { preview } : {}),
      ...(flavours !== undefined ? { flavours } : {}),
      ...(openInTerminal !== undefined ? { openInTerminal: (_abs: string, flavour: FlavourOption) => openInTerminal(node, flavour) } : {}),
      findInFiles: (_abs, replace) => ops.findInFiles(node.relPath, replace),
    },
  );
  items.push(openInSubmenu(openInItems, 'navigate'));

  // US9 (#156): "Copy Path" submenu, directly below "Open In" in the location group (FR-018a).
  // Four forms — absolute/relative × Windows(\)/Linux(/); relative is against the project root.
  // The submenu is the one every menu offering Copy Path builds (`copy-path-menu.ts`).
  if (projectRoot !== undefined) items.push(copyPathSubmenu(pathForms(projectRoot, node.relPath), 'navigate'));

  /*
   * 033 US4 (FR-038, contract E1/E2) — Collapse All Children then Expand All Children, closing the
   * Navigate group after Copy Path.
   *
   * ONLY FOR A FOLDER, and for a file NOT EVEN DISABLED. That is the deliberate opposite of the
   * Terminal parent a few lines above, which IS drawn disabled with no project — and the difference
   * is Principle VI's own test, "would any future state enable it?". A project can be opened; a file
   * can never acquire children. A row that can never come alive teaches the user nothing about what
   * the menu can do, it only takes up a line for every file they ever right-click.
   *
   * Collapse first, because it is the one with somewhere to go: the user reaching for this menu is
   * usually looking at a branch that has got away from them (US4's own framing — "tidy one branch").
   *
   * Neither carries a shortcut or a toolbar button (E3): they act on the RIGHT-CLICKED node, and a
   * chord has no such node to act on.
   */
  if (node.kind === 'folder') {
    items.push({
      label: 'Collapse All Children',
      icon: 'collapseAll',
      section: 'navigate',
      onClick: () => ops.collapseChildren(node.relPath),
    });
    items.push({
      label: 'Expand All Children',
      icon: 'expandAll',
      section: 'navigate',
      onClick: () => ops.expandChildren(node.relPath),
    });
    /*
     * 043 FR-029b's top-level **Find in Files** row closed this group until round five. It is not
     * here any more because it MOVED — into *Open In → Search*, above — rather than being joined by a
     * second route to the same command (FR-090; 006 FR-030's precedent for the OS reveal, "removed
     * from its previous top-level position, no duplication").
     *
     * Its comment gave the reason a file never had it: "a file can never become a directory to
     * search inside". That was only ever the premise that a scope is a directory, and FR-092 withdrew
     * it — a scope may name a single file — so the submenu is offered on files as well.
     */
  }

  // Hide section (023, #127): the 'hide' token now exists — a circled slash reading as "kept out of
  // this project's view".
  if (!isRoot) {
    items.push({ label: 'Hide in this project', icon: 'hide', section: 'viewState', onClick: () => ops.hide(node.relPath) });
    // 060 FR-033 — beside Hide: the same per-project visibility idea, for the search rather than the tree.
    const excludeFromSearch = ops.excludeFromSearch;
    if (excludeFromSearch) {
      items.push({
        label: 'Exclude from Find in Files in this project',
        icon: 'searchExclusions',
        section: 'viewState',
        onClick: () => excludeFromSearch(node.relPath),
      });
    }
  }

  // 067 FR-045, FR-128 — Properties, on files and folders alike, LAST in the whole menu: it is pushed
  // after every other row and joins the last group the menu draws — View & state (Hide) for a row,
  // Navigate for the root, which has no Hide row — so it adds no divider of its own. On a
  // multi-selection it shows the combined figures (FR-054).
  if (ops.properties) {
    items.push({
      label: 'Properties',
      icon: 'about',
      section: isRoot ? 'navigate' : 'viewState',
      onClick: () => ops.properties?.(targets),
    });
  }
  return items;
}
