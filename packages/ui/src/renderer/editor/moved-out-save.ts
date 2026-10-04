/**
 * Saving the editors a move took out of their project, for the flows that "save first" (050 FR-036).
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
    if (!st.movedOut || !st.dirty) continue;
    if (projectId !== null && st.ownerProjectId !== projectId) continue;
    const actions = getEditorActions(st.panelId);
    if (!actions || !(await actions.saveForClose())) return false;
  }
  return true;
}
