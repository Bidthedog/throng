/**
 * "This document's language override changed" — window-local (055 FR-024a; 016 FR-028b).
 *
 * The override is DOCUMENT state, but it is applied by whichever panel chose it, and nothing used to tell
 * another panel already showing the same file. Each editor subscribes, decides from the project id and the
 * project-relative path whether the change is about ITS document, and re-resolves its language from the
 * stored value — which is why this is published only after the store has been written.
 *
 * Module state, so per renderer realm: a sub-workspace window is a separate realm and picks the change up the
 * next time it resolves the document's language.
 */

export interface DocumentKey {
  projectId: string | null;
  relPath: string | null;
}

export interface DocumentLanguageChange extends DocumentKey {
  /** The panel the choice was made in. */
  originPanelId: string;
  /**
   * Whether the origin panel should re-resolve too. False after SETTING an override (the origin has applied
   * it already); true after a RESET, where re-resolving is the whole action.
   */
  includeOrigin: boolean;
}

type Listener = (change: DocumentLanguageChange) => void;

const listeners = new Set<Listener>();

export function subscribeDocumentLanguageChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishDocumentLanguageChange(change: DocumentLanguageChange): void {
  for (const listen of [...listeners]) {
    try {
      listen(change);
    } catch (err) {
      // One editor failing to re-resolve must not stop the others hearing about the change.
      console.error('[throng] a document language listener failed', err);
    }
  }
}

function normalise(relPath: string): string {
  return relPath.replace(/\\/g, '/').toLowerCase();
}

/**
 * Are these the same document? Same project and the same relative path, compared the way
 * `language-override.ts` compares paths (slash direction and case ignored). An untitled document has no
 * path and is never the same as anything — it lives in exactly one panel.
 */
export function isSameDocument(a: DocumentKey, b: DocumentKey): boolean {
  if (!a.projectId || !a.relPath || !b.projectId || !b.relPath) return false;
  return a.projectId === b.projectId && normalise(a.relPath) === normalise(b.relPath);
}
