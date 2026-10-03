/**
 * The application File Explorer clipboard — its shape and its pure transitions (050, research R1).
 *
 * Main holds ONE of these per running application (FR-002), in memory only (FR-007), and applies these
 * rules as the world moves. They live in core so the decision is stated once and asserted without a
 * process: which items an in-app move carries along, which a delete drops, when a project change empties
 * it, and what a finished paste leaves behind.
 */
import { isUnderPath, normaliseForCompare, remainderUnder } from '../fs/path-id.js';

/** One pending item: its absolute path, and the project — and that project's root — it was taken from. */
export interface ClipboardItem {
  /** OS-spelled absolute path (FR-001). */
  absPath: string;
  projectId: string;
  /** The project's root when the item was taken — what FR-011's re-root check compares against. */
  projectRoot: string;
}

/**
 * Empty, or a mode and a NON-EMPTY ordered list of items from exactly one project. An empty list is
 * never stored: it is `null`, so "is there anything to paste?" has one spelling.
 */
export type FileClipboard = null | { mode: 'cut' | 'copy'; items: readonly ClipboardItem[] };

/**
 * Follow an in-app move or rename (FR-009, by 019 FR-005's rule): an item equal to or under a moved
 * `from` takes the corresponding path under `to`. Compared separator- and case-insensitively, on
 * segment boundaries. Returns the SAME array when nothing matched, so a caller can tell "changed".
 */
export function followMoves(
  items: readonly ClipboardItem[],
  moves: readonly { from: string; to: string }[],
): readonly ClipboardItem[] {
  let changed = false;
  const out = items.map((it) => {
    for (const move of moves) {
      if (normaliseForCompare(it.absPath) === normaliseForCompare(move.from)) {
        changed = true;
        return { ...it, absPath: move.to };
      }
      const rest = remainderUnder(it.absPath, move.from);
      if (rest !== null) {
        changed = true;
        // `remainderUnder` answers in `/`; respell it in the destination's own separator so the
        // clipboard keeps holding OS-spelled paths (FR-001).
        const sep = move.to.includes('\\') ? '\\' : '/';
        return { ...it, absPath: `${move.to.replace(/[\\/]+$/, '')}${rest.split('/').join(sep)}` };
      }
    }
    return it;
  });
  return changed ? out : items;
}

/** Drop items deleted in-app, directly or with a folder (FR-009). Same array when nothing matched. */
export function dropDeleted(
  items: readonly ClipboardItem[],
  deletedAbsPaths: readonly string[],
): readonly ClipboardItem[] {
  const out = items.filter((it) => !deletedAbsPaths.some((d) => isUnderPath(it.absPath, d)));
  return out.length === items.length ? items : out;
}

/**
 * Empty the clipboard when the project its items came from was removed or re-rooted (FR-011): those
 * items no longer belong to a project, so FR-010 could not paste them. `idToRoot` is the CURRENT map
 * of project id → root. Same value back when nothing changed.
 */
export function retainProjects(clipboard: FileClipboard, idToRoot: ReadonlyMap<string, string>): FileClipboard {
  if (clipboard === null) return null;
  for (const it of clipboard.items) {
    const root = idToRoot.get(it.projectId);
    if (root === undefined || normaliseForCompare(root) !== normaliseForCompare(it.projectRoot)) return null;
  }
  return clipboard;
}

/**
 * What a finished or cancelled paste leaves on the clipboard (FR-006, FR-019c).
 *
 * A copy stays as it was. A cut keeps exactly the items that did not move, still a cut — and is empty
 * once every item moved. Both only while the clipboard still IS the run's snapshot: a user who cut
 * something else while the paste ran has replaced it, and the finished run has no business undoing that.
 */
export function afterRun(
  clipboard: FileClipboard,
  snapshot: FileClipboard,
  notMoved: readonly ClipboardItem[],
): FileClipboard {
  if (clipboard === null || snapshot === null || !sameClipboard(clipboard, snapshot)) return clipboard;
  if (clipboard.mode === 'copy') return clipboard;
  return notMoved.length === 0 ? null : { mode: 'cut', items: [...notMoved] };
}

function sameClipboard(
  a: { mode: 'cut' | 'copy'; items: readonly ClipboardItem[] },
  b: { mode: 'cut' | 'copy'; items: readonly ClipboardItem[] },
): boolean {
  return (
    a.mode === b.mode &&
    a.items.length === b.items.length &&
    a.items.every(
      (it, i) =>
        normaliseForCompare(it.absPath) === normaliseForCompare(b.items[i]!.absPath) &&
        it.projectId === b.items[i]!.projectId,
    )
  );
}
