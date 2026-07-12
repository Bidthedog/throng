/**
 * Keybindings (FR-033, data-model §3). A user-scoped map of stable action ids to
 * editable binding tokens (keyboard chords + named mouse-zoom gestures). Pure
 * resolver: an input event → binding token → action id. No OS/DOM here.
 */

export type ActionId =
  | 'zoom.in'
  | 'zoom.out'
  | 'zoom.reset'
  // Per-panel-type zoom (012, FR-014). Routed to the active panel's TYPE; distinct
  // from the app-wide global zoom.* above.
  | 'panel.zoomIn'
  | 'panel.zoomOut'
  | 'panel.zoomReset'
  // Keyboard move-focus (012, FR-015). Directional moves + a stable-layout-order
  // cycle over the active tab's panels; tokens use the produced key names.
  | 'focus.left'
  | 'focus.right'
  | 'focus.up'
  | 'focus.down'
  | 'focus.cycle'
  | 'focus.cycleBack'
  | 'view.fullscreen'
  | 'view.toggleProjects'
  | 'view.toggleExplorer'
  // File Explorer tree operations (004, FR-021). Resolved only while the
  // File Explorer Pane has focus (research D8).
  | 'file.rename'
  | 'file.cut'
  | 'file.copy'
  | 'file.paste'
  | 'file.delete'
  // Editor panel operations (006, FR-013/014). Resolved only while the active
  // pane is a workspace Panel, not Files & Folders (research D7).
  | 'editor.save'
  | 'editor.saveAll'
  | 'editor.saveAs'
  // In-panel search (013, FR-017/FR-020). One shared find affordance routed to the
  // ACTIVE panel: a terminal searches its scrollback (read-only), an editor searches
  // and replaces in its file. The replace commands are inert unless an editor is active.
  | 'search.find'
  | 'search.findNext'
  | 'search.findPrevious'
  | 'search.close'
  | 'search.replace'
  | 'search.replaceCurrent'
  | 'search.replaceAll'
  // Terminal scrollback navigation (013, FR-014/FR-016). Resolved only while a
  // terminal panel is active; never delivered as a keystroke to the running program.
  | 'terminal.scrollLineUp'
  | 'terminal.scrollLineDown'
  | 'terminal.scrollPageUp'
  | 'terminal.scrollPageDown'
  | 'terminal.scrollToTop'
  | 'terminal.scrollToBottom';

export interface Keybindings {
  version: number;
  /** action id → list of binding tokens (e.g. "Ctrl+=", "Ctrl+WheelUp", "F11"). */
  bindings: Record<string, string[]>;
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  version: 1,
  bindings: {
    'zoom.in': ['Ctrl+=', 'Ctrl++', 'Ctrl+WheelUp'],
    'zoom.out': ['Ctrl+-', 'Ctrl+WheelDown'],
    'zoom.reset': ['Ctrl+0', 'Ctrl+MiddleClick'],
    // Per-panel-type zoom (012) — distinct modifier family (Ctrl+Alt) from global zoom.
    'panel.zoomIn': ['Ctrl+Alt+=', 'Ctrl+Alt++'],
    'panel.zoomOut': ['Ctrl+Alt+-'],
    'panel.zoomReset': ['Ctrl+Alt+0'],
    // Keyboard move-focus (012). Arrow tokens use the produced key names (`Arrow*`).
    // The cycle chords use the BACKTICK key, normalised to `` ` `` from its physical
    // key (renderer `chordKey`) so `Ctrl+Shift+`` works on every layout — Shift+
    // backtick is `~` on US but `¬` on UK, so a produced-character token isn't
    // portable. All rebindable in the editor.
    'focus.left': ['Ctrl+Alt+ArrowLeft'],
    'focus.right': ['Ctrl+Alt+ArrowRight'],
    'focus.up': ['Ctrl+Alt+ArrowUp'],
    'focus.down': ['Ctrl+Alt+ArrowDown'],
    'focus.cycle': ['Ctrl+`'],
    'focus.cycleBack': ['Ctrl+Shift+`'],
    'view.fullscreen': ['F11'],
    'view.toggleProjects': ['Ctrl+B'],
    'view.toggleExplorer': ['Ctrl+N'],
    'file.rename': ['F2'],
    'file.cut': ['Ctrl+X'],
    'file.copy': ['Ctrl+C'],
    'file.paste': ['Ctrl+V'],
    'file.delete': ['Delete'],
    'editor.save': ['Ctrl+S'],
    'editor.saveAll': ['Ctrl+Shift+S'],
    'editor.saveAs': ['Ctrl+Alt+S'],
    // In-panel search (013). The find chords are the near-universal ones; because the
    // handler consumes them while a panel is active, a terminal's shell never sees them.
    'search.find': ['Ctrl+F'],
    'search.findNext': ['F3'],
    'search.findPrevious': ['Shift+F3'],
    'search.close': ['Escape'],
    'search.replace': ['Ctrl+H'],
    'search.replaceCurrent': ['Alt+Enter'],
    'search.replaceAll': ['Ctrl+Alt+Enter'],
    // Terminal scrollback navigation (013). Shift+Page is the conventional terminal
    // scrollback pair; the line/top/bottom chords follow the same "view, not input" family.
    'terminal.scrollLineUp': ['Ctrl+Shift+ArrowUp'],
    'terminal.scrollLineDown': ['Ctrl+Shift+ArrowDown'],
    'terminal.scrollPageUp': ['Shift+PageUp'],
    'terminal.scrollPageDown': ['Shift+PageDown'],
    'terminal.scrollToTop': ['Ctrl+Home'],
    'terminal.scrollToBottom': ['Ctrl+End'],
  },
};

/** A normalised input event (keyboard or a named mouse-zoom gesture). */
export interface KeyEvent {
  key?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Mouse-zoom gesture token, if any. */
  gesture?: 'WheelUp' | 'WheelDown' | 'MiddleClick';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse raw JSON into Keybindings, merging missing action ids from defaults.
 * Invalid binding entries are dropped; never throws.
 */
export function parseKeybindings(raw: unknown): Keybindings {
  if (!isRecord(raw)) return cloneKeybindings(DEFAULT_KEYBINDINGS);
  const rawBindings = isRecord(raw.bindings) ? raw.bindings : {};
  const bindings: Record<string, string[]> = { ...cloneBindings(DEFAULT_KEYBINDINGS.bindings) };
  for (const [action, value] of Object.entries(rawBindings)) {
    if (Array.isArray(value)) {
      bindings[action] = value.filter((t): t is string => typeof t === 'string');
    }
  }
  return {
    version: typeof raw.version === 'number' ? raw.version : DEFAULT_KEYBINDINGS.version,
    bindings,
  };
}

/** Build the canonical binding token for an event: `Ctrl+Shift+Alt+<key|gesture>`. */
export function eventToToken(ev: KeyEvent): string | null {
  const raw = ev.gesture ?? ev.key;
  if (!raw) return null;
  // The spacebar reports DOM key ' ' — canonicalise to 'Space' so chords resolve
  // consistently and reserved combos (e.g. Alt+Space) can be matched (007, FR-032a).
  const tail = raw === ' ' ? 'Space' : raw;
  const parts: string[] = [];
  if (ev.ctrl) parts.push('Ctrl');
  if (ev.shift) parts.push('Shift');
  if (ev.alt) parts.push('Alt');
  parts.push(tail);
  return parts.join('+');
}

/**
 * Canonicalise a binding token so a single-letter key matches case-insensitively
 * (a DOM keydown reports "b" while users naturally write "Ctrl+B"). Only the final
 * key segment is touched, and only when it is a lone A–Z letter — gestures, digits,
 * "F11", and the "+" key are left as-is.
 */
export function normalizeToken(token: string): string {
  const plus = token.lastIndexOf('+');
  const head = plus >= 0 ? token.slice(0, plus + 1) : '';
  const tail = plus >= 0 ? token.slice(plus + 1) : token;
  return tail.length === 1 && /[a-z]/i.test(tail) ? head + tail.toUpperCase() : token;
}

/** Resolve the action bound to an input event, or null if unbound. */
export function resolveAction(kb: Keybindings, ev: KeyEvent): ActionId | null {
  const token = eventToToken(ev);
  if (!token) return null;
  const norm = normalizeToken(token);
  for (const [action, tokens] of Object.entries(kb.bindings)) {
    if (tokens.some((t) => normalizeToken(t) === norm)) return action as ActionId;
  }
  return null;
}

function cloneBindings(b: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [...v]]));
}

function cloneKeybindings(kb: Keybindings): Keybindings {
  return { version: kb.version, bindings: cloneBindings(kb.bindings) };
}
