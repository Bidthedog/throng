/**
 * Back and Forward — the command every route runs (044 T149, FR-102, FR-105, FR-112;
 * contracts/navigation-history.md §4).
 *
 * ```text
 * navigate.back | navigate.forward (chord) → the FOCUSED editor or preview panel; none → nothing
 * header button, header menu row, mouse button 3 / 4 → the panel they belong to
 *   → target = targetOf(history-store, dir); none → nothing
 *   → editor:  openIntoEditorPanel(ws, panelId, entry.filePath, { kind: 'history', index })
 *   → preview: the mounted panel's own history step — preview.navigate with the history intent and the
 *              view state it is leaving (preview-panel.tsx), which also handles main's reply
 * ```
 *
 * The target comes from THIS window's mirror of main's history; the move itself is main's, made inside the
 * load or the navigate. One panel's step touches no other panel's history (FR-112): the only panel named is
 * the one passed.
 */
import { PREVIEW_KIND, collectPanels, effectiveActivePanelId, targetOf, type Panel } from '@throng/core';
import { openIntoEditorPanel, type WorkspaceApi } from '../editor/open-into-panel.js';
import { navigatePreviewHistory } from '../preview/preview-panel-handles.js';
import { getActivePane } from '../workspace/active-pane.js';
import { getPanelHistory } from './history-store.js';

export type HistoryDirection = 'back' | 'forward';

function panelIn(ws: WorkspaceApi, panelId: string): Panel | undefined {
  return ws.layout?.tabs.flatMap((tab) => collectPanels(tab.root) as Panel[]).find((p) => p.id === panelId);
}

/** Step `panelId` one entry back or forward. Nothing happens for a panel with no history or no target. */
export async function navigatePanelHistory(ws: WorkspaceApi, panelId: string, dir: HistoryDirection): Promise<void> {
  const panel = panelIn(ws, panelId);
  if (panel?.kind !== 'editor' && panel?.kind !== PREVIEW_KIND) return;
  const history = getPanelHistory(panelId);
  const target = history ? targetOf(history, dir) : null;
  if (target === null) return;
  if (panel.kind === 'editor') {
    await openIntoEditorPanel(ws, panelId, target.entry.filePath, { kind: 'history', index: target.index });
    return;
  }
  navigatePreviewHistory(panelId, { index: target.index, filePath: target.entry.filePath });
}

/**
 * The chord's panel: the active panel of the active tab, while a workspace panel — not File Explorer — has
 * the keyboard (FR-105). `null` otherwise.
 */
export function focusedHistoryPanel(ws: WorkspaceApi): string | null {
  if (getActivePane() !== 'workspace') return null;
  const layout = ws.layout;
  const tab = layout?.tabs.find((t) => t.id === layout.activeTabId);
  return tab ? (effectiveActivePanelId(tab) ?? null) : null;
}

/** `navigate.back` / `navigate.forward` — the focused editor or preview panel only. */
export async function navigateFocusedHistory(ws: WorkspaceApi, dir: HistoryDirection): Promise<void> {
  const panelId = focusedHistoryPanel(ws);
  if (panelId !== null) await navigatePanelHistory(ws, panelId, dir);
}
