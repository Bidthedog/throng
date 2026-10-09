/**
 * 053 FR-012 / research R3 — shortening a value a terminal's name shows.
 *
 * `{command}` keeps its start and ends with an ellipsis. `{path}` keeps its root and its last
 * folder and drops WHOLE middle folders behind an ellipsis — a character-level middle cut splits
 * folder names into fragments nobody recognises — and falls back to an end cut only when the root
 * and last folder alone are too long. Lengths count graphemes, as every name limit does (031).
 *
 * A working directory arrives as the daemon or the shell's OSC 9;9 reported it, so `\` and `/` are
 * treated alike and three roots are known: a drive (`D:\`), a UNC share (`\\server\share\`) and
 * POSIX (`/`). Pure: no OS, no configuration.
 */
import { countGraphemes, truncateGraphemes } from './grapheme.js';

/** The marker a shortened value carries in place of what was dropped. */
const ELLIPSIS = '…';

/** UNC share, then drive, then POSIX — the longest root first, so `\\server` is not read as `\`. */
const ROOT = /^(?:[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)|[A-Za-z]:(?:[\\/]|$)|[\\/])/;

/** `text` cut to `limit` graphemes from its start, ending with the ellipsis when anything was cut. */
export function shortenEnd(text: string, limit: number): string {
  if (!Number.isFinite(limit) || countGraphemes(text) <= limit) return text;
  const max = Math.floor(limit);
  if (max <= 0) return '';
  return `${truncateGraphemes(text, max - 1)}${ELLIPSIS}`;
}

/** A path split into its root (possibly `''`) and its folders, ignoring empty segments. */
function splitPath(path: string): { root: string; folders: string[]; sep: string } {
  const root = ROOT.exec(path)?.[0] ?? '';
  const rest = path.slice(root.length);
  const sep = /[\\/]/.exec(rest)?.[0] ?? /[\\/]/.exec(root)?.[0] ?? '\\';
  return { root, folders: rest.split(/[\\/]/).filter((f) => f !== ''), sep };
}

/**
 * `path` bounded to `limit` graphemes (FR-012): unchanged when it fits; otherwise the root, the
 * ellipsis and as many trailing folders as fit, always including the last; an end cut when even
 * the root and the last folder do not fit, or when there is no middle folder to drop.
 */
export function shortenPath(path: string, limit: number): string {
  if (!Number.isFinite(limit) || countGraphemes(path) <= limit) return path;
  const { root, folders, sep } = splitPath(path);
  if (folders.length < 2) return shortenEnd(path, limit);
  const head = `${root}${ELLIPSIS}`;
  let kept = folders.at(-1)!;
  if (countGraphemes(`${head}${sep}${kept}`) > limit) return shortenEnd(path, limit);
  // Never reach the first folder: then nothing was dropped and the path would not have overflowed.
  for (let i = folders.length - 2; i >= 1; i -= 1) {
    const next = `${folders[i]}${sep}${kept}`;
    if (countGraphemes(`${head}${sep}${next}`) > limit) break;
    kept = next;
  }
  return `${head}${sep}${kept}`;
}

/** `{folder}` — the last folder of `path`; a path that is only a root is its root; `''` stays `''`. */
export function lastFolder(path: string): string {
  const { root, folders } = splitPath(path);
  return folders.at(-1) ?? root;
}
