/**
 * Rename validation + non-clobbering name de-duplication (004, FR-016/FR-024/
 * FR-033, research D5). Pure. Sibling comparison is case-insensitive (Windows).
 * No OS/DOM.
 */

export interface RenameResult {
  ok: boolean;
  error?: string;
}

const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

/** Validate a rename against existing sibling names (case-insensitive). */
export function validateRename(name: string, siblings: readonly string[]): RenameResult {
  const n = name.trim();
  if (n.length === 0) return { ok: false, error: 'Name cannot be empty.' };
  if (n === '.' || n === '..') return { ok: false, error: 'Invalid name.' };
  if (INVALID_NAME_CHARS.test(n)) return { ok: false, error: 'Name contains invalid characters.' };
  const lower = n.toLowerCase();
  if (siblings.some((s) => s.toLowerCase() === lower)) {
    return { ok: false, error: 'A file or folder with this name already exists.' };
  }
  return { ok: true };
}

/** De-dup style: copy/paste uses "name copy"; a fresh name uses "name (2)". */
export type DedupeStyle = 'copy' | 'numbered';

/**
 * First non-colliding variant of `base` against `siblings` (case-insensitive).
 * `copy`     → base, "stem copy.ext", "stem copy 2.ext", … (FR-024)
 * `numbered` → base, "stem (2).ext", "stem (3).ext", …     (New folder, FR-033)
 */
export function dedupeName(
  base: string,
  siblings: readonly string[],
  style: DedupeStyle = 'copy',
): string {
  const taken = new Set(siblings.map((s) => s.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const { stem, ext } = splitExt(base);
  const make = (n: number): string =>
    style === 'copy'
      ? `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`
      : `${stem} (${n + 1})${ext}`;
  for (let n = 1; ; n += 1) {
    const candidate = make(n);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Split into stem + extension. A leading dot is part of the name, not an ext. */
function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}
