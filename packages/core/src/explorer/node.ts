/**
 * File-explorer tree nodes (004, data-model §1). Pure — maps `IFileSystem`
 * directory entries to tree nodes and sorts them folders-first, A–Z (FR-036), numbers by value
 * unless the user chose character order (FR-036a, #470).
 * Identity is the node's path relative to the project root. No OS/DOM.
 */
import type { DirEntry } from '../abstractions/file-system.js';
import type { ExplorerSortOrder } from '../config/app-settings.js';

export type NodeKind = 'file' | 'folder';

export interface FileNode {
  /** Root-relative path (POSIX-normalised); "" for the root. Stable tree identity. */
  id: string;
  name: string;
  kind: NodeKind;
  /** Path relative to the project root ("" for the root node). */
  relPath: string;
  /** Symlink/junction — shown with an indicator, never followed out of root (FR-037). */
  isSymlink: boolean;
  /** Folders only — whether a chevron should show. */
  hasChildren: boolean;
  /** Lazily loaded children; `undefined` = not yet read. */
  children?: FileNode[];
}

/** Join a parent's relative path with a child name into a POSIX relPath. */
export function joinRel(parentRelPath: string, name: string): string {
  return parentRelPath ? `${parentRelPath}/${name}` : name;
}

/** The parent directory's relPath of a node ("" when the node is at the root). */
export function parentRel(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? '' : relPath.slice(0, i);
}

/** Map directory entries (under `parentRelPath`) to tree nodes sorted in `order`. */
export function toNodes(
  entries: readonly DirEntry[],
  parentRelPath: string,
  order: ExplorerSortOrder = 'natural',
): FileNode[] {
  const nodes = entries.map((e): FileNode => {
    const relPath = joinRel(parentRelPath, e.name);
    return {
      id: relPath,
      name: e.name,
      kind: e.kind,
      relPath,
      isSymlink: e.isSymlink,
      hasChildren: e.kind === 'folder' ? (e.hasChildren ?? false) : false,
    };
  });
  return sortNodes(nodes, order);
}

/**
 * One collator per order, built once: `localeCompare` with options constructs a fresh collator on
 * every call (see `search/file-search.ts`). `numeric` is the only difference between the two —
 * case and accent handling are 004 FR-036's in both (#470, FR-036a).
 */
const NAME_COLLATORS: Readonly<Record<ExplorerSortOrder, Intl.Collator>> = {
  natural: new Intl.Collator(undefined, { sensitivity: 'accent', numeric: true }),
  characters: new Intl.Collator(undefined, { sensitivity: 'accent' }),
};

/**
 * Sort folders before files; within each group, case-insensitive A–Z by name, with runs of digits
 * compared by value unless `order` is `characters` (004 FR-036 / FR-036a).
 */
export function sortNodes<T extends Pick<FileNode, 'kind' | 'name'>>(
  nodes: readonly T[],
  order: ExplorerSortOrder = 'natural',
): T[] {
  const collator = NAME_COLLATORS[order];
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}
