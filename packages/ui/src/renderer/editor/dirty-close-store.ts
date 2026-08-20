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

/**
 * Test-only: answer whatever prompt is still open, so the next test starts from none.
 *
 * `pending` is module state and NOTHING in the production path clears it except an answer — which
 * is correct for the app, where a raised prompt should survive until the user deals with it, and
 * wrong for a test file, where it survives into the next test. The failure that mode produces is
 * worth naming because it does not look like a leak: the next `render()` shows the STALE request,
 * `findByTestId` resolves against that element, and the assertion runs before React has flushed the
 * new one. So the test reads the previous test's dialog and fails on a filename it never mentioned
 * — intermittently, because it is a race, and only on a machine slow enough to lose it.
 *
 * It answers rather than nulling `pending` directly: the dialog's rule is that a dismissal is a
 * CANCEL (the safe answer), and going through `resolve` means this helper cannot drift from the
 * production path it stands in for.
 */
export function __resetDirtyCloseStore(): void {
  pending?.resolve('cancel');
}
