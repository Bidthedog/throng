/**
 * File-operation undo/redo engine (024 US3, #85). Pure — no fs, no OS, no DOM.
 *
 * Manages a per-project stack of reversible tree operations (move, rename, delete). It decides WHAT
 * to reverse and WHETHER an entry is still applicable against the current world; the caller (the main
 * process, which has fs access) does the applying and turns a refusal into the FR-008 notice. The
 * stack is bounded to the most recent 50 operations (FR-010) and serialises to JSON for the
 * per-project SQLite store (migration v8); a corrupt/old blob parses back to an empty stack (FR-010a).
 */

/**
 * The two projects a cross-project entry spans, by id (050 FR-020). The entry sits in BOTH projects'
 * stacks, matched by its `id`, and undoing it from either side moves it in the other.
 */
export interface CrossProject {
  source: string;
  target: string;
}

/**
 * One reversible tree operation. Paths are absolute, OS-spelled. `at` is an epoch-ms timestamp.
 *
 * 050 R10 widened it additively: an optional `id` on every kind (written for every new entry; older
 * blobs parse without one), an optional `projects` on a `move` that crossed projects, and a `paste` kind
 * recorded only when a paste or drag REPLACED something (FR-018b) — what it moved, what it copied, and
 * what it sent to the Recycle Bin to make room. A paste that replaced nothing records a plain `move`
 * (a cut) or nothing at all (a copy, FR-022).
 */
export type FileOpUndoEntry =
  | { kind: 'move'; id?: string; items: { from: string; to: string }[]; projects?: CrossProject; createdDirs?: string[]; at: number }
  | { kind: 'rename'; id?: string; from: string; to: string; at: number }
  | { kind: 'delete'; id?: string; items: { originalPath: string }[]; at: number }
  | {
      kind: 'paste';
      id?: string;
      moved: { from: string; to: string }[];
      copied: { from: string; to: string }[];
      /** Recycled items only: a permanently replaced item cannot be restored, so it is left out (FR-018f). */
      replaced: { path: string; trashedAt: number }[];
      projects?: CrossProject;
      /** Folders the paste created to keep a selection's structure, parents first (FR-033, R16). */
      createdDirs?: string[];
      at: number;
    };

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
  if (entry.kind === 'paste') {
    // Only the MOVED items are moves. A copy's undo is a removal and its redo a fresh copy, and a
    // replaced item's undo is a Recycle-Bin restore — none of those is a move, and the applier
    // (main's transfer service) handles them from the entry's own lists.
    return entry.moved.map((it) => (direction === 'undo' ? { from: it.to, to: it.from } : { from: it.from, to: it.to }));
  }
  return [];
}

/**
 * Take the entry with this `id` out of whichever list holds it (050 FR-020).
 *
 * Used on the OTHER project's stack when a cross-project entry is undone or redone from this one: the
 * entry is one operation in two stacks, so applying it here must move it there too.
 */
export function removeById(stack: FileOpUndoStack, id: string): FileOpUndoStack {
  const keep = (e: FileOpUndoEntry): boolean => e.id !== id;
  if (stack.undo.every(keep) && stack.redo.every(keep)) return stack;
  return { undo: stack.undo.filter(keep), redo: stack.redo.filter(keep) };
}

/** Add an entry to the undo list, bounded, WITHOUT clearing redo — the other stack's half of a redo. */
export function pushUndoEntry(stack: FileOpUndoStack, entry: FileOpUndoEntry): FileOpUndoStack {
  const undo = [...stack.undo, entry];
  if (undo.length > FILEOP_UNDO_BOUND) undo.splice(0, undo.length - FILEOP_UNDO_BOUND);
  return { undo, redo: [...stack.redo] };
}

/** Add an entry to the redo list WITHOUT touching undo — the other stack's half of an undo. */
export function pushRedoEntry(stack: FileOpUndoStack, entry: FileOpUndoEntry): FileOpUndoStack {
  return { undo: [...stack.undo], redo: [...stack.redo, entry] };
}

/**
 * Drop every entry that names a project no longer present (050 Assumptions: a cross-project entry
 * exists only while both projects do). Applied on load, so removing a project needs no visit to the
 * other project's stack.
 */
export function dropEntriesNamingProjects(stack: FileOpUndoStack, liveProjectIds: readonly string[]): FileOpUndoStack {
  const live = new Set(liveProjectIds);
  const keep = (e: FileOpUndoEntry): boolean => {
    const projects = e.kind === 'move' || e.kind === 'paste' ? e.projects : undefined;
    return projects === undefined || (live.has(projects.source) && live.has(projects.target));
  };
  if (stack.undo.every(keep) && stack.redo.every(keep)) return stack;
  return { undo: stack.undo.filter(keep), redo: stack.redo.filter(keep) };
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
  if (entry.kind === 'paste') return validatePaste(entry, direction, exists);
  for (const m of plannedMoves(entry, direction)) {
    if (!exists(m.from)) return { ok: false, reason: `${m.from} is no longer there.` };
    if (exists(m.to)) return { ok: false, reason: `Something already exists at ${m.to}.` };
  }
  return { ok: true };
}

/**
 * A paste entry against the world (050 FR-018b, FR-021).
 *
 * Undo needs everything the paste placed still where it put it, and every moved item's source free to
 * take it back. The replaced items are not checked here: their paths are occupied by what replaced them
 * until undo removes that, and whether the Recycle Bin still holds them is the fs seam's answer at apply
 * time — the same split `delete` already makes.
 *
 * Redo needs every source back, and every target free — EXCEPT a target that is a replaced path, which
 * holds the restored original again and which redo disposes of exactly as the paste did.
 */
function validatePaste(
  entry: Extract<FileOpUndoEntry, { kind: 'paste' }>,
  direction: 'undo' | 'redo',
  exists: (absPath: string) => boolean,
): { ok: true } | { ok: false; reason: string } {
  const placed = [...entry.moved, ...entry.copied];
  if (direction === 'undo') {
    for (const it of placed) if (!exists(it.to)) return { ok: false, reason: `${it.to} is no longer there.` };
    for (const it of entry.moved) {
      if (exists(it.from)) return { ok: false, reason: `Something already exists at ${it.from}.` };
    }
    return { ok: true };
  }
  const replaced = new Set(entry.replaced.map((r) => r.path));
  for (const it of placed) if (!exists(it.from)) return { ok: false, reason: `${it.from} is no longer there.` };
  for (const it of placed) {
    if (!replaced.has(it.to) && exists(it.to)) return { ok: false, reason: `Something already exists at ${it.to}.` };
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

function isPairs(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.every((it) => typeof (it as { from?: unknown }).from === 'string' && typeof (it as { to?: unknown }).to === 'string')
  );
}

function isOptionalProjects(v: unknown): boolean {
  if (v === undefined) return true;
  if (typeof v !== 'object' || v === null) return false;
  const p = v as { source?: unknown; target?: unknown };
  return typeof p.source === 'string' && typeof p.target === 'string';
}

function isOptionalStrings(v: unknown): boolean {
  return v === undefined || (Array.isArray(v) && v.every((s) => typeof s === 'string'));
}

function isEntry(e: unknown): e is FileOpUndoEntry {
  if (typeof e !== 'object' || e === null) return false;
  const x = e as Record<string, unknown>;
  if (typeof x.at !== 'number') return false;
  // 050 R16 — `createdDirs` (move and paste only) must be a string array when present.
  if (!isOptionalStrings(x.createdDirs)) return false;
  // 050 — optional on every kind, but a present one must be well-formed.
  if (x.id !== undefined && typeof x.id !== 'string') return false;
  if (x.kind === 'rename') return typeof x.from === 'string' && typeof x.to === 'string';
  if (x.kind === 'move') return isPairs(x.items) && isOptionalProjects(x.projects);
  if (x.kind === 'paste') {
    return (
      isPairs(x.moved) &&
      isPairs(x.copied) &&
      Array.isArray(x.replaced) &&
      x.replaced.every(
        (r) =>
          typeof (r as { path?: unknown }).path === 'string' &&
          typeof (r as { trashedAt?: unknown }).trashedAt === 'number',
      ) &&
      isOptionalProjects(x.projects)
    );
  }
  if (x.kind === 'delete') {
    return Array.isArray(x.items) && x.items.every((it) => typeof (it as { originalPath?: unknown }).originalPath === 'string');
  }
  return false;
}
