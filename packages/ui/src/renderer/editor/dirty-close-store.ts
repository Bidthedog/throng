/**
 * Save/discard/cancel prompt for destroying something that holds unsaved editor
 * content (006, FR-006a): a dirty editor Panel, a Tab or project/sub-workspace
 * with dirty editors. A tiny promise-backed store the dialog renders and resolves.
 */
import { useSyncExternalStore } from 'react';

export type DirtyCloseChoice = 'save' | 'discard' | 'cancel';

export interface DirtyCloseRequest {
  /** What is being destroyed (e.g. an editor/tab/project name). */
  targetLabel: string;
  /** Unsaved file names to name in the prompt. */
  files: string[];
  resolve: (choice: DirtyCloseChoice) => void;
}

let pending: DirtyCloseRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function promptDirtyClose(targetLabel: string, files: string[]): Promise<DirtyCloseChoice> {
  return new Promise((resolve) => {
    pending = {
      targetLabel,
      files,
      resolve: (choice) => {
        pending = null;
        emit();
        resolve(choice);
      },
    };
    emit();
  });
}

export function useDirtyCloseRequest(): DirtyCloseRequest | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
    () => pending,
  );
}
