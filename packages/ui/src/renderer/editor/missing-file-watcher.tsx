/**
 * Tab-open "could not open" watcher (006, FR-100/105 · 030 US3, FR-030/FR-035).
 *
 * The failure is reported HERE — once per tab activation — and not inside each editor's mount
 * effect, so merely dragging or moving a panel (which remounts an editor without changing the active
 * tab) never re-warns. Gated by `editor.warnOnMissingFile`. Mounted once per window (in
 * EditorChrome).
 *
 * ══ WHAT 030 CHANGED ══
 *
 * This used to hand the whole tab to `showMissingFilesNotice`, which composed ONE "Cannot open 3
 * files" dialog per tab. FR-035 removes that batching outright: the tab is not the unit a user
 * thinks in, the CAUSE is, and one absent project root defeats editors across four tabs and
 * terminals across two. So each panel is now reported individually and the notification model merges
 * them — which is also what makes the notice GROW as tabs are visited, rather than raising a fresh
 * dialog for each one (FR-030/FR-037).
 *
 * The per-tab scan itself survives untouched, and is now doing a different job: it is what DISCOVERS
 * the casualties in a tab nothing has rendered yet.
 */
import { useEffect, useRef } from 'react';
import { collectPanels, EDITOR_KIND } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useAppSettings } from '../config/config-store.js';
import { useReportPanelFailure } from '../workspace/panel-failure-notice.js';
import { getEditorState } from './editor-state.js';
import { missingFileDetail, missingFileMessage } from './editor-missing-notice.js';

const SCAN_DELAY_MS = 300; // let the tab's editors mount + publish their load state

export function MissingFileWatcher(): null {
  const ws = useWorkspace();
  const warn = useAppSettings().editor.warnOnMissingFile;
  const activeTabId = ws.layout?.activeTabId;
  const prev = useRef<string | undefined>(undefined);
  const report = useReportPanelFailure();
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    // Only react to an actual tab CHANGE (open / re-select) — not every re-render.
    if (activeTabId === prev.current) return;
    prev.current = activeTabId;
    if (!activeTabId || !warn) return;
    const tab = ws.layout?.tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const panels = collectPanels(tab.root).filter((p) => p.kind === EDITOR_KIND);

    const timer = setTimeout(() => {
      const os = window.throng?.osName ?? 'windows';
      for (const { p, st } of panels.map((p) => ({ p, st: getEditorState(p.id) }))) {
        if (!st?.fileMissing) continue;
        reportRef.current({
          panelId: p.id,
          message: missingFileMessage('missing'),
          // The path rides as the row's own detail — copied and logged, never rendered (FR-034).
          detail: missingFileDetail({ filePath: st.filePath, panelName: p.title, reason: 'missing' }, os),
        });
      }
    }, SCAN_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, warn]);

  return null;
}
