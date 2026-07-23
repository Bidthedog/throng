/**
 * Editor pill path display (006, FR-088). Pure. Splits a document's identity into a
 * truncatable directory prefix and an always-visible file name, per the chosen
 * display style (full path vs name only) and ownership:
 *  - project-owned + 'full' → project-relative path: "/" or "/subfolder/" prefix.
 *  - sub-workspace-owned + 'full' → the absolute directory prefix.
 *  - 'name' → no prefix, just the file name.
 * No OS/DOM.
 */
import type { EditorPathDisplay } from '../config/app-settings.js';
import type { OsName } from '../abstractions/platform-info.js';
import type { EditorOwnerKind } from './document.js';

export interface EditorPathParts {
  /** Directory prefix (native separators, trailing separator); '' for name-only. */
  dir: string;
  /** File name — always shown. */
  name: string;
}

function leaf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i < 0 ? path : path.slice(i + 1);
}

/**
 * Render a path with the host OS's native separators (006, FR-101): Windows uses
 * back-slashes, every other platform forward-slashes. Fixes mixed-separator paths
 * (e.g. `D:\git/file.txt`) shown in pills, titles, and dialogs. Pure. No OS/DOM.
 */
export function toDisplayPath(path: string, os: OsName): string {
  return os === 'windows' ? path.replace(/\//g, '\\') : path.replace(/\\/g, '/');
}

/**
 * The auto-derived title for an editor panel with no manual name (024 US5, FR-015): the open file's
 * basename with ONLY its final extension stripped. A file with no extension keeps its whole name
 * (`Makefile`); a dotfile with no further extension keeps its full name including the leading dot
 * (`.gitignore`); a dotfile with a further extension is stripped (`.eslintrc.json` → `.eslintrc`).
 * Never returns a blank string. Pure. No OS/DOM.
 */
export function editorAutoTitle(filePath: string): string {
  const name = leaf(filePath);
  // Last dot that is NOT the leading character — a leading dot is part of a dotfile's name, not an
  // extension separator. `slice` keeps the stem; a trailing-dot name (`foo.`) keeps `foo`.
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function editorPathParts(
  filePath: string,
  ownerRoot: string | null,
  ownerKind: EditorOwnerKind,
  display: EditorPathDisplay,
  os: OsName,
): EditorPathParts {
  const name = leaf(filePath);
  const nat = (dir: string): string => toDisplayPath(dir, os);
  if (display === 'name') return { dir: '', name };

  // Sub-workspace-owned (or no project context): show the full absolute directory.
  if (ownerKind === 'subworkspace' || !ownerRoot) {
    const norm = filePath.replace(/\\/g, '/');
    const i = norm.lastIndexOf('/');
    return { dir: nat(i < 0 ? '' : norm.slice(0, i + 1)), name };
  }

  // Project-owned: the path relative to the project root, rooted at the separator.
  const root = ownerRoot.replace(/[\\/]+$/, '');
  const nf = (s: string): string => s.replace(/\\/g, '/');
  const dirAbs = nf(filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))));
  const rootN = nf(root);
  if (dirAbs.toLowerCase() === rootN.toLowerCase()) return { dir: nat('/'), name };
  if (dirAbs.toLowerCase().startsWith(rootN.toLowerCase() + '/')) {
    return { dir: nat('/' + dirAbs.slice(rootN.length + 1) + '/'), name };
  }
  // Outside the declared root (shouldn't happen for a confined save) → absolute.
  return { dir: nat(dirAbs ? dirAbs + '/' : ''), name };
}
