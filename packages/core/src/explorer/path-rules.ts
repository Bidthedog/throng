/**
 * Project-root confinement for file operations (004, FR-022/FR-023/FR-037,
 * research D5). Pure. Inputs are RESOLVED REAL paths (the UI-main caller runs
 * realpath first) so symlink-escape is caught. Reuses the 003 project
 * path-normalise (resolve case + separators). No OS calls.
 */
import { normaliseFolder } from '../projects/project.js';

/** True when `candidateReal` is the root itself or lives inside it. */
export function isWithinRoot(rootReal: string, candidateReal: string): boolean {
  const r = normaliseFolder(rootReal);
  const c = normaliseFolder(candidateReal);
  if (!r || !c) return false;
  return c === r || c.startsWith(`${r}/`);
}

/**
 * True when moving/copying `srcReal` INTO `destDirReal` is allowed: both inside
 * the root, and the destination is not the source itself nor a descendant of it
 * (which would be moving a folder into its own subtree).
 */
export function isDropAllowed(srcReal: string, destDirReal: string, rootReal: string): boolean {
  if (!isWithinRoot(rootReal, srcReal)) return false;
  if (!isWithinRoot(rootReal, destDirReal)) return false;
  const s = normaliseFolder(srcReal);
  const d = normaliseFolder(destDirReal);
  if (d === s) return false; // into itself
  if (d.startsWith(`${s}/`)) return false; // into its own descendant
  return true;
}

/** The root row (relPath "") is immutable + non-collapsible (Principle I). */
export function isRoot(node: { relPath: string }): boolean {
  return node.relPath === '';
}
