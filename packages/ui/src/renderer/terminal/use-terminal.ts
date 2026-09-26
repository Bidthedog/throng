import { useEffect, useRef, type MutableRefObject } from 'react';
import {
  THRONG_THEME,
  createKittyKeyboardState,
  applyKittyCsi,
  applyDecPrivateMode,
  applicationReadingInput,
  createMouseReportingState,
  MOUSE_REPORTING_MODES,
  kittyKeyboardActive,
  win32InputActive,
  decideWheel,
  encodeEnterKey,
  encodeModifiedKey,
  DEFAULT_APP_SETTINGS,
  type EditorLinkSettings,
  type KittyCsiPrefix,
  type PreviewProviderRegistry,
  type PreviewSettings,
} from '@throng/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';

import { registerPanelSearch, unregisterPanelSearch } from '../search/search-controller.js';
import {
  createTerminalSearchController,
  type TerminalSearchDecorations,
} from '../search/terminal-search.js';
import type { FailureCause } from '@throng/core';
import type { SearchCount } from '../search/search-model.js';
import {
  hoveredLinkReadoutText,
  hoveredLinkTipText,
  keepsClickFromProgram,
  type HoveredLink,
} from './hovered-link.js';
import { clearTerminalLinkReadout, setTerminalLinkReadout } from './terminal-link-readout-store.js';
import {
  activateTerminalHyperlink,
  followTerminalLink,
  hoveredLinkFromUri,
  hyperlinkTargetKind,
  plainClickShowsHint,
  type TerminalLinkDeps,
  type TerminalLinkSite,
} from './terminal-link-activation.js';
import { hideLinkHintFor, showLinkHint } from '../links/link-hint-store.js';
import { createFileLinkProvider, type ProvidedLink } from './file-link-provider.js';
import { linkMarkRefreshKey, useLinkMarkRefresh } from './link-mark-refresh.js';
import { createLinkViewMarks, terminalViewScan, type LinkViewMarks } from './link-view-marks.js';
import { linkScanOptions } from '../links/link-scan-options.js';
import { logicalLinesBetween } from './logical-line.js';
import { createLinkMarks, type MarkedLink } from './link-marks.js';
import { terminalLinkHintAnchor } from './link-hint-anchor.js';
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
import { terminalDebug, terminalDebugEnabled } from './debug-log.js';

/** #290 debug — the DEC modes worth a log line: the screens, alternate scroll, and mouse reporting. */
const DEBUG_LOGGED_MODES = new Set<number>([47, 1047, 1049, 1007, ...MOUSE_REPORTING_MODES]);
import { registerTerminalFocus, unregisterTerminalFocus } from './focus-registry.js';
import { getActivePane } from '../workspace/active-pane.js';

/*
 * 045 round five — the terminal's own floating hover tooltip is GONE, and with it
 * `LINK_TIP_LEAVE_GRACE_MS`, the delay it waited out (`terminals.linkHoverDelayMs`) and the
 * leave-grace that kept it steady under a motionless pointer.
 *
 * The maintainer's rule: "Any other popup / hover / title text should be removed." A link's full
 * target is carried by a native HTML `title` on the mark itself (`link-marks.ts`), which the OS
 * places, times and dismisses — so there is nothing here to position against the viewport, nothing to
 * flash while the pointer sweeps, and nothing to re-arm when xterm re-evaluates its providers under a
 * pointer that never moved. That last one was the whole of the #159 follow-up.
 *
 * What did NOT go: the hovered link itself. `setHovered` still records it, still drives the marks,
 * the status-bar readout (FR-167), the context menu and #198's click guard.
 */

/**
 * The link performers a terminal with no workspace around it has (045). Only the two destinations
 * that need one are missing; the OS routes are bridge calls and work regardless.
 */
const NO_LINK_DESTINATIONS: TerminalLinkDeps = {
  openInEditor: () => {},
  openInPreview: () => {},
  reportFailure: () => {},
};

/** xterm's internal OSC 8 link provider, as far as the view pass reads it. */
interface OscLinkSource {
  provideLinks(
    y: number,
    callback: (links: readonly { readonly text: string; readonly range: MarkedLink['range'] }[] | undefined) => void,
  ): void;
}

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
   * The link currently under the pointer — a web url, or a file link by grammar — or null (024 US7
   * FR-019d; 045 FR-042/FR-043). Read at right-click time so the context menu can offer the items
   * that apply to it.
   *
   * It used to be the url string alone. A file link carries the request main is asked at a follow or
   * a menu opening (FR-037, FR-155), and its position.
   */
  getHoveredLink(): HoveredLink | null;
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
  /*
   * `linkHoverDelayMs` (024 US7, #159 follow-up) is GONE — round five retired both the tooltip it
   * delayed and the setting behind it (`app-settings.ts`). A native `title` on the mark is the whole
   * hover now, and the OS owns its timing.
   */
  /**
   * 045 FR-023 — this terminal's LIVE working directory, as a reader rather than a value.
   *
   * A reader because it is consulted at hover time and `cd` moves it constantly: passing the value
   * would re-render the whole panel on every directory change to keep something the link path reads
   * once per pointer move. The panel supplies `() => peekTerminalCwd(panelId)`.
   */
  linkBaseDirectory?: () => string | undefined;
  /**
   * 045 FR-151 — whether this terminal's flavour is WSL, as a reader (the flavour list is a live
   * setting). True puts `wslFlavour: true` on every link request, so main skips Git's mount table.
   */
  linkWslFlavour?: () => boolean;
  /**
   * 045 FR-033 – FR-036 — where a followed link is allowed to open. The panel supplies these
   * because they need the workspace, the preferences and the notice surface, none of which a hook
   * inside the mount effect can reach. Absent means links are inert, which is what a surface that
   * has not been wired yet must do rather than half-open something.
   */
  linkActions?: TerminalLinkDeps;
  /**
   * 045 FR-060 — `editor.links.detectInTerminals`, as a reader. Absent means on.
   *
   * A reader for the same reason `linkBaseDirectory` is one: the link provider is registered once,
   * inside the mount effect, against a shell that must not be torn down to change a preference.
   */
  detectFileLinks?: () => boolean;
  /**
   * 045 FR-120 / FR-123 — `editor.links`, as a reader: the link provider holds its reply for the
   * existence-check timeout read here on every ask. Absent: the shipped defaults.
   */
  linkSettings?: () => EditorLinkSettings;
  /**
   * 045 FR-168 — what the tooltip's destination is worded from beyond the hover and the project root:
   * the open-target preference and the live preview registry/settings, so a terminal's wording can
   * name which editor, or a preview, exactly as an editor's own tooltip does. A reader for the same
   * reason `linkSettings` is one — read live, at hover time. Absent: `lastActive`, no preview.
   */
  linkWording?: () => {
    readonly openTarget?: 'lastActive' | 'new';
    readonly previewRegistry?: PreviewProviderRegistry;
    readonly previewSettings?: PreviewSettings;
  };
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
  // 045 — the link collaborators follow the same rule as the search ones above: read through refs,
  // so rebinding a preference or re-rendering the panel can never tear a running terminal down.
  const linkCwdRef = useRef(opts.linkBaseDirectory);
  const linkWslRef = useRef(opts.linkWslFlavour);
  const linkActionsRef = useRef(opts.linkActions);
  const detectLinksRef = useRef(opts.detectFileLinks);
  const linkSettingsRef = useRef(opts.linkSettings);
  const linkWordingRef = useRef(opts.linkWording);
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
  linkCwdRef.current = opts.linkBaseDirectory;
  linkWslRef.current = opts.linkWslFlavour;
  linkActionsRef.current = opts.linkActions;
  detectLinksRef.current = opts.detectFileLinks;
  linkSettingsRef.current = opts.linkSettings;
  linkWordingRef.current = opts.linkWording;
  // Read the active-panel predicate through a ref so the (async) attach focus below sees the CURRENT
  // active panel, not the one at mount time (issue 144).
  const isActiveRef = useRef(opts.isActive);
  isActiveRef.current = opts.isActive;
  /**
   * Focus the terminal ONLY when it is the active panel (issue 144) — default true when unset — AND
   * the workspace holds the active pane. A switch made from the Projects list leaves the list as the
   * active pane with focus on the chosen row (046 FR-082), so a terminal mounting or attaching under
   * it must not take the caret; the workspace's own routes (#144) still hand it over.
   */
  const focusIfActive = (term: Terminal): void => {
    if ((isActiveRef.current?.() ?? true) && getActivePane() === 'workspace') term.focus();
  };

  const termRef = useRef<Terminal | null>(null);
  // Re-measure-and-resize callback, published by the main effect so the font/zoom
  // effect below can recompute the grid when the effective font size changes (012).
  const applyResizeRef = useRef<(() => void) | null>(null);

  /*
   * 045 FR-178, FR-159, FR-060 / SC-008 (review round four, I3) — a link-settings change repaints the
   * marks AT REST, with nothing remounted.
   *
   * The mount effect publishes its view pass here; this asks it for one whenever the settings the scan
   * reads change. It is the only trigger that is not a row changing, which is why it cannot live
   * inside the effect: an idle terminal renders nothing, so the pass would never run.
   *
   * The readers are called during render deliberately — they read this panel's live settings context,
   * which is what re-renders the panel in the first place. Nothing is captured: the pass still reads
   * them again for itself.
   */
  const viewMarksRef = useRef<LinkViewMarks | null>(null);
  useLinkMarkRefresh(
    () => viewMarksRef.current,
    linkMarkRefreshKey({
      links: () => opts.linkSettings?.() ?? DEFAULT_APP_SETTINGS.editor.links,
      detect: () => opts.detectFileLinks?.() ?? true,
    }),
  );

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
    // 024 US7 (FR-019d) / 045 FR-042: the link currently under the pointer — a web url, or a file
    // link by grammar (FR-155) — tracked from the link hover callbacks so the context menu can act on
    // it at right-click time and so a Ctrl+press over it stays out of the program (FR-043).
    let hoveredLink: HoveredLink | null = null;
    /**
     * 045 FR-131 / FR-135 — the same link as a MARK: its kind, text and cell range, so every row of it
     * takes the hover state. Null whenever `hoveredLink` is, which is how a dead OSC 8 target gets no
     * hover state (FR-154).
     */
    let hoveredMark: MarkedLink | null = null;
    /**
     * Round five — the native `title` for the hovered link, and the whole of the hover now that the
     * floating tooltip is gone.
     *
     * It is the SAME string the status bar reads (`hoveredLinkReadoutText`), passed to `marks.sync`
     * rather than recomputed there, because the two naming one link differently is the failure this
     * feature has already had once: a rooted `/d/git/x.ts` read out against the working directory
     * while the click opened `D:\git\x.ts` (round four, I1). `''` whenever nothing followable is
     * hovered — `setHovered(null)` is the only way this is written, so there is no path that sets it
     * without clearing it.
     *
     * A plain string on a DOM attribute, deliberately: it is never measured and never laid out, so it
     * cannot repeat the readout's own trap, where a growing status bar resized the terminal, which
     * cancelled the hover, which cleared the readout.
     */
    let hoveredTitle = '';
    /** Repaints the marks; assigned once they exist (after `term.open`). */
    let syncMarks = (): void => {};
    /** Where a link seen in THIS panel is judged from (FR-021, FR-023). Read fresh: `cd` moves it. */
    const linkSite = (): TerminalLinkSite => ({
      panelId,
      ...(opts.projectId ? { originProjectId: opts.projectId } : {}),
      ...(linkCwdRef.current?.() ? { baseDirectory: linkCwdRef.current() as string } : {}),
      ...(linkWslRef.current?.() === true ? { wslFlavour: true as const } : {}),
    });
    /** The activation chord, as FR-165g's hint words it. (The tooltip that also used it is gone.) */
    const linkChord = /Mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';
    /**
     * Track the hovered link (045 FR-042, FR-043, FR-167).
     *
     * ══ ROUND FIVE: THIS NO LONGER DRIVES A TOOLTIP ══
     *
     * It used to own a floating `.terminal-link-tip` div, its 500 ms arming delay, a leave-grace and
     * a `tipKey` guard against xterm re-evaluating its providers under a motionless pointer. All of
     * it is gone: the link's full target is a native `title` on the mark (`link-marks.ts`), which the
     * OS steadies for free. What is left is the hover SIGNAL — and every reader of it stayed:
     *
     *  - the marks (`syncMarks`), which draw the hovered link solid across all of its rows;
     *  - the status-bar readout (FR-167);
     *  - `hoveredLink`, which the right-click menu (FR-019d) and #198's click guard read.
     *
     * ══ 045: THE `^https?://` TEST IS GONE FROM HERE ══
     *
     * It was one of three copies of the same scheme question, and this feature makes the question
     * have three answers rather than two. `hoveredLinkFromUri` asks it once, for every caller, by the
     * target's resource class alone (FR-163) — a well-formed `file:` target is a link whatever it
     * points at, and nothing is asked of main until it is followed.
     */
    const setHovered = (next: HoveredLink | null, mark: MarkedLink | null = null): void => {
      hoveredLink = next;
      hoveredMark = next === null ? null : mark;
      // FR-167 — the link's full target, worded ONCE: the status-bar readout and the mark's native
      // `title` are the same string. Computed before `syncMarks`, because that is what draws the
      // title. Immediate both ways: no delay to show it, and none to leave a stale target up.
      const readout = next === null ? null : hoveredLinkReadoutText(next, linkCwdRef.current?.(), projectRoot);
      hoveredTitle = readout ?? '';
      syncMarks();
      setTerminalLinkReadout(panelId, readout);
    };
    /** FR-159: the live protocol allowlist, as the one scheme gate reads it (T290). */
    const currentAllowlist = (): ReadonlySet<string> =>
      linkScanOptions(linkSettingsRef.current?.() ?? DEFAULT_APP_SETTINGS.editor.links).allowlist ?? new Set<string>();
    /**
     * FR-060, round five — `editor.links.detectInTerminals` for THIS terminal, read at every seam.
     *
     * It used to gate the guessed paths alone; it governs every kind of link now. The provider and the
     * view pass take it as their own `detect` reader; the three seams below are the ones neither of
     * them can see — xterm's OSC 8 hover, its activation, and the OSC 8 ranges the marks pass reads —
     * so a program's own hyperlink goes inert with the setting off exactly as a guessed path does.
     */
    const linksEnabled = (): boolean => detectLinksRef.current?.() ?? true;
    /** xterm's own hover callbacks hand over a URI; this is what one MEANS (FR-011 – FR-013). */
    const setHoveredUri = (uri: string | undefined, range?: MarkedLink['range']): void => {
      // FR-154 / FR-163: judged by the target's class alone, nothing asked. `next` is null for an
      // unfollowable target — and for every target while links are off — so there is no hover state,
      // no readout, no menu items, and a Ctrl+click that still reaches the program.
      const next = linksEnabled() ? hoveredLinkFromUri(uri, linkSite(), currentAllowlist()) : null;
      setHovered(next, uri === undefined || range === undefined ? null : { kind: 'osc8', text: uri, uri, range });
    };
    /** A link the provider served, as a mark — the same key the view pass draws it under. */
    const markOf = (link: HoveredLink | null, range: ProvidedLink['range'] | undefined): MarkedLink | null =>
      link === null || range === undefined
        ? null
        : link.kind === 'web'
          ? { kind: 'web', text: link.uri, range }
          : { kind: 'file', text: link.request.text, range };
    /**
     * 045 FR-011 – FR-013, FR-040 — one route for every terminal link gesture. `http(s)` keeps 024's
     * behaviour byte for byte; a resolving `file:` target follows the file-link route; nothing else
     * is openable at all.
     */
    const openTerminalLink = (event: MouseEvent, uri: string): void => {
      // FR-060, round five: with links off the gesture is the program's and nothing else's.
      if (!linksEnabled()) return;
      void activateTerminalHyperlink({
        event,
        uri,
        site: linkSite(),
        allowlist: currentAllowlist(),
        // Absent only where nothing mounted a workspace around this terminal — the web route and the
        // two OS routes still work, and throng's own two destinations have nowhere to open into.
        deps: linkActionsRef.current ?? NO_LINK_DESTINATIONS,
      });
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
        hover: (_event, uri, range) => setHoveredUri(uri, range),
        leave: () => setHoveredUri(undefined),
        /*
         * 045 FR-011 – FR-013 — without this, xterm never hands over a `file:` hyperlink at all.
         *
         * `OscLinkProvider` parses every OSC 8 target and DISCARDS anything that is not `http(s)`
         * before it builds a range, unless the link handler asks for the rest. So the whole of US2 —
         * a program emitting a `file:` hyperlink to a file or a folder, which is the report this
         * feature started from (SC-005) — was inert in the app while every unit test around it
         * passed: no underline, no tooltip, and a Ctrl+click that did nothing. Nothing below E2E
         * could see it, because nothing below E2E constructs an xterm `Terminal`.
         *
         * xterm's own doc for this option asks for "proper protection in `activate`", and that is
         * what this feature already built rather than something added alongside it:
         * `resourceClass` closes by default, so `javascript:`, `data:` and every unknown or
         * unallowlisted scheme stay exactly as inert as 024 made them, and a `file:` target never
         * reaches the OS url opener — it goes to main as TEXT, which re-resolves it against the
         * panel's own project before acting (FR-037).
         *
         * 045 FR-154 withdrew the cost this used to name ("an inert scheme now draws xterm's hover
         * underline"). An unfollowable hyperlink looks like plain text: `hover` above judges the target
         * by its class alone (`hoveredLinkFromUri`, FR-163 — sanitised, then the one scheme gate)
         * before anything is drawn, so such a target sets no hovered link, no tip and no menu items,
         * and its Ctrl+click still reaches the program (#198's guard sees nothing hovered). xterm's
         * OWN OSC 8 underline and pointer are switched off in `terminal.css`, and the one mark throng
         * draws (`link-marks.ts`) is only ever drawn for a followable target (O10, research R22).
         */
        allowNonHttpProtocols: true,
      },
      // NB: do NOT set `windowsPty` here. Without a matching Windows build number it
      // applies the wrong ConPTY reflow/wrapping heuristics and garbles scrolled
      // PowerShell output. (cls/clear is handled separately via isScreenClear.)
    });
    termRef.current = term;
    /*
     * 045 FR-136 / FR-154 — xterm's built-in OSC 8 provider, so the view pass can mark hyperlinks AT
     * REST. The public API cannot see an OSC 8 link until the pointer reaches it (`IBufferCell` has
     * no `urlId`), and xterm registers this provider first, in its constructor, so it is index 0 of
     * a list that holds nothing else yet. A documented reach into internals (O10, research R22):
     * guarded, and if a future xterm moves it the only loss is the at-rest mark on OSC 8 links —
     * hover, click and every other link kind are unaffected.
     */
    const oscLinks = (
      term as unknown as {
        _core?: { _linkProviderService?: { linkProviders?: readonly OscLinkSource[] } };
      }
    )._core?._linkProviderService?.linkProviders?.[0];

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
    /*
     * Is a REPLAYED scrollback tail being parsed right now (#290)?
     *
     * The tail is raw bytes and still contains every negotiation sequence the program ever emitted.
     * Parsing them again applies them a SECOND time on top of the state this view starts from — and
     * because the kitty protocol is a stack, two pushes against the program's one pop leave it
     * enabled for good. So while the tail is being written the negotiation handlers below observe
     * without mutating: the replay is paint, and the daemon's snapshot is the truth.
     *
     * Live output is not affected. The flag is cleared in the tail write's own callback, and xterm
     * parses writes in order, so anything that arrives after the replay is parsed normally.
     */
    let replayingTail = false;
    /** Keep the panel's copy in step whenever the program changes what it wants. */
    const rememberKitty = (): void => saveKeyboardMode(panelId, kitty);
    // 028 (#187): which DEC mouse-reporting modes the program has enabled. Tracked at the same
    // private-mode snoop that already drives the win32-input gate, because the wheel decision below
    // must not steal a gesture from a program that genuinely claimed the mouse.
    const mouseReporting = createMouseReportingState();
    /*
     * #290 debug — the copy symptom. With the program owning the mouse a drag should reach IT and
     * xterm should hold no selection; a selection appearing while the program believes it owns the
     * mouse is the state the report describes. Logged on the empty→non-empty edge only.
     */
    let hadSelection = false;
    term.onSelectionChange(() => {
      if (!terminalDebugEnabled()) return;
      const has = term.hasSelection();
      if (has && !hadSelection) {
        terminalDebug(panelId, 'selection', {
          length: term.getSelection().length,
          buffer: term.buffer.active.type,
          mouseReporting: mouseReporting.isOn(),
          xtermMouse: term.modes.mouseTrackingMode,
        });
      }
      hadSelection = has;
    });

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
        /*
         * ACCOUNTED like the onData path below, and it was not — which is why this defect could
         * hide behind its own diagnostics.
         *
         * `recordKeyBytes` above records what throng DECIDED. Only the onData path called
         * `countInputWritten` / `recordWrite` / `.then(acked).catch(failed)`, so a re-encoded
         * sequence appeared in `keys[].sent` and in NO write counter — and a failure here was
         * swallowed by the bare `void`. On the gate runner that produced diagnostics stating
         * `sent: "\u001b[13;5u"` for a chord the program never received, with `failed: 0`.
         *
         * These are the writes the feature exists for (#90 kitty CSI-u, and the 028 follow-up for
         * Ctrl+Backspace / Ctrl+Arrow), so they are exactly the ones that must be countable. The
         * reasoning behind FR-009b/FR-023 — a character the shell never received is invisible from
         * the rendered view, and only counting both ends can tell "typed" from "arrived" — applies
         * here at least as strongly.
         */
        countInputWritten(panelId);
        recordWrite(panelId, seq);
        void bridge
          .write(panelId, seq) // we transmit the newline / CSI-u ourselves…
          .then(() => countInputAcked(panelId, true))
          .catch(() => countInputAcked(panelId, false));
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
    // #290 debug: one line per CHANGE in what a notch was decided from, plus a heartbeat with the
    // count, rather than one per event — a wheel spin is dozens of events a second.
    let wheelSignature = '';
    let wheelCount = 0;
    let wheelLoggedAt = 0;
    term.attachCustomWheelEventHandler((e) => {
      const route = decideWheel({
        altBuffer: term.buffer.active.type === 'alternate',
        mouseReporting: mouseReporting.isOn(),
        ctrlKey: e.ctrlKey || e.metaKey,
      });
      if (terminalDebugEnabled()) {
        wheelCount += 1;
        const signature = `${route}|${term.buffer.active.type}|${String(mouseReporting.isOn())}|${term.modes.mouseTrackingMode}`;
        const now = Date.now();
        if (signature !== wheelSignature || now - wheelLoggedAt > 2000) {
          terminalDebug(panelId, 'wheel', {
            route,
            buffer: term.buffer.active.type,
            mouseReporting: mouseReporting.isOn(),
            xtermMouse: term.modes.mouseTrackingMode,
            viewportY: term.buffer.active.viewportY,
            baseY: term.buffer.active.baseY,
            notchesSinceLastLine: wheelCount,
          });
          wheelSignature = signature;
          wheelLoggedAt = now;
          wheelCount = 0;
        }
      }
      if (route === 'arrows') {
        // Three presses per notch — the conventional scroll step, and what xterm's own alternate
        // scroll sends. The bytes are exactly what a real arrow key produces, so the program cannot
        // tell this from a keyboard (FR-035c).
        const key = e.deltaY < 0 ? '[A' : '[B';
        void bridge.write(panelId, key.repeat(3));
        e.preventDefault();
        return false;
      }
      // zoom → the PANEL zoom gesture owns it now (046 iterate round 1, FR-106 — `mouse-zoom.ts`,
      // formerly the window-level zoom binding); program → xterm forwards it as a mouse event;
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
      // Replayed tail: already accounted for in what the daemon handed us, and answering a `?`
      // query from it would reply to a handshake the program completed long ago (#290).
      if (replayingTail) return true;
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
        // #290 — same rule as the kitty handler: a replayed tail must not re-negotiate. The
        // daemon tracks win32-input and bracketed paste too, so the state it handed over already
        // reflects these bytes.
        if (!replayingTail) {
          kitty = applyDecPrivateMode(kitty, modes, enable);
          rememberKitty();
        }
        // Mouse reporting is NOT suppressed: unlike the kitty stack these modes are idempotent flags
        // that re-applying cannot corrupt. The daemon's copy (#290) arrives through this same
        // handler, as the mode sequence the attach writes, so there is one path, not two.
        mouseReporting.apply(modes, enable); // 028 (issue 187) — same snoop, second question
        // #290 debug: the screen and mouse modes only — the ones the wheel and copy depend on.
        if (modes.some((m) => DEBUG_LOGGED_MODES.has(m))) {
          terminalDebug(panelId, 'dec-mode', {
            modes,
            enable,
            replayingTail,
            mouseReporting: mouseReporting.isOn(),
          });
        }
        return false; // observe only — never claim the sequence
      };
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, onDecPrivateMode(true));
    term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, onDecPrivateMode(false));


    const fit = new FitAddon();
    term.loadAddon(fit);
    /*
     * 045 FR-001, FR-130 – FR-133 — detected PATHS and web URLS, from one provider over the LOGICAL
     * line (so a link the terminal wrapped is one link on every row it occupies, #326).
     *
     * `WebLinksAddon` is no longer loaded (plan.md Complexity Tracking, second round): its urls now
     * come from the same `scanLinkLine` that keeps paths out of them (FR-009), and its Ctrl+click
     * keeps 024's route out of the app (`openTerminalLink` → `openExternal`, FR-019c). The provider is
     * called for the row under the pointer, never for output as it arrives (FR-072), and answers from
     * the grammar alone, asking main nothing (FR-155).
     */
    /** The live link settings — a reader, so a preferences edit reaches a terminal already open. */
    const readLinkSettings = (): EditorLinkSettings =>
      linkSettingsRef.current?.() ?? DEFAULT_APP_SETTINGS.editor.links;
    const fileLinkProvider = createFileLinkProvider({
      terminal: term,
      // FR-060, read per row. Round five: off means this terminal has NO links of any kind.
      detect: linksEnabled,
      site: linkSite,
      onHover: (hovered, _event, range) => setHovered(hovered, markOf(hovered, range)),
      follow: ({ request, position }) => {
        void followTerminalLink({
          request,
          ...(position === undefined ? {} : { position }),
          deps: linkActionsRef.current ?? NO_LINK_DESTINATIONS,
        });
      },
      openWeb: (event, uri) => openTerminalLink(event, uri),
      // The same options the view pass scans with, so the hover and the mark at rest agree on a span.
      scanOptions: () => linkScanOptions(readLinkSettings()),
    });
    const fileLinks = term.registerLinkProvider(fileLinkProvider);

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

    /*
     * #198 — a Ctrl+click on a link is throng's, not the program's.
     *
     * With mouse reporting on (Claude Code's full-screen UI, vim, tmux), xterm's always-on mousedown
     * listener on `.xterm` forwards the press to the pty — Ctrl is not a modifier that holds it back —
     * while its Linkifier on `.xterm-screen` ALSO activates the link on mouseup. Claude Code opens a
     * link it is Ctrl+clicked on, so one click opened two browser tabs.
     *
     * So when a link is under the pointer, the press stops at `.xterm-screen`: the Linkifier (whose
     * listener there was registered by `open()`, before this one) has already armed it, and the
     * reporting listener on the parent never sees it — which also means no release is reported, since
     * xterm only listens for one after forwarding a press. A Ctrl+click anywhere else still reaches
     * the program, so links the program draws itself (Claude's status line) keep working through it.
     * Windows Terminal behaves the same way.
     */
    const screenEl = term.element?.querySelector<HTMLElement>('.xterm-screen') ?? null;
    const keepLinkClickFromProgram = (ev: MouseEvent): void => {
      // 045 FR-043: `hoveredLink` now covers FILE links as well as web ones, and that widening is
      // the whole of this requirement — a Ctrl+click on a path throng resolved must not ALSO reach
      // the program, while one on text it did not resolve still must.
      if (
        !keepsClickFromProgram({
          hovered: hoveredLink,
          button: ev.button,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
          mouseTrackingMode: term.modes.mouseTrackingMode,
        })
      )
        return;
      ev.stopPropagation();
      ev.preventDefault();
      term.focus();
    };
    screenEl?.addEventListener('mousedown', keepLinkClickFromProgram);

    /*
     * 045 FR-165 (round four) — the plain-click link hint.
     *
     * ADDITIVE, never preventing anything: neither listener below calls `preventDefault` or
     * `stopPropagation`, so the click keeps whatever it always meant — placing the cursor, starting a
     * selection, or (FR-043) reaching a mouse-reporting program. `plainClickShowsHint` is the pure
     * gate (FR-165e: never on Ctrl+click, never on hover alone) — `hoveredLink` already carries
     * FR-165f's "that kind is enabled" (the hover pipeline never produces one for a switched-off
     * detection), and FR-165g's wording is the same `hoveredLinkTipText` the tooltip calls.
     *
     * The anchor is the hovered LINK's own last row's bottom-right corner (`terminalLinkHintAnchor`,
     * maintainer correction over round four's release-point anchor), in cell geometry read fresh at
     * mouseup — `.xterm-screen`'s own rect divided by `term.cols`/`term.rows` for a uniform monospace
     * cell, and `buffer.active.viewportY` for how far the view has scrolled. `hoveredMark` is null
     * only when `hoveredLink` itself never resolved to a mark (defensive); the release point is the
     * fallback then, same as when the geometry cannot be read at all.
     */
    let hintMouseDown: { x: number; y: number } | null = null;
    const onHintMouseDown = (ev: MouseEvent): void => {
      hintMouseDown = { x: ev.clientX, y: ev.clientY };
    };
    const onHintMouseUp = (ev: MouseEvent): void => {
      const start = hintMouseDown;
      hintMouseDown = null;
      if (start === null) return;
      const moved = Math.abs(ev.clientX - start.x) > 3 || Math.abs(ev.clientY - start.y) > 3;
      if (moved) return; // FR-165e — a drag selects; it is not a click
      if (!plainClickShowsHint(ev, hoveredLink)) return;
      const wording = linkWordingRef.current?.() ?? {};
      const clickPoint = { left: ev.clientX, top: ev.clientY, right: ev.clientX, bottom: ev.clientY };
      const screenRect = screenEl?.getBoundingClientRect();
      const anchor =
        hoveredMark && screenRect && screenRect.width > 0 && screenRect.height > 0 && term.cols > 0 && term.rows > 0
          ? terminalLinkHintAnchor(hoveredMark, {
              cellWidth: screenRect.width / term.cols,
              cellHeight: screenRect.height / term.rows,
              screenLeft: screenRect.left,
              screenTop: screenRect.top,
              viewportY: term.buffer.active.viewportY,
            })
          : clickPoint;
      showLinkHint({
        text: hoveredLinkTipText(hoveredLink!, linkChord, projectRoot, {
          openTarget: wording.openTarget,
          previewRegistry: wording.previewRegistry,
          previewSettings: wording.previewSettings,
        }),
        anchor,
        // FR-165d (I4): this panel's, so its destroy takes the hint with it and no other panel's.
        owner: panelId,
      });
    };
    screenEl?.addEventListener('mousedown', onHintMouseDown);
    screenEl?.addEventListener('mouseup', onHintMouseUp);

    /*
     * 045 FR-135, FR-136, FR-155, FR-172 — the one link affordance, marked AT REST (D5, T237).
     *
     * The rows in view are a pure input: every render (a write, a scroll, a resize) asks for a pass,
     * at most one per `LINK_MARK_THROTTLE_MS` with a trailing one after the last, and a pass runs the
     * grammar over the logical lines in view plus xterm's OSC 8 ranges for the same rows. Nothing
     * waits for the output to go quiet — Claude Code's spinner never lets it — and nothing is asked of
     * main: validity is syntactic (FR-155). A buffer switch clears every mark and marks the new buffer
     * at once. The marks draw them: dashed at rest, solid on hover across every row of the hovered
     * link — drawn from the hovered link itself (FR-172) — and the hand on every hover (FR-164).
     */
    let viewLinks: readonly MarkedLink[] = [];
    const marks = createLinkMarks({
      terminal: term,
      cols: () => term.cols,
      host: container,
      allowlist: currentAllowlist,
    });
    syncMarks = () => {
      // Round five: the fourth argument is the hover's native `title` — the same string the status
      // bar shows, never a second wording of the same link. `undefined` for `modifierHeld`, which
      // FR-164 withdrew.
      if (!disposed) marks.sync(viewLinks, hoveredMark, undefined, hoveredTitle);
    };
    /** The rows in view, 1-based and inclusive, as xterm's link ranges count them. */
    const viewRows = (): { top: number; bottom: number } => ({
      top: term.buffer.active.viewportY + 1,
      bottom: term.buffer.active.viewportY + term.rows,
    });
    const oscLinksInView = (): { range: MarkedLink['range']; uri: string }[] => {
      const found: { range: MarkedLink['range']; uri: string }[] = [];
      // FR-060, round five: with links off there is no mark for a declared hyperlink either.
      if (!linksEnabled()) return found;
      const { top, bottom } = viewRows();
      try {
        for (let y = top; y <= bottom; y += 1) {
          oscLinks?.provideLinks(y, (links) => {
            for (const l of links ?? []) {
              // data-model §16.9 / §16.15: sanitised, then judged by its class alone (FR-156, FR-163)
              // — `hyperlinkTargetKind` does both. An unfollowable target is text (FR-154).
              if (hyperlinkTargetKind(l.text, currentAllowlist()) === null) continue;
              found.push({ range: l.range, uri: l.text });
            }
          });
        }
      } catch {
        /* xterm's internals moved: OSC 8 links lose only their at-rest mark */
      }
      return found;
    };
    const viewMarks = createLinkViewMarks({
      onRender: (listener) => {
        const sub = term.onRender(() => listener());
        return () => sub.dispose();
      },
      onBufferChange: (listener) => {
        const sub = term.buffer.onBufferChange(() => listener());
        return () => sub.dispose();
      },
      logicalLinesInView: () => {
        const { top, bottom } = viewRows();
        return logicalLinesBetween(term.buffer.active, top, bottom);
      },
      // FR-060, FR-159, FR-178: the user's extensions and allowlist, the detection switch, and
      // (round five) the terminal's own working directory, all read per line — an edit or a `cd`
      // lands on the next pass with nothing remounted.
      scan: terminalViewScan({
        links: readLinkSettings,
        detect: linksEnabled,
        cwd: () => linkCwdRef.current?.(),
      }),
      oscLinksInView,
      draw: (links) => {
        viewLinks = links;
        syncMarks();
      },
      clear: () => {
        // Nothing drawn in the other buffer survives the switch — the hovered mark included. The
        // hovered LINK is left to xterm's own leave/hover, so the #198 guard is untouched.
        viewLinks = [];
        hoveredMark = null;
        syncMarks();
      },
    });
    // FR-178 (I3): published so a settings change can ask for a pass no row would ever trigger.
    viewMarksRef.current = viewMarks;

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
        /*
         * ADOPT what the program has negotiated, rather than working it out again (#290).
         *
         * This view may never have seen the negotiation — a panel in a background tab is unmounted,
         * and a program that turns enhanced key reporting off while nobody is watching was simply
         * not heard. The daemon reads every byte regardless, so it is asked instead.
         *
         * Before the replay, deliberately. The tail still contains the sequences that produced this
         * very state, so letting it re-apply them on top would count each push twice and leave the
         * protocol stuck on — which is the defect. `replayingTail` mutes the handlers for exactly
         * the span of the tail.
         */
        if (res.keyboard) {
          kitty = res.keyboard;
          rememberKitty();
        }
        /*
         * The mouse, likewise (#290, the wheel). For an alternate-screen program the tail is
         * withheld, so without this the view held `altBuffer: true` with no mouse reporting — a pair
         * that was never true while the program ran — and a wheel notch was typed at it as arrows.
         *
         * Written as the mode sequence, for the reason the `1049` above is: xterm's OWN mouse
         * protocol has to be on too, or a notch routed to the program is turned into an arrow key by
         * xterm's alternate-scroll fallback instead of a mouse report. The DEC-mode snoop sees this
         * write like any other, so `mouseReporting` follows without a second path. Idempotent flags,
         * so the tail replayed after it (normal buffer only) cannot corrupt them.
         */
        if (res.mouse && res.mouse.length > 0) {
          term.write(`\x1b[?${res.mouse.join(';')}h`);
        }
        // #290/#162 debug: what this (re)built view was handed, and what it holds after adopting it.
        terminalDebug(panelId, 'attach', {
          status: res.status,
          altScreen: res.altScreen,
          mouse: res.mouse,
          kitty: res.keyboard ? kittyKeyboardActive(res.keyboard) : undefined,
          replayBytes: res.scrollback?.length ?? 0,
          redrawn: res.redrawn,
          grid: res.grid,
          view: { cols: term.cols, rows: term.rows },
          buffer: term.buffer.active.type,
        });
        if (res.scrollback) {
          replayingTail = true;
          term.write(res.scrollback, () => {
            replayingTail = false;
          });
        }
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
      terminalDebug(panelId, 'view-dispose', {
        buffer: term.buffer.active.type,
        mouseReporting: mouseReporting.isOn(),
        xtermMouse: term.modes.mouseTrackingMode,
      });
      disposed = true;
      applyResizeRef.current = null;
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      container.removeEventListener('paste', swallowNativePaste, true); // issue 142 paste seam
      // 024 US7 (#159 follow-up): drop the right-button guard. (The hover tooltip element it also
      // removed is gone — round five: the link's target is a native `title` on the mark.)
      container.removeEventListener('mousedown', swallowRightButton, true);
      container.removeEventListener('mouseup', swallowRightButton, true);
      container.removeEventListener('auxclick', swallowRightButton, true);
      screenEl?.removeEventListener('mousedown', keepLinkClickFromProgram); // issue 198
      screenEl?.removeEventListener('mousedown', onHintMouseDown);
      screenEl?.removeEventListener('mouseup', onHintMouseUp);
      clearTerminalLinkReadout(panelId); // FR-167 — a recycled panel id must not inherit it
      // FR-165d (review round four, I4) — a hint this panel raised must not outlive it. Ctrl+W within
      // the 2.5 s window left it floating over whatever replaced the panel, naming a dead link.
      hideLinkHintFor(panelId);
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
      fileLinks.dispose(); // 045 — the link provider goes with the view that registered it
      // 045 FR-136, FR-164, FR-172 — the view pass and the marks go with it.
      viewMarks.dispose();
      if (viewMarksRef.current === viewMarks) viewMarksRef.current = null;
      marks.dispose();
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
