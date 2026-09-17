/**
 * Main's navigation histories, into THIS window (044 T150; contracts/navigation-history.md §2, §3 Path
 * changes, §6; FR-066, FR-109).
 *
 * Mounted once per window by `EditorChrome` — the main window and every sub-workspace window. Two messages,
 * both broadcast to every window:
 *
 * - **`throng:history:changed { panelId, history }`** — after every change to any panel's history, and on
 *   every attach. Mirrored into `history-store` (what Back / Forward read) and, for a panel this window's
 *   layout holds, into `config.history` (what the layout persists). `history: null` is a purge: the store
 *   forgets the panel and `config.history` is removed.
 * - **`throng:files:moved { moves }`** — main has already rewritten every history it holds (and broadcast
 *   `changed` for each), but a panel in this layout whose record main does not hold — one no window has
 *   attached since a restart — would keep the old paths for ever. So every `config.history` in the layout
 *   is rewritten too.
 *
 * ══ MOUNTED OR NOT ══
 *
 * Only the active tab's panels are mounted, so a per-panel listener could never keep a background tab's
 * persisted history current (the `MovedPathSync` precedent). This walks the LAYOUT instead.
 *
 * ══ SKIP WHAT IS ALREADY TRUE ══
 *
 * `updatePanelConfig` builds a new layout whatever it is given, and each new layout schedules a save. IPC
 * structured-clones every payload, so identity says nothing; values are compared structurally — index,
 * paths and view states, whatever order a view state's keys arrive in — and a panel this window does not
 * hold is never written.
 */
import { useEffect, useRef } from 'react';
import {
  collectPanels,
  rewritePaths,
  serialiseHistory,
  type NavigationHistory,
  type Panel,
  type PersistedHistory,
} from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { sameJson } from '../common/same-json.js';
import { setPanelHistory } from './history-store.js';

function persistedHistoryOf(panel: Panel): PersistedHistory | undefined {
  return (panel.config as { history?: PersistedHistory } | undefined)?.history;
}

/** The same persisted history: the index, and each entry's path and view state (fix round 1, item 8). */
function sameHistory(next: PersistedHistory, current: PersistedHistory | undefined): boolean {
  if (current === undefined || !Array.isArray(current.entries)) return false;
  if (next.index !== current.index || next.entries.length !== current.entries.length) return false;
  return next.entries.every((entry, i) => {
    const other = current.entries[i];
    return other !== undefined && entry.filePath === other.filePath && sameJson(entry.viewState, other.viewState);
  });
}

export function HistoryMirrorSync(): null {
  const ws = useWorkspace();
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(() => {
    const panelsHere = (): Panel[] =>
      (wsRef.current.layout?.tabs ?? []).flatMap((tab) => collectPanels(tab.root) as Panel[]);

    const offChanged = window.throng?.history?.onChanged((evt) => {
      setPanelHistory(evt.panelId, evt.history);
      const panel = panelsHere().find((p) => p.id === evt.panelId);
      if (!panel || panel.kind === undefined) return;
      const current = persistedHistoryOf(panel);
      if (evt.history === null) {
        if (current === undefined) return;
        // The existing merge: an `undefined` key is dropped when the layout is serialised.
        wsRef.current.updatePanelConfig(panel.id, { history: undefined });
        return;
      }
      const next = serialiseHistory(evt.history);
      if (sameHistory(next, current)) return;
      wsRef.current.updatePanelConfig(panel.id, { history: next });
    });

    const offMoved = window.throng?.files?.onMoved?.(({ moves }) => {
      for (const panel of panelsHere()) {
        const current = persistedHistoryOf(panel);
        if (current === undefined || !Array.isArray(current.entries)) continue;
        const asHistory: NavigationHistory = { entries: current.entries, index: current.index };
        const rewritten = rewritePaths(asHistory, moves);
        if (rewritten === asHistory) continue;
        wsRef.current.updatePanelConfig(panel.id, { history: serialiseHistory(rewritten) });
      }
    });

    return () => {
      offChanged?.();
      offMoved?.();
    };
  }, []);

  return null;
}
