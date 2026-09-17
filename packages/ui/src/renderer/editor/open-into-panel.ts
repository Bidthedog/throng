/**
 * The ONE renderer route for opening a file into an EXISTING editor panel (044 T147, FR-106,
 * contracts/navigation-history.md §3 "the consolidated renderer flow").
 *
 * A tree open into the tab's last active editor, a drop on an editor, and Back / Forward all replace a
 * panel's document the same way: ask main whether the file is already open or refused, ask the user when
 * the panel holds unsaved work, and then load. Main records history INSIDE that load (a history move is a
 * load carrying `navigation`), so every FR-106 outcome follows from whether the load runs:
 *
 * | Situation                                   | Here                                          | Outcome            |
 * |---------------------------------------------|-----------------------------------------------|--------------------|
 * | File open in another editor (FR-106b)       | that editor is focused, no load               | `focusedElsewhere` |
 * | Refused (FR-106c)                           | one notice naming the file, no load           | `refused`          |
 * | Missing, on a HISTORY step (FR-106d)        | the refusal is ignored, the load runs         | `loaded`           |
 * | Dirty → Cancel (FR-106a)                    | no load                                       | `cancelled`        |
 * | Dirty → Save & open, save fails             | no load                                       | `saveFailed`       |
 * | Dirty → Discard / Save & open               | load, with the intent                         | `loaded`           |
 * | Dirty → Open in new editor                  | a new panel's first, ordinary load            | `openedInNew`      |
 *
 * The load itself is the panel's own `openFile` (use-editor), which carries `config.history` and the
 * intent to `throng:editor:load`; this module never builds a load request of its own.
 */
import { collectPanels, isMissingReason, type OpenDecision } from '@throng/core';
import type { useWorkspace } from '../state/workspace-store.js';
import { getEditorActions, type EditorActions } from './editor-actions.js';
import { getEditorState } from './editor-state.js';
import { setLastActiveEditor } from './last-active-editor.js';
import { publishRefusedOpen } from './refusal-store.js';
import { promptUnsavedOpen, type UnsavedOpenChoice } from './unsaved-open-store.js';

export type WorkspaceApi = ReturnType<typeof useWorkspace>;

/** An ordinary open, or a step to `index` of this panel's history (Back / Forward). */
export type OpenIntoIntent = { kind: 'open' } | { kind: 'history'; index: number };

export type OpenIntoOutcome = 'loaded' | 'cancelled' | 'focusedElsewhere' | 'refused' | 'openedInNew' | 'saveFailed';

export interface OpenIntoDeps {
  /** The unsaved-open prompt. Default: the dialog's store. */
  prompt?: (fileName: string, editorName: string) => Promise<UnsavedOpenChoice>;
  /** Run once the load is decided and just before it starts — a drop activates the panel it landed on. */
  beforeLoad?: () => void;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? p : p.slice(i + 1);
}

/** The tab holding `panelId` in this window's layout, if any. */
function tabOfPanel(ws: WorkspaceApi, panelId: string): string | undefined {
  return ws.layout?.tabs.find((tab) => collectPanels(tab.root).some((p) => p.id === panelId))?.id;
}

/** Main's one-buffer and refusal decision for `absPath` (FR-011a, 041 FR-013). `undefined` without a bridge. */
export async function openDecisionFor(ws: WorkspaceApi, absPath: string): Promise<OpenDecision | undefined> {
  return window.throng?.editor?.openInto({ absPath, ownerKind: 'project', ownerProjectId: ws.layout?.projectId });
}

/**
 * Open `absPath` into editor panel `panelId`, with the intent the caller names.
 *
 * With no live editor registered for the panel there is nothing to load into and nothing is done
 * (`cancelled`): a caller that can create an editor instead (the tree route) checks for one first.
 */
export async function openIntoEditorPanel(
  ws: WorkspaceApi,
  panelId: string,
  absPath: string,
  intent: OpenIntoIntent,
  deps: OpenIntoDeps = {},
): Promise<OpenIntoOutcome> {
  const decision = await openDecisionFor(ws, absPath);
  if (decision?.action === 'focus') {
    // A history entry naming the file this very panel holds is a move, not a focus: the load runs.
    if (!(intent.kind === 'history' && decision.panelId === panelId)) {
      focusPanelIfLocal(ws, decision.panelId);
      return 'focusedElsewhere';
    }
  }
  if (decision?.action === 'refuse') {
    // FR-106d — the one deliberate bypass: a history step onto a file that is no longer there still moves,
    // so the panel shows its could-not-read state and the user can step past it.
    if (!(intent.kind === 'history' && isMissingReason(decision.reason))) {
      publishRefusedOpen({ absPath, reason: decision.reason });
      return 'refused';
    }
  }
  return (await replaceInEditorPanel(ws, panelId, absPath, intent, deps)).outcome;
}

/**
 * The prompt-and-load half, for a caller that has ALREADY taken main's one-buffer decision (the tree route,
 * which must decide before it knows which panel the file lands in). Answers the outcome and the panel the
 * file is now in — the new one for `openedInNew`.
 */
export async function replaceInEditorPanel(
  ws: WorkspaceApi,
  panelId: string,
  absPath: string,
  intent: OpenIntoIntent,
  deps: OpenIntoDeps = {},
): Promise<{ outcome: OpenIntoOutcome; panelId: string }> {
  const actions: EditorActions | undefined = getEditorActions(panelId);
  if (!actions) return { outcome: 'cancelled', panelId };

  if (actions.isDirty()) {
    const editorName = getEditorState(panelId)?.displayName ?? 'This editor';
    const choice = await (deps.prompt ?? promptUnsavedOpen)(basename(absPath), editorName);
    if (choice === 'cancel') return { outcome: 'cancelled', panelId };
    if (choice === 'new') {
      const tabId = tabOfPanel(ws, panelId);
      if (!tabId) return { outcome: 'cancelled', panelId };
      // The new panel's first load is an ordinary one: its history starts with this file (FR-106a).
      return { outcome: 'openedInNew', panelId: createDedicatedEditor(ws, tabId, absPath) };
    }
    if (choice === 'save' && !(await actions.save())) {
      return { outcome: 'saveFailed', panelId }; // a failed save must not be followed by the open
    }
  }

  deps.beforeLoad?.();
  if (intent.kind === 'history') {
    await actions.openFile(absPath, { navigation: { kind: 'history', index: intent.index, filePath: absPath } });
  } else {
    await actions.openFile(absPath);
  }
  return { outcome: 'loaded', panelId };
}

/**
 * Create the tab's dedicated editor Panel already pointed at `absPath` (FR-010).
 *
 * Returns the panel it made. 043 FR-038 needs that id: the match has to be selected in the editor the file
 * actually landed in, and this is the only code that knows which one that is.
 */
export function createDedicatedEditor(ws: WorkspaceApi, tabId: string, absPath: string): string {
  const newId = ws.addPanel(tabId);
  // A programmatically opened editor must NOT open in rename mode (that would steal focus from the tree /
  // editor). Only user-added Panels rename-on-add (FR-041).
  ws.clearLastAddedPanel();
  ws.setPanelType(newId, 'editor', { filePath: absPath });
  window.throng?.panel?.notifyTyped?.(newId, 'editor', { filePath: absPath });
  ws.setActivePanel(tabId, newId);
  setLastActiveEditor(tabId, newId);
  return newId;
}

/** If the given panel is in this window's layout, activate it (local focus). */
export function focusPanelIfLocal(ws: WorkspaceApi, panelId: string): void {
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
