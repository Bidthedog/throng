/**
 * Project-creation overlap detection (006 Phase E, FR-038). Pure. Creating a
 * project whose root would swallow a file currently open in a sub-workspace-owned
 * editor is blocked (the user must save + close that editor first), so a file
 * never silently changes ownership out from under an open buffer. Reuses the 004
 * `isWithinRoot` normalise. No OS calls.
 */
import { isWithinRoot } from '../explorer/path-rules.js';

/**
 * Would a new project rooted at `newRoot` contain any file open in a
 * sub-workspace-owned editor? Returns the offending files (empty ⇒ not blocked).
 */
export function projectRootWouldContainOpenEditor(
  newRoot: string,
  openSubWsEditors: readonly { filePath: string }[],
): { blocked: boolean; files: string[] } {
  const files = openSubWsEditors
    .map((e) => e.filePath)
    .filter((filePath) => isWithinRoot(newRoot, filePath));
  return { blocked: files.length > 0, files };
}
