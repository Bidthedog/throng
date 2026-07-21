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
import { useContextMenu } from '../context-menu-provider.js';
import { Icon } from '../common/icon.js';
import { markTerminalRunning, markTerminalStopped } from '../workspace/subprocess.js';
import { registerPanelFocus, unregisterPanelFocus } from '../workspace/panel-focus.js';
import { setPanelExit } from './exit-store.js';
import { useTerminal, type TerminalApi } from './use-terminal.js';
import { FindBar } from '../search/find-bar.js';
import { PanelSkeleton, useDelayedFlag } from '../common/loading.js';
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
  const { openMenu } = useContextMenu();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  // Safety net: never let the loading skeleton stick if the attach signal is missed.
  const giveUpSkeleton = useDelayedFlag(4000);
  // Non-fatal "still starting" state (008 FR-005): set when an attach exceeds its budget,
  // cleared when an attach resolves running. `attempt` is bumped by the retry control to
  // re-run the attach (a reattach, idempotent by session reuse) — never a revert or kill.
  const [stillStarting, setStillStarting] = useState(false);
  // Show a themed skeleton over the blank xterm until the session attaches and its
  // scrollback is streamed in, so a switch shows a loading placeholder rather than a
  // blank panel that fills in (issue 132 follow-up).
  const [attached, setAttached] = useState(false);
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

  // Right-click → the app's THEMED context menu (the shared ContextMenu), so the
  // terminal's menu matches every other menu in throng rather than the OS-native
  // Electron menu it used to pop (unstyled, ignoring the theme entirely). The two
  // actions are unchanged: Copy writes the xterm selection to the OS clipboard;
  // Paste writes the clipboard into the live shell. Both go through the renderer
  // seams (terminal.writeClipboard / clipboard.paste + terminal.write) that already
  // exist, so no native menu is needed.
  const onContextMenu = useCallback(
    (e: ReactMouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      // Capture the selection at open time — the menu items act on what was selected
      // when the user right-clicked.
      const selection = apiRef.current?.getSelection() ?? '';
      openMenu(e.clientX, e.clientY, [
        {
          label: 'Copy',
          icon: 'copy',
          disabled: selection.length === 0,
          onClick: () => {
            void window.throng?.terminal?.writeClipboard?.(selection);
          },
        },
        {
          label: 'Paste',
          icon: 'paste',
          // The SAME paste route as Ctrl+V / Shift+Insert (#142): one implementation reads the
          // clipboard and writes it to the shell exactly once, so no gesture can double-paste and
          // the menu can never drift from the keyboard path.
          onClick: () => apiRef.current?.paste(),
        },
      ]);
    },
    [openMenu, panel.id],
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
  // A launch/attach failure (e.g. a non-admin terminal refused while elevated) is
  // an unexpected end, so it surfaces as a red error notice, not a neutral one (#143).
  const onError = useCallback((message: string) => end(message, null, true), [end]);
  const onStillStarting = useCallback(() => setStillStarting(true), []);
  const onAttached = useCallback(() => {
    setStillStarting(false);
    setAttached(true); // session live + scrollback replayed — drop the loading skeleton
  }, []);
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
      {!attached && !giveUpSkeleton && <PanelSkeleton testId={`terminal-skeleton-${panel.id}`} />}
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
