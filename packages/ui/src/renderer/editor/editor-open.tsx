import { useEffect } from 'react';
import { collectPanels, isPanel, type LayoutNode } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
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
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { absPath?: string } | undefined;
      if (detail?.absPath) void openFileIntoEditor(ws, detail.absPath);
    };
    window.addEventListener('throng:open-file', handler);
    // UI main raised this window to focus an already-open file's editor (FR-011a).
    const offFocus = window.throng?.editor?.onFocus?.((msg) => focusPanelIfLocal(ws, msg.panelId));
    return () => {
      window.removeEventListener('throng:open-file', handler);
      offFocus?.();
    };
  }, [ws]);
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

async function openFileIntoEditor(ws: Ws, absPath: string): Promise<void> {
  const tabId = ws.layout?.activeTabId;
  if (tabId) await openFileInTab(ws, tabId, absPath);
}

/**
 * Open `absPath` into a specific tab's editor (Open In menu / click). Focuses the
 * existing editor if the file is already open anywhere (one buffer, FR-011a), else
 * routes into the tab's last active editor (creating its dedicated editor if none,
 * FR-010), prompting on a dirty target (US9).
 */
export async function openFileInTab(ws: Ws, tabId: string, absPath: string): Promise<void> {
  // 1) Already open anywhere → focus that one editor (no second buffer, FR-011a).
  const decision = await window.throng?.editor?.openInto({ absPath });
  if (decision?.action === 'focus') {
    focusPanelIfLocal(ws, decision.panelId);
    return;
  }

  const layout = ws.layout;
  if (!layout) return;
  const tab = layout.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (layout.activeTabId !== tabId) ws.setActiveTab(tabId);

  // 2) Resolve the target editor: the tab's last active editor, else any editor in
  //    the tab, else create the tab's single dedicated editor (FR-010).
  const editorsHere = editorPanelsInTab(tab.root);
  const last = getLastActiveEditor(tabId);
  let targetId = last && editorsHere.includes(last) ? last : editorsHere[0];

  if (!targetId) {
    createDedicatedEditor(ws, tabId, absPath);
    return;
  }

  const actions = getEditorActions(targetId);
  if (!actions) {
    createDedicatedEditor(ws, tabId, absPath);
    return;
  }

  // 3) Dirty target → the four-choice prompt (US9).
  if (actions.isDirty()) {
    const editorName = getEditorState(targetId)?.displayName ?? 'This editor';
    const choice = await promptUnsavedOpen(basename(absPath), editorName);
    if (choice === 'cancel') return;
    if (choice === 'new') {
      createDedicatedEditor(ws, tabId, absPath);
      return;
    }
    if (choice === 'save') {
      const ok = await actions.save();
      if (!ok) return; // save failed/cancelled → don't lose the buffer
    }
    // 'discard' or a successful 'save' → replace the document.
    await actions.openFile(absPath);
    return;
  }

  await actions.openFile(absPath);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void targetId;
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
