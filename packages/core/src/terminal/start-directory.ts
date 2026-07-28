/**
 * Which directory a Terminal Panel's terminal starts in (025 FR-028/FR-030/FR-031).
 *
 * Pure, so every fallback is testable without a filesystem: the caller supplies the answer to
 * "does this path still exist as a directory?" rather than this module going and looking.
 */
import { isUnderPath, samePath } from '../fs/path-id.js';

/**
 * Resolve the start directory for a terminal.
 *
 * Precedence: the Panel's remembered directory, when it is still usable, otherwise the project
 * root. A remembered directory is usable only when it still exists AND is still inside the owning
 * project — a directory that has been deleted, or that now resolves outside the project, falls
 * back to the root **without an error** (FR-030). Project isolation (Principle I) is why the
 * containment check is not optional: a remembered path must never let one project's terminal open
 * inside another.
 *
 * A rootless (sub-workspace-owned) Panel passes its home directory as `root`, and the same rules
 * apply against that.
 */
export function resolveStartDirectory(
  root: string,
  rememberedCwd: string | undefined,
  directoryExists: (path: string) => boolean,
): string {
  if (!rememberedCwd) return root; // FR-031: no memory → the project root, exactly as today.
  if (!isWithinOrEqual(rememberedCwd, root)) return root; // escaped its project → root.
  if (!directoryExists(rememberedCwd)) return root; // gone, or no longer a directory → root.
  return rememberedCwd;
}

/** Whether `candidate` is the root itself or sits underneath it. */
function isWithinOrEqual(candidate: string, root: string): boolean {
  return samePath(candidate, root) || isUnderPath(candidate, root);
}
