/**
 * File-explorer tree nodes (004, data-model §1). Pure — maps `IFileSystem`
 * directory entries to tree nodes and sorts them folders-first, A–Z (FR-036).
 * Identity is the node's path relative to the project root. No OS/DOM.
 */
import type { DirEntry } from '../abstractions/file-system.js';

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

/** Map directory entries (under `parentRelPath`) to sorted tree nodes. */
export function toNodes(entries: readonly DirEntry[], parentRelPath: string): FileNode[] {
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
  return sortNodes(nodes);
}

/** Sort folders before files; within each group, case-insensitive A–Z by name. */
export function sortNodes(nodes: readonly FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' });
  });
}
