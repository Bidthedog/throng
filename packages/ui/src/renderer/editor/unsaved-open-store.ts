/**
 * Unsaved-on-open prompt state (006 Phase B, US9). Opening a file into an editor
 * that has unsaved changes offers four choices. A tiny promise-backed store the
 * dialog component renders and resolves.
 */
import { useSyncExternalStore } from 'react';

export type UnsavedOpenChoice = 'discard' | 'save' | 'new' | 'cancel';

export interface UnsavedOpenRequest {
  fileName: string;
  editorName: string;
  /** The third choice's label. Absent: "Open in new editor". A preview with unsaved grid edits words it for a preview (073 FR-033b). */
  newLabel?: string;
  resolve: (choice: UnsavedOpenChoice) => void;
}

let pending: UnsavedOpenRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Ask the user how to open `fileName` into a dirty editor `editorName`. */
export function promptUnsavedOpen(
  fileName: string,
  editorName: string,
  opts: { newLabel?: string } = {},
): Promise<UnsavedOpenChoice> {
  return new Promise((resolve) => {
    pending = {
      fileName,
      editorName,
      ...(opts.newLabel !== undefined ? { newLabel: opts.newLabel } : {}),
      resolve: (choice) => {
        pending = null;
        emit();
        resolve(choice);
      },
    };
    emit();
  });
}

export function useUnsavedOpenRequest(): UnsavedOpenRequest | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
    () => pending,
  );
}
