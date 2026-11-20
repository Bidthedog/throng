/**
 * Print… for an editor panel (`editor.print`): the one command body behind the chord and the header menu row.
 *
 * It reads the panel's LIVE view — so unsaved edits print — and hands its text, file name, syntax tree and font to
 * the shared text printable (`print/text-printable.ts`), which opens Print Preview. It never prints itself.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { getEditorView } from './editor-views.js';
import { getEditorState } from './editor-state.js';
import { printTextDocument, type PrintOpen, type TextPrintableSource, type Tree } from '../print/text-printable.js';

/** How long printing may spend finishing a parse the editor left lazy, in ms; past it, the parsed part highlights. */
const PARSE_BUDGET_MS = 1_000;

/** The document's syntax tree, parsed to its end where the budget allows; `null` when it has no language. */
function fullTree(state: EditorState): Tree | null {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  return tree.length === 0 ? null : tree;
}

/** What an editor's state prints as. Exported for a future panel that also holds a CodeMirror state. */
export function editorPrintSource(state: EditorState, title: string, fontFamily?: string): TextPrintableSource {
  return { text: state.doc.toString(), title, tree: fullTree(state), ...(fontFamily ? { fontFamily } : {}) };
}

/**
 * Open Print Preview for the editor in `panelId`. Resolves `false` when that panel has no live editor or nothing
 * could be opened, `true` when main was asked.
 */
export async function printEditorPanel(panelId: string, open: PrintOpen | undefined = window.throng?.print?.open): Promise<boolean> {
  const view = getEditorView(panelId);
  if (view === undefined) return false;
  const title = getEditorState(panelId)?.displayName ?? 'Untitled';
  const fontFamily = view.contentDOM.ownerDocument.defaultView?.getComputedStyle(view.contentDOM).fontFamily;
  return printTextDocument(editorPrintSource(view.state, title, fontFamily), open);
}
