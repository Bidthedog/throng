/**
 * A preview's route back to its source, Open in Editor (044 FR-015b, FR-015c, FR-015d; contracts/menus-and-controls.md
 * §1, §4, §8). v1 review (#732): one label on every surface, parented or not; the route below decides whether it
 * focuses an editor or places one.
 *
 * ══ THE MIRROR OF OPEN PREVIEW ══
 *
 * | Preview is   | Route          | What happens                                                              |
 * |--------------|----------------|---------------------------------------------------------------------------|
 * | standalone   | open           | "Open files in" = Last Active Editor with an editor in the tab: the editor side's own open (`openFileInTab`) puts the file there (075 FR-093b). Otherwise `openInto` first; `focus` → that editor, nothing placed; `open` → a new editor splitting the preview's slot on its LEFT; `refuse` → the refusal notice, nothing placed |
 * | parented     | go to parent   | the parent's tab to the front, the parent active and focused; `openInto`'s `focus` answer has main raise the window holding it |
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
import { PREVIEW_KIND, collectPanels, previewPathOf, type EditorOpenTarget, type Panel, type PreviewPanelConfig } from '@throng/core';
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

/**
 * 075 FR-093b — the "Open files in" setting (`editor.openTarget`, 023 FR-025/FR-026) as Open in Editor applies it, and
 * the editor side's open that reuses the tab's last active editor (`reuseLastActiveEditor`): `null` from it means the
 * tab has no editor to reuse. Supplied by the window; absent, Open in Editor opens a new editor, as it did before.
 */
export interface PreviewEditorOpen {
  readonly openTarget: EditorOpenTarget;
  reuse(tabId: string, absPath: string, ownerProjectId?: string): Promise<boolean> | null;
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
  /** 075 FR-093b — where "Open files in" sends the file; absent: a new editor beside the preview. */
  editorOpen?: PreviewEditorOpen;
}

export type PreviewEditorRouteOutcome =
  | { kind: 'focused'; panelId: string }
  | { kind: 'opened'; panelId: string }
  /** 075 FR-093b — the file went to the tab's last active editor, through the editor side's own open. */
  | { kind: 'reused'; landed: boolean }
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
  // 075 FR-093b — "Open files in" = Last Active Editor: the tab's last active editor takes the file, by the same open
  // the file tree and Quick Open use. Only with no editor there to reuse does the preview place one of its own.
  if (args.editorOpen?.openTarget === 'lastActive') {
    const tab = tabHolding(current(args.ws), args.previewPanelId);
    const reused = tab === undefined ? null : args.editorOpen.reuse(tab.id, args.filePath, args.projectId);
    if (reused !== null) return { kind: 'reused', landed: await reused };
  }
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
 * The one command the three entry points run (FR-015b): the parent focused while the preview is parented, an
 * editor opened or focused while it is standalone — decided from `preview-store` NOW. A preview that is not a preview, or
 * shows no file, does nothing.
 */
export function runPreviewEditorRoute(panel: Panel, ws: () => PreviewPlacementWorkspace, editorOpen?: PreviewEditorOpen): void {
  if (panel.kind !== PREVIEW_KIND) return;
  const state = getPreviewState(panel.id);
  // 050 R26 — a moved-out preview has no editor to open or focus: the file is no longer this project's, and
  // the remembered state (parent, path) predates the move. The notice is already the panel's one surface;
  // invoking the route brings the panel forward so it is seen again.
  const held = (panel.config as { movedOut?: unknown } | undefined)?.movedOut === true;
  if (held || state?.notice?.kind === 'moved-out') {
    requestPanelFocus(panel.id);
    return;
  }
  const filePath = state?.filePath ?? previewPathOf(panel.config as PreviewPanelConfig | undefined);
  if (!filePath) return;
  const args: PreviewEditorRouteArgs = {
    ws,
    bridge: window.throng?.editor,
    previewPanelId: panel.id,
    filePath,
    projectId: panel.originProjectId,
    ...(editorOpen !== undefined ? { editorOpen } : {}),
  };
  const route = state?.parent ? goToPreviewParent({ ...args, parentPanelId: state.parent.panelId }) : openPreviewInEditor(args);
  route.catch((error: unknown) => {
    // A thrown bridge is a broken bridge (failures are answered, never thrown). Nothing moved; say why in
    // the console, where every other broken-bridge open reports.
    console.error('[preview] the route to the editor failed', error);
  });
}
