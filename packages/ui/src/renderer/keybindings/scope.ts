/**
 * The dispatch scope provider (016, FR-017b0/FR-017f/FR-024b) — ONE answer to "where are we?".
 *
 * Which context the keyboard is in was previously recomputed, slightly differently, at every
 * listener that cared (editor chrome, search dispatch, and a hand-rolled `reservedByTerminal`
 * table). Three copies of one question is three chances to disagree with each other, and a
 * scope-aware resolver makes that disagreement load-bearing: `Ctrl+X` means "cut a file" in one
 * context and "cut a line" in another, so the app must be certain which it is in.
 *
 * Renderer-only: it reads live DOM focus and the workspace store, which is exactly why it is
 * here and not in core.
 */
import {
  collectPanels,
  effectiveActivePanelId,
  resolveAction,
  type ActionId,
  type DispatchScope,
  type Keybindings,
  type LayoutNode,
  type Tab,
} from '@throng/core';
import { getActivePane } from '../workspace/active-pane.js';
import { transientOverlayOpen } from '../common/transient-overlay.js';

/** Panel kinds, as the workspace stores them. */
const EDITOR_KIND = 'editor';
const TERMINAL_KIND = 'terminal';

export interface ScopeInput {
  /** The workspace layout, or null when there is none (no tabs yet). */
  tabs?: readonly Tab[];
  activeTabId?: string | null;
}

function activePanelKind(input: ScopeInput): string | undefined {
  const tab = input.tabs?.find((t) => t.id === input.activeTabId);
  if (!tab) return undefined;
  const activeId = effectiveActivePanelId(tab);
  if (!activeId) return undefined;
  return collectPanels(tab.root as LayoutNode).find((p) => p.id === activeId)?.kind;
}

/**
 * The scope the keyboard is currently in.
 *
 * The Files & Folders pane is the `explorer` scope; a workspace panel is scoped by its TYPE. The
 * fallback is `explorer` — the one scope in which no text-editing command is live — because a
 * workspace pane showing a placeholder panel is not a text surface, and the safe answer to "is
 * Ctrl+X cut-line here?" is no. Window-level commands (zoom, focus movement, view toggles) are
 * live in EVERY scope, so they are unaffected by which fallback is chosen.
 */
export function currentScope(input: ScopeInput): DispatchScope {
  if (getActivePane() !== 'workspace') return 'explorer';
  return scopeFromKind(activePanelKind(input));
}

/**
 * The scope of a panel KIND — the one place the mapping lives, for callers that have already
 * resolved which panel is active and should not resolve it a second time (DRY, Principle VIII).
 */
export function scopeFromKind(kind: string | undefined): DispatchScope {
  if (kind === EDITOR_KIND) return 'editor';
  if (kind === TERMINAL_KIND) return 'terminal';
  return 'explorer';
}

/**
 * True while a TRANSIENT INPUT SURFACE inside a panel holds focus — 013's find bar above all
 * (FR-017f).
 *
 * This is the guard that makes `Tab` safe to bind. `Tab` is `editor.indentLines`' default, and
 * without this it would indent the document while the user is typing a search term into the find
 * bar: an editing command silently mutating the file from a surface that was never editing it.
 * While such a surface has focus, its keys win and none of the seven editor commands fire.
 *
 * CodeMirror's own content area is NOT a transient surface — it IS the document.
 */
export function transientInputFocused(doc: Document = document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.closest('.cm-content')) return false; // the document itself
  if (el.closest('[data-find-bar]')) return true; // 013's find/replace bar
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable;
}

/**
 * Resolve an input event in the current scope, honouring the focus guard (FR-017f).
 *
 * `null` while a transient input surface has focus AND the action is one of the panel-scoped
 * commands: the surface's own keys win. Window-level chords (012's move-focus and zoom) are
 * deliberately NOT suppressed — FR-024b requires them to outrank editor-scoped commands, and a
 * user must be able to leave a panel from inside its find bar.
 */
export function resolveScoped(
  kb: Keybindings,
  ev: Parameters<typeof resolveAction>[1],
  input: ScopeInput,
  opts: { transientFocus?: boolean; overlayOpen?: boolean } = {},
): ActionId | null {
  const scope = currentScope(input);
  const action = resolveAction(kb, ev, scope);
  if (!action) return null;
  const transient = opts.transientFocus ?? transientInputFocused();
  if (!transient || !isPanelScoped(action)) return action;
  /*
   * 033 FR-071 — ONE overlay hands over to ANOTHER, and the guard must not stand in the way.
   *
   * The guard's premise is that a transient input surface INSIDE A PANEL owns its keys. A transient
   * overlay is not inside a panel: it is drawn over the whole window, and while it holds the caret
   * there is no panel content the user could be editing. So the `<input>` the guard is seeing is the
   * overlay's own filter box, and reading it as "the find bar is busy" is a category error.
   *
   * Measured, not theorised: with Quick Open or the tab picker up, `Ctrl+G` and `Ctrl+Alt+T`
   * resolved to null and did nothing at all — four of SC-017's six orderings could not be driven by
   * hand, and the symptom was a chord that appeared to be ignored.
   *
   * BOTH conditions are required, and each rules out a different regression. Without
   * `overlayOpen`, `Ctrl+G` would start firing from inside an editor's FIND BAR, which is the case
   * FR-017f was written for. Without `opensTransientOverlay`, every panel command would come back
   * to life while the user is typing in Quick Open — `Ctrl+X` would cut a line in the editor
   * underneath instead of cutting the query.
   */
  const overlayOpen = opts.overlayOpen ?? transientOverlayOpen();
  return overlayOpen && opensTransientOverlay(action) ? action : null;
}

/**
 * The commands whose whole effect is to OPEN a transient overlay (033 FR-071).
 *
 * Named as a set rather than derived from a prefix: `navigate.gotoLine` opens one and
 * `navigate.quickOpen` opens one, but the `navigate.` prefix is not a promise that the next command
 * added under it will. The tab picker's command lives in a different namespace again, which is the
 * point — this is a property of what a command DOES, not of who owns it.
 */
const OVERLAY_OPENERS: ReadonlySet<string> = new Set<ActionId>([
  'navigate.quickOpen',
  'navigate.gotoLine',
  'tabs.openPicker',
]);

/** Does this command's dispatch put a transient overlay on screen? */
export function opensTransientOverlay(action: ActionId): boolean {
  return OVERLAY_OPENERS.has(action);
}

/**
 * Window-level commands (012) outrank everything (FR-024b). Everything else acts on a panel's
 * content and must yield to a focused input surface.
 */
export function isPanelScoped(action: ActionId): boolean {
  return !(
    action.startsWith('zoom.') ||
    // Every `panel.*` command acts on the PANEL — its zoom, its name — and none on the content
    // inside it. That is the whole distinction this predicate draws, so the test is the prefix
    // rather than `panel.zoom`: `panel.rename` was being suppressed by a focused input surface,
    // which meant F2 worked in an editor (whose content area is the document, not an input) and
    // did nothing whatever in a terminal, whose focused element IS a textarea.
    action.startsWith('panel.') ||
    action.startsWith('focus.') ||
    action.startsWith('view.') ||
    // 033 (#219) — Quick Open is a WINDOW command, like `tabs.openPicker`: it opens a modal over the
    // window and acts on no panel's content. It must survive a focused transient surface, because
    // the two places FR-003 is most about — a terminal, whose focused element IS a textarea, and an
    // editor's find bar — are exactly the ones this guard would otherwise silence it in.
    // An exact match, NOT a `navigate.` prefix: `navigate.gotoLine` (US2) acts inside one editor's
    // document and is panel-scoped, so a prefix here would silently widen to it.
    action === 'navigate.quickOpen'
  );
}

/**
 * The chords 012's window-level commands have claimed (FR-024b).
 *
 * These outrank every editor-scoped command, and the editor is the one context that can silently
 * overrule them: its commands are installed INSIDE CodeMirror at `Prec.highest`, which is precisely
 * the mechanism by which an editor swallows a chord before the window ever sees it. A user who has
 * moved focus with `Ctrl+Alt+Left` for a year does not expect it to stop working in an editor.
 *
 * The shipped defaults do not collide (012 uses `Ctrl+Alt+Arrow`, this feature `Shift+Alt+Arrow`),
 * so nothing here fires today. It fires the moment a user REBINDS one of the seven onto a chord the
 * window level already owns — which the keybinding editor permits, because the two live in different
 * scopes and are not a conflict.
 */
export function windowChords(kb: Keybindings): ReadonlySet<string> {
  const claimed = new Set<string>();
  for (const [action, chords] of Object.entries(kb.bindings)) {
    if (isPanelScoped(action as ActionId)) continue;
    for (const chord of chords) claimed.add(chord);
  }
  return claimed;
}

/**
 * The chords an editor command may install, with anything the WINDOW level already claims removed
 * (FR-024b).
 *
 * The precedence is enforced by OMISSION rather than by a runtime guard: a chord 012 owns is simply
 * never bound inside CodeMirror, so the keypress is not handled there, is not `preventDefault`ed,
 * and reaches the window-level listener exactly as it would with no editor focused. A guard that
 * ran inside the editor's handler and returned "not handled" would work too — but it would have to
 * be remembered by every one of the seven commands, and forgetting it in one of them is invisible
 * until a user rebinds that one command.
 */
export function editorChordsFor(kb: Keybindings, action: ActionId): readonly string[] {
  const claimed = windowChords(kb);
  return (kb.bindings[action] ?? []).filter((chord) => !claimed.has(chord));
}
