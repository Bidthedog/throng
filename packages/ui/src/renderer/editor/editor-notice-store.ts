/**
 * Editor notice (message-box) state (006, FR-078). Surfaces a visible message when
 * a save is refused (out-of-tree / outside-project confinement) or a load fails
 * (binary / too-large), instead of a silent no-op. A tiny reactive store the
 * notice dialog renders; dismissed with a single acknowledgement.
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
