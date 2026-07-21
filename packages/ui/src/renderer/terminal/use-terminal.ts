import { useEffect, useRef, type MutableRefObject } from 'react';
import {
  THRONG_THEME,
  createKittyKeyboardState,
  applyKittyCsi,
  applyDecPrivateMode,
  encodeEnterKey,
  type KittyCsiPrefix,
} from '@throng/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { registerPanelSearch, unregisterPanelSearch } from '../search/search-controller.js';
import {
  createTerminalSearchController,
  type TerminalSearchDecorations,
} from '../search/terminal-search.js';
import type { SearchCount } from '../search/search-model.js';
import { shouldDropScrollback } from './clear-detect.js';
import { saveTerminalViewState, takeTerminalViewState } from './terminal-view-state.js';
import { parseOsc52 } from './osc52.js';
import { TerminalOutputGate } from './output-gate.js';
import { consumeExplicitRetype } from './explicit-retype.js';

export interface TerminalExit {
  code: number | null;
  unexpected: boolean;
}

/** Imperative handle exposed for the right-click menu (current text selection). */
export interface TerminalApi {
  getSelection(): string;
  /** Move DOM focus into the terminal's input surface (012, move-focus). */
  focus(): void;
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
  params: string;
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
  onError: (message: string) => void;
  /**
   * Called when the attach exceeds its budget (008 FR-005). NON-fatal: the session may
   * still be launching, so the view shows a "still starting" state with a retry — it does
   * NOT revert to the form (that is {@link onError}) and does NOT kill the session.
   */
  onStillStarting?: () => void;
  /** Called when an attach resolves as running — clears any "still starting" state. */
  onAttached?: () => void;
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
  /**
   * True for a key that belongs to throng (find, scrollback navigation) rather than to
   * the shell. xterm would otherwise handle these itself and write them to the pty;
   * reserving them is what keeps them out of the running program (FR-010 / FR-014).
   */
  reserveKey?: (e: KeyboardEvent) => boolean;
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
  const { panelId, projectId, projectRoot, rootless, runAsAdmin, flavourId, params, container } = opts;

  const onExitRef = useRef(opts.onExit);
  const onErrorRef = useRef(opts.onError);
  const onStillStartingRef = useRef(opts.onStillStarting);
  const onAttachedRef = useRef(opts.onAttached);
  const themeRef = useRef(opts.theme);
  const metaRef = useRef(opts.meta);
  // Search collaborators are read through refs too (013): the key-reservation predicate
  // changes when the user rebinds a chord or opens/closes find, and the highlight colours
  // change when the theme does — the mount effect must not freeze yesterday's copies.
  const reserveKeyRef = useRef(opts.reserveKey);
  const decorationsRef = useRef(opts.searchDecorations);
  const onSearchCountRef = useRef(opts.onSearchCount);
  onExitRef.current = opts.onExit;
  onErrorRef.current = opts.onError;
  onStillStartingRef.current = opts.onStillStarting;
  onAttachedRef.current = opts.onAttached;
  themeRef.current = opts.theme;
  metaRef.current = opts.meta;
  reserveKeyRef.current = opts.reserveKey;
  decorationsRef.current = opts.searchDecorations;
  onSearchCountRef.current = opts.onSearchCount;

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
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      theme: themeRef.current,
      // The search addon paints match highlights through xterm's decorations API, which
      // is still flagged "proposed" — without this it throws rather than highlighting (013).
      allowProposedApi: true,
      // NB: do NOT set `windowsPty` here. Without a matching Windows build number it
      // applies the wrong ConPTY reflow/wrapping heuristics and garbles scrolled
      // PowerShell output. (cls/clear is handled separately via isScreenClear.)
    });
    termRef.current = term;
    if (opts.apiRef) {
      opts.apiRef.current = {
        getSelection: () => term.getSelection(),
        focus: () => term.focus(),
      };
    }
    // Terminal keyboard negotiation state (#90): the kitty flags AND win32-input-mode the
    // running program has enabled. A modified Enter is reported in CSI-u form while kitty is
    // active, as a win32-input key event while win32-input-mode is (PowerShell/cmd), else as a
    // bare \n. Maintained by the CSI handlers registered below and read by the key handler; both
    // close over this one `let`.
    let kitty = createKittyKeyboardState();

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
      if (reserveKeyRef.current?.(e) === true) return false; // a throng chord — keep it off the pty
      const seq = encodeEnterKey(
        { key: e.key, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey },
        kitty,
      );
      if (seq !== null) {
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
      if (reply !== undefined) void bridge.write(panelId, reply);
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
        kitty = applyDecPrivateMode(kitty, flatten(params), enable);
        return false; // observe only — never claim the sequence
      };
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, onDecPrivateMode(true));
    term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, onDecPrivateMode(false));

    const fit = new FitAddon();
    term.loadAddon(fit);

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
    term.focus();
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
      if (drop) {
        term.write(data, () => {
          if (!disposed) term.clear();
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
      if (term.cols === cols && term.rows === rows) return;
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
      if (e.panelId === panelId && !disposed) onExitRef.current({ code: e.code, unexpected: e.unexpected });
    });
    term.onData((data) => {
      void bridge.write(panelId, data);
    });

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
        explicit: consumeExplicitRetype(panelId),
        rootless: rootless === true,
        runAsAdmin: runAsAdmin === true,
        flavourId,
        params,
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
          onErrorRef.current(res.error.message);
          return;
        }
        onAttachedRef.current?.(); // a successful attach clears any "still starting" state
        // Conform to the session's shared grid BEFORE replaying scrollback, so a view
        // joining an existing session (whose minimum it may not move — e.g. a larger
        // window mirroring a smaller one) renders the replayed screen at the right size
        // instead of offset (008 FR-009). The grid is absent only if there is no session.
        if (res.grid) conformGrid(res.grid.cols, res.grid.rows);
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
          term.focus();
        }
      })
      .catch((err: unknown) => {
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
    const repaintTimer = setInterval(() => {
      if (disposed || container.offsetParent === null) return;
      try {
        term.refresh(0, term.rows - 1);
      } catch {
        /* not measurable yet */
      }
    }, 2000);

    return () => {
      disposed = true;
      applyResizeRef.current = null;
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      clearInterval(repaintTimer);
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
      term.dispose();
      termRef.current = null;
      if (opts.apiRef) opts.apiRef.current = null;
    };
    // `opts.attempt` is a dep so a retry (008 FR-005) re-runs the effect and reattaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, projectId, projectRoot, rootless, runAsAdmin, flavourId, params, container, opts.attempt]);
}
