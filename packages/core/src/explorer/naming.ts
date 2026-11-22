/**
 * Name rules + non-clobbering name de-duplication (004, FR-016/FR-024/
 * FR-033, research D5). Pure. Sibling comparison is case-insensitive (Windows).
 * No OS/DOM.
 */
import { hostTraits } from '../platform/host-traits.js';

/** Characters no Windows file name may hold, the separators included, and the control characters. */
// eslint-disable-next-line no-control-regex
const WINDOWS_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/;
/** Device names Windows reserves, with or without an extension (`NUL`, `nul.txt`). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;

/**
 * Why `name` cannot name a file or folder on this host, or `null` when it can. Under Windows' rules it refuses
 * what the file system would reject with a raw error — or, worse, quietly store under another name: Win32 drops a
 * trailing dot or space, so `report.` would become `report` behind the caller's back.
 */
export function nameProblem(name: string): string | null {
  if (name.length === 0) return 'Name cannot be empty.';
  if (name === '.' || name === '..') return 'Invalid name.';
  if (hostTraits().os !== 'windows') return name.includes('/') ? 'A name cannot contain "/".' : null;
  if (WINDOWS_FORBIDDEN.test(name)) return 'A name cannot contain any of these characters: \\ / : * ? " < > |';
  if (/[. ]$/.test(name)) return 'A name cannot end with a dot or a space.';
  if (WINDOWS_RESERVED.test(name)) return `"${name}" is a name Windows reserves for a device.`;
  return null;
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
