/**
 * Theme document (FR-030, data-model §4). All app colours, icons, and fonts
 * resolve from a Theme; the default is "throng". Pure — the renderer turns the
 * resolved tokens into CSS custom properties (`--throng-*`). No OS/DOM here.
 */

export interface ThemeFonts {
  family: string;
  baseSizePx: number;
  weights: { normal: number; bold: number };
  /** App-wide default casing; per-section roles inherit it unless they override. */
  case?: TextCase;
  /** App-wide default italic; roles inherit unless they override. */
  italic?: boolean;
  /** App-wide default underline; roles inherit unless they override. */
  underline?: boolean;
  /** App-wide default strikethrough; roles inherit unless they override. */
  strikethrough?: boolean;
}

/**
 * A per-section font override. Any field left unset inherits the base `fonts`
 * (family / baseSizePx / normal weight) — so changing `baseSizePx` rescales every
 * role that doesn't pin its own size.
 */
/** Letter-casing override for a text section. */
export type TextCase = 'original' | 'title' | 'lower' | 'upper';

export interface ThemeFontRole {
  /** Override font family. Absent or blank string → the base `fonts.family`. */
  family?: string;
  sizePx?: number;
  /**
   * Bold, or not. NOT a number — and that is the point.
   *
   * A per-role numeric weight promised a granularity that does not exist. Almost every font installed
   * on a desktop ships exactly TWO weights, regular and bold; asked for 500, the browser picks the
   * nearest one it has, so 400, 500 and 600 all render identically and the slider appears to do
   * nothing for two thirds of its travel. Only a variable font interpolates, and you cannot know from
   * here whether the user has one.
   *
   * So the ROLE says bold or not, honestly, and the two numbers that "bold" and "regular" actually MEAN
   * live once, on `fonts.weights` — where a variable font's owner can still tune them, and where the
   * granularity is real.
   */
  bold?: boolean;
  /** Letter casing: original | title (Capitalised Words) | lower | UPPER. */
  case?: TextCase;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface ThemeSizes {
  /** Icon edge length, in pixels — independent of any font size. */
  iconPx?: number;
  /** Scrollbar thickness, in pixels. */
  scrollbarPx?: number;
}

/** The named text sections that can be styled independently (FR-030/FR-074). */
export type TypographyRole =
  | 'paneTitle' // PROJECTS / TERMINALS / FILES & FOLDERS
  | 'tab' // tab name
  | 'panel' // panel name
  | 'paneText' // inner pane/panel text (empty states etc.)
  | 'projectName' // a project's name in the list
  | 'projectPath' // a project's path subtitle
  | 'editor' // inline editor text (CodeMirror) — monospace by default (006)
  | 'terminal' // inline terminal text (xterm) — monospace by default (006)
  | 'button' // buttons carry their own typography role (007, FR-046a)
  // Dialogs and the preferences window. Added because the preferences window's own text answered to no
  // role at all: you could restyle every surface in the application EXCEPT the one you were standing in
  // while you did it, and changing the font there appeared to do nothing.
  | 'dialog';

/** Every typography role, so the editor can offer the FULL set of controls on each. */
export const TYPOGRAPHY_ROLES: readonly TypographyRole[] = [
  'paneTitle',
  'tab',
  'panel',
  'paneText',
  'projectName',
  'projectPath',
  'editor',
  'terminal',
  'button',
  'dialog',
];

/**
 * Every attribute a typography role carries.
 *
 * A role used to expose only the fields the theme happened to PIN — so `tab: { weight: 500 }` offered a
 * weight and a family and nothing else, and there was no way to italicise a tab title however much you
 * wanted to. The editor now offers all of them on every role, which is what the completeness rule meant
 * all along.
 */
export const TYPOGRAPHY_FIELDS: readonly string[] = [
  'family',
  'sizePx',
  'bold',
  'case',
  'italic',
  'underline',
  'strikethrough',
];

/**
 * The TERMINAL is not HTML.
 *
 * xterm renders its own glyphs onto a canvas from a font family and a size. It has no notion of
 * "underline the whole terminal", or of recasing it, or of striking it through — and a control that
 * cannot possibly do anything is worse than a missing one, because it invites you to try. The terminal
 * therefore carries exactly the two attributes it can honour.
 */
export const TERMINAL_FONT_FIELDS: readonly string[] = ['family', 'sizePx'];

/** The attributes a given role can actually honour. */
export function fieldsForRole(role: TypographyRole): readonly string[] {
  return role === 'terminal' ? TERMINAL_FONT_FIELDS : TYPOGRAPHY_FIELDS;
}

/** An icon value: a glyph string, or an image referenced by a pack-relative filename (007). */
export type IconValue = { glyph: string } | { image: string };

export interface Theme {
  name: string;
  /** Colour tokens (hex/rgb strings). */
  colours: Record<string, string>;
  fonts: ThemeFonts;
  /** Per-section font overrides (each inherits `fonts` for unset fields). */
  typography?: Partial<Record<TypographyRole, ThemeFontRole>>;
  /**
   * The measurements that are neither a colour nor a font (018 follow-up).
   *
   * Icons were sized by the FONT SIZE of whatever hosted them, so the preferences window's icons grew
   * and shrank with its dialog text — two unrelated things wired to one control. And the scrollbar had
   * no width at all: `scrollbar-width` takes only `auto | thin | none`, so "thin" was the only answer
   * the application could give, and it was too thin.
   */
  sizes?: ThemeSizes;
  /** Icon tokens → glyph (the base, always-present glyph defaults). */
  icons: Record<string, string>;
  /** (007, FR-039) Name of the chosen icon pack — maps all tokens to the pack. */
  iconPack?: string;
  /** (007, FR-039) Per-token overrides on top of the pack (glyph or image). */
  iconOverrides?: Record<string, IconValue>;
}

/** The default, always-complete theme. Missing tokens in any theme fall back here. */
export const THRONG_THEME: Theme = {
  name: 'throng',
  colours: {
    appBg: '#10131a',
    sidebarBg: '#161b25',
    /* The pane and panel BODY. Until 018 this token also painted the menus, the inputs, the row
       hovers, the modals, the tab chip and several buttons — roughly thirty call sites doing eight
       different jobs, so an author could not restyle one without breaking another. The roles below
       are carved out of it. */
    surface: '#1b2230',
    /* The thing currently SELECTED or active. */
    surfaceActive: '#222c3d',
    /* Carved out of `surface` (018, FR-001). Each falls back to its parent for a theme authored
       before the split — see TOKEN_PARENT. */
    menuSurface: '#1b2230',
    inputSurface: '#1b2230',
    hoverSurface: '#1b2230',
    dialogSurface: '#1b2230',
    /* NOTE: `menuItemHoverSurface` is deliberately ABSENT — it is an OPTIONAL token (see
       OPTIONAL_THEME_COLOUR_TOKENS). Unset, the hovered menu row follows the ACTIVE PROJECT'S
       dominant colour, which the projects store writes into `--accent` at runtime (Principle I).
       Giving it a value here would pin every menu highlight to the theme and silently demote the
       project colour. */
    /* The foreground that sits ON the highlight. Hard-coded as #06101f in several places before
       018, with no token to name it. */
    accentText: '#06101f',
    /* The foreground that sits ON the danger colour — the confirm button of a destructive dialog,
       the hovered remove control. Hard-coded as #fff in three places before 018. Same story as
       `accentText`: a real, recurring role that nobody had named, so nobody could theme it. */
    dangerText: '#ffffff',
    text: '#e6ebf2',
    textMuted: '#93a0b4',
    accent: '#6aa3ff',
    danger: '#e5534b',
    /* 018 follow-up — an ERROR NOTICE has its own surface.
     *
     * It used to sit on `dialogSurface`, the same colour as every other card in the application, with a
     * three-pixel red edge as its only claim on your attention — and in a dark theme that edge is a
     * thin line in the corner of a dark screen, which is precisely where a message saying YOUR SAVE
     * FAILED must not be. It gets a surface of its own, and a foreground guaranteed to read on it. */
    errorSurface: '#3a1d22',
    errorText: '#ffd9dd',
    success: '#3fb950',
    /* Scrollbars (018, FR-009). Before this, the ONLY styled scrollbar in the app was the
       terminal's, which borrowed `border` for its thumb and `textMuted` for the hover, and
       hard-coded `transparent` for the track. Everything else rendered the browser engine's default
       — a light-grey bar in an otherwise dark application. */
    scrollbarTrack: '#10131a',
    scrollbarThumb: '#2a3344',
    railBg: '#161b25',
    border: '#2a3344',
    statusBarBg: '#10131a',
    // Inline terminal (005, xterm.js) — themeable surface/foreground/cursor/selection.
    terminalBg: '#0c0f16',
    terminalFg: '#d6deea',
    terminalCursor: '#6aa3ff',
    terminalSelection: '#2a3a57',
    // Inline editor (006, CodeMirror) — themeable surface/foreground/caret/selection.
    editorBg: '#0c0f16',
    editorFg: '#d6deea',
    editorCursor: '#6aa3ff',
    editorSelection: '#2a3a57',
    // Editor line-number gutter (009) — its own surface + line-number colour, a
    // subtle offset from the editor body so it reads as a distinct strip.
    editorGutterBg: '#151a23',
    editorGutterFg: '#8b98ac',
    // Syntax highlighting (016, FR-006/FR-007). Ten tokens, mapped from the grammar's
    // node types to a colour the theme owns — so highlighting is a THEME concern, not a
    // hard-coded editor one, and switching theme repaints code live. They are CSS
    // variables at render time, which is what makes that repaint free.
    syntaxKeyword: '#7ea8ff',
    syntaxString: '#8ed09a',
    // Comments and punctuation are the quietest hues, and that makes them the BINDING constraint:
    // a match highlight can only be tinted as far as the weakest colour still reads on it. Both
    // carry deliberate headroom above the floor so the search highlight can stay visible.
    syntaxComment: '#93a2b8',
    syntaxNumber: '#e0a878',
    syntaxType: '#63cfd4',
    syntaxFunction: '#c8a6f0',
    syntaxVariable: '#d6deea',
    syntaxOperator: '#9fb3cc',
    syntaxPunctuation: '#a3b0c4',
    syntaxInvalid: '#ff6b6b',
    // The editor's own status strip (016, FR-010) — the band along the BOTTOM OF AN
    // EDITOR PANEL carrying the language indicator. Deliberately NOT `statusBarBg`,
    // which is the application's status bar: different surface, different purpose, and
    // one letter apart would have been a trap for every future theme author.
    editorStatusStripBg: '#151a23',
    editorStatusStripFg: '#a7b4c8',
    editorStatusStripHover: '#233047',
    // The shared unsaved-changes dot (Panel/Tab/project) + editor file/type pills (006).
    unsavedDot: '#e3b341',
    // In-panel search match highlights (013, FR-019). One pair of surfaces shared by
    // the editor and the terminal: every match is tinted, and the current match takes
    // a stronger tint plus an outline so it reads as "the one you are on". Body text
    // must stay legible on both (SC-005), so bundled themes derive these per palette.
    // Re-tuned by 016 (FR-007a): the old surfaces (#1c2f4d / #2c4a7a) were a strong blue, and once
    // code beneath them became SYNTAX-COLOURED rather than plain text, six of the ten hues fell
    // below the readable floor on the current match — a blue keyword vanishing into a blue
    // highlight is precisely the failure FR-007a forbids. Softening them keeps every hue legible
    // AND leaves the current match MORE visible against the editor surface than it was (1.45:1).
    searchMatch: '#151e2d',
    searchMatchCurrent: '#213049',
    searchMatchCurrentBorder: '#6aa3ff',
    // The active Files & Folders pane highlight (006, FR-015/SC-006).
    activePaneHighlight: '#6aa3ff',
    // The active-panel focus context indicator (012, FR-002). Two states: the
    // foreground treatment when this window is the foreground OS window, and a
    // dimmed inactive treatment when it is background (the indicator persists in
    // both). Distinct tokens so a theme can tune each independently.
    activePanelBorder: '#6aa3ff',
    activePanelBorderInactive: '#3f5f8c',
    // Buttons carry their own style tokens (007, FR-046a) — separate from the
    // generic surface/text tokens. Hover flips to the accent + the app background.
    buttonBg: '#222c3d',
    buttonText: '#e6ebf2',
    buttonHoverBg: '#6aa3ff',
    buttonHoverText: '#10131a',
  },
  fonts: {
    family: "'Segoe UI', system-ui, sans-serif",
    baseSizePx: 13,
    weights: { normal: 400, bold: 600 },
  },
  // Per-section fonts. Sizes left unset track `fonts.baseSizePx` (so editing
  // baseSizePx rescales tab/panel/body/project text); paneTitle + projectPath pin
  // their own smaller sizes intentionally.
  typography: {
    paneTitle: { sizePx: 11, bold: true, case: 'upper' },
    // `tab` and `button` used to ask for weight 500 — "a touch bolder than body". With a two-weight
    // font, which is nearly all of them, 500 renders as regular: the touch was never there.
    tab: {},
    panel: { bold: true },
    paneText: {},
    projectName: { bold: true },
    projectPath: { sizePx: 11 },
    button: {},
    // Dialogs and the preferences window — themeable at last.
    dialog: {},
    // Editor + terminal default to a monospace face (006, FR-074). Overridable per
    // theme like any other role; sizes pin 14px intentionally.
    editor: { family: "Consolas, 'Courier New', monospace", sizePx: 14 },
    terminal: { family: "Consolas, 'Courier New', monospace", sizePx: 14 },
  },
  // Icon glyphs (themeable). Plain glyphs for now so they render without an icon
  // font; a future theme may map these tokens to an icon set.
  sizes: {
    iconPx: 16,
    scrollbarPx: 12,
  },
  icons: {
    destroy: '✕',
    // Dismiss a transient message (error bar / notice). Same default glyph as
    // `destroy` but a distinct token so re-skinning one never affects the other
    // (009 addition; consumed by 011 main-window affordances).
    dismiss: '✕',
    collapse: '‹',
    expand: '›',
    rename: '✎',
    send: '↪',
    tab: '▭',
    add: '＋',
    detach: '⧉',
    // Retry a terminal attach that is still starting (008 FR-005) — a themeable action
    // icon (constitution v3.12.0), auto-exposed in the Themes editor like every token.
    retry: '↻',
    // Restore a configuration to its shipped defaults (014). Deliberately NOT the `retry`
    // circular arrow: the Themes editor shows "restore this theme" and "restore ALL themes"
    // side by side, so they must read as different actions at a glance.
    restoreAll: '⎌',
    // Undo one item back to the value it had when the preferences window was opened (015,
    // FR-016). It sits in the same row gutter as `retry` (reset to shipped) and `destroy`
    // (clear), so it has to read as a THIRD action: a plain undo arrow, not another circular
    // one. "Back to where I started" is not "back to what Throng ships".
    revert: '↶',
    // Preferences UI⇄JSON mode toggle (015). The toggle was the last text-labelled
    // control in the window ("{ }" / "UI"). Deliberately NOT `fileJson`/`fileCode`:
    // those mean "a JSON/code FILE" in the explorer tree, and re-skinning them for
    // the tree would silently re-skin the preferences toolbar too.
    editJson: '{ }',
    editVisual: '▤',
    // Reorder controls on the preferences array editor (015) — the last hard-coded glyphs
    // in the window. `collapse`/`expand` are horizontal chevrons and read wrong here.
    moveUp: '↑',
    moveDown: '↓',
    // Per-panel zoom controls (012) — themeable action icons on the panel context
    // menu (constitution v3.12.0). Circled +/-/dot read as in / out / reset.
    zoomIn: '⊕',
    zoomOut: '⊖',
    zoomReset: '⊙',
    // File Explorer tree (004, FR-005/FR-031). Folder/file glyphs, a symlink
    // indicator, by-type file icons, and toolbar actions — all themeable and
    // rendered in a fixed-size box so dimensions stay uniform.
    folder: '📁',
    folderOpen: '📂',
    chevron: '▸',
    file: '📄',
    fileCode: '🗎',
    fileJson: '🗎',
    fileMarkdown: '📝',
    fileImage: '🖼',
    fileText: '📄',
    symlink: '↳',
    // Panel-type markers shown at the head of each panel's title (012). Terminal
    // reuses the terminal glyph below; the editor gets its own themeable token.
    editorPanel: '🖉',
    expandAll: '⊞',
    collapseAll: '⊟',
    newFolder: '📁',
    terminal: '▣',
    // Find-bar action controls (013, FR-018). Every control in the find bar is a
    // themeable icon carrying a hover title — never a text label. Closing the bar
    // reuses the shared `dismiss` glyph above.
    search: '🔍',
    findNext: '↓',
    findPrevious: '↑',
    // The two match-mode toggles read as the thing they match on: "Aa" for letter case,
    // "ab" for a whole word. Both are two characters, so the pair reads as a set.
    matchCase: 'Aa',
    wholeWord: 'ab',
    replace: '⇄',
    replaceAll: '⇶',
    /* 018 / FR-015. The cog menu drew a hard-coded inline gear because the theme had no settings
       glyph — which is exactly the #56 defect, and exactly why the project-settings options icon
       (FR-040) needs one too. One token, two consumers. */
    settings: '⚙',
    /* 018 / FR-014b. The window controls drew four hard-coded inline vectors. SC-002 claims ZERO
       icons in the application come from an inline vector, so deferring these would have made a
       success criterion false on the day it shipped. Icon tokens do not participate in the colour
       distinctness metric, so they cost nothing against FR-006. */
    windowMinimise: '─',
    windowMaximise: '☐',
    windowRestore: '❐',
    windowClose: '✕',
  },
};

/**
 * Resolve a colour token to a definite colour, with `#000` as the last-resort floor.
 *
 * This DELEGATES to `resolveSplitColour` rather than reimplementing the lookup. Two colour
 * resolvers, one of which knew about the 018 split and one of which did not, is how FR-008 gets
 * reintroduced by the next call site that reaches for the convenient one: `resolveColour(theme,
 * 'menuSurface')` on a pre-split theme would have returned *throng's* default instead of that
 * theme's own surface — exactly the violation the split chain exists to prevent — and nothing
 * would have stopped it.
 *
 * Its existing callers (the drag-ghost window in main, the terminal panel) become split-aware for
 * free.
 */
export function resolveColour(theme: Theme, token: string): string {
  return resolveSplitColour(theme, token) ?? '#000000';
}

/*
 * `resolveIcon` used to live here. It is DELETED (017 / #54).
 *
 * It returned `theme.icons[token]` — never consulting `theme.iconPack` or `theme.iconOverrides` —
 * and its `string` return type structurally could not express an image. Every icon in the app went
 * through it, so the user's icon-pack choice was honoured nowhere they could see it.
 *
 * It is deleted rather than deprecated because leaving it exported is precisely what would let a
 * fourteenth call site quietly reintroduce the bug. Use `resolveIconAsset` (icon-pack.ts), which is
 * pack-aware and can return an image. A source guard fails the build if anything reaches for the old
 * name again.
 */

/**
 * 018 / FR-001, FR-008 — the surface split, and the ONE statement of its parentage.
 *
 * Each key is a role carved out of the overloaded token named by its value. A theme authored before
 * the split carries only the parent, so the child must resolve to *that theme's* parent value — not
 * to throng's default, which would visibly change a theme the user already had.
 *
 * This map is the single representation of that knowledge. `resolveSplitColour()`, `toCssVariables()`
 * and `makeTheme()` all read it, so no two of them can drift apart.
 *
 * Note `menuItemHoverSurface`'s parent is `accent`, NOT `surfaceActive`. The shared context menu —
 * the implementation every other menu is being folded into — already highlights its hovered row with
 * the accent colour; only the bespoke menus used `surfaceActive`. Unifying the menus necessarily
 * picks one, and it picks the survivor's.
 */
/**
 * 018 / FR-031a — colour tokens that are deliberately UNSET by default.
 *
 * `iconColour` is the only one. Its ABSENCE is its meaning: unset ⇒ icons inherit the colour of the
 * control hosting them, which is exactly what makes FR-029 true (no bundled theme changes appearance
 * the day the token lands). Give it a default value and every theme's icons repaint at once.
 *
 * But an unset token is not a leaf of `THRONG_THEME`, so the *derived* editor registry cannot see it
 * — and a token the visual editor cannot edit violates the constitution's configuration-editor
 * completeness rule, which is NON-NEGOTIABLE. Hence this list: `themeEditableTokens()` unions it in,
 * so the token is editable without being set.
 *
 * The all-themes completeness sweep, which iterates the built-in theme's actual keys, skips it for
 * free — which is the behaviour we want.
 */
export const OPTIONAL_THEME_COLOUR_TOKENS: readonly string[] = Object.freeze([
  'iconColour',
  // The menu highlight is optional for a DIFFERENT reason than the icon colour, and it matters.
  //
  // Unset, the hovered menu row follows `--accent` — which the projects store OVERRIDES at runtime
  // with the active project's dominant colour. That is Principle I: "the selected project's colour
  // MUST be visually dominant". Pinning this token to the theme's accent would quietly demote the
  // project colour on every menu in the application: switch to a project whose colour is red and the
  // menu highlight would stubbornly stay the theme's blue.
  //
  // Set, the author has deliberately chosen a fixed highlight and it wins.
  //
  // So its absence means "follow the project", not "use a default" — which is why it cannot simply
  // be a token with a value, and why it has no entry in TOKEN_PARENT.
  'menuItemHoverSurface',
]);

export const TOKEN_PARENT: Readonly<Record<string, string>> = Object.freeze({
  menuSurface: 'surface',
  inputSurface: 'surface',
  hoverSurface: 'surface',
  dialogSurface: 'surface',
});

/**
 * Resolve one colour token, honouring the split's parent fallback:
 *
 *     theme.colours[token] ?? theme.colours[parent] ?? THRONG_THEME.colours[token]
 *
 * Every consumer must go through this — not just `toCssVariables()`. The terminal panel reads
 * `theme.colours.*` straight from TypeScript, and the drag-ghost window resolves colours in the main
 * process; neither passes through the CSS variable emitter. If the chain lived only there, each of
 * them would grow its own copy of the fallback logic, which is the duplication FR-008 exists to
 * prevent.
 */
export function resolveSplitColour(theme: Theme, token: string): string | undefined {
  // A token is "set" only if it carries an actual colour. An empty string, a null from a
  // hand-edited JSON file, or a whitespace-only value are all ways of saying NOTHING — and treating
  // them as set is not pedantry: emitting `--throng-colour-menuSurface: ''` REMOVES the custom
  // property, and since the re-pointed rules no longer carry literal fallbacks, every menu in the
  // application would render with no background at all — white text floating over the workspace.
  //
  // The Themes editor makes this one keystroke away: select the hex field, press Delete.
  const set = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

  const colours = theme.colours ?? {};
  const own = colours[token];
  if (set(own)) return own;

  const parent = TOKEN_PARENT[token];
  const inherited = parent === undefined ? undefined : colours[parent];
  if (set(inherited)) return inherited;

  return THRONG_THEME.colours[token];
}

/**
 * Produce the full CSS custom-property map for a theme, merged over the throng
 * defaults so every token is always present (no unstyled UI). Keys are
 * `--throng-colour-<token>` and `--throng-font-*`.
 */
export function toCssVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  const colours = { ...THRONG_THEME.colours, ...theme.colours };
  for (const [token, value] of Object.entries(colours)) {
    vars[`--throng-colour-${token}`] = value;
  }
  // FR-008. Re-resolve the carved-out tokens THROUGH THE CHAIN, over the top of the plain merge
  // above. A theme authored before the split has no `menuSurface`, so the merge just handed it
  // THRONG's default — which would give a user's red theme blue-grey menus. The chain hands it that
  // theme's own `surface` instead.
  //
  // This cannot be done as a CSS `var(--x, fallback)`: the merge above means every property is
  // always defined, so a CSS fallback never fires at runtime.
  for (const token of Object.keys(TOKEN_PARENT)) {
    const resolved = resolveSplitColour(theme, token);
    if (resolved !== undefined) vars[`--throng-colour-${token}`] = resolved;
  }
  // The OPTIONAL tokens. Their ABSENCE is their meaning, so an unset one must emit NO property at
  // all — then the CSS `var(--x, fallback)` beside it expresses what unset means:
  //
  //   iconColour           unset ⇒ `inherit`      ⇒ a glyph takes the colour of its host (FR-029)
  //   menuItemHoverSurface unset ⇒ `var(--accent)` ⇒ the highlight follows the ACTIVE PROJECT
  //
  // Emptiness counts as unset, not as a colour: clearing the field in the Themes editor is exactly
  // how a user says "go back to inheriting", and the resolver already agrees (see resolveSplitColour).
  for (const token of OPTIONAL_THEME_COLOUR_TOKENS) {
    const own = theme.colours?.[token];
    if (typeof own !== 'string' || own.trim() === '') delete vars[`--throng-colour-${token}`];
  }
  const caseToTransform: Record<TextCase, string> = {
    original: 'none',
    title: 'capitalize',
    lower: 'lowercase',
    upper: 'uppercase',
  };

  /**
   * Underline and strikethrough are ONE CSS property.
   *
   * `text-decoration` is not two switches, it is a list — so a role that is both underlined and struck
   * through emits `underline line-through`, and a naive "underline ? 'underline' : 'none'" would make
   * each of them silently switch the other one off.
   */
  const decoration = (underline?: boolean, strikethrough?: boolean): string => {
    const parts = [underline ? 'underline' : '', strikethrough ? 'line-through' : ''].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : 'none';
  };

  const sizes = { ...THRONG_THEME.sizes, ...theme.sizes };
  vars['--throng-size-icon'] = `${sizes.iconPx ?? 16}px`;
  vars['--throng-size-scrollbar'] = `${sizes.scrollbarPx ?? 12}px`;

  const fonts = { ...THRONG_THEME.fonts, ...theme.fonts };
  const baseWeight = fonts.weights?.normal ?? THRONG_THEME.fonts.weights.normal;
  const boldWeight = fonts.weights?.bold ?? THRONG_THEME.fonts.weights.bold;
  vars['--throng-font-family'] = fonts.family;
  vars['--throng-font-size'] = `${fonts.baseSizePx}px`;
  vars['--throng-font-weight-normal'] = String(baseWeight);
  vars['--throng-font-weight-bold'] = String(fonts.weights?.bold ?? THRONG_THEME.fonts.weights.bold);
  // App-wide default case/italic/underline/strikethrough (applied to the body; roles inherit).
  vars['--throng-font-transform'] = caseToTransform[fonts.case ?? 'original'];
  vars['--throng-font-style'] = fonts.italic ? 'italic' : 'normal';
  vars['--throng-font-decoration'] = decoration(fonts.underline, fonts.strikethrough);

  // Per-section font roles: each field falls back to the base fonts, so unset
  // sizes track baseSizePx and unset case/italic/underline track the base. Emits
  // --throng-font-<role>-{family,size,weight,transform,style,decoration}.
  const roles = { ...THRONG_THEME.typography, ...(theme.typography ?? {}) };
  for (const [role, spec] of Object.entries(roles)) {
    const s = spec ?? {};
    // A blank (or absent) family falls back to the base family.
    const family = s.family && s.family.trim().length > 0 ? s.family : fonts.family;
    vars[`--throng-font-${role}-family`] = family;
    vars[`--throng-font-${role}-size`] = `${s.sizePx ?? fonts.baseSizePx}px`;
    // Bold means the theme's OWN bold number — which is what makes `fonts.weights` worth having.
    vars[`--throng-font-${role}-weight`] = String(s.bold ? boldWeight : baseWeight);
    vars[`--throng-font-${role}-transform`] = caseToTransform[s.case ?? fonts.case ?? 'original'];
    vars[`--throng-font-${role}-style`] = (s.italic ?? fonts.italic) ? 'italic' : 'normal';
    vars[`--throng-font-${role}-decoration`] = decoration(
      s.underline ?? fonts.underline,
      s.strikethrough ?? fonts.strikethrough,
    );
  }
  return vars;
}
