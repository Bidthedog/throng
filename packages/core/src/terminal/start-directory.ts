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

/**
 * The remembered directory to TELL THE USER about, or nothing when there is nothing to say
 * (029 FR-005a / FR-005b).
 *
 * ══ WHY THE FALLBACK STOPPED BEING SILENT, AND ONLY PARTLY ══
 *
 * 025 made the fallback silent on purpose and was right that it must never be an error: the terminal
 * starts, nothing is lost, and interrupting the user would be nagging. But silence has its own cost,
 * which #204's cycle exposed — restore a project root while a subfolder stays deleted, and the user
 * finds a shell at the root with no explanation, which reads as "remember-my-directory is broken".
 *
 * So exactly ONE of the two fallback reasons is reported. A directory that is GONE is news: the user
 * did not ask to be moved and can see the difference. A directory that ESCAPED ITS PROJECT is a
 * boundary throng enforces deliberately, and announcing it would be explaining our own rule at
 * someone who never crossed it on purpose.
 *
 * Pure and separate from `resolveStartDirectory` so the distinction is testable without a
 * filesystem, an Electron process or a shell — it used to live inline in an IPC handler, where the
 * only way to exercise it was to launch the app.
 */
export function fallbackToReport(
  rememberedCwd: string | undefined,
  resolvedCwd: string,
  directoryExists: (path: string) => boolean,
): string | undefined {
  if (!rememberedCwd) return undefined; // nothing was remembered, so nothing was lost
  if (samePath(rememberedCwd, resolvedCwd)) return undefined; // it was honoured; no fallback happened
  if (directoryExists(rememberedCwd)) return undefined; // still there ⇒ it escaped the project
  return rememberedCwd;
}

/** Whether `candidate` is the root itself or sits underneath it. */
function isWithinOrEqual(candidate: string, root: string): boolean {
  return samePath(candidate, root) || isUnderPath(candidate, root);
}
