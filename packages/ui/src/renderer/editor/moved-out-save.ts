/**
 * Saving the editors a move took out of their project — or a Replace landed on (052 FR-012) — for the flows that
 * "save first" (050 FR-036).
 *
 * Save is unavailable on such an editor, and main's Save All passes it by — which is right for Ctrl+Shift+S
 * but would let a project unload or removal drop its unsaved text without a word. Those flows call this
 * after Save All: each dirty moved-out editor of the project is Saved As (`saveForClose`), and anything
 * that cannot be — a cancelled dialog, or an editor not mounted here to ask — stops the flow, exactly as a
 * failed Save does.
 */
import { allEditorStates } from './editor-state.js';
import { getEditorActions } from './editor-actions.js';

/** `true` when every dirty moved-out editor of `projectId` (any project when `null`) was saved. */
export async function saveDirtyMovedOutEditors(projectId: string | null): Promise<boolean> {
  for (const st of allEditorStates()) {
    // A REPLACED document (052 FR-012) is the same case: its path is another file's now, so a plain Save is
    // refused and only Save As keeps the buffer.
    if (!(st.movedOut || st.replaced) || !st.dirty) continue;
    if (projectId !== null && st.ownerProjectId !== projectId) continue;
    const actions = getEditorActions(st.panelId);
    if (!actions || !(await actions.saveForClose())) return false;
  }
  return true;
}

/**
 * The Save All failures a "save first" flow must stop on. A REPLACED document is left out: main's Save All refuses
 * its plain Save on purpose (`replaced`, 052 R5) so nothing writes over the moved file, and
 * {@link saveDirtyMovedOutEditors} is what keeps its changes — by Save As. Counting it here as well stopped the
 * flow before that Save As was ever offered (MT-09 step 6).
 */
export function failedBeyondSaveAs(failed: readonly { panelId: string; reason: string }[]): readonly { panelId: string; reason: string }[] {
  return failed.filter((f) => f.reason !== 'replaced');
}
