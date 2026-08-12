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
  effectiveActivePanelId,
  formatDroppedPaths,
  terminalLinkTarget,
  firstBinding,
  resolveAction,
  resolveColour,
  zoomFactor,
  captureDecision,
  captureLogLine,
  shouldSurfaceExit,
  terminalExitNotice,
  shouldNotifyCaptureOutcome,
  panelZoomLevel,
  readTerminalPanelConfig,
  startFailurePreservesPanelType,
  causeMessage,
  type FailureCause,
  type Panel,
  type TerminalPanelConfig,
  type Theme,
} from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useNotify } from '../common/notification.js';
import { panelSubject, usePanelPlace } from '../common/panel-subject.js';
import {
  ensureTerminalCommandBridge,
  forgetTerminalCommand,
  peekTerminalCommand,
  useTerminalCommand,
} from './command-store.js';
import { peekTerminalCwd, useTerminalCwd } from './cwd-store.js';
import { requestRedraw } from './redraw.js';
import { useActiveTheme, useKeybindings, useAppSettings } from '../config/config-store.js';
import { TerminalStatusBar } from './terminal-status-bar.js';
import {
  getTreeDrag,
  clearTreeDrag,
  setTreeDropEffect,
  TREE_DROP_EVENT,
  type TreeDropDetail,
} from '../explorer/tree-drag-store.js';
import { useContextMenu } from '../context-menu-provider.js';
import type { MenuItem } from '../workspace/context-menu.js';
import { Icon } from '../common/icon.js';
import { markTerminalRunning, markTerminalStopped } from '../workspace/subprocess.js';
import { useReportPanelFailure } from '../workspace/panel-failure-notice.js';
import { registerPanelFocus, unregisterPanelFocus } from '../workspace/panel-focus.js';
import { clearPanelExit, setPanelExit } from './exit-store.js';
import { useTerminal, type TerminalApi } from './use-terminal.js';
import { FindBar } from '../search/find-bar.js';
import { PanelSkeleton, useDelayedFlag } from '../common/loading.js';
import { reservedByTerminal } from '../search/search-actions.js';
import { getFindState, updateCount } from '../search/search-store.js';
import type { SearchCount } from '../search/search-model.js';
import './terminal.css';

/**
 * The last path segment — the folder's own name (029 FR-017).
 *
 * Notices and panel messages name their subject in PROSE, never by leaning on a path the reader has
 * to parse. `node:path` is not available in the renderer, and this only ever runs on a path throng
 * itself recorded, so a split on both separators is enough.
 */
function lastSegment(absPath: string): string {
  const parts = absPath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? absPath;
}

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
  tabId,
  projectRoot,
  rootless = false,
  meta,
}: {
  panel: Panel;
  /** The tab this terminal lives in — needed to tell whether it is the active panel (issue 144). */
  tabId: string;
  projectRoot: string | null;
  /** Sub-workspace-owned Panel: launch at the user's home directory (FR-028). */
  rootless?: boolean;
  meta?: { projectName?: string; tabName?: string; panelName?: string };
}): ReactElement {
  const ws = useWorkspace();
  const { notify } = useNotify();
  /** Where this panel lives, for any notice raised about it (030 FR-022). Pure over the layout. */
  const place = usePanelPlace(panel.id);
  // Whether this terminal is the active panel of the active tab — read through a ref so the terminal's
  // (async) attach focus sees the CURRENT active panel and never steals focus when it isn't (issue 144).
  const activeTab = ws.layout?.tabs.find((t) => t.id === tabId);
  const isActivePanelRef = useRef(false);
  isActivePanelRef.current =
    ws.layout?.activeTabId === tabId && !!activeTab && effectiveActivePanelId(activeTab) === panel.id;
  const theme = useActiveTheme();
  const { openMenu } = useContextMenu();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  // Safety net: never let the loading skeleton stick if the attach signal is missed.
  const giveUpSkeleton = useDelayedFlag(4000);
  // Non-fatal "still starting" state (008 FR-005): set when an attach exceeds its budget,
  // cleared when an attach resolves running. `attempt` is bumped by the retry control to
  // re-run the attach (a reattach, idempotent by session reuse) — never a revert or kill.
  const [stillStarting, setStillStarting] = useState(false);
  /**
   * The terminal could not START, for a reason that is the ENVIRONMENT's and not the panel's
   * (029 FR-004). Non-null keeps the panel a terminal and shows the failure in place; the panel type
   * and every remembered setting survive untouched.
   */
  const [startFailure, setStartFailure] = useState<{ message: string; cause: FailureCause } | null>(null);
  /**
   * The consolidated raise (030 FR-029), held in a ref.
   *
   * `onError` is memoised on `[end, panel.id]` and is handed to `useTerminal` once; depending on the
   * reporter directly would re-arm the attach on every layout change, which is a re-attach for a
   * panel drag.
   */
  const reportPanelFailure = useReportPanelFailure();
  const reportPanelFailureRef = useRef(reportPanelFailure);
  reportPanelFailureRef.current = reportPanelFailure;
  // Read by the context-menu callback, which is memoised and would otherwise close over a stale
  // value — the menu must offer Retry/Clear based on the state at the moment it OPENS (FR-004d).
  const startFailureRef = useRef(startFailure);
  startFailureRef.current = startFailure;
  // Same reason, and additionally because `clearWithMemory` is declared BELOW the menu callback:
  // a ref is read when the menu opens, not when the callback was built.
  const clearWithMemoryRef = useRef<() => void>(() => {});
  /** A remembered directory that had gone; the terminal started at the project root (FR-005b). */
  const [cwdFallback, setCwdFallback] = useState<string | null>(null);
  // Show a themed skeleton over the blank xterm until the session attaches and its
  // scrollback is streamed in, so a switch shows a loading placeholder rather than a
  // blank panel that fills in (issue 132 follow-up).
  const [attached, setAttached] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const config = (panel.config ?? {}) as Partial<TerminalPanelConfig>;
  const terminalSettings = useAppSettings().terminals;
  const showStatusBar = terminalSettings.showStatusBar;
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
    (e: KeyboardEvent, programOwnsKeyboard: boolean) =>
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
        programOwnsKeyboard,
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
      // 024 US7 (FR-019d): a link under the pointer, with NO active selection, adds "Open Link" /
      // "Copy Link Address" above Copy/Paste. An active selection takes priority — then the menu is
      // the ordinary Copy menu, whatever the pointer is over.
      const link = terminalLinkTarget(selection, apiRef.current?.getHoveredLink() ?? null);
      const linkItems: MenuItem[] = link
        ? [
            {
              // No icon: there is no link/open token, and 023's rule is "an icon only where a token
              // exists". "Copy Link Address" is a copy action, so it carries the shared copy glyph.
              label: 'Open Link',
              testId: 'menu-item-Open Link',
              onClick: () => window.throng?.openExternal?.(link),
            },
            {
              label: 'Copy Link Address',
              icon: 'copy',
              testId: 'menu-item-Copy Link Address',
              onClick: () => void window.throng?.terminal?.writeClipboard?.(link),
            },
            { separator: true },
          ]
        : [];
      openMenu(e.clientX, e.clientY, [
        ...linkItems,
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
          // The paste chord is FIXED (Ctrl+V / Shift+Insert, #142) and lives in the terminal key
          // handler, not the rebindable keybindings — so the shortcut shown is the literal native
          // chord, matching what the user presses. Copy has no chord of its own (Ctrl+C is the
          // shell's interrupt), so it carries no shortcut.
          shortcut: 'Ctrl+V',
          // The SAME paste route as Ctrl+V / Shift+Insert (#142): one implementation reads the
          // clipboard and writes it to the shell exactly once, so no gesture can double-paste and
          // the menu can never drift from the keyboard path.
          onClick: () => apiRef.current?.paste(),
        },
        { separator: true },
        {
          // 028 (issue 163) — the deliberate version of the divider nudge users discovered by
          // accident. It asks the running program to redraw: no content, scrollback, selection,
          // cursor, focus or layout changes, and nothing is typed at the shell.
          label: 'Refresh / redraw terminal',
          testId: 'menu-item-Refresh / redraw terminal',
          shortcut: firstBinding(keybindings, 'terminal.redraw'),
          onClick: () => requestRedraw(panel.id, 'manual'),
        },
        /*
         * 029 FR-004d — Retry and Clear as MENU ITEMS, not only as icons on the failure badge.
         *
         * The Constitution binds a feature that adds a panel action to add its menu item in the same
         * increment, and FR-004a makes clearing a panel user-invoked for the first time: until now
         * `clearPanelType` only ever ran automatically, as a side effect of a terminal ending. An
         * action reachable solely by an icon on a transient badge is exactly the invisibility that
         * rule exists to prevent.
         *
         * Shown only while a start failure is live, because that is the only state in which either
         * is meaningful — offering "Try again" to a healthy terminal would be noise. The menu itself
         * IS reachable in that state: its `onContextMenu` sits on a div rendered unconditionally, and
         * the failure badge is a sibling of that div rather than a cover.
         */
        ...(startFailureRef.current
          ? ([
              { separator: true },
              {
                label: 'Try again',
                testId: 'menu-item-Try again',
                // Inlined rather than reusing `onRetry`, which is declared below this callback —
                // and read through a ref rather than a dependency, so opening the menu always sees
                // the CURRENT failure state instead of whatever it was when the callback was made.
                onClick: () => {
                  setStillStarting(false);
                  setStartFailure(null);
                  setAttempt((n) => n + 1);
                },
              },
              {
                label: 'Clear panel type',
                testId: 'menu-item-Clear panel type',
                onClick: clearWithMemoryRef.current,
              },
            ] as MenuItem[])
          : []),
      ]);
    },
    [openMenu, panel.id, keybindings],
  );

  useEffect(() => {
    markTerminalRunning(panel.id);
    return () => markTerminalStopped(panel.id);
  }, [panel.id]);

  // 024 US2 (#155): drop a file/folder from Files & Folders onto this terminal → insert its path(s)
  // at the shell cursor, followed by a trailing space with the cursor left BEFORE it (the ESC[D
  // Left-arrow), and never submit the line (FR-004b). Reachable natively (real drag) and via the
  // throng:tree-drop CustomEvent (the e2e seam, mirroring throng:os-drop).
  const insertDroppedPaths = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    apiRef.current?.write(`${formatDroppedPaths(paths)} [D`);
  }, []);
  useEffect(() => {
    const onTreeDrop = (e: Event): void => {
      const detail = (e as CustomEvent<TreeDropDetail>).detail;
      if (detail?.panelId === panel.id) insertDroppedPaths(detail.paths);
    };
    window.addEventListener(TREE_DROP_EVENT, onTreeDrop);
    return () => window.removeEventListener(TREE_DROP_EVENT, onTreeDrop);
  }, [panel.id, insertDroppedPaths]);

  // 025 FR-002d: read through the migrating reader so a Panel persisted before this feature
  // (which spelled it `params`) still launches with its shell arguments intact.
  const rawConfig = readTerminalPanelConfig(config as Record<string, unknown>);

  // 025 FR-019 — resolve a STRANDED observation during render, before the launch reads it.
  //
  // A panel whose terminal died without ending cleanly (app close with "terminate all", a daemon
  // kill, a crash) still carries its last observation. Resolving that only in an effect would be
  // too late: `useTerminal` below has already launched with the OLD command, so the recovered one
  // would not take effect until the restart AFTER this one — which is exactly the case the user
  // cares about. Doing it here is pure (`captureDecision` takes data and returns data) and makes
  // the very first reopen correct; the effect below only persists what this decided.
  // Read ONCE, at mount. `observedCommand` is rewritten continuously while the terminal runs, so
  // reading it live would treat every ordinary observation as a stranded one — recovering a
  // command from a terminal that never ended, and clearing the observation the moment it appeared.
  // What makes a value "stranded" is that it was already there when this terminal mounted.
  const strandedAtMount = useRef(panel.terminalMemory?.observedCommand);
  const stranded = strandedAtMount.current;
  const recovered =
    stranded === undefined || stranded === null
      ? null
      : captureDecision(rawConfig.rememberCommand, rawConfig.startupCommand, stranded);
  const recoveredValue = recovered?.save === true ? recovered.value : undefined;
  const {
    shellArguments,
    startupCommand: savedStartupCommand,
    rememberCommand,
    rememberDirectory,
  } = rawConfig;
  // Memoised over its primitive parts: `end()` below depends on this, and a fresh object each
  // render would re-create that callback (and everything keyed on it) every time.
  const terminalConfig = useMemo(
    () => ({
      shellArguments,
      startupCommand: recoveredValue ?? savedStartupCommand,
      rememberCommand,
      rememberDirectory,
    }),
    [shellArguments, savedStartupCommand, rememberCommand, rememberDirectory, recoveredValue],
  );

  // 025 FR-025 — and PERSIST what the recovery decided, so the Panel's settings agree with it.
  //
  // Resolving the stranded observation above fixes the LAUNCH, but on its own it leaves the saved
  // Startup Command showing the old value: the promotion used to happen only in `end()`, and on
  // the path that strands an observation in the first place — app close with "terminate all", a
  // daemon kill, a crash — `end()` never runs. So the terminal relaunched with the recovered
  // command while the settings still showed the previous one, and every subsequent restart had to
  // recover it again. FR-025 requires the two to agree: what was captured must be what the Panel
  // shows.
  //
  // Clearing `observedCommand` is part of the same write. It marks the recovery resolved, so the
  // next mount does not treat an already-handled end as a fresh one.
  //
  // Scope, stated plainly: the two-run E2E beside this passes on the ORDERLY end path without this
  // effect, because `end()` promotes there. What this covers is the path `end()` misses entirely —
  // a daemon kill or a crash, where the observation is stranded and only a later mount can resolve
  // it. That has no E2E, so this is reasoned rather than proven.
  const persistedRecovery = useRef(false);
  useEffect(() => {
    if (recoveredValue === undefined) return;
    if (persistedRecovery.current) return; // one write per mount — see the write-loop note above
    persistedRecovery.current = true;
    ws.setTerminalMemory(panel.id, { startupCommand: recoveredValue, observedCommand: undefined });
  }, [panel.id, recoveredValue, ws]);

  // 025 — arm the command bridge as this terminal mounts, and drop whatever the panel's PREVIOUS
  // terminal left behind. Both matter: subscribing lazily at capture time meant the first capture
  // of every session saw nothing, and a retained value from an earlier terminal could be promoted
  // into a later one that never ran it (FR-017).
  useEffect(() => {
    ensureTerminalCommandBridge();
    forgetTerminalCommand(panel.id);

    // FR-019 / US2 scenario 7 — an abrupt end (app crash, daemon crash, machine restart) never
    // reaches `end()`, so a value persisted only at teardown would be lost exactly when continuous
    // tracking was supposed to save it. A stranded `observedCommand` on mount therefore means the
    // previous terminal died without ending cleanly; resolve it through the ordinary rule now.
    if (recovered !== null) {
      console.info(captureLogLine(panel.id, recovered));
      ws.setTerminalMemory(panel.id, {
        observedCommand: undefined,
        ...(recovered.save ? { startupCommand: recovered.value } : {}),
      });
    }
    // Only on mount/relaunch: re-running this on every memory write would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id, attempt]);

  // Persist the observation as it changes, so it survives a death that never runs `end()`.
  //
  // Both of these effects write ONLY on a genuine change, tracked in a ref.
  //
  // That is not an optimisation, it is what makes them work at all: writing memory changes the
  // layout, which changes the workspace context's identity, which re-runs the effect, which writes
  // again. The write itself is idempotent, so the loop is invisible — but each write reschedules
  // the debounced layout save, so the save is pushed back forever and NOTHING is ever persisted.
  // That is precisely why directory memory appeared to do nothing at all.
  const lastPersistedCommand = useRef<string | null | undefined>(undefined);
  const observedNow = useTerminalCommand(panel.id);
  useEffect(() => {
    if (!terminalConfig.rememberCommand) return;
    if (observedNow === undefined) return;
    if (lastPersistedCommand.current === observedNow) return;
    lastPersistedCommand.current = observedNow;
    ws.setTerminalMemory(panel.id, { observedCommand: observedNow });
  }, [panel.id, observedNow, terminalConfig.rememberCommand, ws]);

  // FR-027 — persist the working directory AS IT CHANGES, for the same reason.
  //
  // Writing it only in `end()` made directory memory fail on the path that matters most: on app
  // close with "terminate all", UI-main awaits `terminal.killAll` (which returns when the DAEMON
  // has killed the PTYs) and then drains the windows — the renderer's exit handler frequently
  // never runs in between, so nothing was ever recorded. Persisting continuously removes the
  // ordering dependency entirely, which is also what makes it survive a daemon or machine kill.
  //
  // Not gated on the memory checkbox: directory memory is unconditional (FR-027a).
  const lastPersistedCwd = useRef<string | undefined>(undefined);
  const cwdNow = useTerminalCwd(panel.id);
  useEffect(() => {
    if (!terminalConfig.rememberDirectory) return;
    if (!cwdNow) return;
    if (lastPersistedCwd.current === cwdNow) return; // see the note above — this guard is load-bearing
    lastPersistedCwd.current = cwdNow;
    ws.setTerminalMemory(panel.id, { lastCwd: cwdNow });
  }, [panel.id, cwdNow, terminalConfig.rememberDirectory, ws]);

  const end = useCallback(
    (message: string, code?: number | null, unexpected?: boolean) => {
      // A clean exit the user asked for says nothing worth a notice. Typing `exit` and being told
      // "Terminal exited (code 0)" reports back what you just did, and trains people to dismiss
      // notices without reading them — which is exactly when a real failure gets missed.
      //
      // Constitutional Principle III requires surfacing an exit that is UNEXPECTED, with its code.
      // That is untouched: a crash, a non-zero exit, or a launch/attach failure still raises its
      // notice. Only the deliberate, successful case is silent.
      // The rule lives in core so it is testable, and so this cannot silently regress again:
      // the previous attempt gated on `unexpected`, which is set for a typed `exit` too, so it
      // never fired.
      if (!shouldSurfaceExit(code)) clearPanelExit(panel.id);
      else setPanelExit(panel.id, { message, code, unexpected });
      markTerminalStopped(panel.id);

      // 025 — the capture point. This runs for EVERY way a terminal ends (user close/kill,
      // panel destroy, project close, "terminate all", the shell exiting on its own), which is
      // exactly the set FR-020 requires, and it happens BEFORE clearPanelType so the config is
      // still readable. `clearPanelType` then preserves `terminalMemory` on the way past.
      const observed = peekTerminalCommand(panel.id);
      const decision = captureDecision(
        terminalConfig.rememberCommand,
        terminalConfig.startupCommand,
        // `undefined` means nothing was ever observed, which is NOT the same as "idle" — treating
        // it as idle is harmless here (both leave the saved command alone), but conflating them
        // would be wrong if the rule ever changes.
        observed ?? null,
      );
      const memory: Record<string, unknown> = {
        flavourId: config.flavourId,
        shellArguments: terminalConfig.shellArguments,
        rememberCommand: terminalConfig.rememberCommand,
        rememberDirectory: terminalConfig.rememberDirectory,
      };
      // FR-026a: every outcome is logged, including the no-ops, so "it forgot my command" is
      // answerable from the log alone. FR-026d: this is fire-and-forget — nothing here may delay
      // the terminal's teardown.
      console.info(captureLogLine(panel.id, decision));
      if (shouldNotifyCaptureOutcome(decision)) {
        // FR-026b: the only failure the terminal itself never reports — a command WAS running and
        // could not be stored. Anything the shell already printed on screen is deliberately not
        // repeated here.
        notify({
          severity: 'warning',
          title: 'Command not remembered',
          /*
           * 030 US2 — THE PANEL, not the terminal (FR-022 rather than FR-026).
           *
           * What failed is a write to the PANEL's `terminalMemory`, which is why that memory
           * deliberately outlives the terminal that produced it. Naming the flavour here would mean
           * resolving its label, and the only route to a label from this component is
           * `listFlavours`, which re-detects installed shells on every call — a filesystem probe per
           * terminal panel mount, for a string this notice's own `title` already outranks in the
           * heading and which would therefore only ever reach the log record.
           */
          subject: panelSubject(place),
          // FR-025/FR-034 — "this terminal" named nothing a user could act on, and the subject now
          // says which panel it was. What is left is the fact: a command was running and was lost.
          message:
            'The command that was running could not be saved as the startup command. The previous value is unchanged.',
          testId: 'notice-capture-failed',
        });
      }
      // FR-017 — "left exactly as it was" means the USER'S configured command survives a teardown
      // where nothing was running. Writing it only on a capture would silently drop what they
      // typed the moment they stopped their command, so the configured value is always carried
      // and a capture overwrites it.
      memory.startupCommand = decision.save ? decision.value : terminalConfig.startupCommand;
      // Resolved — clear the raw observation so the next mount does not treat this clean end as a
      // crash and re-apply it.
      memory.observedCommand = undefined;
      // FR-027: the directory is remembered unconditionally — it is independent of the
      // command-memory checkbox, and cannot execute anything.
      const lastCwd = peekTerminalCwd(panel.id);
      if (lastCwd) memory.lastCwd = lastCwd;
      ws.setTerminalMemory(panel.id, memory);

      ws.clearPanelType(panel.id); // revert to the type-selection form (FR-020)
    },
    [panel.id, ws, config.flavourId, terminalConfig, notify, place],
  );

  // A failure notice arrives AFTER the Panel has reverted to its type-selection form, so there is
  // nothing left on screen tying it to a terminal. With several open, "Terminal exited (code 1)"
  // names no terminal at all — the identity has to travel with the message.
  const onExit = useCallback(
    ({ code, unexpected }: { code: number | null; unexpected: boolean }) =>
      end(
        terminalExitNotice(code, {
          projectName: meta?.projectName,
          tabName: meta?.tabName,
          panelName: meta?.panelName ?? panel.title,
          flavourLabel: config.flavourLabel,
        }),
        code,
        unexpected,
      ),
    [end, meta, panel.title, config.flavourLabel],
  );
  /**
   * A start failure (029 / #204, FR-001 → FR-003).
   *
   * ══ THE SPLIT ══
   *
   * This used to be `end(message, null, true)` unconditionally — one line, and the whole of #204.
   * `end()` finishes with `clearPanelType`, which strips the panel's `kind` and writes that stripped
   * layout to the store. So a project folder that was briefly renamed away deleted the user's
   * terminal configuration PERMANENTLY: put the folder back, reopen, and the panel is an
   * unconfigured form that never becomes a terminal again.
   *
   * Now the CAUSE decides:
   *
   *   • transient (a folder missing, held, or refused) → keep the panel type, show the failure in
   *     place with Retry and Clear. The configuration survives because nothing was ever wrong with
   *     it — the environment was;
   *   • unsatisfiable or unclassified (a flavour that no longer resolves) → `end()` as before, so
   *     the user can choose again. That arm is deliberately asserted by
   *     `terminal-persistence.e2e.ts:81` and must not change.
   *
   * A failure that ends a RUNNING shell is untouched by this — it arrives via `onExit` (FR-002).
   */
  /**
   * Clear a panel the user no longer wants a terminal in (029 FR-004a) — remembering its settings
   * on the way out.
   *
   * The remembering is not incidental. Before 029, a failed start ran `end()`, which wrote
   * `terminalMemory` and only then cleared the type, so the type-selection form came back
   * PRE-FILLED with the flavour and arguments the user had chosen. Keeping the panel type (FR-001)
   * means `end()` no longer runs on that path — so clearing without this would hand the user an
   * empty form and quietly lose the settings that #204 is about preserving. Measured:
   * `terminalMemory:false` in the layout after the fix, where it had been `true`.
   */
  const clearWithMemory = useCallback(() => {
    ws.setTerminalMemory(panel.id, {
      flavourId: config.flavourId,
      shellArguments: terminalConfig.shellArguments,
      rememberCommand: terminalConfig.rememberCommand,
      rememberDirectory: terminalConfig.rememberDirectory,
      startupCommand: terminalConfig.startupCommand,
    });
    ws.clearPanelType(panel.id);
  }, [ws, panel.id, config.flavourId, terminalConfig]);
  clearWithMemoryRef.current = clearWithMemory;

  const onError = useCallback(
    (message: string, cause?: FailureCause) => {
      if (startFailurePreservesPanelType(cause ?? null)) {
        setStartFailure({ message: causeMessage(cause as FailureCause), cause: cause as FailureCause });
        /*
         * 030 US3 (FR-029/FR-038) — AND SAY SO ONCE, FOR THE WHOLE PROJECT.
         *
         * The badge above stays exactly as it is: it is this panel's own statement, and FR-038 says
         * consolidation changes the notice count and nothing else. What it cannot do is tell a user
         * looking at ONE panel that five others are broken too — a project whose root folder went
         * away produces a badge per terminal and, before this, no notice at all, so the user found
         * out by visiting each panel in turn.
         *
         * The cause is passed through rather than re-derived: it is the daemon's, it decided the
         * panel type survives, and it is the key by which the file tree's report of the same absent
         * folder is superseded rather than shown alongside.
         */
        reportPanelFailureRef.current({
          panelId: panel.id,
          message: causeMessage(cause as FailureCause),
          detail: (cause as FailureCause).raw,
          cause: cause as FailureCause,
        });
        setStillStarting(false);
        // Drop the loading skeleton NOW. It renders while `!attached && !giveUpSkeleton`, and
        // `giveUpSkeleton` is a 4000ms delayed flag — a panel that failed to start never attaches,
        // so without this the failure sits under an opaque "loading" cover for four seconds. That is
        // not "presenting the failure in place" (FR-004).
        setAttached(true);
        markTerminalStopped(panel.id);
        return;
      }
      end(message, null, true);
    },
    [end, panel.id],
  );
  const onStillStarting = useCallback(() => setStillStarting(true), []);
  const onAttached = useCallback((cwdFallback?: string) => {
    setStillStarting(false);
    setStartFailure(null); // a working attach clears any start failure this panel was showing
    /*
     * 029 FR-005b — the terminal started, but NOT where it was asked to.
     *
     * Information, not a failure: the shell is live and nothing was lost, so this never becomes an
     * error notice. But it must not be silent either — a user who left a shell deep in a subtree and
     * finds one at the root, with no explanation, reasonably concludes that remember-my-directory is
     * broken. Naming the folder is the difference between a fallback and a bug.
     */
    setCwdFallback(cwdFallback ?? null);
    setAttached(true); // session live + scrollback replayed — drop the loading skeleton
  }, []);
  const onRetry = useCallback(() => {
    setStillStarting(false);
    // 029 FR-004c: this retries THIS panel and nothing else. No retry-all, and a success here does
    // not cascade into other failed panels — reopening the project is already the bulk path.
    setStartFailure(null);
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
    shellArguments: terminalConfig.shellArguments,
    startupCommand: terminalConfig.startupCommand,
    // 025 FR-028: reopen where this panel was last working, not always at the project root.
    rememberedCwd: terminalConfig.rememberDirectory ? panel.terminalMemory?.lastCwd : undefined,
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
    linkHoverDelayMs: terminalSettings.linkHoverDelayMs,
    isActive: () => isActivePanelRef.current,
  });

  return (
    <div className="terminal-panel-wrap" style={{ background: xtermTheme.background }}>
      <div
        className="terminal-panel"
        data-testid={`terminal-${panel.id}`}
        ref={setContainer}
        onContextMenu={onContextMenu}
        // 024 US2: accept a tree drag (its paths are in the shared drag store); a real drop inserts
        // them at the shell cursor. An OS 'Files' drag is not ours — leave it alone.
        onDragOver={(e) => {
          if (getTreeDrag()) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            // State the intent for the window-level re-assert too (see setTreeDropEffect): a
            // terminal takes any tree drag, files and folders alike, as text at the prompt.
            setTreeDropEffect('copy');
          }
        }}
        onDrop={(e) => {
          const drag = getTreeDrag();
          if (!drag) return;
          e.preventDefault();
          insertDroppedPaths(drag.paths);
          clearTreeDrag();
        }}
        style={{ background: xtermTheme.background }}
      />
      {!attached && !giveUpSkeleton && <PanelSkeleton testId={`terminal-skeleton-${panel.id}`} />}
      {/* The one shared find bar (013); renders only while find is open on this panel. */}
      <FindBar panelId={panel.id} />
      {/*
        029 FR-004 — the terminal could not START, and the panel says so IN PLACE rather than
        dissolving into an unconfigured form. Same shape as the "still starting" badge because it is
        the same kind of news: non-fatal, actionable, and belonging to this panel.
      */}
      {startFailure ? (
        <div
          className="terminal-panel__starting"
          data-testid={`terminal-start-failed-${panel.id}`}
          role="status"
        >
          <span className="terminal-panel__starting-msg">{startFailure.message}</span>
          {/* Action controls (Principle VI): themeable icons with hover titles, never text buttons. */}
          <button
            type="button"
            className="terminal-panel__retry"
            title="Try again"
            aria-label="Try again"
            data-testid={`terminal-retry-${panel.id}`}
            onClick={onRetry}
          >
            <Icon token="retry" />
          </button>
          {/*
            FR-004a — the escape hatch that preserving the panel type takes away.
            Before 029 a failed start reverted the panel for you; now it does not, so a user who no
            longer wants a terminal here must be able to SAY so, without destroying the panel and
            losing its position and title. Clearing becomes their decision instead of a side effect
            of a folder being briefly unavailable — which is the whole distinction this feature draws.
          */}
          <button
            type="button"
            className="terminal-panel__retry"
            title="Clear panel type"
            aria-label="Clear panel type"
            data-testid={`terminal-clear-${panel.id}`}
            onClick={clearWithMemory}
          >
            <Icon token="dismiss" />
          </button>
        </div>
      ) : null}
      {cwdFallback ? (
        <div
          className="terminal-panel__starting"
          data-testid={`terminal-cwd-fallback-${panel.id}`}
          role="status"
        >
          <span className="terminal-panel__starting-msg">
            Started in the project root — "{lastSegment(cwdFallback)}" no longer exists.
          </span>
          <button
            type="button"
            className="terminal-panel__retry"
            title="Dismiss"
            aria-label="Dismiss"
            data-testid={`terminal-cwd-fallback-dismiss-${panel.id}`}
            onClick={() => setCwdFallback(null)}
          >
            <Icon token="dismiss" />
          </button>
        </div>
      ) : null}
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
      {/* 024 US1 (FR-001/001b): the new terminal status bar, preference-controlled. Shows the shell
          flavour label; no wrap control this feature (terminal wrap descoped to #169, FR-003e). */}
      {showStatusBar && (
        <TerminalStatusBar panelId={panel.id} flavourLabel={config.flavourLabel ?? 'Terminal'} />
      )}
    </div>
  );
}
