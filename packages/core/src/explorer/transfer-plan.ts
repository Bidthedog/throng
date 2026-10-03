/**
 * The pure rules a paste or a drag is planned by (050, research R3). Pure: no fs, no OS, no DOM.
 *
 * Main owns the filesystem facts — real paths, what exists, sizes and times — and walks the tree a
 * folder merge needs. What each of those facts MEANS lives here, so the rule is stated once and can be
 * asserted without a disk.
 */
import { normaliseForCompare } from '../fs/path-id.js';
import { dedupeName } from './naming.js';

/** How one selected item relates to the folder it is being pasted into. */
export type TopLevelClass = 'same-folder-duplicate' | 'into-own-descendant' | 'ordinary';

/** What a name clash can become: a folder merge, or a choice the user makes (FR-018c). */
export type ClashKind = 'merge' | 'replaceable';

/** The user's answer to one clash (FR-018). Cancel is not a choice about the item — it ends the run. */
export type ClashChoice = 'replace' | 'skip' | 'keep-both';

/**
 * Classify a top-level item before anything is touched.
 *
 * - **same-folder-duplicate** — pasted back into the folder it already lives in. A copy there is a
 *   duplicate and takes the non-clobbering name with no question; a cut there is a no-op (FR-018c, and
 *   006's drop-onto-own-parent rule). Checked for both modes; the caller decides what each does.
 * - **into-own-descendant** — the target is the item itself or somewhere inside it. Refused, as it
 *   always has been within a project. Across projects it cannot happen (Principle I forbids nested
 *   roots), which is why it is decided here once rather than per caller.
 * - **ordinary** — everything else.
 *
 * All three arguments are REAL paths (004 FR-037); comparison is separator- and case-normalised, the
 * way NTFS answers the same question.
 */
export function classifyTopLevel(
  sourceParentReal: string,
  targetReal: string,
  sourceReal: string,
  _mode: 'cut' | 'copy',
): TopLevelClass {
  const parent = normaliseForCompare(sourceParentReal);
  const target = normaliseForCompare(targetReal);
  const source = normaliseForCompare(sourceReal);
  if (parent === target) return 'same-folder-duplicate';
  if (target === source || target.startsWith(`${source}/`)) return 'into-own-descendant';
  return 'ordinary';
}

/**
 * A folder landing on a folder merges; every other pairing is a choice (FR-018c, and the edge case
 * "clash with a different kind" — a file and a folder cannot merge).
 */
export function clashKind(incoming: 'file' | 'folder', existing: 'file' | 'folder'): ClashKind {
  return incoming === 'folder' && existing === 'folder' ? 'merge' : 'replaceable';
}

/** Keep both's name: the non-clobbering name a copy has always taken (FR-018a, 004 FR-024). */
export function keepBothName(name: string, siblings: readonly string[]): string {
  return dedupeName(name, siblings, 'copy');
}

/**
 * Which side of a clash is newer, for the prompt's marker (FR-018).
 *
 * A side with no time (a folder, whose prompt row shows an item count instead) cannot be compared,
 * and equal times have no newer side: marking one would be a guess presented as a fact.
 */
export function newerOf(
  existing: { modifiedMs?: number },
  incoming: { modifiedMs?: number },
): 'existing' | 'incoming' | 'neither' {
  if (existing.modifiedMs === undefined || incoming.modifiedMs === undefined) return 'neither';
  if (incoming.modifiedMs > existing.modifiedMs) return 'incoming';
  if (existing.modifiedMs > incoming.modifiedMs) return 'existing';
  return 'neither';
}
