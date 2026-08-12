/**
 * What an editor says when it cannot open its file.
 *
 * ══ THE PER-TAB BATCH IS GONE (030 US3, FR-035) ══
 *
 * This module used to BUILD the batch: `showMissingFilesNotice(entries)` composed one
 * "Cannot open 3 files" dialog per tab and pushed it into `editor-notice-store`, and the tab-open
 * watcher called it once per tab activation. That was 006's answer to a real problem — three editors
 * each popping their own modal — and it was the right answer until 029 and 030 gave the application
 * a general one.
 *
 * It is removed rather than narrowed, and the difference matters. Batching by TAB is a claim that
 * the tab is the unit a user thinks in, and it is not: the unit is the CAUSE. One absent project
 * root defeats editors in four tabs and terminals in two, and a per-tab batch reports that as four
 * dialogs, none of which mentions the terminals — grouped by the wrong thing, four times. The tab
 * survives as a HEADING inside the consolidated notice's list (FR-031a), which is where it belongs:
 * a way of organising the casualties, not a boundary between notices.
 *
 * So each unopenable file is now reported as one panel casualty through
 * `workspace/panel-failure-notice.ts`, and the notification model merges them by cause or by the
 * action that produced them. What is left here is the WORDING and the classification — the two
 * things that were never about batching.
 *
 * ══ WHAT SURVIVES, AND WHY (T051a) ══
 *
 * `editor-notice-store.ts`, `editor-notice-dialog.tsx` and the `NoticeFile` type all STAY. They are
 * not a per-tab batch and never were: the store is a small reactive channel for editor messages
 * that need a structured file list, and its other two callers — the "file changed on disk" notice
 * (`file-changed-notice.ts`, 011/FR-010) and the refused save (`use-editor.ts`, 006/FR-078) — are
 * outside this feature's scope and unaffected. Removing the store to remove the batch would have
 * been a change to two behaviours in order to change one.
 */
import { toDisplayPath } from '@throng/core';
import type { OsName } from '@throng/core';

export interface LoadErrorEntry {
  filePath: string | null;
  panelName: string;
  /** A `LoadResult` reason: 'binary' | 'too-large' | 'out-of-tree' | 'folder' | 'io'. */
  reason: string;
}

/**
 * Reasons a file could not be opened that are NOT "the file isn't there" (018 / US9, FR-061).
 *
 * This used to be spelt `reason !== 'binary' && reason !== 'too-large'`, in two places — a rule that
 * silently classified every OTHER reason as a missing file, including reasons that did not yet exist.
 * So the moment the load path learned to REFUSE a file on ownership grounds, the refusal was announced
 * as a file that "may have been moved, renamed, or deleted", which is not true, and then SUPPRESSED for
 * anyone with missing-file warnings off, which is worse than not true.
 *
 * It is enumerated now, and it is enumerated ONCE — a rule that has to be restated is a rule that will
 * eventually be restated differently.
 */
export const NOT_A_MISSING_FILE: ReadonlySet<string> = new Set([
  'binary',
  'too-large',
  'out-of-tree',
  'folder',
]);

/** True when the file could not be opened because it is not there (as opposed to not permitted). */
export function isMissingReason(reason: string): boolean {
  return !NOT_A_MISSING_FILE.has(reason);
}

/**
 * The sentence for ONE unopenable file.
 *
 * One file, one sentence — there is no plural form any more, because there is no batch to pluralise.
 * The notice that carries this states the project once and lists the panels (FR-031), so the
 * counting the old wording did ("These 3 files could not be opened") is now done by the list, which
 * can also say WHICH.
 *
 * The path is deliberately absent: FR-034 keeps raw paths out of a notice, and the panel's own
 * banner already shows the one it could not read (FR-040a). What this adds is why.
 */
export function missingFileMessage(reason: string): string {
  if (reason === 'binary') return 'That file is not text, so it cannot be opened in an editor.';
  if (reason === 'too-large') return 'That file is too large to open in an editor.';
  // The file EXISTS. Saying "missing" here would send the user looking for a file that is sitting
  // exactly where they left it.
  if (reason === 'out-of-tree') return 'That file is outside this project, so it cannot be opened here.';
  if (reason === 'folder') return 'That is a folder, not a file.';
  return 'The file could not be opened — it may have been moved, renamed or deleted. An editor with a recovered buffer can be saved to write its contents back.';
}

/** The file's own path, for the row's `detail` — copied and logged, never rendered (FR-034). */
export function missingFileDetail(entry: LoadErrorEntry, os: OsName): string {
  const path = entry.filePath ? toDisplayPath(entry.filePath, os) : '(unsaved document)';
  return `${path} (${entry.reason})`;
}
