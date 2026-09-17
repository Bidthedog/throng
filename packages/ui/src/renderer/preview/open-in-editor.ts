/**
 * A preview's route back to its source: Open in Editor and Go to Editor (044 FR-015b, FR-015c, FR-015d;
 * contracts/menus-and-controls.md §1, §4, §8).
 *
 * ══ THE MIRROR OF OPEN PREVIEW ══
 *
 * | Preview is   | Route          | What happens                                                              |
 * |--------------|----------------|---------------------------------------------------------------------------|
 * | standalone   | Open in Editor | `openInto` first; `focus` → that editor, nothing placed; `open` → a new editor splitting the preview's slot on its LEFT; `refuse` → the refusal notice, nothing placed |
 * | parented     | Go to Editor   | the parent's tab to the front, the parent active and focused; `openInto`'s `focus` answer has main raise the window holding it |
 *
 * `openInto` is main's one-buffer oracle — the question every editor open asks first (006 FR-011a, 041
 * FR-013) — so a file open in some editor anywhere is never opened a second time from here. Once the new
 * editor registers the document, main parents the preview to it in place (FR-013a); nothing here does.
 *
 * ══ ONE FUNCTION, THREE ENTRY POINTS ══
 *
 * The status bar's button, the body menu's row and the header menu's row all call
 * {@link runPreviewEditorRoute}, which reads the preview's parented state from `preview-store` when it is
 * chosen — so the three cannot disagree about which of the two routes a click takes (FR-015b).
 */
import { PREVIEW_KIND, collectPanels, previewPathOf, type Panel, type PreviewPanelConfig } from '@throng/core';
import { getPreviewState } from './preview-store.js';
import { focusLocalPanel, type PreviewPlacementWorkspace } from './open-preview.js';
import { setActivePane } from '../workspace/active-pane.js';
import { requestPanelFocus } from '../workspace/panel-focus.js';
import { setLastActiveEditor } from '../editor/last-active-editor.js';
import { publishRefusedOpen } from '../editor/refusal-store.js';

/** What `window.throng.editor.openInto` answers. */
type OpenIntoAnswer =
  | { action: 'focus'; panelId: string; windowId: string }
  | { action: 'open' }
  | { action: 'refuse'; reason: string };

/** The one bridge call the route makes. */
export interface EditorOpenIntoBridge {
  openInto(req: { absPath: string; ownerKind?: 'project' | 'subworkspace'; ownerProjectId?: string }): Promise<OpenIntoAnswer>;
}

export interface PreviewEditorRouteArgs {
  /** The workspace, or a getter for it — read again after main answers, as `openPreview` does. */
  ws: PreviewPlacementWorkspace | (() => PreviewPlacementWorkspace);
  bridge: EditorOpenIntoBridge | undefined;
  previewPanelId: string;
  /** The file the preview shows now. */
  filePath: string;
  /** The preview's origin project — the document's owner the question is asked about. */
  projectId: string;
}

export type PreviewEditorRouteOutcome =
  | { kind: 'focused'; panelId: string }
  | { kind: 'opened'; panelId: string }
  | { kind: 'refused'; reason: string }
  /** No bridge, or nowhere to put the editor. */
  | { kind: 'unavailable' };

const current = (ws: PreviewEditorRouteArgs['ws']): PreviewPlacementWorkspace => (typeof ws === 'function' ? ws() : ws);

const tabHolding = (ws: PreviewPlacementWorkspace, panelId: string) =>
  ws.layout?.tabs.find((t) => collectPanels(t.root).some((p) => p.id === panelId));

function ask(args: PreviewEditorRouteArgs): Promise<OpenIntoAnswer> | null {
  return args.bridge?.openInto({ absPath: args.filePath, ownerKind: 'project', ownerProjectId: args.projectId }) ?? null;
}

/** Focus `panelId` if this window holds it. */
function focusIfLocal(ws: PreviewPlacementWorkspace, panelId: string): void {
  if (ws.layout !== null) focusLocalPanel(ws, ws.layout, panelId);
}

/** FR-015c — Open in Editor, from a standalone preview. */
export async function openPreviewInEditor(args: PreviewEditorRouteArgs): Promise<PreviewEditorRouteOutcome> {
  const answer = await ask(args);
  if (answer === null) return { kind: 'unavailable' };
  const ws = current(args.ws);

  if (answer.action === 'focus') {
    // Already open in an editor: that one is the route. In another window, main has raised it already.
    focusIfLocal(ws, answer.panelId);
    return { kind: 'focused', panelId: answer.panelId };
  }
  if (answer.action === 'refuse') {
    // 041 FR-013 — no panel for a file throng will not open; the refusal becomes the usual notice.
    publishRefusedOpen({ absPath: args.filePath, reason: answer.reason });
    return { kind: 'refused', reason: answer.reason };
  }

  const tab = tabHolding(ws, args.previewPanelId);
  const panelId = tab === undefined ? null : ws.addPanelBeside(args.previewPanelId, 'left');
  if (tab === undefined || panelId === null) return { kind: 'unavailable' };
  // A command-created panel must not open in rename mode (FR-041 is for user-added panels).
  ws.clearLastAddedPanel();
  const config = { filePath: args.filePath };
  ws.setPanelType(panelId, 'editor', config);
  window.throng?.panel?.notifyTyped?.(panelId, 'editor', config);
  if (ws.layout?.activeTabId !== tab.id) ws.setActiveTab(tab.id);
  ws.setActivePanel(tab.id, panelId);
  setLastActiveEditor(tab.id, panelId);
  setActivePane('workspace');
  requestPanelFocus(panelId);
  return { kind: 'opened', panelId };
}

/** FR-015d — Go to Editor, from a parented preview. Never places anything. */
export async function goToPreviewParent(
  args: PreviewEditorRouteArgs & { parentPanelId: string },
): Promise<PreviewEditorRouteOutcome> {
  const answer = await ask(args);
  const ws = current(args.ws);
  // `focus` names the editor main holds the document in — and main has raised its window. Anything else
  // (no bridge, or a parent that has just let the file go) still focuses the parent this preview named.
  const target = answer?.action === 'focus' ? answer.panelId : args.parentPanelId;
  focusIfLocal(ws, target);
  return answer === null ? { kind: 'unavailable' } : { kind: 'focused', panelId: target };
}

/**
 * The one command the three entry points run (FR-015b): Go to Editor while the preview is parented, Open
 * in Editor while it is standalone — decided from `preview-store` NOW. A preview that is not a preview, or
 * shows no file, does nothing.
 */
export function runPreviewEditorRoute(panel: Panel, ws: () => PreviewPlacementWorkspace): void {
  if (panel.kind !== PREVIEW_KIND) return;
  const state = getPreviewState(panel.id);
  const filePath = state?.filePath ?? previewPathOf(panel.config as PreviewPanelConfig | undefined);
  if (!filePath) return;
  const args: PreviewEditorRouteArgs = {
    ws,
    bridge: window.throng?.editor,
    previewPanelId: panel.id,
    filePath,
    projectId: panel.originProjectId,
  };
  const route = state?.parent ? goToPreviewParent({ ...args, parentPanelId: state.parent.panelId }) : openPreviewInEditor(args);
  route.catch((error: unknown) => {
    // A thrown bridge is a broken bridge (failures are answered, never thrown). Nothing moved; say why in
    // the console, where every other broken-bridge open reports.
    console.error('[preview] the route to the editor failed', error);
  });
}
