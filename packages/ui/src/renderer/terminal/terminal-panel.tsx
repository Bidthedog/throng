import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import {
  resolveAction,
  resolveColour,
  zoomFactor,
  panelZoomLevel,
  type Panel,
  type TerminalPanelConfig,
  type Theme,
} from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useActiveTheme, useKeybindings } from '../config/config-store.js';
import { Icon } from '../common/icon.js';
import { markTerminalRunning, markTerminalStopped } from '../workspace/subprocess.js';
import { registerPanelFocus, unregisterPanelFocus } from '../workspace/panel-focus.js';
import { setPanelExit } from './exit-store.js';
import { useTerminal, type TerminalApi } from './use-terminal.js';
import { FindBar } from '../search/find-bar.js';
import { reservedByTerminal } from '../search/search-actions.js';
import { getFindState, updateCount } from '../search/search-store.js';
import type { SearchCount } from '../search/search-model.js';
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
  // Non-fatal "still starting" state (008 FR-005): set when an attach exceeds its budget,
  // cleared when an attach resolves running. `attempt` is bumped by the retry control to
  // re-run the attach (a reattach, idempotent by session reuse) — never a revert or kill.
  const [stillStarting, setStillStarting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const config = (panel.config ?? {}) as Partial<TerminalPanelConfig>;
  const xtermTheme = useMemo(() => buildXtermTheme(theme), [theme]);
  const font = useMemo(() => terminalFont(theme), [theme]);
  // Match highlights are painted by xterm's own decorations, so the colours have to be
  // handed over as values — resolved from the SAME theme tokens the editor's highlights
  // use, so a match looks like a match in either panel type (FR-019).
  const searchDecorations = useMemo(
    () => ({
      matchBackground: resolveColour(theme, 'searchMatch'),
      activeMatchBackground: resolveColour(theme, 'searchMatchCurrent'),
      activeMatchBorder: resolveColour(theme, 'searchMatchCurrentBorder'),
    }),
    [theme],
  );
  // xterm re-reports the result set as output streams in or the buffer is trimmed, so the
  // bar's count stays true to the live scrollback (FR-012).
  const onSearchCount = useCallback(
    (count: SearchCount) => updateCount(panel.id, count),
    [panel.id],
  );
  // Which keys are throng's rather than the shell's — decided per keypress from the LIVE
  // bindings and the LIVE find state, so rebinding find moves the reservation with it
  // (FR-017), and so keys like Escape reach the program whenever no find bar is up.
  const keybindings = useKeybindings();
  const reserveKey = useCallback(
    (e: KeyboardEvent) =>
      reservedByTerminal(
        // The TERMINAL scope, by construction: this reservation runs inside a terminal panel's
        // own key handler. Resolving scope-blind here would let an editor-only command claim a
        // key the shell owns (016, FR-017d).
        resolveAction(
          keybindings,
          { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey },
          'terminal',
        ),
        getFindState().panelId === panel.id,
      ),
    [keybindings, panel.id],
  );
  // Per-panel TERMINAL zoom (012, FR-012 / per-instance): the effective font size is
  // the themed base size × THIS panel's own zoom factor. The grid is computed from
  // this size (not the app-wide global zoom, which raster-scales the rendered
  // result). Rounded to a whole pixel for crisp glyphs.
  const effectiveFontSize = Math.round(font.size * zoomFactor(panelZoomLevel(panel)));
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
  const onStillStarting = useCallback(() => setStillStarting(true), []);
  const onAttached = useCallback(() => setStillStarting(false), []);
  const onRetry = useCallback(() => {
    setStillStarting(false);
    setAttempt((n) => n + 1); // re-run the attach effect → reattach (idempotent by reuse)
  }, []);

  // Register this terminal's focus with the panel-focus registry (012) so keyboard
  // move-focus can route DOM focus into its input surface.
  useEffect(() => {
    const id = panel.id;
    registerPanelFocus(id, () => apiRef.current?.focus());
    return () => unregisterPanelFocus(id);
  }, [panel.id]);

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
    fontSize: effectiveFontSize,
    meta,
    onExit,
    onError,
    onStillStarting,
    onAttached,
    attempt,
    apiRef,
    searchDecorations,
    onSearchCount,
    reserveKey,
  });

  return (
    <div className="terminal-panel-wrap" style={{ background: xtermTheme.background }}>
      <div
        className="terminal-panel"
        data-testid={`terminal-${panel.id}`}
        ref={setContainer}
        onContextMenu={onContextMenu}
        style={{ background: xtermTheme.background }}
      />
      {/* The one shared find bar (013); renders only while find is open on this panel. */}
      <FindBar panelId={panel.id} />
      {stillStarting ? (
        <div
          className="terminal-panel__starting"
          data-testid={`terminal-starting-${panel.id}`}
          role="status"
        >
          <span className="terminal-panel__starting-msg">Terminal is still starting…</span>
          {/* Action control (constitution v3.12.0): a themeable icon (glyph from the
              theme's icon tokens, colours from theme tokens) with a hover title — not a
              text button, not an inline SVG. Retry reattaches to the running session. */}
          <button
            type="button"
            className="terminal-panel__retry"
            title="Retry"
            aria-label="Retry"
            data-testid={`terminal-retry-${panel.id}`}
            onClick={onRetry}
          >
            <Icon token="retry" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
