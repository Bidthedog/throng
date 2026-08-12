/**
 * Editor notice (message-box) state (006, FR-078). Surfaces a visible message when
 * a save is refused (out-of-tree / outside-project confinement) or the on-disk file
 * changed under unsaved edits, instead of a silent no-op. A tiny reactive store the
 * notice dialog renders; dismissed with a single acknowledgement.
 *
 * ══ WHY THIS SURVIVED 030 US3 (T051a) ══
 *
 * FR-035 removed per-tab batching outright, and this store was where the batch LIVED: the
 * "Cannot open N files" dialog was pushed through here once per tab activation. It would have been
 * easy to conclude that the store went with it.
 *
 * It does not, because the store is not a batch. It is a small reactive channel for an editor
 * message that needs a structured file list, and it has two other callers that 030 does not touch:
 *
 *   • `file-changed-notice.ts` — "this file was changed by another program while you have unsaved
 *     edits" (011 / US4, FR-010), which names the document, its panel and its tab and is not about
 *     a failure at all;
 *   • `use-editor.ts`'s refused save (006, FR-078).
 *
 * What changed is that the MISSING-FILES path stopped feeding it; each unopenable file is now one
 * panel casualty of a consolidated notice (`workspace/panel-failure-notice.ts`). Removing the store
 * to remove the batch would have changed two behaviours in order to change one.
 *
 * The identifiers the adapter passes through — `editor-notice-dialog`, `editor-notice-message`,
 * `editor-notice-ok`, `editor-notice-files` — are preserved for the same reason they were preserved
 * when the ninth idiom was folded in (T051b, FR-053): three suites drive them across six assertions,
 * and dropping them would turn one behaviour change into a three-file test migration.
 */
import { useSyncExternalStore } from 'react';

/** One file in a multi-file "cannot open" notice: the directory (shown dim) split
 *  from the file name (shown bold), plus a dim note (e.g. the owning panel). */
export interface NoticeFile {
  dir: string;
  name: string;
  note?: string;
}

export interface EditorNotice {
  title: string;
  message: string;
  /** When present, rendered as a scrollable bulleted list under `message`. */
  files?: NoticeFile[];
}

let pending: EditorNotice | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Show a message; replaces any currently-pending notice. */
export function showEditorNotice(notice: EditorNotice): void {
  pending = notice;
  emit();
}

export function dismissEditorNotice(): void {
  pending = null;
  emit();
}

export function useEditorNotice(): EditorNotice | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
    () => pending,
  );
}
