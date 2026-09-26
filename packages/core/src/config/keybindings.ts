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
  /**
   * 041 FR-020 (#314) — move focus to the most recent notice on screen.
   *
   * 030 FR-060a deferred this by name: the affected-panel list is already a tab stop, but nothing
   * focuses a notice, so reaching one means tabbing through the whole application until focus
   * happens to land there.
   */
  | 'focus.notice'
  | 'view.fullscreen'
  | 'view.toggleProjects'
  | 'view.toggleExplorer'
  /**
   * 046 US2 (FR-015/FR-019/FR-020) — step the active project forward/back, and move keyboard
   * focus straight to the File Explorer or the Projects pane, from anywhere in the window. All
   * four are window-level like the pane toggles above: `EVERYWHERE`, including a focused terminal
   * (data-model §4, R3 — the `projects` scope joins `EVERYWHERE` for the same reason `preview` did).
   */
  | 'project.next'
  | 'project.previous'
  | 'focus.explorer'
  | 'focus.projects'
  /**
   * 046 iterate round 3 (FR-116) — the route back to the centre. Moves keyboard focus to the ACTIVE
   * tab's ACTIVE panel, exactly as a directional move ending on that panel would, and switches
   * nothing. Keyboard-only: it moves the user between surfaces and acts on no panel (constitution
   * v5.6.0 Principle VI, "A chord MAY stand without a menu item").
   */
  | 'focus.workspace'
  // File Explorer tree operations (004, FR-021). Resolved only while the
  // File Explorer Pane has focus (research D8).
  | 'file.rename'
  | 'file.cut'
  | 'file.copy'
  | 'file.paste'
  | 'file.delete'
  // 024 US3 (#85): undo/redo the last file OPERATION — a move, a rename, a delete. Explorer-scoped,
  // so Ctrl+Z means "put that file back" in the tree and "undo my typing" in an editor, which is
  // exactly what a user means by it in each place.
  | 'file.undo'
  | 'file.redo'
  // Editor panel operations (006, FR-013/014). Resolved only while the active
  // pane is a workspace Panel, not File Explorer (research D7).
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
  // Find in Files (043, FR-028/FR-029). The find bar's counterparts one level up: these search the
  // PROJECT rather than the active panel's own content, so they are live wherever you are — the
  // question "where does this string appear" is not one the file tree answers differently from a
  // terminal. `search.replaceInFiles` is the same command with the replacement row already open
  // (FR-029d), which is why it gets a chord and no second toolbar control of its own.
  | 'search.findInFiles'
  | 'search.replaceInFiles'
  // Terminal scrollback navigation (013, FR-014/FR-016). Resolved only while a
  // terminal panel is active; never delivered as a keystroke to the running program.
  | 'terminal.scrollLineUp'
  | 'terminal.scrollLineDown'
  | 'terminal.scrollPageUp'
  | 'terminal.scrollPageDown'
  | 'terminal.scrollToTop'
  | 'terminal.scrollToBottom'
  /**
   * 028 (#163) — redraw the focused terminal deliberately. The user's only cure for a mis-rendered
   * terminal used to be dragging a panel divider a pixel or two: an accidental discovery, dependent
   * on landing the drag precisely enough to change the character grid, and destructive to the layout
   * they arranged. This is that nudge, asked for on purpose.
   */
  | 'terminal.redraw'
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
  | 'editor.toggleWordWrap'
  // 024 US6 (#157): open the focused item's context menu from the keyboard (Shift+F10 / the Menu key),
  // so a menu-driven UI is reachable without a mouse (FR-018c). Neither chord is a reserved terminal key.
  | 'menu.open'
  // 024 follow-up: rename the ACTIVE PANEL from the keyboard. F2 is the rename key everywhere else
  // in throng (the file tree's `file.rename`) and everywhere else in Windows, so a panel header that
  // could only be renamed by double-click or a menu was the odd one out.
  | 'panel.rename'
  // 031 US3 (#225): open the tab picker — a searchable list of every tab in the window. Ctrl+Alt+T,
  // in the Ctrl+Alt family throng already owns; in neither the reserved nor the shadowable tier
  // (constitution IV), so it displaces no line-editor binding and needs no recorded exception.
  | 'tabs.openPicker'
  /*
   * 033 US1 (#219) — open any file in the current project by typing part of its path.
   *
   * A NEW `navigate.` namespace rather than an existing one, and the reason is mechanical rather
   * than aesthetic (data-model.md §2): `useExplorerKeybindings` accepts ONLY `file.*` actions and
   * dispatches them at the explorer scope, so `file.quickOpen` would be claimed by the tree's own
   * handler and never reach the window. `view.*` is pane toggles and `editor.*` is text editing.
   *
   * `Ctrl+Shift+T` is in neither constitutional tier (IV), so it displaces no line-editor binding.
   */
  | 'navigate.quickOpen'
  /*
   * 033 US2 (#219) — jump to a line number in the focused editor.
   *
   * `Ctrl+G` is readline's `abort`, and a shell user presses it. This command is therefore
   * **EDITOR_ONLY**, and that scope is the whole of its defence: the chord is never live in a
   * terminal, so `resolveAction` returns null there, nothing is preventDefaulted, and xterm delivers
   * `^G` to the shell exactly as it would with this feature absent (A3, SC-007).
   *
   * Principle IV's tier test is about what a hosted flavour's LINE EDITOR does, and it is satisfied
   * by scope rather than by absence — which is why `Ctrl+G` needs no recorded exception while
   * `navigate.quickOpen`, scoped EVERYWHERE, had to pick a chord no line editor wanted.
   */
  | 'navigate.gotoLine'
  /*
   * 044 (#10, #136) — previews and per-panel navigation history.
   *
   * `preview.open` (FR-005) opens the preview of the focused editor's file or the tree's selection,
   * and ships UNBOUND: every entry point is a button or a menu item, and no chord was asked for.
   * `navigate.back` / `navigate.forward` (FR-105) step the focused editor or preview through its
   * history. `preview.followLink` (FR-096c) is Ctrl+click for the keyboard, on the focused link —
   * and since 045 FR-045 it is live in an EDITOR as well as a preview, on the same id and the same
   * chord (S3).
   */
  | 'preview.open'
  | 'navigate.back'
  | 'navigate.forward'
  | 'preview.followLink'
  /*
   * 044, 2026-09-16 iteration (FR-122d). Flips the ONE global scroll-sync setting, from an editor or a
   * preview. Every surface that shows the toggle — four menu items, two status-bar buttons — runs this
   * command, and it ships unbound, as `preview.open` does.
   */
  | 'preview.toggleSyncScroll';

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
export type DispatchScope = 'editor' | 'terminal' | 'explorer' | 'findInFiles' | 'preview' | 'projects';

export type CommandScopes = Readonly<Record<ActionId, ReadonlySet<DispatchScope>>>;

/*
 * 044 R16 — `preview` is the FIFTH scope, for 043 R14's reason: `scopeFromKind` falls through to
 * `explorer` for a kind it does not know, and over a preview that would make Delete, F2, Ctrl+X and
 * Ctrl+C act on the file tree's selection (FR-021). It joins EVERYWHERE because zoom, focus movement
 * and the view toggles must keep working there (FR-034); it joins neither PANELS (a preview has no
 * document to save and no find bar) nor ANY_PANEL (a preview cannot be renamed, FR-030).
 *
 * 046 R3 (FR-015) — `projects` is the SIXTH, one pane along and for the same reason: the renderer
 * answered `explorer` for any pane that was not the workspace, so with the Projects pane focused F2
 * renamed the File Explorer's selected file and Delete deleted it. It joins EVERYWHERE and nothing
 * else, so window commands stay live there and no text-editing or file-tree command is.
 */
const EVERYWHERE = new Set<DispatchScope>([
  'editor',
  'terminal',
  'explorer',
  'findInFiles',
  'preview',
  'projects',
]);
const EDITOR_ONLY = new Set<DispatchScope>(['editor']);
/**
 * 045 FR-045 / S3 (#394): the panel kinds a file link can be FOLLOWED from with the keyboard.
 *
 * It replaces `PREVIEW_ONLY`, which had exactly one member and one user. Principle IV requires one
 * command to use one chord across panel types, and editors now have links — so widening the scope
 * of the command 044 introduced is the alternative to a second command sharing Ctrl+Enter, which
 * two users could rebind apart.
 *
 * A terminal is deliberately absent and stays so (FR-046). A terminal link has no keyboard
 * position to follow FROM, and taking Ctrl+Enter there would take a key the shell is entitled to —
 * including its modified-Enter encoding. Its keyboard route is the context menu.
 *
 * The same shape as `HISTORY_PANELS` and deliberately not shared with it: the two sets agree today
 * by coincidence, and folding them together would mean a future change to one silently moving the
 * other.
 */
const LINK_SURFACES = new Set<DispatchScope>(['editor', 'preview']);
/** The two panel kinds that keep a navigation history (FR-100). */
const HISTORY_PANELS = new Set<DispatchScope>(['editor', 'preview']);
/** Where a file whose preview can be opened is focused: its editor, or the tree's selection (FR-005). */
const PREVIEW_SOURCES = new Set<DispatchScope>(['editor', 'explorer']);
const TERMINAL_ONLY = new Set<DispatchScope>(['terminal']);
const EXPLORER_ONLY = new Set<DispatchScope>(['explorer']);
/** Panels, but not the file tree: a find bar and a save belong to whatever panel is showing. */
const PANELS = new Set<DispatchScope>(['editor', 'terminal']);
/**
 * Every panel kind, INCLUDING the ones that hold no document of their own (043 R14).
 *
 * Distinct from {@link PANELS} because the two answer different questions. `PANELS` is "surfaces
 * with content a command can act on" — a save, a find bar — and a Find in Files panel has neither.
 * This is "surfaces that are a Panel", which is what `panel.rename` is about: a panel's NAME belongs
 * to the panel whatever it holds. Widening `PANELS` itself would have made `editor.save` and the
 * `search.*` bar chords live over a results panel, where they mean nothing.
 *
 * It is also half of a defect fix rather than a nicety. `scopeFromKind` falls through to `explorer`
 * for an unknown kind, so before the fourth scope existed F2 over a Find in Files panel resolved to
 * `file.rename` and renamed whatever the FILE TREE had selected — the same class of accident as
 * Delete over a results list.
 */
const ANY_PANEL = new Set<DispatchScope>(['editor', 'terminal', 'findInFiles']);

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
  // A panel's NAME belongs to the panel, so this is live in EVERY panel kind and nowhere else — the
  // file tree has its own F2 (`file.rename`), and the two never contend because their scopes are
  // disjoint. `ANY_PANEL` rather than `PANELS`: 043's results panel is renameable like any other,
  // and on the old set F2 there fell through to the explorer and renamed a FILE (R14).
  'panel.rename': ANY_PANEL,
  'focus.left': EVERYWHERE,
  'focus.right': EVERYWHERE,
  'focus.up': EVERYWHERE,
  'focus.down': EVERYWHERE,
  'focus.cycle': EVERYWHERE,
  'focus.cycleBack': EVERYWHERE,
  // 041 FR-020a — a notice can be raised while ANY surface has focus, and a terminal is where one
  // is most likely to appear, because that is where long-running things fail. A narrower scope would
  // leave it unreachable in exactly the case that motivates the binding.
  'focus.notice': EVERYWHERE,
  'view.fullscreen': EVERYWHERE,
  'view.toggleProjects': EVERYWHERE,
  'view.toggleExplorer': EVERYWHERE,
  // 046 US2 (FR-015/020) — window-level, the same reasoning as the pane toggles above: a user
  // stepping projects or jumping focus to a side pane means the same thing from a terminal, an
  // editor or the tree, and `projects` (046 R3) is included so the commands work FROM the pane too.
  'project.next': EVERYWHERE,
  'project.previous': EVERYWHERE,
  'focus.explorer': EVERYWHERE,
  'focus.projects': EVERYWHERE,
  // 046 FR-116 — the way back from a side pane or a notice must work from wherever focus is now,
  // a terminal included; the `focus.` prefix already makes it a window command in `isPanelScoped`.
  'focus.workspace': EVERYWHERE,
  // 024 US6: the keyboard "open context menu" works wherever a focusable item has one (explorer,
  // editor, terminal) — EVERYWHERE covers those three scopes.
  'menu.open': EVERYWHERE,
  // 031 FR-032a: the tab picker is a WINDOW-level navigation aid, and must work at any tab count
  // from any surface — a user with six visible tabs may still prefer to type a name than aim at one.
  // PANELS would make it dead in the file tree, which is precisely where a user loses their place.
  'tabs.openPicker': EVERYWHERE,
  // 033 US1 (#219, FR-003): Quick Open answers the same from a terminal, an editor or the tree, so
  // it is EVERYWHERE — a chord that only worked in some of them would need the user to know which.
  'navigate.quickOpen': EVERYWHERE,
  // 033 US2 (#219, FR-025, A2): Go To Line acts inside ONE editor's document, so it is live in an
  // editor and nowhere else. Not a preference — `Ctrl+G` is readline's `abort`, and EDITOR_ONLY is
  // what keeps the shell's copy of it (SC-007). Deliberately NOT `navigate.*` by prefix: the two
  // commands in this namespace have different scopes on purpose.
  'navigate.gotoLine': EDITOR_ONLY,
  // 044 — none of the four is live in a terminal, so no shell loses a key (Principle IV). Back and
  // Forward share ONE chord across both panel kinds that have a history (one command, one chord).
  'preview.open': PREVIEW_SOURCES,
  'navigate.back': HISTORY_PANELS,
  'navigate.forward': HISTORY_PANELS,
  // 045 FR-045: widened from `PREVIEW_ONLY`. The ActionId and the `['Ctrl+Enter']` default are
  // unchanged — a rename would silently drop every rebinding saved since 044.
  'preview.followLink': LINK_SURFACES,
  // 044 FR-122d — live exactly where the toggle is shown: an editor or a preview. Never a terminal, so
  // no shell loses a key even once a user binds it.
  'preview.toggleSyncScroll': HISTORY_PANELS,
  // The File Explorer's clipboard chords act on FILES, and only while the tree has focus.
  'file.rename': EXPLORER_ONLY,
  'file.cut': EXPLORER_ONLY,
  'file.copy': EXPLORER_ONLY,
  'file.paste': EXPLORER_ONLY,
  'file.delete': EXPLORER_ONLY,
  'file.undo': EXPLORER_ONLY,
  'file.redo': EXPLORER_ONLY,
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
  /*
   * 043 FR-028/FR-029 — EVERYWHERE, and the contrast with the seven above is the point.
   *
   * The find bar is `PANELS` because it acts on the content the active panel is showing, so it has
   * nothing to act on in the file tree. These two act on the PROJECT, which is the same thing from
   * every surface: a user in a terminal who wants to know where a symbol is defined means exactly
   * what a user in the tree means. Narrowing them would make the chord answer in some places and
   * not others, and the user would have to know which — the reasoning `navigate.quickOpen` records.
   */
  'search.findInFiles': EVERYWHERE,
  'search.replaceInFiles': EVERYWHERE,
  // Scrollback navigation is meaningless anywhere but a terminal.
  'terminal.scrollLineUp': TERMINAL_ONLY,
  'terminal.scrollLineDown': TERMINAL_ONLY,
  'terminal.scrollPageUp': TERMINAL_ONLY,
  'terminal.scrollPageDown': TERMINAL_ONLY,
  'terminal.scrollToTop': TERMINAL_ONLY,
  'terminal.scrollToBottom': TERMINAL_ONLY,
  // TERMINAL_ONLY, not PANELS: a redraw has no meaning in an editor or the file tree, and a chord
  // throng consumes never reaches the shell — so the shadow is kept to the one surface that earns it.
  'terminal.redraw': TERMINAL_ONLY,
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
    /*
     * 046 iterate round 1 (FR-102, constitution v5.6.0 Principle IV) — the global window zoom is
     * TIER 1 (navigation and the application): a single Ctrl+Shift+Alt chord, no plain Ctrl chord,
     * no gesture. #390's Ctrl+Shift+0 is retired along with the plain trio: the panel header's own
     * Zoom submenu and the keyboard are the routes now (046 iterate round 2, FR-113, removed the cog
     * menu's Zoom row), and the gestures below move to the PANEL zoom (FR-106), which is TIER 2 and
     * keeps its own Ctrl+Alt chord unchanged.
     *
     * `zoom.reset` is the one TIER-1 exception with no plain digit key at all: 046 iterate round 2
     * (FR-114) — the maintainer's own words, mid-build: "The 'Zoom Reset' key bindings need to use
     * the numpad zero, NOT the 0 key." — so its key segment is `Numpad0`, not `0`. FR-105's "no
     * shipped Numpad… token" guard carries a named two-command exception for this and
     * `panel.zoomReset` below (`keybindings-tiers.test.ts`); every other digit-shaped default is
     * unaffected.
     */
    'zoom.in': ['Ctrl+Shift+Alt++'],
    'zoom.out': ['Ctrl+Shift+Alt+-'],
    'zoom.reset': ['Ctrl+Shift+Alt+Numpad0'],
    // Per-panel-type zoom (012) — TIER 2, Ctrl+Alt family, unchanged chord. It gains the gesture
    // the window zoom just gave up (FR-106): a Ctrl+wheel or Ctrl+middle-click now zooms the panel
    // under the pointer, never the window. Its own reset moved to Numpad0 alongside zoom.reset's,
    // for the same FR-114 reason (the main-row 0 key no longer resets either zoom).
    'panel.zoomIn': ['Ctrl+Alt++', 'Ctrl+WheelUp'],
    'panel.zoomOut': ['Ctrl+Alt+-', 'Ctrl+WheelDown'],
    // 046 iterate round 7 (FR-127): the main-row `Ctrl+Alt+0` joins Numpad0 as a SECOND keyboard
    // chord — Constitution IV's second named exception to the one-chord rule, after `menu.open`.
    // It is matched on the PRODUCED `0`, so an AltGr+0 that types `}` (German) or `@` (AZERTY) never
    // fires it. `zoom.reset` is unchanged: the main-row 0 still resets no window zoom. Saved installs
    // gain it through shipped-defaults version 16.
    'panel.zoomReset': ['Ctrl+Alt+Numpad0', 'Ctrl+Alt+0', 'Ctrl+MiddleClick'],
    'panel.rename': ['F2'],
    // Keyboard move-focus (012) — TIER 1 (046, FR-102): Ctrl+Shift+Alt+Arrow*, freeing the plain
    // Ctrl+Alt+Arrow family back to the editor/shell. Arrow tokens use the produced key names
    // (`Arrow*`). The cycle chords are a RECORDED EXCEPTION (FR-103) and keep their pre-round
    // Ctrl+`/Ctrl+Shift+` form: the BACKTICK key, normalised to `` ` `` from its physical key
    // (renderer `chordKey`) so `Ctrl+Shift+`` works on every layout — Shift+backtick is `~` on US
    // but `¬` on UK, so a produced-character token isn't portable. All rebindable in the editor.
    'focus.left': ['Ctrl+Shift+Alt+ArrowLeft'],
    'focus.right': ['Ctrl+Shift+Alt+ArrowRight'],
    'focus.up': ['Ctrl+Shift+Alt+ArrowUp'],
    'focus.down': ['Ctrl+Shift+Alt+ArrowDown'],
    'focus.cycle': ['Ctrl+`'],
    'focus.cycleBack': ['Ctrl+Shift+`'],
    // 046 iterate round 1 (FR-102) — TIER 1, alongside the rest of the navigation family; moved
    // from its pre-round Ctrl+Alt+M. Notices are deliberately NOT added to the `focus.cycle` ring
    // (FR-020c): the ring is pressed constantly and a notice is transient, so one timing out
    // mid-cycle would change what the next press does. 046 iterate round 3 (FR-117) — V, not M:
    // the maintainer asked for "V for notices if it is not already reserved", and M now focuses
    // the File Explorer. No shipped default binds V with any modifier.
    'focus.notice': ['Ctrl+Shift+Alt+V'],
    'view.fullscreen': ['F11'],
    /*
     * 046 iterate round 1 (FR-102) — the pane toggles move again, from the Ctrl+Alt family (026)
     * to TIER 1's Ctrl+Shift+Alt, alongside every other window command that acts on a whole side
     * pane. Ctrl+B and Ctrl+N — readline's `backward-char`/tmux's prefix key and `next-history` —
     * stay unclaimed either way.
     *
     * 046 iterate round 3 (FR-117) — J and K, left pane then right pane, the maintainer's own
     * layout: "Collapse / expand side panes should be J and K, from left to right." B and N, which
     * the toggles held before, now focus Projects and the workspace (below).
     *
     * Only the SHIPPED DEFAULT moves. A user who has saved their own bindings keeps exactly what
     * they saved, including an earlier round's value — nothing on disk distinguishes a deliberate
     * choice of Ctrl+Alt+B versus Ctrl+Alt+B simply being the default when the file was written, so
     * rewriting it would silently override some users' decisions in order to help others (026
     * FR-030).
     */
    'view.toggleProjects': ['Ctrl+Shift+Alt+J'],
    'view.toggleExplorer': ['Ctrl+Shift+Alt+K'],
    /*
     * 046 iterate round 1 (FR-102) — TIER 1, alongside the rest of the navigation family. Moved
     * from their pre-round Ctrl+Alt values (US2, FR-020/021): none of the four is in the reserved
     * or shadowable tier, and `Ctrl+Alt+E`/`Ctrl+Alt+F` were already checked against AltGr
     * collisions before this round (spec FR-021) — the Ctrl+Shift+Alt tier changes the modifier
     * set, not the reasoning that picked the letters.
     *
     * 046 iterate round 3 (FR-116, FR-117) — the three focus commands sit on one row, left to
     * right as the surfaces are: B focuses Projects, N the workspace (the new `focus.workspace`),
     * M the File Explorer — the maintainer's "Focus should be B, N and M (from left to right)".
     * Ctrl+Shift+Alt+F and Ctrl+Shift+Alt+P are left unbound; unbinding P gives US-International
     * its AltGr+Shift `Ö` back (research R22).
     */
    'project.next': ['Ctrl+Shift+Alt+PageDown'],
    'project.previous': ['Ctrl+Shift+Alt+PageUp'],
    'focus.explorer': ['Ctrl+Shift+Alt+M'],
    'focus.projects': ['Ctrl+Shift+Alt+B'],
    'focus.workspace': ['Ctrl+Shift+Alt+N'],
    'menu.open': ['Shift+F10', 'ContextMenu'],
    /*
     * 046 iterate round 1 (FR-102) — TIER 1, moved from its pre-round Ctrl+Alt+T (031 FR-032a):
     * the tab picker is a window-level navigation aid, and the whole navigation family now shares
     * one modifier prefix. `Ctrl+Shift+Alt+T` is in neither constitutional tier (FR-032c), so the
     * enumerated exception list is unchanged by this move.
     */
    'tabs.openPicker': ['Ctrl+Shift+Alt+T'],
    /*
     * 033 / FR-002 — Quick Open. `Ctrl+Shift+T` is the chord this gesture carries in every editor a
     * user is likely to arrive from, and it is in neither the reserved nor the shadowable terminal
     * tier (constitution IV), so it displaces no line-editor binding and needs no exception.
     */
    'navigate.quickOpen': ['Ctrl+Shift+T'],
    /*
     * 033 / FR-020 — Go To Line. `Ctrl+G` is the chord this gesture carries in every editor a user
     * is likely to arrive from, and no shipped throng binding holds it.
     *
     * It IS readline's `abort`, and that is not an oversight: the command is EDITOR_ONLY (above), so
     * the chord is never resolved in a terminal scope and the shell keeps receiving `^G`. Principle
     * IV's reserved tier bans a chord being taken from a hosted line editor; nothing is taken here.
     */
    'navigate.gotoLine': ['Ctrl+G'],
    /*
     * 044 (contracts/settings-bindings-tokens.md). The spec says "Alt+Left"; the TOKEN is
     * `Alt+ArrowLeft`, because a token must equal what `eventToToken` builds from a keydown and the
     * DOM names the key `ArrowLeft` — `Alt+Left` would never match a keypress (the focus.* chords
     * above are spelled the same way for the same reason).
     *
     * None of the three chords is in either constitutional tier, and none is live in a terminal.
     * `Ctrl+Enter` is unbound elsewhere; `Alt+Enter` / `Ctrl+Alt+Enter` belong to the replace
     * commands, whose PANELS scope does not include `preview`.
     */
    'preview.open': [],
    'navigate.back': ['Alt+ArrowLeft'],
    'navigate.forward': ['Alt+ArrowRight'],
    'preview.followLink': ['Ctrl+Enter'],
    // FR-122d — unbound, like `preview.open`: every surface is a menu item or a button.
    'preview.toggleSyncScroll': [],
    'file.rename': ['F2'],
    'file.cut': ['Ctrl+X'],
    'file.copy': ['Ctrl+C'],
    'file.paste': ['Ctrl+V'],
    'file.delete': ['Delete'],
    'file.undo': ['Ctrl+Z'],
    'file.redo': ['Ctrl+Y'],
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
    /*
     * Find in Files (043). `Ctrl+Shift+F` / `Ctrl+Shift+H` are the near-universal pair, and both are
     * free here: the only shipped `Ctrl+Shift+*` chords are `Ctrl+Shift+\``, `Ctrl+Shift+T`,
     * `Ctrl+Shift+S` and the terminal scroll pair (R13's exhaustive check).
     *
     * They do NOT collide with `Ctrl+F` / `Ctrl+H` above, even though both pairs are `search.*` and
     * both are live in an editor: `chordCollisions` compares normalised TOKENS, and `Ctrl+F` is not
     * `Ctrl+Shift+F`. Nor is a reserved-key exception needed — the constitution's reserved and
     * shadowable tiers list `Ctrl+F` and `Ctrl+H`, and the enforcing test matches exact tokens too.
     */
    'search.findInFiles': ['Ctrl+Shift+F'],
    'search.replaceInFiles': ['Ctrl+Shift+H'],
    // Terminal scrollback navigation (013). Shift+Page is the conventional terminal
    // scrollback pair; the line/top/bottom chords follow the same "view, not input" family.
    'terminal.scrollLineUp': ['Ctrl+Shift+ArrowUp'],
    'terminal.scrollLineDown': ['Ctrl+Shift+ArrowDown'],
    'terminal.scrollPageUp': ['Shift+PageUp'],
    'terminal.scrollPageDown': ['Shift+PageDown'],
    'terminal.scrollToTop': ['Ctrl+Home'],
    'terminal.scrollToBottom': ['Ctrl+End'],
    /*
     * Ctrl+F5 — "hard refresh" in every browser and Visual Studio, so users guess it.
     *
     * Bare F5 is deliberately NOT taken (FR-049d): terminal file managers bind the unmodified
     * function keys heavily (F5 is copy in Far Manager), and swallowing it would remove a working
     * key from them. Ctrl+F5 is far less trafficked, is not in the constitution's reserved tier, and
     * is recorded as a shadowable exception (Principle IV) rather than taken silently.
     */
    'terminal.redraw': ['Ctrl+F5'],
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
    // 046 iterate round 1 (FR-091, FR-092, FR-102) — `Ctrl+Alt+W` moved to the Ctrl+Shift+Alt
    // navigation tier and is no longer free, so this becomes the two-stroke chord `Ctrl+E W`:
    // Constitution IV's reserved-prefix exception for exactly this case. EDITOR_ONLY, so the
    // no-terminal-scope rule (FR-092) is satisfied by scope, the same way `navigate.gotoLine`'s
    // Ctrl+G is. 046 iterate round 5 (FR-124): written `Mods+K1,K2` — Ctrl held through E then W.
    // Saved installs move from `Ctrl+E W` through shipped-defaults version 15.
    'editor.toggleWordWrap': ['Ctrl+E,W'],
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
 *
 * A two-stroke-SHAPED entry (046, FR-091/FR-092, review finding MINOR 4) is validated the same
 * way: a malformed shape (a bare first stroke, three-or-more strokes, a modifier-only stroke) is
 * dropped like any other invalid entry, and a well-formed two-stroke chord is ALSO dropped when the
 * action's own scope includes `terminal` — never legal there, whatever its shape. Without this, a
 * hand-edited `keybindings.json` could carry a two-stroke token that simply never fires, silently
 * and with nothing to tell the user why.
 */
export function parseKeybindings(raw: unknown): Keybindings {
  if (!isRecord(raw)) return cloneKeybindings(DEFAULT_KEYBINDINGS);
  const rawBindings = isRecord(raw.bindings) ? raw.bindings : {};
  const bindings: Record<string, string[]> = { ...cloneBindings(DEFAULT_KEYBINDINGS.bindings) };
  for (const [action, value] of Object.entries(rawBindings)) {
    if (Array.isArray(value)) {
      bindings[action] = value
        .filter((t): t is string => {
          if (typeof t !== 'string') return false;
          if (!isTwoStrokeToken(t)) return true;
          if (!isValidTwoStrokeToken(t)) return false;
          return !COMMAND_SCOPES[action as ActionId]?.has('terminal');
        })
        // A saved space-separated two-stroke token (unreleased 046 builds) reads as its comma
        // form (FR-124); every other token is kept exactly as written.
        .map((t) => (isTwoStrokeToken(t) && /\s/.test(t) ? normalizeToken(t) : t));
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
 * Canonicalise a SINGLE-STROKE binding token so a single-letter key matches case-insensitively
 * (a DOM keydown reports "b" while users naturally write "Ctrl+B"). Only the final key segment is
 * touched, and only when it is a lone A–Z letter — gestures, digits, "F11", and the "+" key are
 * left as-is.
 */
function normalizeSingleStroke(token: string): string {
  const plus = token.lastIndexOf('+');
  const head = plus >= 0 ? token.slice(0, plus + 1) : '';
  const tail = plus >= 0 ? token.slice(plus + 1) : token;
  return tail.length === 1 && /[a-z]/i.test(tail) ? head + tail.toUpperCase() : token;
}

/**
 * Read ONE stroke of a written token starting at `from`: `Mod+Mod+Key`, where the key may itself be
 * `+` or `,` (the `Ctrl++` / `Ctrl+,` precedent). Returns the stroke text and where it ended, the
 * end being either the token's end or a `,` separator. `null` when the stroke is followed by
 * anything but a separator (`Ctrl++W`).
 */
function lexStroke(token: string, from: number): { stroke: string; end: number } | null {
  let i = from;
  let end: number;
  for (;;) {
    let j = i;
    while (j < token.length && token[j] !== '+' && token[j] !== ',') j++;
    if (j > i) {
      // A named segment: a modifier when a `+` follows it, else the stroke's key.
      if (token[j] === '+') {
        i = j + 1;
        continue;
      }
      end = j;
      break;
    }
    // An empty segment: the key is a lone `+` or `,` — or, at the token's end, there is no key.
    end = i < token.length ? i + 1 : i;
    break;
  }
  if (end < token.length && token[end] !== ',') return null;
  return { stroke: token.slice(from, end), end };
}

/**
 * The strokes of a binding token AS WRITTEN (046 FR-124): `Ctrl+E,W` → `['Ctrl+E', 'W']`,
 * `Ctrl+,,W` → `['Ctrl+,', 'W']`, `Ctrl+,` → `['Ctrl+,']`. A comma separates strokes except where it
 * is itself a stroke's key. A legacy whitespace-separated token (`Ctrl+E W`, written only by
 * unreleased 046 builds) splits on its whitespace instead. `null` for a token that does not lex.
 * The second stroke is RELATIVE — it names only the modifiers it adds; see {@link parseTwoStroke}
 * for the strokes as physically pressed.
 */
export function splitStrokes(token: string): string[] | null {
  if (/\s/.test(token)) {
    const parts = token.split(/\s+/).filter((p) => p.length > 0);
    const strokes: string[] = [];
    for (const part of parts) {
      const lexed = splitStrokes(part);
      if (!lexed || lexed.length !== 1) return null;
      strokes.push(lexed[0]);
    }
    if (strokes.length < 2) return strokes.length === 1 ? strokes : null;
    // A legacy second stroke named the held modifiers again or not at all; either way it is
    // relative to the first in the comma form.
    const held = new Set(strokeMods(strokes[0]));
    return [strokes[0], ...strokes.slice(1).map((s) => joinStroke(strokeMods(s).filter((m) => !held.has(m)), strokeKey(s)))];
  }
  if (token.length === 0) return null;
  const strokes: string[] = [];
  let i = 0;
  for (;;) {
    const lexed = lexStroke(token, i);
    if (!lexed) return null;
    strokes.push(lexed.stroke);
    if (lexed.end >= token.length) break;
    i = lexed.end + 1; // skip the separator
    if (i >= token.length) {
      strokes.push(''); // a trailing separator: a keyless final stroke
      break;
    }
  }
  return strokes;
}

/** Canonical modifier order, the order {@link eventToToken} builds. */
const MODIFIER_ORDER = ['Ctrl', 'Shift', 'Alt', 'Meta'];

function orderMods(mods: readonly string[]): string[] {
  const known = MODIFIER_ORDER.filter((m) => mods.includes(m));
  const unknown = mods.filter((m) => !MODIFIER_ORDER.includes(m));
  return [...known, ...unknown];
}

function joinStroke(mods: readonly string[], key: string): string {
  return [...mods, key].join('+');
}

/**
 * Canonicalise a binding token (046, FR-091/FR-092; FR-124). A TWO-STROKE token is normalised
 * stroke by stroke and written in its comma form `Mods+K1,K2` — ONE binding, never collapsed or
 * reordered. A legacy space-separated token (`Ctrl+E W`, `Ctrl+E  W`, `Ctrl+E Ctrl+W`) is the same
 * binding and normalises to `Ctrl+E,W`; a second stroke names only the modifiers it ADDS.
 */
export function normalizeToken(token: string): string {
  const strokes = splitStrokes(token);
  if (!strokes || strokes.length < 2) return normalizeSingleStroke(token.trim());
  return strokes.map(normalizeSingleStroke).join(',');
}

/**
 * Is `token` a two-stroke-SHAPED binding (046 FR-091/FR-092; FR-124)? True for anything that lexes
 * into two or more strokes (or does not lex while carrying a separator), so validation can refuse a
 * malformed one rather than mistake it for a single stroke. `Ctrl+,` — Ctrl+comma — is one stroke.
 */
export function isTwoStrokeToken(token: string): boolean {
  const strokes = splitStrokes(token);
  if (strokes) return strokes.length >= 2;
  return /[\s,]/.test(token);
}

/** The most keys a chord may carry under its held modifiers (046 FR-126). */
export const MAX_CHORD_KEYS = 3;

/**
 * Read a chord token into its strokes AS PHYSICALLY PRESSED (046 FR-124, FR-126): one to
 * {@link MAX_CHORD_KEYS} strokes. `Ctrl+E,W,Q` → `['Ctrl+E', 'Ctrl+W', 'Ctrl+Q']`; every later key
 * carries the FIRST stroke's modifiers, still held, plus any it adds itself — that addition belongs to
 * its own key only, so `Ctrl+E,Shift+W,Q` → `['Ctrl+E', 'Ctrl+Shift+W', 'Ctrl+Q']`. Modifiers come
 * out in canonical `Ctrl+Shift+Alt+Meta` order, letters upper-cased. A legacy `Ctrl+E W` reads as
 * `Ctrl+E,W`. `null` for four or more keys (refused outright, never truncated) or a token that does
 * not lex.
 */
export function parseChordStrokes(token: string): string[] | null {
  const written = splitStrokes(token);
  if (!written || written.length > MAX_CHORD_KEYS) return null;
  const strokes = written.map(normalizeSingleStroke);
  const firstMods = strokeMods(strokes[0]);
  return strokes.map((stroke, i) => {
    const mods = i === 0 ? firstMods : [...firstMods, ...strokeMods(stroke).filter((m) => !firstMods.includes(m))];
    return joinStroke(orderMods(mods), strokeKey(stroke));
  });
}

/**
 * Write PHYSICAL strokes as the chord token (046 FR-124, FR-126) — the save and display form:
 * `['Ctrl+E', 'Ctrl+W', 'Ctrl+Q']` → `Ctrl+E,W,Q`, `['Ctrl+E', 'Ctrl+Shift+W']` → `Ctrl+E,Shift+W`.
 * The inverse of {@link parseChordStrokes}. `null` when a later stroke does not hold every modifier of
 * the first (a modifier released between the keys makes it separate presses, not one chord), for no
 * strokes, or for more than {@link MAX_CHORD_KEYS}.
 */
export function formatChord(strokes: readonly string[]): string | null {
  if (strokes.length === 0 || strokes.length > MAX_CHORD_KEYS) return null;
  const firstMods = strokeMods(strokes[0]);
  const parts = [joinStroke(orderMods(firstMods), strokeKey(strokes[0]))];
  for (const stroke of strokes.slice(1)) {
    const mods = strokeMods(stroke);
    if (!firstMods.every((m) => mods.includes(m))) return null;
    parts.push(joinStroke(orderMods(mods.filter((m) => !firstMods.includes(m))), strokeKey(stroke)));
  }
  return parts.join(',');
}

/**
 * Read a TWO-key token into its two strokes as physically pressed (046 FR-124) — {@link
 * parseChordStrokes} held to exactly two: `Ctrl+E,W` → `['Ctrl+E', 'Ctrl+W']`. `null` for any other
 * number of keys.
 */
export function parseTwoStroke(token: string): [first: string, second: string] | null {
  const strokes = parseChordStrokes(token);
  return strokes?.length === 2 ? [strokes[0], strokes[1]] : null;
}

/**
 * Write two PHYSICAL strokes as `Mods+K1,K2` (046 FR-124) — {@link formatChord} for two keys:
 * `('Ctrl+E', 'Ctrl+W')` → `Ctrl+E,W`. `null` when the second does not hold every first-stroke
 * modifier.
 */
export function formatTwoStroke(first: string, second: string): string | null {
  return formatChord([first, second]);
}

/** The modifier names a single-stroke token carries, honouring the "+" key's own literal `+`. */
function strokeMods(stroke: string): string[] {
  if (stroke === '+') return []; // the bare "+" key — a later stroke written `Ctrl+E,W,+`
  if (stroke.endsWith('++')) return stroke.slice(0, -2).split('+').filter(Boolean);
  const plus = stroke.lastIndexOf('+');
  return plus >= 0 ? stroke.slice(0, plus).split('+').filter(Boolean) : [];
}

/**
 * The KEY segment of a single-stroke token — everything after its last modifier `+`, honouring the
 * "+" key's own literal `+` (so `Ctrl++` yields the key `+`, not an empty string). Empty when the
 * stroke is modifiers with nothing after them (`Ctrl+Alt+`), which is what makes a keyless first
 * stroke detectable.
 */
function strokeKey(stroke: string): string {
  if (stroke === '+' || stroke.endsWith('++')) return '+';
  const plus = stroke.lastIndexOf('+');
  return plus >= 0 ? stroke.slice(plus + 1) : stroke;
}

/** The canonical modifier PREFIX names — never legal as a stroke's own key (046, FR-092). */
const MODIFIER_ONLY_NAMES: ReadonlySet<string> = new Set(['Ctrl', 'Shift', 'Alt', 'Meta']);

/**
 * Is `token` a VALID multi-key chord (046 FR-092, FR-124, FR-126) — two or three keys under held
 * modifiers? The first stroke MUST carry a modifier — a bare first stroke would swallow ordinary
 * typing the moment it becomes a prefix key — and EVERY stroke must carry a real KEY: a stroke that
 * is modifiers with nothing after them (`Ctrl+Alt+`, review finding MINOR 8's "keyless first
 * stroke"), or that is itself just a bare modifier name (`Ctrl`, `Shift`, … MINOR 8's
 * "modifier-only second stroke"), is not a real keystroke. False for a single-stroke token and for
 * four or more keys. The name is historical: it predates FR-126's third key.
 */
export function isValidTwoStrokeToken(token: string): boolean {
  const strokes = parseChordStrokes(token);
  if (!strokes || strokes.length < 2) return false;
  if (strokeMods(strokes[0]).length === 0) return false;
  return strokes.every((stroke) => {
    const key = strokeKey(stroke);
    return key.length > 0 && !MODIFIER_ONLY_NAMES.has(key);
  });
}

/**
 * Is `token` valid as the FIRST stroke of a two-stroke capture (046 FR-092, review finding CRITICAL
 * on c0d85941)? Unlike an ordinary single-stroke chord — bindable bare since the 016 reversal — a
 * first stroke MUST carry a modifier, the same rule {@link isValidTwoStrokeToken} already applies to
 * a complete two-stroke token's first half, exposed here so a capture UI can refuse a bare first
 * stroke BEFORE it is ever held pending, rather than only once the (already-wrong) pair is complete.
 */
export function isValidTwoStrokeFirstStroke(token: string): boolean {
  if (strokeMods(token).length === 0) return false;
  const key = strokeKey(token);
  return key.length > 0 && !MODIFIER_ONLY_NAMES.has(key);
}

/** One shipped or saved two-stroke binding that violates FR-092: never legal on a terminal-live command. */
export interface TwoStrokeTerminalViolation {
  action: string;
  token: string;
}

/**
 * Every two-stroke chord bound to a command whose {@link CommandScopes} entry contains `terminal`
 * (046 FR-092). A multi-stroke prefix key would be swallowed by the shell as ordinary keystrokes
 * the instant it became live there, so the rule is absolute rather than a collision to negotiate.
 */
export function twoStrokeTerminalViolations(
  bindings: Record<string, string[]>,
  scopes: CommandScopes = COMMAND_SCOPES,
): TwoStrokeTerminalViolation[] {
  const violations: TwoStrokeTerminalViolation[] = [];
  for (const [action, tokens] of Object.entries(bindings)) {
    if (!scopes[action as ActionId]?.has('terminal')) continue;
    for (const token of tokens) {
      if (isTwoStrokeToken(token)) violations.push({ action, token });
    }
  }
  return violations;
}

/**
 * The FR-105 "same binding" fold: the key segment a physical resolver treats as identical to
 * another. `Equal` (the `=` key, unshifted) folds onto `+`, and the keypad `+`/`-` fold onto their
 * main-row key — never a second, distinct token. Applied to the LAST segment of a single-stroke
 * token only; the modifier prefix is untouched.
 *
 * `Numpad0` is deliberately NOT one of these folds (046 iterate round 2, FR-114/FR-115,
 * branch-review fix round). Before this round it folded onto `'0'`, so `sameBindingToken` — and
 * everything built on it (`chordCollisions`, the FR-108 shipped-defaults upgrade guard in
 * `shipped-defaults.ts`) — treated `Ctrl+Shift+Alt+Numpad0` and `Ctrl+Shift+Alt+0` as the SAME
 * chord. FR-114 moved `zoom.reset`/`panel.zoomReset` onto the physical `Numpad0` key SPECIFICALLY
 * so the main-row `0` would stop firing either reset — "The main-row 0 key MUST NOT fire either
 * reset, in any tier, in any scope" — so keeping the fold here would have silently reintroduced the
 * exact ambiguity FR-114 exists to remove, at the ONE layer that still checked bindings as static
 * strings rather than physical events: a v11 user with an unrelated command already saved on the
 * main-row `Ctrl+Shift+Alt+0` was wrongly refused the `zoom.reset` upgrade to
 * `Ctrl+Shift+Alt+Numpad0`, because the guard believed the two collided. `Numpad0` now compares as
 * its own, genuinely distinct token everywhere `sameBindingToken` is used.
 */
const SAME_BINDING_KEY: Readonly<Record<string, string>> = {
  '=': '+',
  NumpadAdd: '+',
  Minus: '-',
  NumpadSubtract: '-',
};

function splitBindingKey(stroke: string): { head: string; key: string } {
  if (stroke.endsWith('++')) return { head: stroke.slice(0, -1), key: '+' };
  const plus = stroke.lastIndexOf('+');
  return plus >= 0 ? { head: stroke.slice(0, plus + 1), key: stroke.slice(plus + 1) } : { head: '', key: stroke };
}

function sameBindingStroke(stroke: string): string {
  const { head, key } = splitBindingKey(stroke);
  return head + (SAME_BINDING_KEY[key] ?? key);
}

/**
 * Fold a binding token onto its FR-105 "same binding" canonical form, so `Ctrl+Alt+=` and
 * `Ctrl+Alt++` — and a keypad `+`/`-`/`0` and its main-row equivalent — compare equal wherever a
 * collision or an upgrade guard needs to know they are the SAME chord, never two. Applied
 * per-stroke for a two-stroke token. Call it AFTER {@link normalizeToken} for the letter-casing fold
 * too; {@link chordCollisions} does both.
 */
export function sameBindingToken(token: string): string {
  const strokes = splitStrokes(token);
  if (strokes && strokes.length >= 2) return strokes.map(sameBindingStroke).join(',');
  return sameBindingStroke(token);
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

/** The clashing subset of `actions` (in intersecting scopes), or `[]` when fewer than two clash. */
function scopeClashes(actions: readonly ActionId[], scopes: CommandScopes): ActionId[] {
  const unique = [...new Set(actions)];
  const clashing = unique.filter((a) =>
    unique.some((b) => a !== b && scopesIntersect(scopes[a], scopes[b])),
  );
  return clashing.length > 1 ? clashing : [];
}

/**
 * Every real chord clash: two commands sharing a chord whose scope sets INTERSECT (FR-017b1).
 *
 * Enumerated from the command registry, never from a hand-listed set of features — a hand list
 * silently stops covering whatever command is added after it was written. Disjoint scopes are
 * NOT a clash: `editor.cutLine` ({editor}) and `file.cut` ({explorer}) share `Ctrl+X`
 * legitimately, and a flat uniqueness rule would forbid the coexistence the app already relies on.
 *
 * Tokens are compared through {@link normalizeToken} THEN {@link sameBindingToken} (046, FR-105 /
 * FR-109 bullet 2), so `Ctrl+Alt+=` and `Ctrl+Alt++` — and a keypad key and its main-row
 * equivalent — are the SAME chord for collision purposes, never two that happen to look different.
 *
 * A multi-key binding's every PROPER PREFIX collides with anything ELSE bound to that EXACT chord as
 * a WHOLE binding (046, FR-092's first-stroke rule, widened by FR-126): pressing `Ctrl+E` — or, with
 * a three-key `Ctrl+E,W,Q`, pressing `Ctrl+E,W` — is genuinely ambiguous between "fire that other
 * command now" and "wait for the next key". Two DIFFERENT multi-key bindings merely SHARING a prefix
 * are NOT a clash (review finding MINOR 9) — the next key is what disambiguates which one fires. The
 * prefix is looked up only among WHOLE tokens, so a shared prefix never matches by itself.
 */
export function chordCollisions(
  bindings: Record<string, string[]>,
  scopes: CommandScopes = COMMAND_SCOPES,
): ChordCollision[] {
  const wholeTokenOwners = new Map<string, ActionId[]>();
  for (const [action, tokens] of Object.entries(bindings)) {
    for (const token of tokens) {
      // Normalised to the comma form (FR-124), so a legacy "Ctrl+E  W" and "Ctrl+E,W" are the
      // same binding, not two (review finding MINOR 9).
      const norm = sameBindingToken(normalizeToken(token));
      wholeTokenOwners.set(norm, [...(wholeTokenOwners.get(norm) ?? []), action as ActionId]);
    }
  }

  const collisions: ChordCollision[] = [];

  for (const [token, actions] of wholeTokenOwners) {
    const clashing = scopeClashes(actions, scopes);
    if (clashing.length > 0) collisions.push({ token, actions: clashing });
  }

  for (const [action, tokens] of Object.entries(bindings)) {
    for (const token of tokens) {
      const strokes = splitStrokes(sameBindingToken(normalizeToken(token)));
      if (!strokes || strokes.length < 2) continue;
      for (let k = 1; k < strokes.length; k++) {
        const prefix = strokes.slice(0, k).join(',');
        const owners = wholeTokenOwners.get(prefix);
        if (!owners) continue;
        const clashing = scopeClashes([action as ActionId, ...owners], scopes);
        if (clashing.length > 0) collisions.push({ token: prefix, actions: clashing });
      }
    }
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
  preview: 'Preview',
  terminal: 'Terminal',
  findInFiles: 'Find in Files',
  explorer: 'File Explorer',
  projects: 'Projects',
};

/**
 * Canonical order, so two commands with the same scope set always read identically.
 *
 * Its LENGTH is load-bearing, not just its order: `scopeNames` collapses a full set to the single
 * word "Everywhere" by comparing sizes, so a scope added here and forgotten in `EVERYWHERE` would
 * turn every window command's one pill into a list of contexts.
 */
const SCOPE_ORDER: readonly DispatchScope[] = [
  'editor',
  'preview',
  'terminal',
  'findInFiles',
  'explorer',
  'projects',
];

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
