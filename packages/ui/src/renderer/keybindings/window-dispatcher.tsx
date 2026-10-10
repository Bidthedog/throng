/**
 * The ONE window-level chord dispatcher (048 R4, R5, FR-090 – FR-093, #275), mounted in the main window
 * (`app.tsx`) and in every sub-workspace window (`subworkspace-app.tsx`).
 *
 * One key normalisation (`resolveKeydown`), one Shift rule (`windowProducedEvent`), one resolver
 * (`resolveScoped`) and one gate ({@link WINDOW_HANDLED_ACTIONS}) — the same code in both windows. It
 * was `app.tsx`'s `KeybindingsHandler` until 048; a sub-workspace window used to run a second, narrower
 * listener of its own (`navigation-chrome.tsx`) that knew three commands and resolved them with a
 * different Shift rule, which is the drift #275 reported. Any difference between the two windows is
 * expressed here, once, through {@link WindowCapabilities} — never by a second code path (FR-091).
 *
 * It also hosts the window-scope {@link ChordEngine} (048 R4): multi-stroke window chords — the four
 * `panel.split*` commands, `Ctrl+Shift+Alt+End` then an arrow — run through it BEFORE single-stroke
 * resolution, so a pending split mode wins over `focus.*` on `Ctrl+Shift+Alt+Arrow` (FR-020a).
 */
import { useEffect, useRef, type ReactElement } from 'react';
import {
  COMMAND_SCOPES,
  KEYBINDINGS_METADATA,
  WINDOW_HANDLED_ACTIONS as CORE_WINDOW_HANDLED_ACTIONS,
  collectPanels,
  cycleOrder,
  effectiveActivePanelId,
  eventToToken,
  moveFocus,
  nextInCycle,
  normalizeToken,
  splitStrokes,
  type ActionId,
  type Direction,
  type DispatchScope,
  type Keybindings,
  type LayoutNode,
  type SplitDirection,
} from '@throng/core';
import { currentScope, resolveScoped, type ScopeInput } from './scope.js';
import { ChordEngine, type ChordIndicator } from './chord-engine.js';
import {
  carriedModifiers,
  chordKey,
  resolveKeydown,
  windowProducedEvent,
  withoutCarried,
  type CarriedModifiers,
  type ChordEventLike,
  type ResolverEvent,
} from '../config/chord-key.js';
import { useKeybindings } from '../config/config-store.js';
import { useOptionalContextMenu } from '../context-menu-provider.js';
import { useWorkspace } from '../state/workspace-store.js';
import { getEditorView } from '../editor/editor-views.js';
import { followLinkInPanel } from '../editor/link-decorations.js';
import { clearPendingChord, setPendingChord } from '../editor/pending-chord.js';
import { requestQuickOpen, setNavigationModal } from '../navigate/navigation-store.js';
import { requestFindInFiles } from '../find-in-files/open-find-in-files.js';
import { focusMostRecentNotice } from '../common/notification.js';
import { getExplorerCommands } from '../explorer/explorer-commands.js';
import { navigateFocusedHistory } from '../navigation/navigate-history.js';
import { focusPanel } from '../workspace/panel-focus.js';
import { getActivePane, setActivePane } from '../workspace/active-pane.js';
import { asKeyboardMenu } from '../workspace/keyboard-menu.js';
import { requestTabPicker } from '../workspace/tab-picker.js';
import { requestPanelDestroy } from '../workspace/panel-destroy.js';
import { toggleMaximisePanel } from '../workspace/maximise-store.js';
import { useSidePaneActions, type SidePaneActions } from '../workspace/side-pane-actions.js';
import { endSplitMode, getSplitModePanel, startSplitMode, subscribeSplitMode } from '../workspace/split-mode.js';

/**
 * 031 FR-032a — the command that opens the tab picker (`Ctrl+Alt+T` by default, rebindable).
 *
 * A named constant rather than a literal in two places, so the HANDLED gate and the dispatch below
 * cannot drift apart. Typed as an `ActionId`, so a rename in core's registry fails here rather than
 * silently leaving the chord unhandled.
 */
const TABS_OPEN_PICKER: ActionId = 'tabs.openPicker';

/**
 * 033 FR-001/FR-003 (#219) — Quick Open, from any focus context.
 *
 * Handled HERE, in the capture phase, which is the whole of AS-1: a focused terminal must receive no
 * keystroke at all, and only a capture-phase `preventDefault` on the window gets in front of xterm.
 * Adding it to this allowlist is one of the two edits data-model.md §2 records as SILENT failures —
 * the other is `isPanelScoped` in `keybindings/scope.ts`. Miss either and the chord compiles, binds,
 * resolves, and does nothing.
 */
const QUICK_OPEN: ActionId = 'navigate.quickOpen';

/**
 * 033 FR-025 / A2 (#219) — Go To Line, EDITOR-scoped.
 *
 * Handled here rather than inside CodeMirror, and the difference decides correctness. A keymap entry
 * would sit at `Prec.highest` with `preventDefault: true`, so the chord would be claimed INSIDE the
 * view before this listener ever saw it — and the scope gate below, which is the only thing keeping
 * `Ctrl+G` out of a terminal, would become unreachable code (A3).
 *
 * Adding it to the `HANDLED` allowlist is the second of the two edits data-model.md §2 records as
 * SILENT failures. Miss it and the chord compiles, binds, resolves, and does nothing at all.
 */
const GOTO_LINE: ActionId = 'navigate.gotoLine';

/**
 * 043 FR-028/FR-029 (#220, #153) — find in files and replace in files, from any focus context.
 *
 * Handled HERE for Quick Open's reason, and the trap is the same one the comment above records:
 * adding an action to the allowlist below is a SILENT failure to forget. The chord compiles, binds,
 * resolves — and does nothing at all, with no throw and no log.
 *
 * These two carry a sharper version of it. Both are `Ctrl+Shift+<letter>`, which is exactly the
 * shape that produced the `Ctrl+Shift+T` defect: the dispatcher used to drop Shift for every key
 * but the backtick and the function keys, so a letter chord arrived at the resolver one modifier
 * short and matched nothing. `window-chord-manifest.test.ts` is what stops that regression coming
 * back, and it fails the BUILD unless both appear in the coverage map in `tests/shared/window-chords.ts`.
 */
const FIND_IN_FILES: ActionId = 'search.findInFiles';
const REPLACE_IN_FILES: ActionId = 'search.replaceInFiles';

/**
 * 044 FR-105 (#136) — Back and Forward through the focused editor's or preview's history.
 *
 * Handled HERE, in the capture phase, because FR-105's last sentence is a precedence rule: in an editor,
 * Alt+Left and Alt+Right are CodeMirror's `cursorSyntaxLeft` / `cursorSyntaxRight` in `defaultKeymap`, and
 * only a window listener that runs BEFORE the view's own keydown handler — and stops the event — gets in
 * front of them. The scope is `HISTORY_PANELS` (editor and preview), so a terminal never loses the chord.
 */
const NAVIGATE_BACK: ActionId = 'navigate.back';
const NAVIGATE_FORWARD: ActionId = 'navigate.forward';

/**
 * The actions the WINDOW owns — intercepted and stopped in the capture phase, so they fire wherever
 * DOM focus happens to be. The set lives in core (048 T060), beside the rule it also decides: which
 * terminal-live commands may carry a multi-stroke chord (`terminalMultiStrokeAllowed`). One list, so
 * a command this dispatcher runs and a command whose chord validates can never disagree. Re-exported
 * here for the callers that have always imported it from the dispatcher.
 */
export const WINDOW_HANDLED_ACTIONS: ReadonlySet<string> = CORE_WINDOW_HANDLED_ACTIONS;

/**
 * 048 FR-092 (R5) — the window commands with nothing to act on in a sub-workspace window: each reaches
 * a side pane (Projects, File Explorer, the notice stack) or a main-window-only store, and a
 * sub-workspace window has none of them. Their chords are still consumed there — never reaching a
 * terminal — and say why nothing happened.
 */
export const SUB_WORKSPACE_UNAVAILABLE: ReadonlySet<string> = new Set<ActionId>([
  'project.next',
  'project.previous',
  'focus.projects',
  'focus.explorer',
  'view.toggleProjects',
  'view.toggleExplorer',
  'file.undo',
  'file.redo',
  'search.findInFiles',
  'search.replaceInFiles',
  'focus.notice',
]);

/**
 * What this window can act on (048 data-model "Window capabilities") — the ONE place a window-specific
 * difference in chord handling is expressed (FR-091).
 */
export interface WindowCapabilities {
  readonly kind: 'main' | 'sub-workspace';
  has(action: ActionId): boolean;
}

export const MAIN_WINDOW_CAPABILITIES: WindowCapabilities = { kind: 'main', has: () => true };

export const SUB_WORKSPACE_CAPABILITIES: WindowCapabilities = {
  kind: 'sub-workspace',
  has: (action) => !SUB_WORKSPACE_UNAVAILABLE.has(action),
};

/**
 * 048 R4 — the multi-stroke WINDOW commands and what each does. The window chord engine matches the
 * first strokes of these commands' bindings (whatever the user rebinds them to), and runs the command
 * on the second.
 */
const SPLIT_DIRECTION: Readonly<Partial<Record<ActionId, SplitDirection>>> = {
  'panel.splitDown': 'down',
  'panel.splitUp': 'up',
  'panel.splitRight': 'right',
  'panel.splitLeft': 'left',
};
/**
 * Which commands this engine hosts is core's answer, not a second list here: the same set decides
 * whether a multi-stroke chord on a terminal-live command validates at all (`terminalMultiStrokeAllowed`),
 * so a command admitted there is exactly one this engine runs.
 */
const WINDOW_MULTI_STROKE: readonly ActionId[] = [...CORE_WINDOW_HANDLED_ACTIONS];

/** A pending window chord: the first stroke as bound, and the modifiers it was pressed with. */
interface WindowPrefix {
  readonly first: string;
  readonly carried: CarriedModifiers;
}

/** Each two-stroke binding of a window multi-stroke command live in `scope`, as normalised strokes. */
function twoStrokeBindings(
  kb: Keybindings,
  scope: DispatchScope,
): { action: ActionId; first: string; second: string }[] {
  const out: { action: ActionId; first: string; second: string }[] = [];
  for (const action of WINDOW_MULTI_STROKE) {
    if (!COMMAND_SCOPES[action]?.has(scope)) continue;
    for (const token of kb.bindings[action] ?? []) {
      const strokes = splitStrokes(token);
      if (!strokes || strokes.length !== 2) continue;
      out.push({ action, first: normalizeToken(strokes[0] as string), second: normalizeToken(strokes[1] as string) });
    }
  }
  return out;
}

const tokenOf = (ev: ResolverEvent): string | null => {
  const token = eventToToken(ev);
  return token ? normalizeToken(token) : null;
};

/** The label the Key Bindings editor gives `action` — how FR-092's notice names it. */
function actionLabel(action: ActionId): string {
  return KEYBINDINGS_METADATA.find((d) => d.key === action)?.label ?? action;
}

/**
 * The on-screen rectangle of the text CURSOR inside `el`, if there is one.
 *
 * Read from the DOM selection rather than from any editor's own API, so this stays one generic
 * helper: CodeMirror's caret IS the document selection, and a surface with no text selection simply
 * yields nothing and falls back to its element box.
 *
 * It measures the selection's FOCUS end — the end that moves, where the cursor actually is — and not
 * the selection's bounding box. The box of a long unwrapped line selected with Shift+End starts at
 * the line's left edge, so anchoring to it put the menu back at the START of the selection, yards
 * from the cursor the user had just moved. A collapsed range reports width 0 with a correct
 * position, which is exactly what is wanted; an all-zero rect (a node that cannot be measured) falls
 * back to the whole selection, and then to the element.
 */
function caretRect(el: HTMLElement): DOMRect | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const { focusNode, focusOffset } = selection;
  if (focusNode !== null && el.contains(focusNode)) {
    const atCursor = document.createRange();
    try {
      atCursor.setStart(focusNode, focusOffset);
      atCursor.collapse(true);
      const cursor = atCursor.getBoundingClientRect();
      if (cursor.height !== 0 || cursor.width !== 0) return cursor;
    } catch {
      /* an offset the node cannot take — fall through to the selection's own box */
    }
  }
  try {
    const rect = range.getBoundingClientRect();
    if (rect.height === 0 && rect.width === 0) return null;
    return rect;
  } catch {
    // A Range that cannot report its own box (e.g. a test environment with no layout engine) falls
    // back to the element's own box, exactly as "an all-zero rect" already does above.
    return null;
  }
}

/**
 * The box of panel `panelId` when it shows a status bar — where split mode's text is drawn (048
 * FR-021: "where the panel has a status bar"). `null` for a panel with none (a placeholder,
 * Find in Files, or an editor/preview/terminal whose status bar is switched off): that panel shows
 * split mode's pulse alone.
 *
 * A DOM query rather than a lookup of the panel's kind and its setting, because "shown" is what the
 * requirement asks and the rendered bar is the one thing that answers it without restating three
 * panels' visibility rules. It reads no layout (Constitution XII).
 */
function statusBarHost(panelId: string | null | undefined): HTMLElement | null {
  const box = panelBox(panelId);
  return box?.querySelector('.editor-status-strip, .terminal-status-bar') ? box : null;
}

/**
 * 048 FR-131 — the panel `panel.destroy` acts on, judged from where keyboard focus is (`from`: the
 * keydown's target, or the focused element), or `null` when it acts on none.
 *
 *  - Focus inside a panel's box: THAT panel — the one that holds focus, which is not necessarily the
 *    tab's active panel (a find bar, a terminal, a placeholder's type form all sit inside the box).
 *  - Focus in a dialog or a menu: none. A destroy already waiting on its confirmation must not be asked
 *    for twice, and a menu's own keys are the menu's.
 *  - Anywhere else (the body, the tab strip): the active panel, but only while the WORKSPACE holds the
 *    active pane. With a side pane holding it (File Explorer, Projects) the chord destroys nothing.
 */
function destroyTarget(from: Element | null, activePanelId: string | undefined): string | null {
  const host = from?.closest?.('[data-panel-host]')?.getAttribute('data-panel-host');
  if (host) return host;
  if (from?.closest?.('[role="dialog"], [aria-modal="true"], [role="menu"]')) return null;
  return getActivePane() === 'workspace' ? (activePanelId ?? null) : null;
}

/** The box of panel `panelId`, whatever it shows. */
function panelBox(panelId: string | null | undefined): HTMLElement | null {
  if (!panelId) return null;
  for (const box of document.querySelectorAll<HTMLElement>('[data-panel-host]')) {
    if (box.getAttribute('data-panel-host') === panelId) return box;
  }
  return null;
}

export interface WindowDispatcherProps {
  capabilities: WindowCapabilities;
  /** Main window only — the pane toggles and reveals act on `App()`'s own persisted pane state. */
  onToggleProjects?: () => void;
  onToggleExplorer?: () => void;
  /** 046 US2 (FR-017) — reveal the sidebar/File Explorer pane if hidden; a no-op if already shown. */
  onRevealLeft?: () => void;
  onRevealRight?: () => void;
}

const noop = (): void => {};

/**
 * The side-pane dispatch (046 US2, `side-pane-actions.ts`), mounted ONLY in a window whose
 * capabilities include the side-pane commands, publishing into the dispatcher's ref.
 *
 * `useSidePaneActions` derives the reachable project list (project categories, the active project)
 * on every render. That is the main window's state: a sub-workspace window has no Projects pane and
 * no File Explorer, which is exactly why these four commands are unavailable there (FR-092). Calling
 * the hook unconditionally made every sub-workspace window compute — and depend on — state it never
 * uses. The capability that answers "can this window act on it?" is the one that decides whether the
 * state is read at all (FR-091: one place per window difference).
 */
function SidePaneBridge({
  onRevealLeft,
  onRevealRight,
  target,
}: {
  onRevealLeft: () => void;
  onRevealRight: () => void;
  target: { current: SidePaneActions | null };
}): null {
  target.current = useSidePaneActions(onRevealLeft, onRevealRight);
  useEffect(
    () => () => {
      target.current = null;
    },
    [target],
  );
  return null;
}

/** The four commands whose dispatch {@link SidePaneBridge} supplies. */
const SIDE_PANE_ACTIONS: readonly ActionId[] = ['project.next', 'project.previous', 'focus.explorer', 'focus.projects'];

/**
 * Resolves the window's keyboard accelerators from the user's live keybindings (FR-033) on real DOM
 * keydown events, in the CAPTURE phase so they fire wherever focus is. See the module doc.
 */
export function WindowDispatcher({
  capabilities,
  onToggleProjects = noop,
  onToggleExplorer = noop,
  onRevealLeft = noop,
  onRevealRight = noop,
}: WindowDispatcherProps): ReactElement | null {
  const keybindings = useKeybindings();
  const ws = useWorkspace();
  const cbRef = useRef({ onToggleProjects, onToggleExplorer });
  cbRef.current = { onToggleProjects, onToggleExplorer };
  const capsRef = useRef(capabilities);
  capsRef.current = capabilities;
  // 046 US2 — the SAME dispatch the cog menu's Navigate section uses (side-pane-actions.ts), read
  // through a ref for `onKeyDown`'s reason: the listener isn't re-subscribed on every render. Filled
  // by `SidePaneBridge`, which only a window that can act on the side panes mounts (see below).
  const sidePaneRef = useRef<SidePaneActions | null>(null);
  const hasSidePanes = SIDE_PANE_ACTIONS.every((a) => capabilities.has(a));
  // The workspace store is read through a ref so the keydown listener isn't
  // re-subscribed on every layout change (012 — per-type zoom routes to it).
  const wsRef = useRef(ws);
  wsRef.current = ws;
  // 048 FR-133 — the menu host, read through a ref for the same reason. Null only where no provider is
  // mounted (some component tests); both windows mount one in `composition-root.tsx`.
  const menu = useOptionalContextMenu();
  const menuRef = useRef(menu);
  menuRef.current = menu;
  /** The window chord engine's live instance, for the endings that are not keys (below). */
  const engineRef = useRef<{ end(): void; panel(): string | null } | null>(null);

  useEffect(() => {
    // The id of the active panel — the target of per-panel zoom (012, per-instance).
    // undefined when there is no active panel, in which case a zoom command no-ops.
    const activePanelId = (): string | undefined => {
      const layout = wsRef.current.layout;
      if (!layout) return undefined;
      const tab = layout.tabs.find((t) => t.id === layout.activeTabId);
      return tab ? effectiveActivePanelId(tab) : undefined;
    };
    // What the scope provider needs to answer "which context is the keyboard in?" (016).
    const scopeInput = (): ScopeInput => {
      const layout = wsRef.current.layout;
      return { tabs: layout?.tabs, activeTabId: layout?.activeTabId ?? null };
    };
    // The active tab's split tree + active panel — the input to move-focus (012, US3).
    const activeFocus = (): { tabId: string; root: LayoutNode; activeId: string } | null => {
      const layout = wsRef.current.layout;
      if (!layout) return null;
      const tab = layout.tabs.find((t) => t.id === layout.activeTabId);
      if (!tab) return null;
      const activeId = effectiveActivePanelId(tab);
      if (!activeId) return null;
      return { tabId: tab.id, root: tab.root, activeId };
    };
    // Move the active panel AND transfer DOM focus (012, US3 fix): after changing
    // which panel is active, route real keyboard focus into its input surface so
    // typing follows the indicator — from and to terminals and editors alike.
    /*
     * 048 FR-133 — a keyboard move leaves the panel it leaves the way a click on another panel does.
     *
     * A click elsewhere ends two kinds of transient state, by two existing mechanisms, and this reaches
     * each through the SAME one rather than a second: an open throng menu closes through the provider's
     * `closeMenu` — the very `onClose` its window `pointerdown` listener calls — and a native drop-down
     * (the type form's "Choose a type") closes because its `<select>` loses focus, so the focused element
     * is blurred before focus is sent anywhere. Nothing else is touched: a find bar's session lives in
     * `search-store.ts` and survives a blur, exactly as it survives a click elsewhere (spec 033).
     */
    const leaveTransientState = (): void => {
      if (menuRef.current?.isOpen) menuRef.current.closeMenu();
      const focused = document.activeElement;
      /*
       * A native drop-down's open list is NOT closed by blur in Electron on Windows — the maintainer's
       * report is exactly that: the chord moved focus, the select lost it, and the list stayed open.
       * Chromium does hide a select's popup when the element's layout tree is detached, so each select in
       * the panel being left (and the focused element, if it is one) is taken out of layout for one
       * forced layout and put straight back, with its previous inline `display` restored exactly.
       */
      const selects = new Set<HTMLSelectElement>(
        panelBox(activePanelId())?.querySelectorAll<HTMLSelectElement>('select') ?? [],
      );
      if (focused instanceof HTMLSelectElement) selects.add(focused);
      for (const select of selects) {
        const previous = select.style.display;
        select.style.display = 'none';
        void select.offsetHeight; // forces the style recalc / layout that detaches the popup's owner
        select.style.display = previous;
      }
      if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
    };
    const goToPanel = (tabId: string, target: string): void => {
      leaveTransientState();
      wsRef.current.setActivePanel(tabId, target);
      setActivePane('workspace'); // a workspace Panel is now active (gates Ctrl+S etc.)
      focusPanel(target); // move the caret / input into the target view
    };
    const dispatchMove = (dir: Direction): void => {
      // 046 FR-122 — the directional chords act only while the workspace holds the active pane.
      // From the Projects pane or the File Explorer they do nothing; the listener below has
      // already consumed the chord, so it reaches neither the list nor the tree.
      if (getActivePane() !== 'workspace') return;
      const f = activeFocus();
      if (!f) return;
      const target = moveFocus(f.root, f.activeId, dir); // null at the edge → stay put
      if (target && target !== f.activeId) goToPanel(f.tabId, target);
    };
    const dispatchCycle = (step: 1 | -1): void => {
      const f = activeFocus();
      if (!f) return;
      const target = nextInCycle(cycleOrder(f.root), f.activeId, step);
      if (target !== f.activeId) goToPanel(f.tabId, target);
    };

    /*
     * ══ THE WINDOW CHORD ENGINE (048 R4) — split mode ══
     *
     * The third host of 046's `ChordEngine`, after the editor and the preview. `'released-ok'`: the
     * arrow may follow `Ctrl+Shift+Alt+End` with those modifiers held OR let go (FR-020a), so neither
     * a release nor a key without them ends the prefix. Everything else — the 4 s timeout, Escape
     * consumed, an unbound key reported — is the engine's, unchanged (FR-022, FR-024).
     *
     * Split mode's visible state (the pulse, `split-mode.ts`) follows the engine's indicator exactly:
     * `pending` is split mode, anything else is not. So every ending the engine owns ends the pulse
     * and the pending text in the same call (FR-022 "at once"), and the endings it does not own —
     * blur, another panel, a menu, a drag — go through `engine.end()` and arrive the same way.
     */
    /** The panel the pending prefix is on — the active one when its first stroke was pressed. */
    let splitTarget: { tabId: string; panelId: string } | null = null;
    /**
     * 048 T060 (FR-024) — whether the pending prefix is a SPLIT chord's. The engine hosts every
     * window command's multi-stroke binding; only a split prefix is split mode, with its pulse and its
     * move of focus to the panel (FR-021). Any other prefix shows the pending text alone.
     */
    let prefixIsSplit = false;
    let splitPending = false;
    /** A window command matched as a second stroke that this window cannot act on (FR-092). */
    let deferredUnavailable: ActionId | null = null;
    /** The panel an `unavailable` notice is about — the active one when it was raised. */
    let noticePanel: string | null = null;
    /** Where this engine's indication was last drawn, so an ending clears exactly that one. */
    let shownOn: HTMLElement | null = null;

    const onIndicator = (indicator: ChordIndicator): void => {
      // Split mode's text goes only where a status bar is shown — without one the pulse says it alone
      // (FR-021). The `unavailable` notice has no pulse to fall back on, so it goes on the active
      // panel's box whatever that panel shows (SC-012, FR-092: never nothing at all).
      const host =
        indicator === null
          ? null
          : indicator.kind === 'unavailable'
            ? panelBox(noticePanel)
            : statusBarHost(splitTarget?.panelId);
      if (shownOn && shownOn !== host) clearPendingChord(shownOn);
      shownOn = host;
      if (indicator && host) setPendingChord({ kind: indicator.kind, host, keys: indicator.keys });
      if (indicator?.kind === 'pending' && splitTarget && prefixIsSplit) {
        splitPending = true;
        startSplitMode(splitTarget.panelId);
      } else {
        // Cleared BEFORE the store is told, so the store's own notification (subscribed below) sees
        // an engine that has already ended and does not end it a second time.
        splitPending = false;
        endSplitMode();
      }
    };

    // The host's matchers call `engine.begin` synchronously, as the engine's contract requires, so they
    // close over the instance they belong to (only ever called after it is constructed).
    /**
     * `e` as the FIRST stroke of a window multi-stroke chord live here: begins (or re-begins) the
     * prefix on the active panel and returns true, or returns false. Matched on the physical key first
     * (Constitution IV), then as reported with Shift kept — `End` encodes no Shift in its name, so the
     * window's Shift-dropping rule would lose it.
     */
    const beginIfFirstStroke = (e: ChordEventLike): boolean => {
      const f = activeFocus();
      if (!f) return false;
      const candidates = twoStrokeBindings(keybindings, currentScope(scopeInput()));
      if (candidates.length === 0) return false;
      const first = resolveKeydown(e, (ev) => {
        const token = tokenOf(ev);
        return token !== null && candidates.some((c) => c.first === token) ? token : null;
      });
      if (first === null) return false;
      splitTarget = { tabId: f.tabId, panelId: f.activeId };
      prefixIsSplit = candidates.some((c) => c.first === first && SPLIT_DIRECTION[c.action] !== undefined);
      // FR-021 — split mode is on the active panel, and keyboard focus goes there if it was
      // elsewhere (the File Explorer, the project list, a find bar). Only for a split prefix: another
      // window command's chord (a rebound `file.undo`, say) must not pull focus out of where it acts.
      if (prefixIsSplit) goToPanel(f.tabId, f.activeId);
      engine.begin({ first, carried: carriedModifiers(e) }, [first]);
      return true;
    };

    const engine: ChordEngine<WindowPrefix> = new ChordEngine<WindowPrefix>(
      {
        matchFirst: beginIfFirstStroke,
        matchNext: (e, prefix) => {
          if (!splitTarget) return false;
          const candidates = twoStrokeBindings(keybindings, currentScope(scopeInput())).filter(
            (c) => c.first === prefix.first,
          );
          const resolve = (ev: ChordEventLike): ActionId | null =>
            resolveKeydown(ev, (r) => {
              const token = tokenOf(r);
              return candidates.find((c) => c.second === token)?.action ?? null;
            });
          // Exactly as pressed first (a second stroke bound WITH modifiers), then with the first
          // stroke's modifiers cleared — FR-020a: an arrow with any of them still held is the bare
          // arrow, so `Ctrl+Shift+Alt+ArrowDown` here splits and never reaches `focus.down`.
          const action = resolve(e) ?? resolve(withoutCarried(e, prefix.carried));
          // FR-025 — the first stroke again restarts the timeout on the same panel: it EXTENDS the
          // prefix (`begin` again), so the engine keeps it pending rather than stacking a second mode.
          if (!action) return beginIfFirstStroke(e);
          const direction = SPLIT_DIRECTION[action];
          if (direction) {
            wsRef.current.splitPanel(splitTarget.tabId, splitTarget.panelId, direction);
          } else if (!capsRef.current.has(action)) {
            // Raised once the engine has finished with this key — its own completion would end a
            // notice raised from inside the match.
            deferredUnavailable = action;
          } else if (runAction(action) === 'unavailable') {
            // T060 (FR-024) — any other window command, through the same switch its single stroke
            // uses; one that found nothing to act on here is reported after the engine finishes.
            deferredUnavailable = action;
          }
          return true;
        },
        onIndicator,
      },
      { modifierPolicy: 'released-ok' },
    );
    engineRef.current = { end: () => engine.end(), panel: () => (splitPending ? (splitTarget?.panelId ?? null) : null) };

    // FR-022 — a menu opening or a drag starting ends split mode through the store; end the engine
    // with it so the timeout and the pending text go too.
    const unsubscribe = subscribeSplitMode(() => {
      if (splitPending && getSplitModePanel() === null) engine.end();
    });
    // FR-022 — focus leaving the window ends it.
    const onBlur = (): void => engine.blur();

    const onKeyDown = (e: KeyboardEvent): void => {
      // The window chord engine first: while split mode is pending it takes every key (FR-022, FR-023),
      // and its first stroke outranks single-stroke resolution.
      if (engine.keydown(e)) {
        if (deferredUnavailable !== null) {
          const action = deferredUnavailable;
          deferredUnavailable = null;
          noticePanel = activePanelId() ?? null;
          engine.notify({ kind: 'unavailable', keys: actionLabel(action) });
        }
        return;
      }
      /*
       * Shift is deliberately dropped for most keys (the produced character already encodes it,
       * e.g. "Ctrl++" is Ctrl+Shift+"="). The exceptions — the backtick, function keys, letters and
       * arrows, each with its own history — live in `chordCandidates` (046 FR-026, R2), which builds
       * the produced token and, for Ctrl+digit WITHOUT Alt, tries the PHYSICAL digit first.
       *
       * Window-level chords are live in every scope (012, FR-024b) — including from inside an
       * editor's find bar, so the user can always move focus out of wherever they are. The HANDLED
       * gate below is what keeps this listener to the window's own commands and nothing else.
       */
      const action = resolveKeydown(e, (ev) => resolveScoped(keybindings, ev, scopeInput()), windowProducedEvent(e));
      if (!action || !WINDOW_HANDLED_ACTIONS.has(action)) return;
      // 048 FR-131 — with focus where no panel is the target (a side pane, a dialog), Destroy Panel is not
      // this window's to take: the key goes on to whatever holds focus, unconsumed.
      if (action === 'panel.destroy' && destroyTarget(e.target as Element | null, activePanelId()) === null) return;
      // 054 FR-071 — Maximise / Restore Panel acts on the same panel Destroy Panel would, and the same way
      // passes the key on when that is none.
      if (action === 'panel.toggleMaximise' && destroyTarget(e.target as Element | null, activePanelId()) === null) return;
      // Capture phase: stop the focused terminal/editor from ALSO acting on the chord
      // (e.g. Git Bash turning Ctrl+Alt+Arrow into an escape sequence), then handle it.
      e.preventDefault();
      e.stopPropagation();
      // 048 FR-092 — nothing to act on in this window: consumed all the same, and said so.
      if (!capsRef.current.has(action) || runAction(action) === 'unavailable') {
        noticePanel = activePanelId() ?? null;
        engine.notify({ kind: 'unavailable', keys: actionLabel(action) });
      }
    };

    /**
     * What a window command DOES — one switch, reached by a single stroke and by a chord's last.
     * Returns `'unavailable'` when the command turned out to have nothing to act on in THIS window
     * (FR-092), which the caller reports exactly as it reports a capability the window lacks.
     */
    const runAction = (action: ActionId): 'unavailable' | void => {
      switch (action) {
        case 'zoom.in':
          window.throng?.zoomBy?.(1);
          break;
        case 'zoom.out':
          window.throng?.zoomBy?.(-1);
          break;
        case 'zoom.reset':
          window.throng?.zoomReset?.();
          break;
        // Per-panel zoom (012, per-instance) — routed to the active panel by id.
        case 'panel.zoomIn': {
          const id = activePanelId();
          if (id) wsRef.current.bumpZoom(id, 1);
          break;
        }
        case 'panel.zoomOut': {
          const id = activePanelId();
          if (id) wsRef.current.bumpZoom(id, -1);
          break;
        }
        case 'panel.zoomReset': {
          const id = activePanelId();
          if (id) wsRef.current.resetZoom(id);
          break;
        }
        // Keyboard move-focus (012, US3) — routed to the active tab's split tree.
        case 'focus.left':
          dispatchMove('left');
          break;
        case 'focus.right':
          dispatchMove('right');
          break;
        case 'focus.up':
          dispatchMove('up');
          break;
        case 'focus.down':
          dispatchMove('down');
          break;
        case 'focus.cycle':
          dispatchCycle(1);
          break;
        case 'focus.cycleBack':
          dispatchCycle(-1);
          break;
        /*
         * 046 iterate round 3 (FR-116) — back to the active tab's active panel, exactly as a
         * directional move ending there would go. UNLIKE `dispatchMove` / `dispatchCycle` it does
         * not skip when the target is already the active panel: that is the whole case — focus is
         * on a side pane or a notice, the active panel has not changed, and the caret must return.
         * With no project, no active tab or a tab with no panel, `activeFocus()` is null and the
         * chord does nothing (and raises no notice).
         */
        case 'focus.workspace': {
          const f = activeFocus();
          if (f) goToPanel(f.tabId, f.activeId);
          break;
        }
        /*
         * 041 FR-020 (#314) — focus the most recent notice.
         *
         * Dispatched from here rather than from inside the notification provider because the chord
         * is scoped EVERYWHERE (FR-020a): it has to work while focus is in a terminal, which is
         * where a notice is most likely to appear. Idempotent and never cycling — see FR-020d.
         */
        case 'focus.notice':
          focusMostRecentNotice();
          break;
        case 'view.fullscreen':
          window.throng?.fullscreenToggle?.();
          break;
        /*
         * 031 T5/T7 (FR-032a, FR-032d) — the tab picker, from anywhere.
         *
         * Live in every scope, at ANY tab count, including when nothing overflows: a user who knows
         * the name of the tab they want should not first have to make the strip too small to show
         * it. Chord and the strip's "show all" control open the SAME picker by construction — there
         * is one opener, and the strip registers it (tab-picker.tsx).
         */
        case TABS_OPEN_PICKER:
          requestTabPicker();
          break;
        /*
         * 033 (FR-001, FR-018, A5) — Quick Open. `requestQuickOpen` returns whether it opened, and
         * `false` is a legitimate outcome rather than a failure: with no project open in this window
         * there is nothing to list, so the chord is swallowed and nothing appears. Swallowed rather
         * than passed on, because a chord the application has claimed must not also reach a shell.
         * The opener is registered by `NavigationChrome`, mounted in both windows, which knows this
         * window's root (048 FR-093 — the sub-workspace used to open it from its own listener).
         *
         * 048 FR-092 / SC-012 (iterate round 1, D2) — in a SUB-WORKSPACE window a decline means the
         * active panel has no project root (an editor the sub-workspace itself owns), which is
         * "nothing to act on here" and must say so rather than do nothing. The main window's decline
         * stays silent, as 033 FR-018 asks.
         */
        case QUICK_OPEN:
          if (!requestQuickOpen() && capsRef.current.kind === 'sub-workspace') return 'unavailable';
          break;
        /*
         * 043 (FR-020–FR-022, FR-029d, FR-029e) — find and replace in files.
         *
         * ONE command with two entry points, which is FR-029d stated as code: replace in files is
         * find in files with `replace: true`, so the two cannot drift on which panel they reuse or
         * how they scope. The route is `chord`, and that is what licenses seeding from the focused
         * panel's selection (FR-031a) — the toolbar and the folder menu pass their own route and
         * seed nothing.
         *
         * `requestFindInFiles` returns whether anything opened, and `false` is a legitimate outcome
         * rather than a failure: with no project open there is nothing to search, so the chord is
         * SWALLOWED and nothing appears, and no notice is raised (FR-029e).
         */
        case FIND_IN_FILES:
          requestFindInFiles({ route: 'chord', replace: false });
          break;
        case REPLACE_IN_FILES:
          requestFindInFiles({ route: 'chord', replace: true });
          break;
        /*
         * 033 US2 (FR-025, A2, A4) — Go To Line, over the ACTIVE editor panel.
         *
         * The gate is stated here as well as declared in `COMMAND_SCOPES`, and the two are not
         * redundant in the way they look. `resolveScoped` answers "is this chord live?", which is
         * what keeps `^G` in a terminal (A3). This answers "which document does it act on?", and
         * `null` is a legitimate answer: with no active panel, or a placeholder one, there is no
         * view to jump inside and the chord does nothing at all (A4).
         */
        case GOTO_LINE: {
          const target = activePanelId();
          if (target && currentScope(scopeInput()) === 'editor') {
            setNavigationModal({ kind: 'gotoLine', panelId: target });
          }
          break;
        }
        /*
         * 044 FR-105 — the FOCUSED editor or preview only. A panel with no older (or newer) entry, or no
         * history yet, has no target and nothing happens — the chord is still swallowed, so it neither
         * moves an editor's caret by syntax nor reaches anything else.
         */
        case NAVIGATE_BACK:
          void navigateFocusedHistory(wsRef.current, 'back');
          break;
        case NAVIGATE_FORWARD:
          void navigateFocusedHistory(wsRef.current, 'forward');
          break;
        case 'view.toggleProjects':
          cbRef.current.onToggleProjects();
          break;
        case 'view.toggleExplorer':
          cbRef.current.onToggleExplorer();
          break;
        /*
         * 046 US2 (FR-010 – FR-017) — step the active project, or jump focus to a side pane. The SAME
         * `dispatch` the cog menu's Navigate section calls (side-pane-actions.ts), so choosing an item
         * there and pressing its chord can never disagree about what happens.
         */
        case 'project.next':
        case 'project.previous':
        case 'focus.explorer':
        case 'focus.projects':
          sidePaneRef.current?.dispatch(action);
          break;
        // 024 US3 (#85): undo/redo a FILE operation. Resolved here as well as in the tree's own
        // handler, because `file.*` only resolves at all while the active pane is File Explorer —
        // so this cannot reach an editor, and it works wherever focus sits inside the pane.
        case 'file.undo':
          getExplorerCommands()?.undoFileOp();
          break;
        case 'file.redo':
          getExplorerCommands()?.redoFileOp();
          break;
        // 048 FR-003 — a split command on a single-stroke binding: the active panel, that way, at once.
        case 'panel.splitDown':
        case 'panel.splitUp':
        case 'panel.splitRight':
        case 'panel.splitLeft': {
          const f = activeFocus();
          const direction = SPLIT_DIRECTION[action];
          if (f && direction) wsRef.current.splitPanel(f.tabId, f.activeId, direction);
          break;
        }
        /*
         * 048 FR-131 — the panel that holds focus runs its OWN destroy flow (the ✕'s: the same prompts,
         * the same verb, the same last-panel handling), through the opener it registered. A chord-engine
         * completion has no event, so it asks the focused element.
         */
        case 'panel.destroy': {
          const target = destroyTarget(document.activeElement, activePanelId());
          if (target) requestPanelDestroy(target);
          break;
        }
        /*
         * 054 FR-071, FR-071a — maximise or restore the panel that holds focus, in the tab that holds it.
         * Window-handled, so it is taken here ahead of a focused terminal or editor; Shift+Enter and
         * Ctrl+Enter resolve to nothing in this set and pass straight through.
         */
        case 'panel.toggleMaximise': {
          const target = destroyTarget(document.activeElement, activePanelId());
          const tab = target
            ? wsRef.current.layout?.tabs.find((t) => collectPanels(t.root).some((p) => p.id === target))
            : undefined;
          if (target && tab) toggleMaximisePanel(tab.id, target);
          break;
        }
        case 'menu.open':
          // 024 US6 (FR-018c): open the FOCUSED item's context menu without a mouse. Rather than
          // rebuild each surface's menu, re-dispatch a `contextmenu` at the focused element's centre —
          // the explorer row, editor and terminal all already handle that event, so this is one path
          // for all three. No focused element with a menu → nothing happens.
          {
            let el = document.activeElement as HTMLElement | null;
            // File Explorer: react-arborist keeps DOM focus on the tree CONTAINER (roving focus),
            // so a synthetic contextmenu on activeElement would open the ROOT menu even when a row is
            // highlighted (#157 follow-up). Redirect to the highlighted row; when nothing is
            // highlighted, to the root row — so the menu still comes off the root folder, not mid-pane.
            const tree = el?.closest?.('[data-testid="file-explorer-tree"]') ?? null;
            if (tree) {
              el =
                (tree.querySelector('[data-tree-focused="true"]') as HTMLElement | null) ??
                (tree.querySelector('.tree-row--root') as HTMLElement | null) ??
                el;
            }
            if (el && el !== document.body) {
              const target = el;
              // Anchor to the CARET where there is one (an editor's selection), else to the focused
              // element's corner. A menu for a text selection that opens at the top-left of a
              // full-height editor is pointing at nothing the user was looking at.
              const r = caretRect(target) ?? target.getBoundingClientRect();
              const x = Math.round(r.left + Math.min(r.width / 2, 20));
              const y = Math.round(r.top + Math.min(r.height / 2, 10));
              // Tell the handler this came from the keyboard: a mouse handler may act on the
              // POINTER (the editor moves the caret to a click outside the selection), and these
              // coordinates are a stand-in, not somewhere the user pointed. See keyboard-menu.ts.
              asKeyboardMenu(() =>
                target.dispatchEvent(
                  new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
                ),
              );
            }
          }
          break;
        default:
          break;
      }
    };
    // Capture phase (third arg true): runs BEFORE the focused widget's own key
    // handlers, so move-focus/zoom chords are intercepted even inside a terminal.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
      unsubscribe();
      engineRef.current = null;
      engine.destroy();
    };
  }, [keybindings]);

  /*
   * FR-022 — the active panel changing (a click on another panel, a tab switch) ends split mode: the
   * mode belongs to the panel it started on. The split itself makes its new panel active, but by then
   * the engine has already completed and nothing is pending.
   */
  const layout = ws.layout;
  const activeTab = layout?.tabs.find((t) => t.id === layout.activeTabId);
  const activeKey = `${layout?.activeTabId ?? ''}:${activeTab ? (effectiveActivePanelId(activeTab) ?? '') : ''}`;
  useEffect(() => {
    const engine = engineRef.current;
    const panel = engine?.panel();
    if (engine && panel && !activeKey.endsWith(`:${panel}`)) engine.end();
  }, [activeKey]);

  /*
   * 045 FR-044, FR-045 — the Open Link chord over the active EDITOR.
   *
   * ══ WHY IT IS A LISTENER OF ITS OWN, AND NOT A `WINDOW_HANDLED_ACTIONS` CASE ══
   *
   * The dispatcher above calls `preventDefault()` and `stopPropagation()` for EVERY action in its
   * allowlist, before the switch. That is right for a window chord — it is the whole reason
   * `Ctrl+Alt+Left` does not also reach Git Bash — and it is exactly wrong here. FR-044 keeps
   * Ctrl+Enter's editor meaning everywhere but inside a link, and that meaning is CodeMirror's own
   * `insertBlankLine` in `defaultKeymap`: swallowing the key unconditionally would delete it.
   *
   * So the key is taken ONLY when a link was actually followed. Capture phase all the same, because
   * `defaultKeymap` claims `Mod-Enter` inside the view and a bubble-phase listener would arrive
   * after the blank line had already been inserted — which is why `preview-commands.tsx`, which owns
   * this command's PREVIEW scope in the bubble phase, cannot host the editor scope too.
   *
   * `editorCommandKeymap` deliberately leaves the chord unbound and must stay that way: a keymap
   * entry at `Prec.highest` would claim the key inside the view and make the scope gate unreachable.
   */
  useEffect(() => {
    const onFollowLink = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const layout = wsRef.current.layout;
      const scope: ScopeInput = { tabs: layout?.tabs, activeTabId: layout?.activeTabId ?? null };
      const action = resolveKeydown(
        e,
        (ev) => resolveScoped(keybindings, ev, scope),
        { key: chordKey(e), ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey },
      );
      if (action !== 'preview.followLink') return;
      // The scope gate, stated here as well as declared in `COMMAND_SCOPES`, for Go To Line's
      // reason: `resolveScoped` answers "is this chord live?", this answers "on what?". A preview
      // panel's copy of the command is `preview-commands.tsx`'s, and FR-046 gives a terminal none.
      const tab = layout?.tabs.find((t) => t.id === layout.activeTabId);
      const target = tab ? effectiveActivePanelId(tab) : undefined;
      if (!target || currentScope(scope) !== 'editor') return;
      if (followLinkInPanel(target, getEditorView(target))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onFollowLink, true);
    return () => window.removeEventListener('keydown', onFollowLink, true);
  }, [keybindings]);
  return hasSidePanes ? (
    <SidePaneBridge onRevealLeft={onRevealLeft} onRevealRight={onRevealRight} target={sidePaneRef} />
  ) : null;
}
