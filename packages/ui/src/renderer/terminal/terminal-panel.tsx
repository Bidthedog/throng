import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import type { Panel, TerminalPanelConfig, Theme } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useActiveTheme } from '../config/config-store.js';
import { markTerminalRunning, markTerminalStopped } from '../workspace/subprocess.js';
import { setPanelExit } from './exit-store.js';
import { useTerminal, type TerminalApi } from './use-terminal.js';
import './terminal.css';

/** Build the xterm theme from the active throng terminal colour tokens (FR-030). */
function buildXtermTheme(theme: Theme): Record<string, string> {
  const c = theme.colours;
  return {
    background: c.terminalBg ?? '#0c0f16',
    foreground: c.terminalFg ?? '#d6deea',
    cursor: c.terminalCursor ?? '#6aa3ff',
    selectionBackground: c.terminalSelection ?? '#2a3a57',
  };
}

/** Resolve the themeable terminal font from the terminal typography role (FR-074).
 *  Terminals ARE app-stylable — xterm renders to canvas from these options. */
function terminalFont(theme: Theme): { family: string; size: number } {
  const role = theme.typography?.terminal;
  return {
    family: role?.family && role.family.trim().length > 0 ? role.family : "Consolas, 'Courier New', monospace",
    size: role?.sizePx ?? 14,
  };
}

/**
 * The inline terminal view for a confirmed Terminal Panel (005 / FR-014). Mounts
 * xterm.js (via {@link useTerminal}) bound to the daemon session keyed by the
 * Panel id, themed by the active theme. When the session ends — a clean/unexpected
 * exit or a launch failure — it records the exit info and reverts the Panel to the
 * type-selection form (FR-017/019/020). The session is registered as a running
 * subprocess so Destroy confirmations and `terminal.kill` work (FR-018).
 */
export function TerminalPanel({
  panel,
  projectRoot,
  rootless = false,
  meta,
}: {
  panel: Panel;
  projectRoot: string | null;
  /** Sub-workspace-owned Panel: launch at the user's home directory (FR-028). */
  rootless?: boolean;
  meta?: { projectName?: string; tabName?: string; panelName?: string };
}): ReactElement {
  const ws = useWorkspace();
  const theme = useActiveTheme();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const config = (panel.config ?? {}) as Partial<TerminalPanelConfig>;
  const xtermTheme = useMemo(() => buildXtermTheme(theme), [theme]);
  const font = useMemo(() => terminalFont(theme), [theme]);
  const apiRef = useRef<TerminalApi | null>(null);

  // Right-click → the native (Electron) Copy / Paste menu, instead of the app's
  // Panel context menu. Copy uses the xterm selection; Paste writes the clipboard
  // to the live shell (handled in UI main).
  const onContextMenu = useCallback(
    (e: ReactMouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      void window.throng?.terminal?.contextMenu?.({
        panelId: panel.id,
        selection: apiRef.current?.getSelection() ?? '',
      });
    },
    [panel.id],
  );

  useEffect(() => {
    markTerminalRunning(panel.id);
    return () => markTerminalStopped(panel.id);
  }, [panel.id]);

  const end = useCallback(
    (message: string, code?: number | null, unexpected?: boolean) => {
      setPanelExit(panel.id, { message, code, unexpected });
      markTerminalStopped(panel.id);
      ws.clearPanelType(panel.id); // revert to the type-selection form (FR-020)
    },
    [panel.id, ws],
  );

  const onExit = useCallback(
    ({ code, unexpected }: { code: number | null; unexpected: boolean }) =>
      end(`Terminal exited (code ${code ?? '—'})`, code, unexpected),
    [end],
  );
  const onError = useCallback((message: string) => end(message), [end]);

  useTerminal({
    panelId: panel.id,
    projectId: panel.originProjectId,
    projectRoot,
    rootless,
    runAsAdmin: config.runAsAdmin === true,
    flavourId: config.flavourId ?? '',
    params: config.params ?? '',
    container,
    theme: xtermTheme,
    fontFamily: font.family,
    fontSize: font.size,
    meta,
    onExit,
    onError,
    apiRef,
  });

  return (
    <div
      className="terminal-panel"
      data-testid={`terminal-${panel.id}`}
      ref={setContainer}
      onContextMenu={onContextMenu}
      style={{ background: xtermTheme.background }}
    />
  );
}
