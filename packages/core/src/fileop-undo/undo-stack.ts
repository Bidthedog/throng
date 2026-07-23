/**
 * File-operation undo/redo engine (024 US3, #85). Pure — no fs, no OS, no DOM.
 *
 * Manages a per-project stack of reversible tree operations (move, rename, delete). It decides WHAT
 * to reverse and WHETHER an entry is still applicable against the current world; the caller (the main
 * process, which has fs access) does the applying and turns a refusal into the FR-008 notice. The
 * stack is bounded to the most recent 50 operations (FR-010) and serialises to JSON for the
 * per-project SQLite store (migration v8); a corrupt/old blob parses back to an empty stack (FR-010a).
 */

/** One reversible tree operation. Paths are absolute, OS-spelled. `at` is an epoch-ms timestamp. */
export type FileOpUndoEntry =
  | { kind: 'move'; items: { from: string; to: string }[]; at: number }
  | { kind: 'rename'; from: string; to: string; at: number }
  | { kind: 'delete'; items: { originalPath: string }[]; at: number };

export interface FileOpUndoStack {
  readonly undo: readonly FileOpUndoEntry[];
  readonly redo: readonly FileOpUndoEntry[];
}

/** The most recent N operations kept per project (FR-010). */
export const FILEOP_UNDO_BOUND = 50;

export function emptyStack(): FileOpUndoStack {
  return { undo: [], redo: [] };
}

/** Record a new operation: push to the undo stack (bounded, oldest dropped), and clear redo (FR-010). */
export function record(stack: FileOpUndoStack, entry: FileOpUndoEntry): FileOpUndoStack {
  const undo = [...stack.undo, entry];
  if (undo.length > FILEOP_UNDO_BOUND) undo.splice(0, undo.length - FILEOP_UNDO_BOUND);
  return { undo, redo: [] };
}

/** Pop the last undo entry onto the redo stack. Null when there is nothing to undo. */
export function undo(stack: FileOpUndoStack): { entry: FileOpUndoEntry; stack: FileOpUndoStack } | null {
  if (stack.undo.length === 0) return null;
  const entry = stack.undo[stack.undo.length - 1];
  return {
    entry,
    stack: { undo: stack.undo.slice(0, -1), redo: [...stack.redo, entry] },
  };
}

/** Pop the last redo entry back onto the undo stack. Null when there is nothing to redo. */
export function redo(stack: FileOpUndoStack): { entry: FileOpUndoEntry; stack: FileOpUndoStack } | null {
  if (stack.redo.length === 0) return null;
  const entry = stack.redo[stack.redo.length - 1];
  return {
    entry,
    stack: { undo: [...stack.undo, entry], redo: stack.redo.slice(0, -1) },
  };
}

/** The forward and reverse path moves an entry implies, for applying it in a direction. */
export interface PlannedMove {
  from: string;
  to: string;
}

/**
 * The concrete moves that applying `entry` in `direction` performs (FR-006/007). `undo` reverses the
 * original op; `redo` re-applies it. A DELETE has no moves here — its undo is a recycle-bin restore
 * and its redo is a re-trash, both handled by the fs seam using `deletePaths(entry)`.
 */
export function plannedMoves(entry: FileOpUndoEntry, direction: 'undo' | 'redo'): PlannedMove[] {
  if (entry.kind === 'move') {
    return entry.items.map((it) => (direction === 'undo' ? { from: it.to, to: it.from } : { from: it.from, to: it.to }));
  }
  if (entry.kind === 'rename') {
    return [direction === 'undo' ? { from: entry.to, to: entry.from } : { from: entry.from, to: entry.to }];
  }
  return [];
}

/** The original paths a DELETE entry concerns (to restore on undo, or re-trash on redo). */
export function deletePaths(entry: Extract<FileOpUndoEntry, { kind: 'delete' }>): string[] {
  return entry.items.map((it) => it.originalPath);
}

/**
 * Whether `entry` can be applied in `direction` given the world (FR-008). Validated BEFORE any change
 * so a stale entry is refused, changing nothing. `exists(absPath)` reports whether something is at a
 * path now (case/separator normalisation is the caller's concern — it knows the platform).
 *
 * A move/rename needs its **source present** and its **destination free**; a delete-undo (restore)
 * needs each original path **free** (recoverability — is it still in the recycle bin — is checked by
 * the fs seam at apply time, which rejects and becomes a refusal); a delete-redo (re-trash) needs
 * each item **present**.
 */
export function validate(
  entry: FileOpUndoEntry,
  direction: 'undo' | 'redo',
  exists: (absPath: string) => boolean,
): { ok: true } | { ok: false; reason: string } {
  if (entry.kind === 'delete') {
    if (direction === 'undo') {
      for (const p of deletePaths(entry)) {
        if (exists(p)) return { ok: false, reason: `Something already exists at ${p}.` };
      }
    } else {
      for (const p of deletePaths(entry)) {
        if (!exists(p)) return { ok: false, reason: `${p} is no longer there to delete.` };
      }
    }
    return { ok: true };
  }
  for (const m of plannedMoves(entry, direction)) {
    if (!exists(m.from)) return { ok: false, reason: `${m.from} is no longer there.` };
    if (exists(m.to)) return { ok: false, reason: `Something already exists at ${m.to}.` };
  }
  return { ok: true };
}

/** Serialise the stack for the per-project store (v8). */
export function serialise(stack: FileOpUndoStack): string {
  return JSON.stringify({ undo: stack.undo, redo: stack.redo });
}

/**
 * Parse a stored stack, degrading to empty on anything unrecognised (FR-010a) — a missing/corrupt/old
 * blob must never fail the project's load. Entries are shape-checked; a bad one drops the whole side.
 */
export function parse(json: string | null | undefined): FileOpUndoStack {
  if (json == null) return emptyStack();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return emptyStack();
  }
  if (typeof raw !== 'object' || raw === null) return emptyStack();
  const r = raw as { undo?: unknown; redo?: unknown };
  const undo = validEntries(r.undo);
  const redo = validEntries(r.redo);
  if (undo === null || redo === null) return emptyStack();
  return { undo, redo };
}

function validEntries(v: unknown): FileOpUndoEntry[] | null {
  if (!Array.isArray(v)) return null;
  const out: FileOpUndoEntry[] = [];
  for (const e of v) {
    if (!isEntry(e)) return null;
    out.push(e);
  }
  return out;
}

function isEntry(e: unknown): e is FileOpUndoEntry {
  if (typeof e !== 'object' || e === null) return false;
  const x = e as Record<string, unknown>;
  if (typeof x.at !== 'number') return false;
  if (x.kind === 'rename') return typeof x.from === 'string' && typeof x.to === 'string';
  if (x.kind === 'move') {
    return (
      Array.isArray(x.items) &&
      x.items.every((it) => typeof (it as { from?: unknown }).from === 'string' && typeof (it as { to?: unknown }).to === 'string')
    );
  }
  if (x.kind === 'delete') {
    return Array.isArray(x.items) && x.items.every((it) => typeof (it as { originalPath?: unknown }).originalPath === 'string');
  }
  return false;
}
