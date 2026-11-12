/**
 * Context passing the row-level right-click handler down to react-arborist's
 * node renderer (TreeRow), which can't receive extra props directly (004, US3).
 */
import { createContext, useContext, type MouseEvent } from 'react';
import type { NodeApi } from 'react-arborist';
import type { TreeNodeData } from './use-explorer-data.js';

/** The File Explorer gesture that raised an open-file intent (067 FR-116). */
export type TreeOpenGesture = 'click' | 'dblclick' | 'dblclickUnsupportedOnly';

export interface ExplorerRowCtx {
  onContextMenu: (node: NodeApi<TreeNodeData>, event: MouseEvent) => void;
  /** Root-relative paths currently on the clipboard as a "cut" (shown greyed). */
  cutPaths: ReadonlySet<string>;
  /** Open-into-editor trigger (006, FR-009): single click, double click, or never
   *  (`none` — the file only opens via Enter or the Open In menu). */
  openOnClick: 'single' | 'double' | 'none';
  /**
   * Raise an open-file intent for the file at `relPath` → the last active editor. A pointer gesture names
   * itself (067 FR-116): `dblclickUnsupportedOnly` is the double click that follows a first click which
   * already opened the file, raised only so a file the editor refuses can still go to the OS.
   */
  onOpenFile: (relPath: string, gesture?: TreeOpenGesture) => void;
  /**
   * Root-relative paths of files with UNSAVED editor changes — the shared unsaved dot, on the file
   * itself. A user who has edited a file and looked away needs to see that from the place they think
   * about files, not only from the panel that happens to be holding it.
   */
  dirtyPaths: ReadonlySet<string>;
  /**
   * Root-relative path (lower-cased) of the file the ACTIVE EDITOR is showing, or null (#188).
   *
   * Deliberately not the same thing as the selection. The selection highlight belongs to the active
   * pane and vanishes when the keyboard is elsewhere (explorer.css) — which is exactly when the user
   * most wants to know which file they are in, since being in the editor is what put it there. So
   * the active file carries its own quieter mark, shown wherever the focus happens to be.
   *
   * Independent of `explorer.autoRevealActiveFile` as well: turning the follow-the-editor behaviour
   * off asks the tree not to MOVE on its own, not to stop saying what is open.
   */
  activeFilePath: string | null;
  /** The folder an OS file drag over the tree would drop into (067 FR-004), highlighted like a tree drop; `null` when none. */
  inboundDropFolder: string | null;
}

export const ExplorerRowContext = createContext<ExplorerRowCtx | null>(null);

export function useExplorerRow(): ExplorerRowCtx | null {
  return useContext(ExplorerRowContext);
}
