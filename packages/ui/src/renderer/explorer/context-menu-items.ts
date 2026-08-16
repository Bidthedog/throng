/**
 * Builds the file-tree right-click menu (004, T051, FR-020). Offers the
 * actionable operations + "Open in file explorer"; paste is disabled when the
 * clipboard is empty; the root cannot be renamed/cut/copied/deleted. Structured
 * so more items can be added as the feature grows.
 */
import type { MenuAction } from '../workspace/context-menu.js';
import type { ClipboardState } from './use-explorer-data.js';
import {
  firstBinding,
  pathForms,
  type FlavourOption,
  type Keybindings,
  type TargetNode,
} from '@throng/core';

export interface ContextMenuOps {
  beginRename: (relPath: string) => void;
  cut: (relPaths: string[]) => void;
  copy: (relPaths: string[]) => void;
  paste: (target: TargetNode) => void;
  remove: (relPaths: string[]) => void;
  reveal: (relPath: string) => void;
  hide: (relPath: string) => void;
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
}

export function buildContextMenuItems(args: {
  node: TargetNode;
  selectedRelPaths: string[];
  clipboard: ClipboardState;
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
}): MenuAction[] {
  const { node, selectedRelPaths, clipboard, ops, openIn, keybindings, projectRoot, undoState, flavours } = args;
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
    items.push({ label: 'Rename', icon: 'rename', section: 'content', shortcut: sc('file.rename'), onClick: () => ops.beginRename(node.relPath) });
    // 023 (#127): the clipboard actions now have their own theme tokens (cut/copy/paste), so the
    // reserved icon column finally renders a glyph rather than sitting blank.
    items.push({ label: 'Cut', icon: 'cut', section: 'content', shortcut: sc('file.cut'), onClick: () => ops.cut(targets) });
    items.push({ label: 'Copy', icon: 'copy', section: 'content', shortcut: sc('file.copy'), onClick: () => ops.copy(targets) });
  }
  items.push({ label: 'Paste', icon: 'paste', section: 'content', disabled: clipboard === null, shortcut: sc('file.paste'), onClick: () => ops.paste(node) });
  // 024 US3 (#85): undo/redo the last file OPERATION. Disabled — not hidden — when the stack is
  // empty: an action that exists and is unavailable teaches what the menu can do; one that vanishes
  // teaches nothing (and leaves the user wondering whether undo exists at all).
  items.push({
    label: 'Undo',
    icon: 'undo',
    section: 'content',
    disabled: !(undoState?.canUndo ?? false),
    shortcut: sc('file.undo'),
    onClick: () => ops.undoFileOp(),
  });
  items.push({
    label: 'Redo',
    icon: 'redo',
    section: 'content',
    disabled: !(undoState?.canRedo ?? false),
    shortcut: sc('file.redo'),
    onClick: () => ops.redoFileOp(),
  });

  // Create section.
  items.push({ label: 'New File', icon: 'add', section: 'create', onClick: () => ops.newFile(node) });
  items.push({ label: 'New Folder', icon: 'newFolder', section: 'create', onClick: () => ops.newFolder(node) });

  // Destructive section. The root has none, and an EMPTY group draws no divider — which is why the
  // tree's empty space still opens with two boundaries rather than four (M5).
  if (!isRoot) {
    items.push({ label: 'Delete', icon: 'destroy', section: 'destroy', shortcut: sc('file.delete'), onClick: () => ops.remove(targets) });
  }

  // Location section (US5/#158, FR-018a): a single "Open In" submenu, "OS File Explorer" FIRST,
  // with the editor "Open In" targets (for files) beneath. Folders get just the OS reveal. The child
  // reads "OS File Explorer" — the parent already says "Open In", so "Open in OS File Explorer" doubled it.
  const openInItems: MenuAction[] = [
    { label: 'OS File Explorer', icon: 'folderOpen', section: 'navigate', onClick: () => ops.reveal(node.relPath) },
    ...(openIn ?? []),
  ];
  /*
   * 033 US3 (FR-029/FR-030/FR-035) — Terminal, a THIRD level nested inside Open In, for folders and
   * files alike. A file gets one because "open a shell here" means the folder the file lives in,
   * which is what the user is pointing at; there is no state in which the item would be meaningless,
   * so Principle VI says disable it, never hide it.
   *
   * The children ARE the catalogue — mapped, not filtered and not re-ordered. A user-defined flavour
   * therefore appears with no wiring at all, and a disabled built-in is already absent by the time
   * the list arrives (FR-030, FR-037).
   */
  const terminalFlavours = flavours ?? [];
  const canOpenTerminal = terminalFlavours.length > 0 && ops.openInTerminal !== undefined;
  openInItems.push({
    label: 'Terminal',
    icon: 'terminal',
    section: 'navigate',
    disabled: !canOpenTerminal,
    submenu: canOpenTerminal
      ? terminalFlavours.map((flavour) => ({
          label: flavour.label,
          icon: 'terminal',
          section: 'navigate' as const,
          onClick: () => ops.openInTerminal?.(node, flavour),
        }))
      : undefined,
  });
  items.push({ label: 'Open In', icon: 'send', section: 'navigate', submenu: openInItems });

  // US9 (#156): "Copy Path" submenu, directly below "Open In" in the location group (FR-018a).
  // Four forms — absolute/relative × Windows(\)/Linux(/); relative is against the project root.
  if (projectRoot !== undefined) {
    const forms = pathForms(projectRoot, node.relPath);
    const copyText = (text: string): void => {
      void window.throng?.clipboard?.write({ text, mode: 'verbatim' });
    };
    // Every form copies a path to the clipboard, so the whole group — parent and each leaf — carries
    // the shared `copy` glyph (023): the row is a copy action whichever form the user picks.
    items.push({
      label: 'Copy Path',
      icon: 'copy',
      section: 'navigate',
      submenu: [
        { label: 'Absolute (Windows)', icon: 'copy', section: 'navigate', onClick: () => copyText(forms.absWin) },
        { label: 'Absolute (POSIX)', icon: 'copy', section: 'navigate', onClick: () => copyText(forms.absPosix) },
        { label: 'Relative (Windows)', icon: 'copy', section: 'navigate', onClick: () => copyText(forms.relWin) },
        { label: 'Relative (POSIX)', icon: 'copy', section: 'navigate', onClick: () => copyText(forms.relPosix) },
      ],
    });
  }

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
  }

  // Hide section (023, #127): the 'hide' token now exists — a circled slash reading as "kept out of
  // this project's view".
  if (!isRoot) {
    items.push({ label: 'Hide in this project', icon: 'hide', section: 'viewState', onClick: () => ops.hide(node.relPath) });
  }
  return items;
}
