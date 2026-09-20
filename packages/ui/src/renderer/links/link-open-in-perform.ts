import { collectPanels } from '@throng/core';
import { openFileInPanel, openFileInTab } from '../editor/editor-open.js';
import type { RevealTarget } from '../editor/reveal-range.js';
import { getEditorState } from '../editor/editor-state.js';
import { linkOpenInEditors, type LinkOpenInTarget, type OpenInEditorRow } from './link-open-in.js';

/**
 * 045 FR-170 row 2 — performing a Link menu's Open In ▸ row, and reading its named rows from the live
 * stores (T277). The pure half is `link-open-in.ts`.
 *
 * Every route goes through the editor's own open functions, never around them: `openFileInTab` and
 * `openFileInPanel` take main's one-buffer decision first (an already-open file is FOCUSED, 006
 * FR-011a), refuse what throng will not open (041 FR-013) and ask before replacing unsaved work — so
 * a link can no more create a second buffer than the explorer can.
 */

type Ws = Parameters<typeof openFileInTab>[0];

/** The named Open In rows for this window, from its layout and the editor store. */
export function currentLinkOpenInEditors(ws: Ws, targetPath?: string | null): OpenInEditorRow[] {
  return linkOpenInEditors(ws.layout, {
    heldPath: (panelId) => getEditorState(panelId)?.filePath,
    ...(targetPath ? { targetPath } : {}),
  });
}

/**
 * Open `absPath` where the chosen row says:
 *
 *   - **New Editor** — a new editor panel in the active tab (`openFileInTab`'s `'new'`);
 *   - **Active Editor** — the active tab's last active editor, reused (`'lastActive'`);
 *   - **<editor name>** — INTO that editor panel, whichever tab holds it (`openFileInPanel`). If it has
 *     closed since the menu opened, nothing is opened rather than the file landing somewhere the
 *     user did not name.
 *
 * `range` is the link's position (FR-052), revealed in whichever panel the file lands in.
 */
export async function performLinkOpenIn(
  ws: Ws,
  target: LinkOpenInTarget,
  absPath: string,
  range?: RevealTarget,
): Promise<void> {
  const layout = ws.layout;
  if (!layout) return;
  if (target.kind === 'editor') {
    const tab = layout.tabs.find((t) => collectPanels(t.root).some((p) => p.id === target.editorId));
    if (tab) await openFileInPanel(ws, tab.id, target.editorId, absPath, range);
    return;
  }
  const tabId = layout.activeTabId;
  if (!tabId) return;
  await openFileInTab(ws, tabId, absPath, target.kind === 'new' ? 'new' : 'lastActive', range);
}
