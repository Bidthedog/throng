import { useEffect, useRef, type MutableRefObject } from 'react';
import {
  THRONG_THEME,
  createKittyKeyboardState,
  applyKittyCsi,
  applyDecPrivateMode,
  applicationReadingInput,
  createMouseReportingState,
  kittyKeyboardActive,
  win32InputActive,
  decideWheel,
  encodeEnterKey,
  encodeModifiedKey,
  type KittyCsiPrefix,
} from '@throng/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';

/**
 * Open a terminal link in the system browser (024 US7, #159). Activation requires Ctrl (Cmd on
 * macOS) — matching VS Code's terminal, Windows Terminal and iTerm2 (FR-019c) — so a plain click
 * keeps its terminal meaning. Only http(s) is routed out (FR-019); the main-process open-external
 * seam re-validates and denies any in-app window. Shared by OSC 8 links and plain-text detection.
 */
function openTerminalLink(event: MouseEvent, uri: string): void {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (!/^https?:\/\//i.test(uri)) return;
  window.throng?.openExternal?.(uri);
}
import { registerPanelSearch, unregisterPanelSearch } from '../search/search-controller.js';
import {
  createTerminalSearchController,
  type TerminalSearchDecorations,
} from '../search/terminal-search.js';
import type { FailureCause } from '@throng/core';
import type { SearchCount } from '../search/search-model.js';
import { shouldDropScrollback } from './clear-detect.js';
import { saveTerminalViewState, takeTerminalViewState } from './terminal-view-state.js';
import { parseOsc52 } from './osc52.js';
import { reportTerminalCwd } from './cwd-store.js';
import { setTerminalTitle, clearTerminalTitle } from './title-store.js';
import { TerminalOutputGate } from './output-gate.js';
import { consumeExplicitRetype } from './explicit-retype.js';
import { clearKeyboardMode, peekKeyboardMode, saveKeyboardMode } from './keyboard-mode-store.js';
import {
  countInputAcked,
  countInputWritten,
  countReconcile,
  forgetDiagnostics,
  recordKeyDecision,
  recordKeyBytes,
  recordWrite,
  recordModeEvent,
} from './diagnostics.js';
import { requestRedraw, registerTerminalRefresh } from './redraw.js';
import { registerTerminalFocus, unregisterTerminalFocus } from './focus-registry.js';

/**
 * How long a link `leave` waits before the hover tip is actually hidden (024 US7 follow-up). Long
 * enough to absorb the leave/hover pair a re-render produces under a motionless pointer, short
 * enough that a pointer genuinely moving off a link sees the tip go at once.
 */
const LINK_TIP_LEAVE_GRACE_MS = 250;

export interface TerminalExit {
  code: number | null;
  unexpected: boolean;
}

/** Imperative handle exposed for the right-click menu (current text selection). */
export interface TerminalApi {
  getSelection(): string;
  /** Move DOM focus into the terminal's input surface (012, move-focus). */
  focus(): void;
  /**
   * Paste the OS clipboard into the live shell exactly once (#142). The single paste route shared
   * by Ctrl+V, Shift+Insert and the right-click menu — see the paste handling in the mount effect.
   */
  paste(): void;
  /**
   * Write text straight to the shell's input, as if pasted (024 US2, #155 — a dropped path). The
   * caller composes the exact bytes (e.g. a trailing space + a Left-arrow to sit the cursor before
   * it, FR-004b); this just routes them to the pty and restores focus.
   */
  write(text: string): void;
  /**
   * The http(s) URL currently under the pointer (an OSC 8 or detected plain-text link), or null
   * (024 US7, FR-019d). Read at right-click time so the context menu can offer "Open Link".
   */
  getHoveredLink(): string | null;
}

/**
 * A paste chord: Ctrl+V or Shift+Insert (#142). Ctrl+Shift+V and Alt combinations are left to the
 * shell. `e.key` is `'v'` (no Shift) but we accept `'V'` defensively; Shift+Insert reports `'Insert'`.
 */
function isPasteChord(e: KeyboardEvent): boolean {
  if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) return true;
  if (e.shiftKey && !e.ctrlKey && !e.altKey && e.key === 'Insert') return true;
  return false;
}

export interface UseTerminalOptions {
  panelId: string;
  projectId: string;
  projectRoot: string | null;
  /** Sub-workspace-owned Panel: launch at the user's home directory (FR-028). */
  rootless?: boolean;
  /** Run the terminal elevated ("as administrator", FR-025). */
  runAsAdmin?: boolean;
  flavourId: string;
  shellArguments: string;
  /** 025 FR-001: a command the shell runs on cold start. */
  startupCommand: string;
  /** 025 FR-028: the directory this panel last worked in, if it remembered one. */
  rememberedCwd?: string;
  /** 033 FR-033: where this panel was CREATED to start — set when it was opened from the tree.
   *  Only consulted when nothing has been remembered; main resolves both by the same rules. */
  startDirectory?: string;
  /** The DOM node to mount xterm into. */
  container: HTMLElement | null;
  /** xterm theme built from the active throng theme tokens. */
  theme: Record<string, string>;
  /** Themeable terminal font (006, FR-074) — resolved from the terminal typography role. */
  fontFamily: string;
  fontSize: number;
  /** Display labels sent on attach for the app-close warning details (FR-015). */
  meta?: { projectName?: string; tabName?: string; panelName?: string };
  /** Called when the terminal process ends (revert to the form, FR-020). */
  onExit: (exit: TerminalExit) => void;
  /** Called when (re)attach fails — bad params, missing flavour, etc. (FR-019). */
  /**
   * Carries the daemon-classified CAUSE where there is one (029, FR-003).
   *
   * The panel needs it to decide whether to keep its type: a folder briefly away is transient and
   * the configuration must survive, while a flavour that no longer resolves is a choice the user
   * must remake. A bare string could not tell those apart, which is #204.
   */
  onError: (message: string, cause?: FailureCause) => void;
  /**
   * Called when the attach exceeds its budget (008 FR-005). NON-fatal: the session may
   * still be launching, so the view shows a "still starting" state with a retry — it does
   * NOT revert to the form (that is {@link onError}) and does NOT kill the session.
   */
  onStillStarting?: () => void;
  /**
   * Called when an attach resolves as running — clears any "still starting" state.
   *
   * `cwdFallback` names a remembered directory that no longer exists, when the terminal started at
   * the project root because of it (029 FR-005b). The terminal WORKS; this is information, not a
   * failure, and must never be presented as one.
   */
  onAttached?: (cwdFallback?: string) => void;
  /**
   * Retry counter (008 FR-005). Bumping it re-runs the attach effect, reattaching to the
   * (already-running) session — idempotent by session reuse — so a still-starting view can
   * recover without reverting or replacing.
   */
  attempt?: number;
  /** Populated with an imperative handle to the live terminal (for the menu). */
  apiRef?: MutableRefObject<TerminalApi | null>;
  /**
   * Match-highlight colours for in-terminal find (013, FR-019), resolved from theme
   * tokens by the panel. Search is registered only when supplied.
   */
  searchDecorations?: TerminalSearchDecorations;
  /** The live match count, as xterm re-evaluates it against the growing buffer (FR-012). */
  onSearchCount?: (count: SearchCount) => void;
  /** 024 US7 (#159 follow-up): ms the pointer must rest on a link before the hover tip shows.
   *  Read live so a preferences change takes effect without remounting the terminal. */
  linkHoverDelayMs?: number;
  /**
   * True for a key that belongs to throng (find, scrollback navigation) rather than to
   * the shell. xterm would otherwise handle these itself and write them to the pty;
   * reserving them is what keeps them out of the running program (FR-010 / FR-014).
   */
  reserveKey?: (e: KeyboardEvent, programOwnsKeyboard: boolean) => boolean;
  /**
   * Whether this terminal is the ACTIVE panel of the active tab, read at focus time (issue 144).
   *
   * A terminal used to `term.focus()` unconditionally on mount AND on attach (the latter fires late,
   * after an async round-trip), so switching to a tab that merely CONTAINS a terminal handed keyboard
   * focus to that terminal regardless of which panel was active — the last-mounting/last-attaching
   * terminal always won. Gating both focus calls on this predicate means only the active panel takes
   * focus; the shared panel-focus authority (PanelFocusSync → requestPanelFocus) routes focus on a
   * switch. Absent (undefined) → keep the old always-focus behaviour.
   */
  isActive?: () => boolean;
}

/**
 * Drives an inline xterm.js view bound to a daemon terminal session (005 Phase C).
 * On mount it (re)attaches by `panelId` — replaying scrollback, then streaming
 * live output (FR-014/021) — wires keystrokes to the PTY, and fits/resizes to the
 * Panel. Unmounting only detaches the *view*: the session keeps running in the
 * daemon (Principle III), so it is never killed here.
 *
 * The effect re-runs (re-attaching) ONLY when the terminal's identity/config
 * changes — never on unrelated re-renders. The exit/error callbacks and the theme
 * are held in refs so activating the Panel (which changes the workspace store
 * identity) does not tear down and recreate the live terminal.
 */
export function useTerminal(opts: UseTerminalOptions): void {
  const { panelId, projectId, projectRoot, rootless, runAsAdmin, flavourId, shellArguments, startupCommand, container } = opts;

  const onExitRef = useRef(opts.onExit);
  const onErrorRef = useRef(opts.onError);
  const onStillStartingRef = useRef(opts.onStillStarting);
  const onAttachedRef = useRef(opts.onAttached);
  const themeRef = useRef(opts.theme);
  const metaRef = useRef(opts.meta);
  /**
   * 025 FR-028 — the remembered start directory, held in a REF and deliberately NOT a dependency
   * of the attach effect below.
   *
   * It changes every time the user `cd`s, because directory memory records the live cwd. Treating
   * it as a dependency tore the terminal down and re-attached it on every directory change — a
   * visible flash, and a needless round-trip. It is only ever read at LAUNCH, so a ref is not a
   * shortcut here: it is the correct lifetime for the value.
   */
  const rememberedCwdRef = useRef(opts.rememberedCwd);
  // 033 FR-033: read at LAUNCH only, exactly like the remembered directory above — a ref, so it can
  // never become an attach dependency and tear a running terminal down.
  const startDirectoryRef = useRef(opts.startDirectory);
  // Search collaborators are read through refs too (013): the key-reservation predicate
  // changes when the user rebinds a chord or opens/closes find, and the highlight colours
  // change when the theme does — the mount effect must not freeze yesterday's copies.
  const reserveKeyRef = useRef(opts.reserveKey);
  const decorationsRef = useRef(opts.searchDecorations);
  const onSearchCountRef = useRef(opts.onSearchCount);
  const linkDelayRef = useRef(opts.linkHoverDelayMs);
  onExitRef.current = opts.onExit;
  onErrorRef.current = opts.onError;
  onStillStartingRef.current = opts.onStillStarting;
  onAttachedRef.current = opts.onAttached;
  themeRef.current = opts.theme;
  metaRef.current = opts.meta;
  rememberedCwdRef.current = opts.rememberedCwd;
  startDirectoryRef.current = opts.startDirectory;
  reserveKeyRef.current = opts.reserveKey;
  decorationsRef.current = opts.searchDecorations;
  onSearchCountRef.current = opts.onSearchCount;
  linkDelayRef.current = opts.linkHoverDelayMs;
  // Read the active-panel predicate through a ref so the (async) attach focus below sees the CURRENT
  // active panel, not the one at mount time (issue 144).
  const isActiveRef = useRef(opts.isActive);
  isActiveRef.current = opts.isActive;
  /** Focus the terminal ONLY when it is the active panel (issue 144). Default true when unset. */
  const focusIfActive = (term: Terminal): void => {
    if (isActiveRef.current?.() ?? true) term.focus();
  };

  const termRef = useRef<Terminal | null>(null);
  // Re-measure-and-resize callback, published by the main effect so the font/zoom
  // effect below can recompute the grid when the effective font size changes (012).
  const applyResizeRef = useRef<(() => void) | null>(null);

  // Live theme updates (hot-reload) without recreating the terminal.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = opts.theme;
  }, [opts.theme]);

  // Hot-reload the terminal font when the theme's terminal role changes (FR-074) OR
  // the per-panel-type zoom changes the effective font size (012, FR-012). A font
  // metric change alters how many columns/rows the same container holds, so after
  // applying it we re-measure the grid (proposeDimensions) and resize the PTY only
  // when cols/rows actually move (SC-005) — a deferred call lets xterm apply the new
  // cell size first. A pure focus change never runs this effect, so it sends no
  // resize (SC-004).
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.options.fontFamily = opts.fontFamily;
    t.options.fontSize = opts.fontSize;
    const id = setTimeout(() => applyResizeRef.current?.(), 0);
    return () => clearTimeout(id);
  }, [opts.fontFamily, opts.fontSize]);

  useEffect(() => {
    if (!container) return;
    const bridge = window.throng?.terminal;
    if (!bridge) return;

    let disposed = false;
    // Identity of THIS view (this window's presentation of the panel) for the daemon's
    // per-view grid (008 FR-009). Generated per mount so attach/resize/detach all carry
    // the same id; the daemon sizes the shared PTY to the minimum across every view, so
    // two different-sized windows can never corrupt one grid.
    const viewId = crypto.randomUUID();
    // Timestamp of the last PTY resize. A resize makes ConPTY repaint the whole
    // (new-size) viewport — cursor-home + an erase per row, the same shape as a
    // `cls` — so we must NOT treat output arriving just after a resize as a clear,
    // or enlarging the Panel wipes the scrollback. See shouldDropScrollback.
    let resizedAt = 0;
    /** Tears down the search registration when this view goes (013). */
    let cleanupSearch: (() => void) | undefined;
    // 024 US7 (FR-019d): the http(s) link currently under the pointer, tracked from the link hover
    // callbacks so the context menu can offer "Open Link" at right-click time.
    let hoveredLink: string | null = null;
    // 024 US7 (#159 follow-up): a hover tooltip naming the activation gesture. xterm's only built-in
    // link affordance is a hover underline, which does not say the link is Ctrl-clickable — so we add
    // a floating tip that appears while the pointer is over an http(s) link. It lives on document.body
    // with `position:fixed` (not inside the panel, whose `overflow:hidden` would clip it) and follows
    // the pointer in viewport coordinates; removed on dispose.
    const linkTip = document.createElement('div');
    linkTip.className = 'terminal-link-tip';
    linkTip.setAttribute('role', 'tooltip');
    const linkChord = /Mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';
    linkTip.textContent = `${linkChord}+Click to open in system browser`;
    linkTip.hidden = true;
    document.body.appendChild(linkTip);
    // The tip appears only after the pointer RESTS on a link for the configured delay (default 500ms,
    // `terminals.linkHoverDelayMs`), so a pointer sweeping across a link doesn't flash it. The timer is
    // cancelled the moment the pointer leaves the link (or the view is disposed).
    let linkTipTimer: ReturnType<typeof setTimeout> | undefined;
    // The link the tip is currently showing (or armed for), and the pending hide. Both exist to keep
    // the tip STEADY while the pointer rests on one link — see setHovered.
    let tipUri: string | null = null;
    let linkTipHideTimer: ReturnType<typeof setTimeout> | undefined;
    const placeLinkTip = (event: MouseEvent): void => {
      // Naive position (up-and-right of the pointer) first, then unhide and CLAMP to the viewport so
      // the tip is never cut off at an edge (018/FR-013 — every floating surface flips/clamps). Near
      // the right edge it flips to the pointer's left; near the top it drops below.
      linkTip.style.left = `${event.clientX + 12}px`;
      linkTip.style.top = `${event.clientY - 28}px`;
      linkTip.hidden = false;
      const w = linkTip.offsetWidth;
      const h = linkTip.offsetHeight;
      let x = event.clientX + 12;
      let y = event.clientY - 28;
      if (x + w > window.innerWidth - 2) x = event.clientX - w - 12;
      if (y < 2) y = event.clientY + 20;
      if (y + h > window.innerHeight - 2) y = window.innerHeight - h - 2;
      linkTip.style.left = `${Math.max(2, x)}px`;
      linkTip.style.top = `${Math.max(2, y)}px`;
    };
    const hideLinkTip = (): void => {
      if (linkTipTimer !== undefined) {
        clearTimeout(linkTipTimer);
        linkTipTimer = undefined;
      }
      if (linkTipHideTimer !== undefined) {
        clearTimeout(linkTipHideTimer);
        linkTipHideTimer = undefined;
      }
      tipUri = null;
      linkTip.hidden = true;
    };
    /**
     * Track the hovered link and drive the tip (024 US7, #159 follow-ups).
     *
     * The tip must stay put while the pointer RESTS on a link — it used to blink every couple of
     * seconds. xterm re-evaluates its link providers whenever the view re-renders, and the self-heal
     * repaint below runs on a 2s interval, so a motionless pointer was told `leave` and then `hover`
     * again on every tick; the old code hid the tip and re-armed the 500ms delay each time, which is
     * exactly what the user saw. Two guards, either of which suffices:
     *
     *  - a `hover` naming the link the tip is ALREADY showing (or armed for) is a no-op, so the delay
     *    is never restarted under the pointer;
     *  - a `leave` only SCHEDULES the hide, so a re-hover arriving in the same beat cancels it.
     *
     * `hoveredLink` (read by the right-click menu, FR-019d) still updates immediately — the grace
     * period is the tip's alone.
     */
    const setHovered = (uri: string | undefined, event?: MouseEvent): void => {
      const next = uri && /^https?:\/\//i.test(uri) ? uri : null;
      hoveredLink = next;
      if (next === null) {
        if (linkTipTimer !== undefined) {
          clearTimeout(linkTipTimer);
          linkTipTimer = undefined;
        }
        if (tipUri !== null && linkTipHideTimer === undefined) {
          linkTipHideTimer = setTimeout(hideLinkTip, LINK_TIP_LEAVE_GRACE_MS);
        }
        return;
      }
      if (linkTipHideTimer !== undefined) {
        clearTimeout(linkTipHideTimer);
        linkTipHideTimer = undefined;
      }
      if (tipUri === next) return; // same link, still hovered — leave the tip exactly as it is
      if (linkTipTimer !== undefined) clearTimeout(linkTipTimer);
      linkTip.hidden = true;
      tipUri = next;
      if (!event) return;
      const delay = Math.max(0, linkDelayRef.current ?? 500);
      linkTipTimer = setTimeout(() => placeLinkTip(event), delay);
    };
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      theme: themeRef.current,
      // The search addon paints match highlights through xterm's decorations API, which
      // is still flagged "proposed" — without this it throws rather than highlighting (013).
      allowProposedApi: true,
      // 024 US7 (#159): route an OSC 8 hyperlink click through the OS open-external seam instead of
      // xterm's default (which calls window.open → an in-app BrowserWindow, the reported bug). Gated
      // on Ctrl/Cmd (FR-019c); the main process re-validates the scheme and denies any window.
      linkHandler: {
        activate: (event, uri) => openTerminalLink(event, uri),
        hover: (event, uri) => setHovered(uri, event),
        leave: () => setHovered(undefined),
      },
      // NB: do NOT set `windowsPty` here. Without a matching Windows build number it
      // applies the wrong ConPTY reflow/wrapping heuristics and garbles scrolled
      // PowerShell output. (cls/clear is handled separately via isScreenClear.)
    });
    termRef.current = term;

    // US10 (#89) — surface the live window title the shell/program announces via OSC 0/2. xterm
    // disposes this handler with the terminal (like the other on* handlers here), so no manual
    // cleanup is needed beyond dropping the stored title on dispose (below).
    term.onTitleChange((title) => setTerminalTitle(panelId, title));

    // The one paste route (#142). Reads the OS clipboard through the seam and writes it to the pty
    // ONCE, then restores focus. Shared by Ctrl+V, Shift+Insert (both in the key handler below) and
    // the right-click menu (via the api handle), so a single paste gesture inserts the clipboard
    // exactly once. A failing paste is logged, not swallowed silently: a paste that fails invisibly
    // looks exactly like a paste of nothing, and the user retries and concludes the terminal is broken.
    const pasteFromClipboard = async (): Promise<void> => {
      try {
        const entry = await window.throng?.clipboard?.paste();
        const text = entry?.text ?? '';
        if (text.length === 0) return;
        await bridge.write(panelId, text);
        term.focus();
      } catch (error) {
        console.error('[terminal] paste failed', error);
      }
    };

    // The imperative handle, also published to the focus registry so the panel wrapper can move
    // focus into this terminal synchronously on pointer-down (028, issue 200).
    if (opts.apiRef) {
      opts.apiRef.current = {
        getSelection: () => term.getSelection(),
        focus: () => term.focus(),
        paste: () => void pasteFromClipboard(),
        write: (text: string) => {
          void bridge.write(panelId, text);
          term.focus();
        },
        getHoveredLink: () => hoveredLink,
      };
      registerTerminalFocus(panelId, opts.apiRef.current);
    }

    /*
     * A redraw's client-side half (028, #163). The daemon's nudge only applies to a program on the
     * alternate screen; on the normal buffer the content is already here, so repainting the view IS
     * the redraw — and it is the only safe one, since resizing a console reflows its buffer.
     */
    const unregisterRefresh = registerTerminalRefresh(panelId, () => {
      term.refresh(0, term.rows - 1);
    });

    // xterm 6.0 binds its own `paste` handler to BOTH the hidden textarea and its parent element
    // (`this.element`); the textarea is a descendant, so a single native paste bubbles through both
    // and is written to the pty TWICE (#142 "double paste"). We own paste explicitly (above/below),
    // so xterm's DOM-paste path must not run at all. A capture-phase listener on the container fires
    // before either of xterm's descendant listeners; stopping immediate propagation neutralises both.
    // The right-click menu and Ctrl+V do not depend on this event, so nothing legitimate is lost.
    const swallowNativePaste = (ev: ClipboardEvent): void => {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    };
    container.addEventListener('paste', swallowNativePaste, true);
    // 024 US7 (#159 follow-up): the RIGHT mouse button must not reach the terminal program. With
    // mouse reporting on (Claude Code, vim, tmux), xterm forwards a right-button press to the pty as
    // a mouse event, which the program acts on — a stray paste/insert — while throng ALSO opens its
    // themed context menu, so one click is handled twice. A capture-phase listener on the container
    // fires before xterm's descendant handlers; stopping button-2 press/release there makes the
    // context menu the sole owner of a right-click. `stopImmediatePropagation` (not `preventDefault`)
    // leaves the browser free to still fire `contextmenu` for the themed menu, and the panel's
    // pointerdown still marks it active. Left/middle buttons (selection, mouse reporting) are untouched.
    const swallowRightButton = (ev: MouseEvent): void => {
      if (ev.button === 2) ev.stopImmediatePropagation();
    };
    container.addEventListener('mousedown', swallowRightButton, true);
    container.addEventListener('mouseup', swallowRightButton, true);
    container.addEventListener('auxclick', swallowRightButton, true);
    // Terminal keyboard negotiation state (#90): the kitty flags AND win32-input-mode the
    // running program has enabled. A modified Enter is reported in CSI-u form while kitty is
    // active, as a win32-input key event while win32-input-mode is (PowerShell/cmd), else as a
    // bare \n. Maintained by the CSI handlers registered below and read by the key handler; both
    // close over this one `let`.
    /*
     * Seeded from what THIS PANEL's program already negotiated, not from zero (028 follow-up).
     *
     * An inactive tab is unmounted, so a tab switch rebuilds this view — and the program will not
     * re-negotiate, because from its side nothing happened. Starting fresh here is what made
     * Ctrl+Backspace and Ctrl+End work exactly once, in whichever terminal had not been switched
     * away from yet.
     */
    let kitty = peekKeyboardMode(panelId) ?? createKittyKeyboardState();
    /** Keep the panel's copy in step whenever the program changes what it wants. */
    const rememberKitty = (): void => saveKeyboardMode(panelId, kitty);
    // 028 (#187): which DEC mouse-reporting modes the program has enabled. Tracked at the same
    // private-mode snoop that already drives the win32-input gate, because the wheel decision below
    // must not steal a gesture from a program that genuinely claimed the mouse.
    const mouseReporting = createMouseReportingState();

    // The key handler does three things, in order:
    //   1. Hand throng's own chords (find, scrollback nav) back to the app — returning false
    //      tells xterm not to process the key at all, so it never reaches the pty. The
    //      window-level handler then acts on it ("searching types nothing at the shell", SC-002).
    //   2. Give a modified Enter a NEWLINE instead of a submit (#90): Shift+Enter / Ctrl+Enter reach
    //      the pty as whatever the running program understands as a soft line break — a win32-input
    //      key event under PowerShell/cmd (so PSReadLine inserts the newline AND moves the cursor
    //      down), a CSI-u sequence if it negotiated the kitty protocol (Claude Code), else a bare
    //      `\n` (the byte Ctrl+J sends, which raw REPLs newline on). Plain Enter is untouched.
    //   3. Everything else: let xterm encode it as before.
    //
    // reserveKeyRef is read through a REF, never captured: the predicate depends on the user's
    // bindings and on whether a find bar is open, both of which change while this terminal
    // lives. A captured copy would keep reserving yesterday's chord and leak today's to the shell.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true; // keyup/keypress: nothing to reserve or re-encode
      /*
       * The running program owns the keyboard when it negotiated enhanced reporting, when it is
       * READING INPUT ITSELF, or when it is painting the alternate screen (where there is no
       * scrollback for throng's chords to move).
       *
       * The middle case was missing, and it is the common one: Claude Code renders INLINE — it never
       * takes the alternate screen — so a full-screen-looking program sat on the normal buffer while
       * throng went on claiming Ctrl+End and Ctrl+Home for scrollback, out of a program that binds
       * them itself. Bracketed paste is what says an application is reading; see BRACKETED_PASTE_MODE.
       */
      const altBuffer = term.buffer.active.type === 'alternate';
      /*
       * "Reading input" is NOT the same as "owns the scrollback chords", and conflating them was a
       * regression: bash enables bracketed paste at its ordinary prompt, so a bare git-bash terminal
       * started claiming to own the keyboard and Ctrl+Home stopped scrolling — measured, on git-bash
       * only, because it is the shell whose line editor announces itself.
       *
       * The honest carve-out is the ALTERNATE SCREEN: there is no scrollback there, so Ctrl+Home and
       * Ctrl+End have nothing to move and belong to the program (vim, less, claude's agent view).
       * Everywhere else — including a program rendering INLINE, as Claude Code does — the buffer is
       * throng's and so are the chords that move it.
       */
      const programOwnsKeyboard = kittyKeyboardActive(kitty) || altBuffer;
      const reserved = reserveKeyRef.current?.(e, programOwnsKeyboard) === true;
      // Always on, bounded, and read only by diagnostics: what throng believed when the key was
      // pressed. Three stand-in programs failed to reproduce a defect a user reproduces every time,
      // so the decision inputs are recorded where it actually happens.
      recordKeyDecision(panelId, {
        chord: `${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${e.key}`,
        reserved,
        kitty: kittyKeyboardActive(kitty),
        win32: win32InputActive(kitty),
        app: applicationReadingInput(kitty),
        altBuffer,
        programOwnsKeyboard,
      });
      if (reserved) {
        /*
         * A throng chord — keep it off the pty, AND cancel the browser's own default for it.
         *
         * Returning false stops xterm processing but does NOT preventDefault, which was harmless
         * while every reserved chord was one Chromium ignores. `Ctrl+F5` is not: it is Chromium's
         * HARD RELOAD accelerator, so leaving the default in place lets a redraw request tear down
         * and rebuild the whole renderer — a far more violent thing than the redraw it was asking
         * for, and one that lands mid-session in a live terminal.
         */
        e.preventDefault();
        return false;
      }
      /*
       * Plain PageUp / PageDown scroll THIS terminal's viewport when nothing is reading input.
       *
       * They used to be transmitted as `CSI 5~` / `CSI 6~` to whatever was on the other end, which at
       * a PowerShell prompt is PSReadLine — and PSReadLine answers PageDown by repainting over the
       * screen, measured as 120 lines of output collapsing to a bare prompt with the rest of the
       * session unreachable until `clear`. Windows Terminal does not do this: with no application
       * reading, the pager keys belong to the TERMINAL's scrollback, which is also what a user
       * pressing them means.
       *
       * When a program IS reading (claude, an editor, anything on the alternate screen) they are its
       * keys and go straight through, because there the scrollback is not what the user is looking at.
       */
      if (
        (e.key === 'PageUp' || e.key === 'PageDown') &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !programOwnsKeyboard
      ) {
        e.preventDefault();
        term.scrollPages(e.key === 'PageUp' ? -1 : 1);
        return false;
      }
      // Paste (#142): Ctrl+V / Shift+Insert. xterm 6.0 has no key-driven paste (it pastes only from a
      // DOM `paste` event, which Chromium fires from Ctrl+V only with an Edit-menu role throng does
      // not ship), so Ctrl+V did nothing. Do the paste ourselves — exactly once — and keep the chord
      // off the pty so it types no literal `v` / Ctrl+V (0x16). Checked AFTER reserveKey so a user who
      // rebinds this chord to a throng action still wins.
      if (isPasteChord(e)) {
        e.preventDefault();
        void pasteFromClipboard();
        return false;
      }
      const chord = {
        key: e.key,
        shift: e.shiftKey,
        alt: e.altKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
      };
      /*
       * Enter first (#90), then the other modified keys throng re-encodes (028 follow-up:
       * Ctrl+Backspace and Ctrl+Arrow did nothing in throng but worked in Windows Terminal).
       *
       * Both answer the same question — what does THIS program expect for this chord — and both
       * return null when the answer is "whatever xterm already sends".
       */
      const seq =
        encodeEnterKey(chord, kitty) ?? encodeModifiedKey(chord, kitty);
      if (seq !== null) {
        recordKeyBytes(panelId, seq); // throng re-encoded it; onData will never see this one
        // Suppress the browser's OWN default for this key BEFORE handing back. Returning false
        // stops xterm processing but does NOT preventDefault, and Shift+Enter's default action in
        // xterm's hidden input <textarea> is to insert a newline — which xterm would then transmit
        // as a stray \r AFTER our sequence (Shift+Enter → `\x1b[13;2u\r`, submitting in Claude).
        e.preventDefault();
        void bridge.write(panelId, seq); // we transmit the newline / CSI-u ourselves…
        return false; // …so xterm must not ALSO send its \r
      }
      return true;
    });

    /*
     * 028 (#187) — where a wheel notch goes.
     *
     * The reported bug is that the wheel does NOTHING over a Claude Code session. It is not a lost
     * event: xterm scrolls the viewport on the normal buffer, the alternate screen has no scrollback
     * to scroll, and xterm only forwards notches as arrow keys once the program enables DEC private
     * mode 1007 — which Claude Code does not. So the gesture arrives and is silently dropped.
     *
     * Decide explicitly instead (FR-035/035a). Returning false tells xterm not to handle the event.
     * The one dangerous route is `arrows`, which must NEVER fire on the normal buffer: a wheel that
     * synthesised keys at a shell prompt would type into the user's command line (FR-035c). That is
     * why the decision is a pure function pinned by unit tests rather than an inline condition.
     */
    term.attachCustomWheelEventHandler((e) => {
      const route = decideWheel({
        altBuffer: term.buffer.active.type === 'alternate',
        mouseReporting: mouseReporting.isOn(),
        ctrlKey: e.ctrlKey || e.metaKey,
      });
      if (route === 'arrows') {
        // Three presses per notch — the conventional scroll step, and what xterm's own alternate
        // scroll sends. The bytes are exactly what a real arrow key produces, so the program cannot
        // tell this from a keyboard (FR-035c).
        const key = e.deltaY < 0 ? '[A' : '[B';
        void bridge.write(panelId, key.repeat(3));
        e.preventDefault();
        return false;
      }
      // zoom → the window-level zoom binding owns it; program → xterm forwards it as a mouse event;
      // viewport → xterm scrolls. All three are xterm's or the app's existing behaviour, untouched.
      return route !== 'zoom';
    });

    // Kitty keyboard protocol negotiation (#90). The program turns enhanced key reporting on
    // and off with `CSI <?|=|>|<> … u` control sequences; xterm 6.0 has no native kitty support
    // and would silently ignore them, so we parse each and dispatch through applyKittyCsi to
    // drive `kitty` above. The `?` query is answered (ahead of the CSI c sentinel every
    // terminal replies to) so the program's handshake detects support and enables the protocol.
    // Returning true marks the sequence handled. (xterm disposes these with the terminal, like
    // the OSC 52 handler.)
    const flatten = (params: (number | number[])[]): number[] =>
      params.map((p) => (Array.isArray(p) ? (p[0] ?? 0) : p));
    const onKittyCsi = (prefix: KittyCsiPrefix) => (params: (number | number[])[]): boolean => {
      const { state, reply } = applyKittyCsi(kitty, prefix, flatten(params));
      kitty = state;
      rememberKitty();
      if (reply !== undefined) {
        void bridge.write(panelId, reply);
      }
      return true;
    };
    for (const prefix of ['?', '=', '>', '<'] as const) {
      term.parser.registerCsiHandler({ prefix, final: 'u' }, onKittyCsi(prefix));
    }

    // win32-input-mode negotiation (#90 follow-up). PowerShell/PSReadLine and cmd enable DEC
    // private mode 9001 (`CSI ? 9001 h`) while editing a line — our signal that they read console
    // KEY events, so a modified Enter must be a win32-input key event (which advances the cursor)
    // rather than a bare LF (which strands it on the first line). We only SNOOP the mode to drive
    // `kitty.win32Input`; returning false lets xterm still apply every private mode it owns
    // (cursor show/hide, alt-screen, bracketed paste, …). 9001 is unknown to xterm, so it is a
    // harmless no-op there.
    const onDecPrivateMode =
      (enable: boolean) =>
      (params: (number | number[])[]): boolean => {
        const modes = flatten(params);
        recordModeEvent(panelId, modes, enable);
        /*
         * A program taking the ALTERNATE SCREEN is a new program, and it has negotiated nothing yet.
         *
         * Whatever the shell agreed with throng belongs to the shell. cmd and PSReadLine enable
         * win32-input-mode to read their prompt, so by the time `claude` starts, throng believes the
         * terminal wants key RECORDS — and then re-encodes Shift+Enter, and previously
         * Ctrl+Backspace, into records that a program reading raw VT cannot act on. The keys that
         * kept working were precisely the ones throng passes through untouched.
         *
         * Reset on entry, before the new program's own negotiation is applied: anything it wants, it
         * will ask for, and what it does not ask for it should not receive.
         */
        /*
         * Reset on a TRANSITION, never on a repetition.
         *
         * Programs re-assert their setup constantly — claude re-sends its screen and mouse modes
         * after every resize, and throng nudges the grid on attach, so a rebuilt view sees the whole
         * negotiation again within milliseconds. Resetting on each of those threw away the state the
         * panel store had just restored, and Ctrl+Backspace reverted to its unnegotiated encoding on
         * a tab switch. Two transitions genuinely mean "a new program":
         *
         *   - bracketed paste going OFF→ON: an application has started reading input;
         *   - the alternate screen being entered from the normal one (for programs that never enable
         *     bracketed paste), excluding the switch throng writes itself to restore a view.
         */
        /*
         * The console mode is NOT throng's to clear.
         *
         * This used to blank win32-input-mode whenever an application started, on the reasoning that
         * the shell's negotiation should not leak. But 9001 belongs to the CONSOLE, and the console
         * does not turn it off just because a program started — captured side by side, Windows
         * Terminal answers `CSI ? 9001 ; 1 $ y` (set) in exactly the state where throng answered `2`.
         * Clearing it made throng lie about itself to any program that asked.
         *
         * Who is READING is a different question, and the encoders answer it themselves from
         * bracketed paste. Tracking stays faithful; the decisions stay informed.
         */
        kitty = applyDecPrivateMode(kitty, modes, enable);
        rememberKitty();
        mouseReporting.apply(modes, enable); // 028 (issue 187) — same snoop, second question
        return false; // observe only — never claim the sequence
      };
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, onDecPrivateMode(true));
    term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, onDecPrivateMode(false));


    const fit = new FitAddon();
    term.loadAddon(fit);
    // 024 US7 (#159): detect plain-text http(s) URLs printed to the terminal (inert until now) and
    // open them on Ctrl/Cmd+click through the same seam as OSC 8 links. The addon underlines a link
    // on hover, which is the actionable affordance (FR-019a/c).
    term.loadAddon(
      new WebLinksAddon((event, uri) => openTerminalLink(event, uri), {
        hover: (event, uri) => setHovered(uri, event),
        leave: () => setHovered(undefined),
      }),
    );

    // In-panel find over the retained scrollback (013). Read-only: the addon reads the
    // buffer and moves the viewport, never the pty. Registered against the panel id so
    // the shared find bar can drive whichever terminal is active.
    if (decorationsRef.current) {
      const searchAddon = new SearchAddon();
      term.loadAddon(searchAddon);
      // Colours are read at search time, so re-theming repaints the highlights.
      const controller = createTerminalSearchController(term, searchAddon, () =>
        // 018 / SC-002 — the fallback used to be three hard-coded hexes, which happened to be the base
        // theme's values COPIED. Two copies of a colour drift; and a literal here is invisible to the
        // no-inline-artwork guard, which walks CSS and TSX, not TS. Read the shipped theme instead, so
        // there is one place the colour lives and no literal to go stale.
        decorationsRef.current ?? {
          matchBackground: THRONG_THEME.colours.searchMatch,
          activeMatchBackground: THRONG_THEME.colours.searchMatchCurrent,
          activeMatchBorder: THRONG_THEME.colours.searchMatchCurrentBorder,
        },
      );
      const offCount = controller.onCountChange((c) => onSearchCountRef.current?.(c));
      registerPanelSearch(panelId, controller);
      cleanupSearch = () => {
        offCount?.();
        unregisterPanelSearch(panelId);
        searchAddon.dispose();
      };
    }

    term.open(container);
    focusIfActive(term); // only the active panel grabs focus on mount (issue 144)
    try {
      fit.fit();
    } catch {
      /* container not measured yet */
    }

    // Honour OSC 52 clipboard writes (xterm.js ignores them by default). A program
    // running inside the terminal — Claude Code, tmux, vim — copies by emitting
    // `ESC ] 52 ; c ; <base64> ST`; we decode it and relay the text to the OS
    // clipboard via UI main (the sandboxed renderer can't reach it directly). Reads
    // (`?`) and malformed sequences are ignored (parseOsc52 → null).
    // 025 follow-up — OSC 9;9 carries a working directory the SHELL reports. PowerShell is the
    // reason this exists: its `Set-Location` never moves the process working directory, so the
    // daemon's external read can never see it and only the shell can say where it is. Windows
    // Terminal uses the same sequence, so a shell already emitting it works with no configuration.
    term.parser.registerOscHandler(9, (payload) => {
      const marker = '9;';
      if (!payload.startsWith(marker)) return false; // some other OSC 9 (a notification) — not ours
      const reported = payload.slice(marker.length).trim();
      if (reported) reportTerminalCwd(panelId, reported);
      return true;
    });
    term.parser.registerOscHandler(52, (payload) => {
      const text = parseOsc52(payload);
      if (text === null) return true; // handled: swallow reads/garbage (do not echo)
      void bridge.writeClipboard?.(text);
      return true;
    });

    // A shell's very first output clears the screen (cmd/PowerShell emit ESC[2J at
    // launch). That is NOT stale scrollback to drop: the terminal is fresh, so a
    // drop-scrollback (term.clear, below) has nothing to remove — and worse, it
    // truncates the prompt when the cwd path is long enough to wrap onto a second
    // row (term.clear keeps only the cursor's row, discarding the first). So we let
    // xterm handle the startup clear natively and only honour drops AFTER it.
    let startupClearHandled = false;

    const writeChunk = (data: string): void => {
      // After a `cls`/`clear` repaint, drop the scrollback the repaint pushed up so
      // the buffer is actually cleared (ConPTY leaves it behind — see isScreenClear).
      // A resize repaint has the same shape but must NOT clear, so gate on the time
      // since the last resize (shouldDropScrollback).
      let drop = shouldDropScrollback(data, term.rows, Date.now() - resizedAt);
      if (drop && !startupClearHandled) {
        startupClearHandled = true;
        drop = false; // the shell's startup clear — nothing to drop, and dropping truncates a wrapped prompt
      }
      /*
       * NEVER on the ALTERNATE screen.
       *
       * Dropping scrollback is a normal-buffer idea: the alt screen HAS no scrollback, and
       * `term.clear()` there does not tidy anything — it throws away the running program's rendered
       * screen, keeping only the cursor's row, while the program goes on believing its display is
       * intact and redrawing only what changes. The result is a full-screen application (claude,
       * vim, tmux) left visibly wrong until something forces it to repaint everything.
       *
       * `isScreenClear` already refuses the chunk that SWITCHES to the alt screen, but that guard
       * only ever sees the switch. Every repaint AFTERWARDS is cursor-home plus one erase per row —
       * exactly the shape of a `cls` — and a full-screen program repaints constantly. So the buffer
       * TYPE is checked here, where it is actually known, both before the write and again in the
       * callback (the chunk itself may have entered the alt screen in between).
       */
      if (drop && term.buffer.active.type === 'alternate') drop = false;
      if (drop) {
        term.write(data, () => {
          if (!disposed && term.buffer.active.type === 'normal') term.clear();
        });
      } else {
        term.write(data);
      }
    };

    // Conform THIS view's xterm to the shared daemon grid (008 FR-009/FR-013). The
    // daemon sizes one PTY to the MINIMUM columns/rows across every attached view; a
    // view rendering at any other size shows a full-screen (alternate-screen) program
    // offset/wrapped, because that screen is painted absolutely for the PTY grid and is
    // not reflowed by xterm. This is the ONLY thing that sets the xterm's size — the
    // ResizeObserver below merely REPORTS this view's container capacity so the daemon
    // can compute the minimum, and the daemon broadcasts the result back here.
    const conformGrid = (cols: number, rows: number): void => {
      if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return;
      // Any grid change makes ConPTY repaint the viewport (home + erase-per-row — the
      // same shape as a `cls`); arm the window so that repaint is not mistaken for a
      // clear (which would wipe scrollback), whether or not this xterm's size changes.
      resizedAt = Date.now();
      if (term.cols === cols && term.rows === rows) {
        /*
         * The grid already matches, so there is no resize — and this is often the FIRST thing that
         * happens to a newly opened terminal, whose container may not have been measurable when
         * `term.open()` ran (the panel was still laying out, and the `fit()` there is wrapped in a
         * try/catch for exactly that reason).
         *
         * ══ WHAT THIS CALL DOES, AND WHAT IT WAS ONCE CLAIMED TO DO (#290) ══
         *
         * This comment used to say the repaint gives such a terminal its viewport scroll area, "so
         * the wheel works from the first frame". READ AGAINST xterm 6.0.0, THAT IS NOT TRUE, and it
         * is left corrected rather than deleted because it is the reasoning a reader of #290 will
         * otherwise re-derive:
         *
         *   Terminal.refresh(a, b)  →  this._renderService?.refreshRows(a, b)
         *
         * — rows, and nothing else. The viewport's scroll area is synced from `queueSync()`, which
         * is subscribed to exactly three things: `_bufferService.onResize`, `_bufferService`'s
         * `buffers.onBufferActivate` (a normal↔alternate switch), and the scroll events
         * (`onScroll` / the input handler's). A repaint is none of them. `Terminal.resize()` also
         * early-returns when neither dimension changed, so a same-size resize is not a way in
         * either — which is why this branch exists at all.
         *
         * That matches what #290 reports from the other end: a window resize recovers a dead
         * viewport every time, more output sometimes does, and `Ctrl+F5` (`terminal.redraw`) never
         * does — and `terminal.redraw` issues this very call.
         *
         * The repaint is KEPT. It costs one render of an already-correct grid, it is what makes a
         * first frame appear for a panel whose container was not measurable at `open()`, and
         * removing it is a production change that #290 does not yet have a reproduction to justify.
         * What is gone is the claim that it fixes scrolling.
         */
        try {
          term.refresh(0, term.rows - 1);
        } catch {
          /* not measurable yet — the periodic repaint below will catch it */
        }
        return;
      }
      // A shrink in EITHER dimension can leave stale cells beyond the new grid (a right
      // column tail and/or bottom rows); a pure grow cannot.
      const shrank = cols < term.cols || rows < term.rows;
      const wasAlt = term.buffer.active.type === 'alternate';
      try {
        term.resize(cols, rows);
        // On the ALTERNATE screen a shrink can leave stale cells beyond the new grid: the
        // program repaints via ABSOLUTE cursor positioning (it does not clear-then-draw),
        // ConPTY suppresses the app's own clear right after a resize, and xterm does not
        // reflow the alt buffer — so a view that had been larger keeps old content in the
        // now-out-of-grid columns/rows and shows a full-screen program offset. Clear the
        // alt screen ourselves so the imminent resize-repaint (a full-screen program always
        // repaints on SIGWINCH) lands on a clean grid. NEVER on the normal buffer — that
        // would wipe a shell's visible output, which is not repainted on a resize — and
        // only on a shrink, so a grow never flashes empty before the repaint.
        if (wasAlt && shrank) term.write('\u001b[H\u001b[2J'); // clear stale alt-screen cells
      } catch {
        /* not measurable yet */
      }
    };

    // Live output can arrive before attach() resolves with the scrollback backlog
    // (the two travel on different sockets). Buffer it until scrollback is applied,
    // then flush in order, so a busy reattach/mirror never renders recent lines
    // above the older history. See TerminalOutputGate.
    const gate = new TerminalOutputGate();
    const offOutput = bridge.onOutput((e) => {
      if (e.panelId !== panelId || disposed) return;
      if (gate.accept(e.data)) writeChunk(e.data);
    });
    // The shared grid moved (a view joined/left/resized): conform this xterm to it so a
    // full-screen program stays identical across differently-sized windows (008 FR-009).
    const offGrid = bridge.onGrid((e) => {
      if (e.panelId !== panelId || disposed) return;
      conformGrid(e.cols, e.rows);
    });
    const offExit = bridge.onExit((e) => {
      if (e.panelId !== panelId) return;
      // The program is gone: forget what IT negotiated, so the next one to run in this panel does
      // not inherit a protocol it never asked for (the same bug, pointing the other way).
      clearKeyboardMode(panelId);
      // And forget the title it announced, for the same reason and on the same event (#295). This
      // used to live in the effect's CLEANUP, which conflated "this view went away" with "the
      // program ended" — a tab switch threw away a title the program had announced once at
      // startup and had no reason to repeat, so the header fell back to the flavour label for the
      // life of the session and Reset Name could not bring it back.
      clearTerminalTitle(panelId);
      if (!disposed) onExitRef.current({ code: e.code, unexpected: e.unexpected });
    });
    /*
     * Focus reports are only honest when focus actually moved (028 follow-up).
     *
     * With focus reporting on (DEC 1004), a terminal tells the program when it gains or loses focus:
     * `CSI I` / `CSI O`. Claude Code re-asserts the mode on every screen transition, and xterm answers
     * each time with the CURRENT state — so a report was landing after keystrokes during which focus
     * never moved. Measured: a DOM focus listener saw nothing while `\x1b[I` went out after every
     * arrow press and every Escape.
     *
     * That is not cosmetic. A lone ESC is ambiguous — it is both the Escape key and the first byte of
     * every sequence — so a program waits to see what follows before deciding. Handing it
     * `ESC` then `ESC [ I` turns the user's Escape into something else, which is the reported
     * "Escape enters the session instead of leaving it", and intermittent because it depends on what
     * the program was doing.
     *
     * So: a report is transmitted only if a real focus change produced it. The listeners sit on the
     * container in the CAPTURE phase, which runs before xterm's own handlers on the textarea, so the
     * flag is set by the time xterm asks to send.
     */
    let realFocusChange = false;
    const noteFocusChange = (): void => {
      realFocusChange = true;
    };
    container.addEventListener('focus', noteFocusChange, true);
    container.addEventListener('blur', noteFocusChange, true);

    term.onData((data) => {
      // `CSI I` / `CSI O` — a focus report. Send it only when focus really moved.
      if (data === '[I' || data === '[O') {
        if (!realFocusChange) return;
        realFocusChange = false;
      }
      // 028 (#200) — count what left the renderer and what the daemon acknowledged. The reported
      // defect is a character the SHELL never received, which is invisible from the rendered view:
      // a test can only tell "typed" from "arrived" by counting both ends (FR-009b/FR-023).
      countInputWritten(panelId);
      recordKeyBytes(panelId, data);
      recordWrite(panelId, data); // what the PROGRAM got, next to what throng decided
      void bridge
        .write(panelId, data)
        .then(() => countInputAcked(panelId, true))
        .catch(() => countInputAcked(panelId, false));
    });

    /*
     * A deliberate re-type COLD-STARTS a different program (008 FR-002/FR-007), so whatever the
     * previous one negotiated about the keyboard dies with it. Consumed before the attach so the
     * decision and the state change happen together.
     */
    const explicitRetype = consumeExplicitRetype(panelId);
    if (explicitRetype) {
      clearKeyboardMode(panelId);
      kitty = createKittyKeyboardState();
    }

    void bridge
      .attach({
        panelId,
        projectId,
        projectRoot,
        viewId,
        // Was this attach triggered by the user explicitly (re-)typing the panel via the
        // Confirm button (008 FR-002/FR-007)? Consumed one-shot: an explicit re-type
        // terminates any running session and cold-starts the chosen flavour; a mirror or
        // re-render leaves it false and reuses the running session.
        explicit: explicitRetype,
        rootless: rootless === true,
        runAsAdmin: runAsAdmin === true,
        flavourId,
        shellArguments,
        startupCommand,
        rememberedCwd: rememberedCwdRef.current,
        startDirectory: startDirectoryRef.current,
        cols: term.cols,
        rows: term.rows,
        meta: metaRef.current,
      })
      .then((res) => {
        if (disposed) return;
        if (!res.ok) {
          // A non-fatal attach timeout (008 FR-005): the session may still be launching.
          // Show the "still starting" state + retry; do NOT revert to the form or kill it.
          if (res.stillStarting) {
            onStillStartingRef.current?.();
            return;
          }
          onErrorRef.current(res.error.message, res.cause);
          return;
        }
        onAttachedRef.current?.(res.cwdFallback); // a successful attach clears any "still starting" state
        // Conform to the session's shared grid BEFORE replaying scrollback, so a view
        // joining an existing session (whose minimum it may not move — e.g. a larger
        // window mirroring a smaller one) renders the replayed screen at the right size
        // instead of offset (008 FR-009). The grid is absent only if there is no session.
        if (res.grid) conformGrid(res.grid.cols, res.grid.rows);
        /*
         * Match the SCREEN the program is on before anything is written (028 follow-up).
         *
         * A rebuilt view used to learn this from the replayed tail, which carried the switch
         * sequence. That replay is suppressed for exactly this case now — it was a visible flash of
         * stale content — so the view was left believing it was on the normal buffer while the
         * program painted the alternate one. Everything keyed off the buffer type then drew the
         * wrong conclusion: the scrollback chords were reclaimed from a program that owns them
         * (measured as Ctrl+End dying after a tab switch), and the wheel and clear-detection would
         * have been wrong in the same way.
         *
         * Written as the switch sequence rather than set as a flag, so xterm's own state is right
         * too — the buffer type is what the rest of this file already asks.
         */
        if (res.altScreen === true && term.buffer.active.type !== 'alternate') {
          // Restoring the screen the program is on, for a view throng rebuilt. Nothing about the
          // negotiation changes here: it belongs to the program, which is still the same one.
          term.write('[?1049h');
        }
        // How many bytes of replayed tail this view painted (028 follow-up instrumentation). A
        // replay is a visible full-screen paint, so it is one of the "flashes" a user counts on a
        // tab switch — and for an alternate-screen program it is a paint of something that will be
        // overwritten anyway. Recorded so a test can assert on it rather than on flicker.
        (window as unknown as { __throngLastReplayBytes?: number }).__throngLastReplayBytes =
          res.scrollback?.length ?? 0;
        if (res.scrollback) term.write(res.scrollback);
        // Scrollback is applied — open the gate and flush any live output that
        // arrived during the attach window, in order, after the backlog.
        for (const chunk of gate.release()) writeChunk(chunk);
        // Restore the scroll offset + selection the user left before this view was
        // torn down (issue 144, follow-up). Deferred behind an empty write so it runs
        // AFTER the replayed backlog has been parsed (xterm writes are async), and
        // measured from the buffer bottom so live output that grew the scrollback
        // while detached doesn't throw the position off.
        const savedTerminalView = takeTerminalViewState(panelId);
        if (savedTerminalView) {
          term.write('', () => {
            if (disposed) return;
            const buffer = term.buffer.active;
            if (savedTerminalView.offsetFromBottom > 0) {
              term.scrollToLine(Math.max(0, buffer.baseY - savedTerminalView.offsetFromBottom));
            }
            const sel = savedTerminalView.selection;
            if (sel) {
              // getSelectionPosition() is 1-based; select()/selectLines() are 0-based.
              if (sel.start.y === sel.end.y) {
                term.select(sel.start.x - 1, sel.start.y - 1, Math.max(1, sel.end.x - sel.start.x));
              } else {
                term.selectLines(sel.start.y - 1, sel.end.y - 1);
              }
            }
          });
        }
        if (res.status === 'exited') {
          onExitRef.current({ code: res.exit?.code ?? null, unexpected: true });
        } else {
          // Attach resolves asynchronously and LATE — this used to be the last focus call of all, so a
          // background terminal in a multi-panel tab stole focus from the active panel on every switch.
          // Focus only when this terminal is still the active panel (issue 144).
          focusIfActive(term);
          /*
           * 028 (#162) — ask the program to redraw, now that this view has been rebuilt.
           *
           * An inactive tab is not hidden: its panels are UNMOUNTED (tab-group renders only the
           * active tab's tree). So every tab switch disposes this xterm and builds a new one, and
           * what we have just written into it is the daemon's replayed byte tail — which cannot
           * represent a full-screen program's screen. The program paints absolutely and redraws only
           * when the window changes, so without this it goes on sending deltas against a screen that
           * was never drawn, and the user sees overlapping glyphs and wrong wrapping until they drag
           * a divider. That drag is a grid change; this is the same signal, asked for deliberately.
           *
           * Only for a session that was ALREADY RUNNING when we attached: a cold start has painted
           * nothing yet, and there is nothing to redraw.
           */
          // The daemon forces the redraw itself when this view is a REBUILD, and says so. Asking
          // again would double a full-screen repaint the user sees as a flash.
          if (res.grid && res.redrawn !== true) requestRedraw(panelId, 'attach');
          else if (res.redrawn === true) countReconcile(panelId, 'attach');
        }
      })
      .catch((err: unknown) => {
        // No cause here by construction: this is a THROWN transport failure (the IPC bridge itself
        // rejected), not a daemon-classified one, so the panel reverts as it does today.
        if (!disposed) onErrorRef.current(err instanceof Error ? err.message : 'terminal attach failed');
      });

    // Resize only when the character grid actually changes — a same-size resize
    // still makes shells (notably PowerShell/PSReadLine) repaint, so firing it on
    // every sub-pixel reflow made terminals redraw whenever any panel was resized.
    // Debounced so a divider drag coalesces into one resize.
    let lastCols = term.cols;
    let lastRows = term.rows;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const applyResize = (): void => {
      // MEASURE the container's capacity — do NOT fit()/resize the xterm here. The xterm's
      // size is driven solely by the shared grid the daemon broadcasts back (conformGrid).
      // If a view sized itself to its own container it would diverge from a smaller
      // mirrored view and render a full-screen program offset (008 FR-009). fit.fit() is
      // measure-and-apply; proposeDimensions is measure-only, exactly what we want.
      const dims = fit.proposeDimensions();
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
      if (dims.cols === lastCols && dims.rows === lastRows) return;
      lastCols = dims.cols;
      lastRows = dims.rows;
      // Report THIS view's capacity; the daemon re-derives the grid as the minimum across
      // all views, resizes the PTY only if that minimum moved, and broadcasts the grid
      // back — which is what actually resizes this xterm (008 FR-010/FR-013).
      void bridge.resize(panelId, dims.cols, dims.rows, viewId);
    };
    // Publish so the font/zoom effect can trigger a re-measure when the effective
    // font size changes (012, FR-012 / SC-005).
    applyResizeRef.current = applyResize;
    const observer = new ResizeObserver(() => {
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyResize, 60);
    });
    observer.observe(container);

    // Periodic self-heal repaint (FR-109): some shells (notably PSReadLine) leave
    // xterm's rendered view subtly stale — artifacts the user otherwise clears by
    // resizing a panel. A full `refresh` re-renders every visible row FROM THE
    // BUFFER: it changes no content, scrollback, cursor, selection, or focus, so it
    // never interrupts typing or work. Skipped while the terminal is hidden (an
    // inactive tab → no offsetParent) so background terminals cost nothing.
    // It is NOT skipped while the pointer rests on a link, though an earlier revision of the hover
    // tip did skip it: a repaint makes xterm re-evaluate its link providers and re-report the hover,
    // and suppressing the repaint was the belt-and-braces half of stopping the tip from flickering.
    // The braces were harmful. A pointer left over a link — claude prints URLs, and a user reading
    // output leaves the mouse where it lies — would suspend the self-heal INDEFINITELY, which is
    // precisely the "the terminal stopped updating until I did something else" the timer exists to
    // prevent. The belt (setHovered ignoring a re-report of the link it is already showing) is what
    // actually fixed the flicker, and it needs no help.
    /*
     * The periodic repaint is GONE (028 follow-up, at the maintainer's call).
     *
     * It re-rendered the visible rows FROM THE BUFFER every few seconds, so it could never fix the
     * corruption it was aimed at - when the buffer itself is wrong, painting it again paints the
     * same wrong thing. The real cure is event-driven: a rebuilt view asks the program to redraw.
     * What was left was a timer firing forever in every visible terminal, counted in the
     * diagnostics as `backstop` and doing nothing anyone could point at.
     */

    return () => {
      disposed = true;
      applyResizeRef.current = null;
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      container.removeEventListener('paste', swallowNativePaste, true); // issue 142 paste seam
      // 024 US7 (#159 follow-up): drop the right-button guard and the hover tooltip element.
      container.removeEventListener('mousedown', swallowRightButton, true);
      container.removeEventListener('mouseup', swallowRightButton, true);
      container.removeEventListener('auxclick', swallowRightButton, true);
      if (linkTipTimer !== undefined) clearTimeout(linkTipTimer);
      if (linkTipHideTimer !== undefined) clearTimeout(linkTipHideTimer);
      linkTip.remove();
      observer.disconnect();
      offOutput();
      offGrid();
      offExit();
      // Detach THIS view so the daemon drops it from the shared grid and recomputes
      // across the survivors (008 FR-010). This is NOT a kill: the session keeps running
      // for its other views, and is terminated by the daemon only when the last view of a
      // sub-workspace-owned panel goes (FR-007). A window-close that never runs this
      // cleanup is backstopped by the main process (FR-008a).
      void bridge.detach?.(panelId, viewId);
      cleanupSearch?.();
      // Remember the scroll offset + selection before the xterm is disposed, so the
      // next mount of this terminal (tab/panel/project switch) can restore them
      // (issue 144, follow-up). Offset is measured from the buffer bottom.
      const activeBuffer = term.buffer.active;
      saveTerminalViewState(panelId, {
        offsetFromBottom: Math.max(0, activeBuffer.baseY - activeBuffer.viewportY),
        selection: term.getSelectionPosition() ?? undefined,
      });
      // NB: the live title is NOT cleared here (#295). It belongs to the SESSION, like the scroll
      // offset saved two lines above and the keyboard mode next to it — not to this view of it.
      // It is dropped when the program actually exits, in the `onExit` handler.
      forgetDiagnostics(panelId); // 028 FR-009 — counters are per live view, not a growing ledger
      unregisterTerminalFocus(panelId);
      unregisterRefresh();
      container.removeEventListener('focus', noteFocusChange, true);
      container.removeEventListener('blur', noteFocusChange, true);
      term.dispose();
      termRef.current = null;
      if (opts.apiRef) opts.apiRef.current = null;
    };
    // `opts.attempt` is a dep so a retry (008 FR-005) re-runs the effect and reattaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, projectId, projectRoot, rootless, runAsAdmin, flavourId, shellArguments, startupCommand, container, opts.attempt]);
}
