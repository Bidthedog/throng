/**
 * Paste / drop / new-folder target resolution (004, FR-017/FR-019/FR-033,
 * research D5). Pure. Returns the target directory's root-relative path
 * ("" = project root). No OS/DOM.
 */
import { type NodeKind, parentRel } from './node.js';

/** The minimum a node needs for target resolution. */
export type TargetNode = { relPath: string; kind: NodeKind };

/**
 * Resolve the directory an action targets, given the node it lands on:
 * a folder → that folder; a file → its parent; nothing selected → the root.
 * For a multi-selection the caller passes the anchor node.
 */
export function resolveTarget(node: TargetNode | null): string {
  if (!node) return '';
  return node.kind === 'folder' ? node.relPath : parentRel(node.relPath);
}
