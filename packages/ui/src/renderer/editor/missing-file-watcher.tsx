/**
 * Tab-open "cannot open file" watcher (006, FR-100/105). The missing-file notice is
 * raised HERE — once per tab activation — not inside each editor's mount effect, so:
 *   • all unopenable files on a freshly-(re)opened tab appear in ONE dialog, and
 *   • merely dragging/moving a panel (which remounts an editor without changing the
 *     active tab) never re-warns.
 * Gated by `editor.warnOnMissingFile`. Mounted once per window (in EditorChrome).
 */
import { useEffect, useRef } from 'react';
import { collectPanels, EDITOR_KIND } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useAppSettings } from '../config/config-store.js';
import { getEditorState } from './editor-state.js';
import { showMissingFilesNotice } from './editor-missing-notice.js';

const SCAN_DELAY_MS = 300; // let the tab's editors mount + publish their load state

export function MissingFileWatcher(): null {
  const ws = useWorkspace();
  const warn = useAppSettings().editor.warnOnMissingFile;
  const activeTabId = ws.layout?.activeTabId;
  const prev = useRef<string | undefined>(undefined);

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
      const missing = panels
        .map((p) => ({ p, st: getEditorState(p.id) }))
        .filter((x) => x.st?.fileMissing)
        .map((x) => ({ filePath: x.st!.filePath, panelName: x.p.title, reason: 'missing' }));
      showMissingFilesNotice(missing, os);
    }, SCAN_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, warn]);

  return null;
}
