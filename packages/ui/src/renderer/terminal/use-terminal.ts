import { useEffect, useRef, type MutableRefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { shouldDropScrollback } from './clear-detect.js';
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
  onExitRef.current = opts.onExit;
  onErrorRef.current = opts.onError;
  onStillStartingRef.current = opts.onStillStarting;
  onAttachedRef.current = opts.onAttached;
  themeRef.current = opts.theme;
  metaRef.current = opts.meta;

  const termRef = useRef<Terminal | null>(null);

  // Live theme updates (hot-reload) without recreating the terminal.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = opts.theme;
  }, [opts.theme]);

  // Hot-reload the terminal font when the theme's terminal role changes (FR-074).
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.options.fontFamily = opts.fontFamily;
    t.options.fontSize = opts.fontSize;
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
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      theme: themeRef.current,
      // NB: do NOT set `windowsPty` here. Without a matching Windows build number it
      // applies the wrong ConPTY reflow/wrapping heuristics and garbles scrolled
      // PowerShell output. (cls/clear is handled separately via isScreenClear.)
    });
    termRef.current = term;
    if (opts.apiRef) opts.apiRef.current = { getSelection: () => term.getSelection() };
    const fit = new FitAddon();
    term.loadAddon(fit);
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

    // Live output can arrive before attach() resolves with the scrollback backlog
    // (the two travel on different sockets). Buffer it until scrollback is applied,
    // then flush in order, so a busy reattach/mirror never renders recent lines
    // above the older history. See TerminalOutputGate.
    const gate = new TerminalOutputGate();
    const offOutput = bridge.onOutput((e) => {
      if (e.panelId !== panelId || disposed) return;
      if (gate.accept(e.data)) writeChunk(e.data);
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
        if (res.scrollback) term.write(res.scrollback);
        // Scrollback is applied — open the gate and flush any live output that
        // arrived during the attach window, in order, after the backlog.
        for (const chunk of gate.release()) writeChunk(chunk);
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
      try {
        fit.fit();
      } catch {
        return; // container not measurable yet
      }
      if (term.cols === lastCols && term.rows === lastRows) return;
      lastCols = term.cols;
      lastRows = term.rows;
      // Arm the resize-repaint window so the repaint ConPTY sends back is not
      // mistaken for a `cls` (which would wipe the scrollback on enlarge).
      resizedAt = Date.now();
      // Report THIS view's measured size; the daemon re-derives the grid as the minimum
      // across all views and resizes the PTY only if that minimum moved (008 FR-010).
      void bridge.resize(panelId, term.cols, term.rows, viewId);
    };
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
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      clearInterval(repaintTimer);
      observer.disconnect();
      offOutput();
      offExit();
      // Detach THIS view so the daemon drops it from the shared grid and recomputes
      // across the survivors (008 FR-010). This is NOT a kill: the session keeps running
      // for its other views, and is terminated by the daemon only when the last view of a
      // sub-workspace-owned panel goes (FR-007). A window-close that never runs this
      // cleanup is backstopped by the main process (FR-008a).
      void bridge.detach?.(panelId, viewId);
      term.dispose();
      termRef.current = null;
      if (opts.apiRef) opts.apiRef.current = null;
    };
    // `opts.attempt` is a dep so a retry (008 FR-005) re-runs the effect and reattaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, projectId, projectRoot, rootless, runAsAdmin, flavourId, params, container, opts.attempt]);
}
