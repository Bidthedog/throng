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

/** Where one selected item lands: the folder it goes INTO, keeping its own name. */
export interface Landing {
  src: string;
  destDir: string;
}

const segmentsOf = (p: string): string[] => p.split(/[\\/]+/).filter((s) => s !== '');

/**
 * Where each item of a paste or drag lands, keeping the structure of a selection that spans folders
 * (FR-033, research R16).
 *
 * An item inside another selected item travels with it and is dropped. Every remaining item lands under
 * `targetDir` at its parent's path relative to the deepest folder holding every item's parent — so items
 * sharing one folder land directly in `targetDir`, as they always have, and `/test/test.md` with
 * `/test.md` keep `test/`. Parents are compared separator- and case-insensitively (NTFS's rule); the
 * relative segments keep the source's spelling and are joined with the target's separator. Input order
 * is kept.
 */
export function landingPlan(sources: readonly string[], targetDir: string): Landing[] {
  const norm = sources.map((s) => normaliseForCompare(s));
  const kept = sources.filter(
    (_s, i) => !norm.some((other, j) => j !== i && norm[i].startsWith(`${other}/`)),
  );
  const parents = kept.map((s) => segmentsOf(s).slice(0, -1));
  const key = (seg: string): string => normaliseForCompare(seg);
  let common = parents[0]?.length ?? 0;
  for (const p of parents) {
    common = Math.min(common, p.length);
    for (let i = 0; i < common; i++) {
      if (key(p[i]) !== key(parents[0][i])) {
        common = i;
        break;
      }
    }
  }
  const sep = targetDir.includes('\\') ? '\\' : '/';
  const base = targetDir.replace(/[\\/]+$/, '');
  return kept.map((src, i) => {
    const rest = parents[i].slice(common);
    return { src, destDir: rest.length === 0 ? targetDir : [base, ...rest].join(sep) };
  });
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
