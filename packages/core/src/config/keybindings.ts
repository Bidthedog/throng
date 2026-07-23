/**
 * Keybindings (FR-033, data-model §3). A user-scoped map of stable action ids to
 * editable binding tokens (keyboard chords + named mouse-zoom gestures). Pure
 * resolver: an input event → binding token → action id, WITHIN a dispatch scope
 * (016, FR-017b0). No OS/DOM here.
 */
import type { OsName } from '../abstractions/platform-info.js';

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
  | 'terminal.scrollToBottom'
  // Editor text-editing commands (016, FR-017a/FR-025a). Live ONLY while an editor
  // panel is active — which is what lets `editor.cutLine` share Ctrl+X with the
  // Explorer's `file.cut` (their scopes are disjoint). Cut/Copy/Paste/Select All/
  // Undo/Redo are deliberately NOT here: they keep their native OS bindings so they
  // interoperate with the rest of the system (FR-017c).
  | 'editor.cutLine'
  | 'editor.indentLines'
  | 'editor.outdentLines'
  | 'editor.columnSelectUp'
  | 'editor.columnSelectDown'
  | 'editor.columnSelectLeft'
  | 'editor.columnSelectRight'
  // 024 US1 (#152): toggle word wrap for the focused editor's document. Ctrl+Alt+W — a single chord
  // the model already expresses, clear of the reserved terminal-key tier (constitution IV, v4.2.0).
  | 'editor.toggleWordWrap';

export interface Keybindings {
  version: number;
  /** action id → list of binding tokens (e.g. "Ctrl+=", "Ctrl+WheelUp", "F11"). */
  bindings: Record<string, string[]>;
}

/**
 * A context a command's chord is live in (016, FR-017b0). "Global" is not a special value —
 * it is simply the full set. Every registered command declares a NON-EMPTY set and there is
 * NO default: an unscoped command would be live everywhere, which is how a text-editing chord
 * ends up deleting a file.
 */
export type DispatchScope = 'editor' | 'terminal' | 'explorer';

export type CommandScopes = Readonly<Record<ActionId, ReadonlySet<DispatchScope>>>;

const EVERYWHERE = new Set<DispatchScope>(['editor', 'terminal', 'explorer']);
const EDITOR_ONLY = new Set<DispatchScope>(['editor']);
const TERMINAL_ONLY = new Set<DispatchScope>(['terminal']);
const EXPLORER_ONLY = new Set<DispatchScope>(['explorer']);
/** Panels, but not the file tree: a find bar and a save belong to whatever panel is showing. */
const PANELS = new Set<DispatchScope>(['editor', 'terminal']);

/**
 * The scope of every registered command (016, FR-017b0). Declared here, beside the chords, so a
 * new command cannot be added without answering "where is this live?" — the completeness test
 * fails if it is.
 */
export const COMMAND_SCOPES: CommandScopes = {
  // Window-level: zoom, focus movement and view toggles work wherever you are.
  'zoom.in': EVERYWHERE,
  'zoom.out': EVERYWHERE,
  'zoom.reset': EVERYWHERE,
  'panel.zoomIn': EVERYWHERE,
  'panel.zoomOut': EVERYWHERE,
  'panel.zoomReset': EVERYWHERE,
  'focus.left': EVERYWHERE,
  'focus.right': EVERYWHERE,
  'focus.up': EVERYWHERE,
  'focus.down': EVERYWHERE,
  'focus.cycle': EVERYWHERE,
  'focus.cycleBack': EVERYWHERE,
  'view.fullscreen': EVERYWHERE,
  'view.toggleProjects': EVERYWHERE,
  'view.toggleExplorer': EVERYWHERE,
  // The File Explorer's clipboard chords act on FILES, and only while the tree has focus.
  'file.rename': EXPLORER_ONLY,
  'file.cut': EXPLORER_ONLY,
  'file.copy': EXPLORER_ONLY,
  'file.paste': EXPLORER_ONLY,
  'file.delete': EXPLORER_ONLY,
  // Save acts on the active panel's document; it is inert, not wrong, in a terminal.
  'editor.save': PANELS,
  'editor.saveAll': PANELS,
  'editor.saveAs': PANELS,
  // One find bar, routed to the active panel (013): a terminal searches its scrollback.
  'search.find': PANELS,
  'search.findNext': PANELS,
  'search.findPrevious': PANELS,
  'search.close': PANELS,
  'search.replace': PANELS,
  'search.replaceCurrent': PANELS,
  'search.replaceAll': PANELS,
  // Scrollback navigation is meaningless anywhere but a terminal.
  'terminal.scrollLineUp': TERMINAL_ONLY,
  'terminal.scrollLineDown': TERMINAL_ONLY,
  'terminal.scrollPageUp': TERMINAL_ONLY,
  'terminal.scrollPageDown': TERMINAL_ONLY,
  'terminal.scrollToTop': TERMINAL_ONLY,
  'terminal.scrollToBottom': TERMINAL_ONLY,
  // The seven new editor commands (016). Editor-only is what makes Ctrl+X unambiguous.
  'editor.cutLine': EDITOR_ONLY,
  'editor.indentLines': EDITOR_ONLY,
  'editor.outdentLines': EDITOR_ONLY,
  'editor.columnSelectUp': EDITOR_ONLY,
  'editor.columnSelectDown': EDITOR_ONLY,
  'editor.columnSelectLeft': EDITOR_ONLY,
  'editor.columnSelectRight': EDITOR_ONLY,
  'editor.toggleWordWrap': EDITOR_ONLY,
};

/** The modifier held to drag a rectangular selection. Platform-keyed, like the chords (FR-017e). */
export type ColumnSelectModifier = 'Alt' | 'Ctrl' | 'Meta';

/** One platform's shipped input defaults: the chords AND the column-select mouse modifier. */
export interface PlatformBindings {
  bindings: Record<string, string[]>;
  columnSelectModifier: ColumnSelectModifier;
}

const WINDOWS_BINDINGS: PlatformBindings = {
  columnSelectModifier: 'Alt',
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
    // Editor text editing (016). `Ctrl+X` coexists with `file.cut` — the scopes are disjoint,
    // and the scope-aware collision rule permits exactly this.
    'editor.cutLine': ['Ctrl+X'],
    'editor.indentLines': ['Tab'],
    'editor.outdentLines': ['Shift+Tab'],
    // Canonical modifier order is Ctrl+Shift+Alt+key. Written `Alt+Shift+Arrow…` these tokens
    // would never match a real event, and the commands would be silently dead.
    'editor.columnSelectUp': ['Shift+Alt+ArrowUp'],
    'editor.columnSelectDown': ['Shift+Alt+ArrowDown'],
    'editor.columnSelectLeft': ['Shift+Alt+ArrowLeft'],
    'editor.columnSelectRight': ['Shift+Alt+ArrowRight'],
    'editor.toggleWordWrap': ['Ctrl+Alt+W'],
  },
};

/**
 * Shipped input defaults, KEYED BY PLATFORM (016, FR-017e — Principle II).
 *
 * Windows is the only platform this build ships, and the only key populated. macOS and Linux
 * join by ADDING VALUES — no existing key moves, and no consumer of the record changes shape.
 * That is the whole point: a flat action→chords record would have to be RESHAPED to gain a
 * platform, and by then ~19 call sites read it. No macOS chord is guessed here; an invented
 * default is worse than an absent one, because it looks decided.
 */
export const SHIPPED_KEYBINDINGS_BY_PLATFORM: Readonly<Partial<Record<OsName, PlatformBindings>>> = {
  windows: WINDOWS_BINDINGS,
};

/** The platform whose values this build resolves. */
export const DEFAULT_BINDING_PLATFORM: OsName = 'windows';

/**
 * The shipped bindings for `platform`. An unpopulated platform falls back to the populated one
 * rather than leaving the app with no bindings at all — a visible stopgap, not a guess baked
 * into the data.
 */
export function shippedBindingsFor(platform: OsName = DEFAULT_BINDING_PLATFORM): PlatformBindings {
  return SHIPPED_KEYBINDINGS_BY_PLATFORM[platform] ?? WINDOWS_BINDINGS;
}

/**
 * The resolved shipped bindings for this platform.
 *
 * Kept as a plain `Keybindings` — the same shape ~19 call sites (parse, reset, the editors, the
 * shipped-defaults record, the fidelity contract test) already read — so the platform key is a
 * change of SHAPE at the source and NOT at every consumer.
 */
export const DEFAULT_KEYBINDINGS: Keybindings = {
  version: 1,
  bindings: shippedBindingsFor().bindings,
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

/**
 * Resolve the action bound to an input event WITHIN a dispatch scope, or null if unbound there
 * (016, FR-017b0).
 *
 * The scope is REQUIRED, and that is the fix. Resolution returns the first match in map order and
 * `file.*` precedes `editor.*`, so a scope-blind resolver hands `Ctrl+X` inside an editor to the
 * Explorer's `file.cut` — and `editor.cutLine` never fires at all. A command is only a candidate
 * where it is live.
 */
export function resolveAction(
  kb: Keybindings,
  ev: KeyEvent,
  scope: DispatchScope,
  scopes: CommandScopes = COMMAND_SCOPES,
): ActionId | null {
  const token = eventToToken(ev);
  if (!token) return null;
  const norm = normalizeToken(token);
  for (const [action, tokens] of Object.entries(kb.bindings)) {
    if (!scopes[action as ActionId]?.has(scope)) continue;
    if (tokens.some((t) => normalizeToken(t) === norm)) return action as ActionId;
  }
  return null;
}

/**
 * The FIRST bound chord token for a command (US1, #125), or undefined if it is unbound. Context
 * menus render this in brackets after the label (e.g. "Copy (Ctrl+C)"). Tokens are already the
 * display form the keybindings editor shows, so no formatting is applied; only the first is used
 * even when a command has several (FR-002).
 */
export function firstBinding(kb: Keybindings, action: ActionId): string | undefined {
  return kb.bindings[action]?.[0];
}

/** Two commands that want the same chord in a context where both are live (FR-017b1). */
export interface ChordCollision {
  token: string;
  actions: ActionId[];
}

/**
 * Every real chord clash: two commands sharing a chord whose scope sets INTERSECT (FR-017b1).
 *
 * Enumerated from the command registry, never from a hand-listed set of features — a hand list
 * silently stops covering whatever command is added after it was written. Disjoint scopes are
 * NOT a clash: `editor.cutLine` ({editor}) and `file.cut` ({explorer}) share `Ctrl+X`
 * legitimately, and a flat uniqueness rule would forbid the coexistence the app already relies on.
 */
export function chordCollisions(
  bindings: Record<string, string[]>,
  scopes: CommandScopes = COMMAND_SCOPES,
): ChordCollision[] {
  const byToken = new Map<string, ActionId[]>();
  for (const [action, tokens] of Object.entries(bindings)) {
    for (const token of tokens) {
      const norm = normalizeToken(token);
      byToken.set(norm, [...(byToken.get(norm) ?? []), action as ActionId]);
    }
  }

  const collisions: ChordCollision[] = [];
  for (const [token, actions] of byToken) {
    if (actions.length < 2) continue;
    const clashing = actions.filter((a) =>
      actions.some((b) => a !== b && scopesIntersect(scopes[a], scopes[b])),
    );
    if (clashing.length > 1) collisions.push({ token, actions: clashing });
  }
  return collisions;
}

/**
 * Is the column-select gesture's modifier held? (FR-017e, FR-025.)
 *
 * The modifier is declared per platform in the shipped-defaults record — and a declared value that
 * nothing reads is a lie: change it to `Ctrl` and the gesture would carry on answering to Alt,
 * because CodeMirror's `rectangularSelection()` hardcodes Alt as its default. It matched the shipped
 * Windows value by pure coincidence, which is the kind of agreement that silently stops holding the
 * day a second platform ships.
 *
 * Takes plain booleans rather than a MouseEvent: core has no DOM (Principle II).
 */
export function columnSelectHeld(
  modifier: ColumnSelectModifier,
  mods: { alt: boolean; ctrl: boolean; meta: boolean },
): boolean {
  if (modifier === 'Alt') return mods.alt;
  if (modifier === 'Ctrl') return mods.ctrl;
  return mods.meta;
}

/** What each context is called, where a user can see it. */
const SCOPE_NAMES: Record<DispatchScope, string> = {
  editor: 'Editor',
  terminal: 'Terminal',
  explorer: 'File Explorer',
};

/** Canonical order, so two commands with the same scope set always read identically. */
const SCOPE_ORDER: readonly DispatchScope[] = ['editor', 'terminal', 'explorer'];

/**
 * Where a command's chord is live, in words (016, FR-017b0).
 *
 * The Key Bindings editor shows this beside every command, and it is the ONLY thing that explains
 * why `Ctrl+X` appears twice in the list without being a mistake: one of them cuts a line in an
 * editor, the other cuts a file in the tree, and they never both fire. Without it, a user looking at
 * a duplicated chord has to conclude that either throng is broken or one of the two does nothing —
 * and a user who "fixes" the duplicate by rebinding one has broken something that worked.
 */
export function scopeLabel(scopes: ReadonlySet<DispatchScope> | undefined): string {
  return scopeNames(scopes).join(' · ');
}

/**
 * The contexts a command is live in, as SEPARATE names — one per pill in the Key Bindings editor.
 *
 * Joined into a single pill, "Editor · Terminal" reads as one exotic scope called "Editor-Terminal"
 * rather than as two ordinary ones. The pills are the unit of meaning: a command is live in the
 * editor, AND in the terminal.
 *
 * A command live everywhere collapses to one pill rather than three: listing every context is
 * technically the same statement, but "Everywhere" is the thing the user actually wants to know, and
 * three pills on most rows would drown the two-pill rows that carry the real information.
 */
export function scopeNames(scopes: ReadonlySet<DispatchScope> | undefined): string[] {
  if (!scopes || scopes.size === 0) return [];
  if (scopes.size === SCOPE_ORDER.length) return ['Everywhere'];
  return SCOPE_ORDER.filter((scope) => scopes.has(scope)).map((scope) => SCOPE_NAMES[scope]);
}

/** True when two commands are live in at least one common context — the collision rule (FR-017b1). */
export function scopesIntersect(
  a: ReadonlySet<DispatchScope> | undefined,
  b: ReadonlySet<DispatchScope> | undefined,
): boolean {
  if (!a || !b) return false;
  for (const scope of a) if (b.has(scope)) return true;
  return false;
}

function cloneBindings(b: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [...v]]));
}

function cloneKeybindings(kb: Keybindings): Keybindings {
  return { version: kb.version, bindings: cloneBindings(kb.bindings) };
}
