/**
 * Builds the "file changed on disk" notice (011, US4, FR-010/011). The on-disk
 * file changed under the user's unsaved edits; the notice NAMES the affected
 * document — its containing tab, its panel, and the file's full path — via the
 * notice model's files list, and still explains the two available actions. Pure.
 */
import { toDisplayPath, type OsName } from '@throng/core';
import type { EditorNotice } from './editor-notice-store.js';

const MESSAGE =
  'This file was changed by another program while you have unsaved edits here. ' +
  'Saving will overwrite those changes; Revert will discard your edits and load the on-disk version.';

/** Split a display path into its directory prefix (with trailing separator) + name. */
function splitDisplayPath(p: string): { dir: string; name: string } {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
}

export function buildFileChangedNotice(
  fullPath: string | null,
  panelTitle: string,
  tabTitle: string,
  os: OsName,
): EditorNotice {
  if (!fullPath) return { title: 'File changed on disk', message: MESSAGE };
  const { dir, name } = splitDisplayPath(toDisplayPath(fullPath, os));
  return {
    title: 'File changed on disk',
    message: MESSAGE,
    files: [{ dir, name, note: `Panel: ${panelTitle} · Tab: ${tabTitle}` }],
  };
}
