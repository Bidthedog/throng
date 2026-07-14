/**
 * The live CodeMirror view of each Editor Panel, by panel id (016).
 *
 * The status strip and the language picker are React components mounted OUTSIDE the CodeMirror
 * view, and they need to reconfigure it (swap the grammar) when the user picks a language. This is
 * the same registry idiom the editor already uses for its imperative actions, its focus target and
 * its search controller — the view is not React state, and pretending otherwise would mean
 * threading it through props that exist only to carry it.
 */
import type { EditorView } from '@codemirror/view';

const views = new Map<string, EditorView>();

export function registerEditorView(panelId: string, view: EditorView): void {
  views.set(panelId, view);
}

export function unregisterEditorView(panelId: string): void {
  views.delete(panelId);
}

export function getEditorView(panelId: string): EditorView | undefined {
  return views.get(panelId);
}
