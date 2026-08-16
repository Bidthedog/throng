import { useEffect } from 'react';
import { collectPanels, isPanel, type EditorOpenTarget, type LayoutNode } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useAppSettings } from '../config/config-store.js';
import { getEditorActions } from './editor-actions.js';
import { getEditorState } from './editor-state.js';
import { getLastActiveEditor, setLastActiveEditor } from './last-active-editor.js';
import { promptUnsavedOpen } from './unsaved-open-store.js';

/**
 * Open-from-tree orchestration (006 Phase B, US2/US9, FR-010/011a). Listens for
 * the explorer's `throng:open-file` intent and routes the file into the tab's
 * **last active editor** — creating the tab's single dedicated editor only if none
 * exists (never a second, FR-010). An already-open file focuses the one existing
 * editor (app-wide one buffer, FR-011a); opening into a dirty editor shows the
 * four-choice prompt (US9). Mounted once inside the workspace.
 */
export function EditorOpenListener(): null {
  const ws = useWorkspace();
  // US7 (#141): the default open target for a file-tree open (last active editor, or a new one).
  const openTarget = useAppSettings().editor.openTarget;
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { absPath?: string } | undefined;
      if (detail?.absPath) void openFileIntoEditor(ws, detail.absPath, openTarget);
    };
    window.addEventListener('throng:open-file', handler);
    // UI main raised this window to focus an already-open file's editor (FR-011a).
    const offFocus = window.throng?.editor?.onFocus?.((msg) => focusPanelIfLocal(ws, msg.panelId));
    return () => {
      window.removeEventListener('throng:open-file', handler);
      offFocus?.();
    };
  }, [ws, openTarget]);
  return null;
}

type Ws = ReturnType<typeof useWorkspace>;

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? p : p.slice(i + 1);
}

/** Editor panelIds present in the given tab (in document order). */
function editorPanelsInTab(root: LayoutNode): string[] {
  return collectPanels(root)
    .filter((p) => getEditorState(p.id) !== undefined || (isPanel(p) && p.kind === 'editor'))
    .map((p) => p.id);
}

async function openFileIntoEditor(ws: Ws, absPath: string, openTarget: EditorOpenTarget): Promise<void> {
  const tabId = ws.layout?.activeTabId;
  if (tabId) await openFileInTab(ws, tabId, absPath, openTarget);
}

/**
 * Open `absPath` into a specific tab's editor (Open In menu / click). Focuses the
 * existing editor if the file is already open anywhere (one buffer, FR-011a), else
 * routes into the tab's last active editor (creating its dedicated editor if none,
 * FR-010), prompting on a dirty target (US9).
 *
 * ══ THE RETURN VALUE: DID A FILE ACTUALLY GET OPENED? ══
 *
 * `true` when the file was routed somewhere the user can see it — a new editor, the last active
 * one, or the existing editor that already held it. `false` for every branch that ends with
 * NOTHING opened: no layout, no such tab, Cancel at the unsaved-changes prompt, or a Save that
 * chose to open and then failed.
 *
 * It exists because "the file opened" and "the call returned" are not the same event, and a caller
 * that treats them as one gets it wrong in exactly the case the user notices: 033 FR-061 remembers
 * the Quick Open query that OPENED a file, and recording it before this call meant a user who chose
 * a row, was asked about unsaved changes and said Cancel had their query remembered for a file that
 * never opened. The settings editor promises them "the last query that actually opened a file", so
 * the signal has to come from here — this is the only code that knows.
 *
 * NOT a report on whether the document loaded. `EditorActions.openFile` returns `void`; a file that
 * is missing or too large is reported by the editor itself, and by then the open HAS happened —
 * the user is looking at that editor and at that message.
 */
export async function openFileInTab(
  ws: Ws,
  tabId: string,
  absPath: string,
  openTarget: EditorOpenTarget = 'lastActive',
): Promise<boolean> {
  // 1) Already open anywhere → focus that one editor (no second buffer, FR-011a / one-doc-one-state
  //    #68). This holds regardless of the open-target preference (US7 / FR-027).
  //    Counts as opened: the file the caller asked for is what the user is now looking at, whether
  //    this window raised it or UI-main raised the window holding it.
  const decision = await window.throng?.editor?.openInto({ absPath });
  if (decision?.action === 'focus') {
    focusPanelIfLocal(ws, decision.panelId);
    return true;
  }

  const layout = ws.layout;
  if (!layout) return false;
  const tab = layout.tabs.find((t) => t.id === tabId);
  if (!tab) return false;
  if (layout.activeTabId !== tabId) ws.setActiveTab(tabId);

  // US7 (#141): with "New Editor", a not-yet-open file lands in a NEW editor panel each time,
  // rather than reusing the tab's last active editor.
  if (openTarget === 'new') {
    openFileInNewEditor(ws, tabId, absPath);
    return true;
  }

  // 2) Resolve the target editor: the tab's last active editor, else any editor in
  //    the tab, else create the tab's single dedicated editor (FR-010).
  const editorsHere = editorPanelsInTab(tab.root);
  const last = getLastActiveEditor(tabId);
  const targetId = last && editorsHere.includes(last) ? last : editorsHere[0];

  if (!targetId) {
    createDedicatedEditor(ws, tabId, absPath);
    return true;
  }

  const actions = getEditorActions(targetId);
  if (!actions) {
    createDedicatedEditor(ws, tabId, absPath);
    return true;
  }

  // 3) Dirty target → the four-choice prompt (US9).
  if (actions.isDirty()) {
    const editorName = getEditorState(targetId)?.displayName ?? 'This editor';
    const choice = await promptUnsavedOpen(basename(absPath), editorName);
    if (choice === 'cancel') return false;
    if (choice === 'new') {
      createDedicatedEditor(ws, tabId, absPath);
      return true;
    }
    if (choice === 'save') {
      const ok = await actions.save();
      if (!ok) return false; // save failed/cancelled → don't lose the buffer
    }
    // 'discard' or a successful 'save' → replace the document.
    await actions.openFile(absPath);
    return true;
  }

  await actions.openFile(absPath);
  void targetId;
  return true;
}

/**
 * Open `absPath` into ONE NAMED PANEL — the one the user dropped it on (018 follow-up).
 *
 * `openFileInTab` routes to the tab's LAST ACTIVE editor, which is exactly right when the request came
 * from the tree: the user asked for a file, not for a place. A DROP is the opposite. It is a gesture at
 * a place, and sending the file to whichever editor happened to be focused a minute ago ignores the
 * only thing the gesture actually said.
 *
 * Everything else is shared with `openFileInTab`, deliberately: the one-buffer rule still focuses an
 * editor that already holds the file rather than opening a second copy of it, and a DIRTY target still
 * asks before it is replaced.
 */
export async function openFileInPanel(
  ws: Ws,
  tabId: string,
  panelId: string,
  absPath: string,
): Promise<void> {
  // 1) Already open anywhere → focus that one editor (no second buffer, FR-011a).
  const decision = await window.throng?.editor?.openInto({ absPath });
  if (decision?.action === 'focus') {
    focusPanelIfLocal(ws, decision.panelId);
    return;
  }

  const actions = getEditorActions(panelId);
  if (!actions) {
    // The panel is not an editor yet (or its view has gone). Fall back to the tab-level route rather
    // than dropping the file on the floor.
    await openFileInTab(ws, tabId, absPath);
    return;
  }

  // 2) Dirty target → the four-choice prompt (US9). Dropping a file onto an editor holding unsaved work
  //    must not silently discard it just because the gesture was a drag rather than a click.
  if (actions.isDirty()) {
    const editorName = getEditorState(panelId)?.displayName ?? 'This editor';
    const choice = await promptUnsavedOpen(basename(absPath), editorName);
    if (choice === 'cancel') return;
    if (choice === 'new') {
      createDedicatedEditor(ws, tabId, absPath);
      return;
    }
    if (choice === 'save') {
      const ok = await actions.save();
      if (!ok) return;
    }
  }

  ws.setActivePanel(tabId, panelId);
  setLastActiveEditor(tabId, panelId);
  await actions.openFile(absPath);
}

/**
 * Force `absPath` into a BRAND-NEW dedicated Editor Panel in `tabId` (Open In →
 * "New Editor", FR-072). The caller gates on the file not already being open
 * anywhere (app-wide one-buffer, FR-011a), so no focus/reuse path is needed.
 */
export function openFileInNewEditor(ws: Ws, tabId: string, absPath: string): void {
  createDedicatedEditor(ws, tabId, absPath);
}

/** Create the tab's dedicated editor Panel already pointed at `absPath` (FR-010). */
function createDedicatedEditor(ws: Ws, tabId: string, absPath: string): void {
  const newId = ws.addPanel(tabId);
  // A programmatically opened editor must NOT open in rename mode (that would steal
  // focus from the tree / editor). Only user-added Panels rename-on-add (FR-041).
  ws.clearLastAddedPanel();
  ws.setPanelType(newId, 'editor', { filePath: absPath });
  window.throng?.panel?.notifyTyped?.(newId, 'editor', { filePath: absPath });
  ws.setActivePanel(tabId, newId);
  setLastActiveEditor(tabId, newId);
}

/** If the given panel is in this window's layout, activate it (local focus). */
function focusPanelIfLocal(ws: Ws, panelId: string): void {
  const layout = ws.layout;
  if (!layout) return;
  for (const tab of layout.tabs) {
    if (collectPanels(tab.root).some((p) => p.id === panelId)) {
      ws.setActiveTab(tab.id);
      ws.setActivePanel(tab.id, panelId);
      setLastActiveEditor(tab.id, panelId);
      return;
    }
  }
}
