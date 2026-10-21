import { useEffect, useRef, useState } from 'react';
import { collectPanels, type FocusReport, type WorkspaceLayout } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useActivePane, type ActivePane } from '../workspace/active-pane.js';
import { useWindowFocus } from '../workspace/use-window-focus.js';
import { currentPanelTitle } from '../workspace/use-panel-display-names.js';
import { useTerminalTitleVersion } from '../terminal/title-store.js';
import { useEditorStateVersion } from '../editor/editor-state.js';
import { ensureAttentionBridge } from './attention-store.js';

/**
 * Everything one report is built from. Pure, so the shape is checkable without a window.
 *
 * `windowId` is left at 0: the renderer cannot know its webContents id, and main stamps the sender's
 * onto the report it receives (contracts/app-attention.md).
 */
export function buildFocusReport(input: {
  layout: WorkspaceLayout | null;
  windowFocused: boolean;
  pane: ActivePane;
  /** The panel host the DOM's focus is inside, regardless of which pane is active. */
  domFocusedPanelId: string | null;
}): FocusReport {
  const { layout } = input;
  return {
    windowId: 0,
    windowFocused: input.windowFocused,
    // FR-004: keyboard focus counts only inside the workspace pane. In the Files or Projects pane the
    // user is looking at a list, not at a panel, even when a panel's box is still under the cursor.
    focusedPanelId: input.pane === 'workspace' ? input.domFocusedPanelId : null,
    hostedPanels:
      layout?.tabs.flatMap((t) =>
        collectPanels(t.root).map((p) => ({
          panelId: p.id,
          projectId: p.originProjectId,
          title: currentPanelTitle(p),
          tabTitle: t.title, // FR-100: a mark names the tab it is on
        })),
      ) ?? [],
  };
}

/** The panel whose host element holds DOM focus, or null. `data-panel-host` is emitted only by the panel itself. */
export function panelHoldingFocus(): string | null {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  return active instanceof Element ? (active.closest('[data-panel-host]')?.getAttribute('data-panel-host') ?? null) : null;
}

/**
 * Tells main what this window shows and where focus is (057 R5, contracts/app-attention.md
 * `throng:attention:focus`), so main can apply "attended panels never get a mark" (FR-004) at the
 * moment of a raise, clear on focus (FR-005) and run the clear delay (FR-006).
 *
 * Coalesced to one report per animation frame, and only when something the report carries changed
 * (Principle XII: a focus change is an input path, and this does no layout read — only DOM focus,
 * which the browser already tracks).
 */
export function FocusReporter(): null {
  const ws = useWorkspace();
  const pane = useActivePane();
  const windowFocused = useWindowFocus();
  // A title is read live by `currentPanelTitle`; these re-render the reporter when one changes.
  useTerminalTitleVersion();
  useEditorStateVersion();
  const [domFocusedPanelId, setDomFocused] = useState<string | null>(panelHoldingFocus);

  useEffect(() => {
    ensureAttentionBridge();
    const update = (): void => setDomFocused(panelHoldingFocus());
    update();
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);

  const report = buildFocusReport({ layout: ws.layout, windowFocused, pane, domFocusedPanelId });
  const key = JSON.stringify(report);

  const latest = useRef(report);
  latest.current = report;
  const lastSent = useRef<string | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (key === lastSent.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const now = JSON.stringify(latest.current);
      if (now === lastSent.current) return;
      lastSent.current = now;
      window.throng?.attention?.reportFocus(latest.current);
    });
  }, [key]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  return null;
}
