/**
 * Builds the "Cannot open file" notice (006, FR-100/105). One dialog covers all the
 * unopenable files discovered when a tab is (re-)opened. The SAME layout is used
 * whether one file or many: intro text + a scrollable bulleted list (bold file
 * names, dim directory paths) — a single file just lists one. Paths render with
 * native OS separators (FR-101). Gated by `editor.warnOnMissingFile` at the call
 * site; this module only formats + shows.
 */
import { toDisplayPath } from '@throng/core';
import type { OsName } from '@throng/core';
import { showEditorNotice, type NoticeFile } from './editor-notice-store.js';

export interface LoadErrorEntry {
  filePath: string | null;
  panelName: string;
  /** 'binary' | 'too-large' | 'missing' | other (missing/moved/deleted). */
  reason: string;
}

function shortReason(reason: string): string {
  return reason === 'binary' ? 'not text' : reason === 'too-large' ? 'too large' : 'missing';
}

/** Split a native path into its directory prefix (with trailing separator) + name. */
function splitPath(p: string): { dir: string; name: string } {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
}

/** Show one notice for a set of unopenable files (empty → no-op). Single and multi
 *  share one layout — the single case just lists one file. */
export function showMissingFilesNotice(entries: readonly LoadErrorEntry[], os: OsName): void {
  if (entries.length === 0) return;
  const path = (p: string | null): string => (p ? toDisplayPath(p, os) : '(unsaved document)');
  const allMissing = entries.every((e) => e.reason !== 'binary' && e.reason !== 'too-large');

  const files: NoticeFile[] = entries.map((e) => {
    const { dir, name } = splitPath(path(e.filePath));
    // The panel note carries the per-file reason only when it isn't a plain "missing".
    const note = allMissing ? `Panel: ${e.panelName}` : `${shortReason(e.reason)} · Panel: ${e.panelName}`;
    return { dir, name, note };
  });

  const n = entries.length;
  const noun = n === 1 ? 'file' : 'files';
  const subject = n === 1 ? 'This file' : `These ${n} files`;
  const body = allMissing
    ? `${subject} could not be opened — ${n === 1 ? 'it' : 'they'} may have been moved, renamed, or deleted. ` +
      `Editors with a recovered buffer can be saved to write ${n === 1 ? 'its' : 'their'} contents back.`
    : `${subject} could not be opened.`;

  showEditorNotice({ title: `Cannot open ${n === 1 ? '' : `${n} `}${noun}`, message: body, files });
}
