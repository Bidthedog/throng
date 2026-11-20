/**
 * Theme document (FR-030, data-model §4). All app colours, icons, and fonts
 * resolve from a Theme; the default is "throng". Pure — the renderer turns the
 * resolved tokens into CSS custom properties (`--throng-*`). No OS/DOM here.
 */
import { readableTextOn } from './colour-math.js';
import { deriveFileIconColours } from './file-icon-colours.js';
import { deriveCalloutColours } from './callout-colours.js';

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
   * The font WEIGHT for this role, as a number (100–900). Unset → inherit the base weight
   * (`fonts.weights.normal`).
   *
   * This was a boolean `bold` that resolved to the theme's two `fonts.weights` numbers. That hid a real
   * control and produced a genuine defect: on a theme whose `weights.bold` was set low, turning a role
   * "bold" could render it LIGHTER than a sibling role's inherited normal weight, and there was no way
   * to ask for a specific weight at all. The caveat the boolean guarded is still true — most desktop
   * fonts ship only two weights, so 400/500/600 can render identically — but that is the FONT's limit
   * to expose, not ours to hide behind a checkbox: a variable font honours every step, and the slider
   * lets its owner use them. A role left unset simply tracks `fonts.weights.normal`.
   */
  weight?: number;
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
  | 'paneTitle' // PROJECTS / TERMINALS / FILE EXPLORER
  | 'tab' // tab name
  | 'panel' // panel name
  | 'paneText' // inner pane/panel text (empty states etc.)
  | 'projectName' // a project's name in the list
  | 'projectPath' // a project's path subtitle
  | 'editor' // inline editor text (CodeMirror) — monospace by default (006)
  | 'terminal' // inline terminal text (xterm) — monospace by default (006)
  | 'button'; // buttons carry their own typography role (007, FR-046a)
// The `dialog` role was RETIRED in 021: dialogs and the preferences window now simply inherit the base
// application font (there is no separate "dialog font" to keep in step), so `.modal`/`.prefs-root` fall
// through to `--throng-font-*`. One fewer role, and the app reads as one typographic whole.

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
  'weight',
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

/**
 * The EDITOR is code, and code is not prose (021).
 *
 * Casing, italics, underline and strikethrough on source text are noise, not theming — the same
 * argument the terminal makes, one attribute richer because the editor CAN honour a weight and a size.
 * So the editor carries family, size and weight only; the four decoration/casing controls are gone.
 */
export const EDITOR_FONT_FIELDS: readonly string[] = ['family', 'sizePx', 'weight'];

/** The attributes a given role can actually honour. */
export function fieldsForRole(role: TypographyRole): readonly string[] {
  if (role === 'terminal') return TERMINAL_FONT_FIELDS;
  if (role === 'editor') return EDITOR_FONT_FIELDS;
  return TYPOGRAPHY_FIELDS;
}

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
  /**
   * (069) The name of the user icon set this theme uses. ABSENT means the default set, which is what a
   * new or cloned theme gets. The key keeps its name on disk; the user-visible text says "icon set".
   */
  iconPack?: string;
}

/** The default, always-complete theme. Missing tokens in any theme fall back here. */
/** The backgrounds a file icon is drawn on in the throng theme: the tree's pane, a hovered row, a selected row, the app. */
const THRONG_FILE_ICON_BACKGROUNDS = ['#161b25', '#1b2230', '#222c3d', '#10131a'];

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
       before the split — see TOKEN_PARENT. 021 (FR-023) consolidated the menu and dialog cards back
       onto `surfaceActive` and `surface`, so `menuSurface`/`dialogSurface` are gone. */
    inputSurface: '#1b2230',
    hoverSurface: '#1b2230',
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
    /* 045 FR-138 — the underline that marks a link in an editor or a terminal: dashed at rest, solid
       on hover. The link's TEXT keeps its own colour. Both follow `accent` (see TOKEN_PARENT). */
    linkUnderline: '#6aa3ff',
    linkUnderlineHover: '#6aa3ff',
    /* 045 FR-165g — the link hint's own surface, text and border. Each follows the carved-out role it
       most resembles (a raised surface, body text, a hairline) rather than getting a value of its
       own, so a theme authored before the hint exists still draws one that reads (see TOKEN_PARENT). */
    linkHintBackground: '#222c3d',
    linkHintText: '#e6ebf2',
    linkHintBorder: '#2a3344',
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
    /* The amber cue for "this went ahead, but not the way you asked" — a warning notice's edge.
       Distinct from `danger` on purpose: a warning is not a failure, and colouring it red would
       teach users to read a red card as "something you can ignore". */
    warning: '#d29922',
    /* 057 (R11). The attention mark — one circle on a panel, tab, project or category — and the count on
       the taskbar badge; distinct from 047 FR-083's attention FLASH — a flash is a moment, a mark is a
       state. Round 13 (FR-135, FR-139) retired its Failed twin, `attentionFailedMark`: a failure's mark
       looks the same, and says what failed in words. */
    attentionMark: '#6aa3ff',
    /* Scrollbars (018, FR-009). Before this, the ONLY styled scrollbar in the app was the
       terminal's, which borrowed `border` for its thumb and `textMuted` for the hover, and
       hard-coded `transparent` for the track. Everything else rendered the browser engine's default
       — a light-grey bar in an otherwise dark application. */
    scrollbarTrack: '#10131a',
    scrollbarThumb: '#2a3344',
    railBg: '#161b25',
    // 046 iterate round 1 (FR-072) — the Projects pane's category header strip. Bold and uppercase
    // already mark it; this raises it off the sidebar body a shade so it reads as its own strip
    // (review finding IMPORTANT 5: painting it the same as `sidebarBg` failed to meet that). Follows
    // `surfaceActive` for a theme authored before this token existed (see TOKEN_PARENT) — the same
    // raised-surface role `linkHintBackground` already follows.
    categoryHeaderBackground: '#222c3d',
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
    // 049 FR-025 — a selection kept in an unfocused editor or preview. Hand-set from the SAME walk the
    // fourteen bundled themes run (`inactiveSelection` in default-themes), measured on these values;
    // re-measure it whenever `editorSelection`, `editorBg` or a match surface below moves. 049 FR-025a moved it from
    // `#182133` (ΔE00 8.25 from the page) to the walk's first candidate at least 9.0 from it: 11.10.
    editorSelectionInactive: '#2b323f',
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
    //
    // ══ HAND-MAINTAINED AGAINST A RULE THE OTHER FOURTEEN SATISFY AUTOMATICALLY (043, FR-067) ══
    //
    // `assertMatchDistinctness` (theme-quality.ts) requires an ordinary match, the current match and
    // the page behind them to be mutually distinguishable — three ΔE00 gaps, each above
    // `MATCH_DISTINCTNESS_THRESHOLD`. The fourteen bundled themes MEET that by construction:
    // `makeTheme` re-derives them, so a future change to `searchHighlights` moves all fourteen at
    // once. `throng` is authored here, by hand, and goes nowhere near `makeTheme` — so the same
    // change will move fourteen themes and silently leave this one behind, at values that were tuned
    // against a rule that no longer holds.
    //
    // That asymmetry is exactly why the gate runs over `ALL_DEFAULT_THEMES` and never
    // `DEFAULT_THEMES` (plan D5). It is the only thing that will notice, and the theme it protects is
    // the one every user sees first. If you move the derivation, MEASURE these two and re-set them.
    //
    // `searchMatch` is the neutral lift the derivation now produces for the fourteen —
    // `blend(editorBg, editorFg, 0.13)`, chosen by hand from the same search, at ΔE00 7.99 from the
    // current match and 8.07 from the page (the old `#151e2d` measured 6.81 / 6.62, and sat on the
    // accent ray where the current match already is). `searchMatchCurrent` keeps its 016 FR-007a
    // value unchanged, because FR-067 leaves the accent ray alone: the current match is what 016
    // tuned and what `searchMatchCurrentBorder` holds its 3:1 against.
    //
    // 049 FR-009a then raised the floor between the two fills to ΔE00 9.0, which 7.99 missed; `separatedMatch`'s
    // rule (the candidate nearest the old value that clears it, every other rule held) gives `#24272d`: 9.30 from
    // the current match, 7.06 from the page, and the outline below still 3:1 against it.
    searchMatch: '#24272d',
    searchMatchCurrent: '#213049',
    searchMatchCurrentBorder: '#6aa3ff',
    // 047 FR-074 — the ORDINARY match's outline, `blend(editorBg, editorFg, 0.49)`: the first
    // neutral tint the derivation's walk accepts, clearing 3:1 against the page (3.9:1) and against
    // the ordinary fill (3.0:1). Hand-set for the reason above; re-measure it with the other three.
    searchMatchBorder: '#6f747e',
    // 049 (#324, #325) — another instance of the selected text. Focused: exactly the ordinary-match
    // tint (FR-010, one soft tint means "another instance"). Unfocused: `inactiveOccurrence`'s walk
    // over this theme's values, nearer the page (FR-018a). Hand-set for the reason above.
    searchMatchOccurrence: '#24272d',
    searchMatchOccurrenceInactive: '#181b23',
    // The ACTIVE-PANE highlight — the outline marking the pane/panel you are working in (012, FR-002;
    // 021 consolidated the File Explorer's separate `activePaneHighlight` onto this one token so the
    // whole app marks the active pane the same way). While a project is open the highlight is painted
    // with that project's dominant colour at runtime (Principle I — the project colour must dominate),
    // so this value is the FALLBACK shown when no project colour applies; the dimmed variant marks the
    // pane when this window is in the background.
    activePanelBorder: '#6aa3ff',
    activePanelBorderInactive: '#3f5f8c',
    // Three-type button model (021, US7, FR-027). Every text dialog/form button resolves to exactly
    // one type — Confirm (safe primary), Cancel (safe dismiss), Destroy (destructive) — and each type
    // owns six tokens: bg / hover-bg / border / hover-border / text / hover-text. Derived (data-model
    // §6) so appearance is unchanged at rest: Confirm ← accent/accentText, Destroy ← danger/dangerText,
    // Cancel ← the legacy button surface + border. `migrateTheme` seeds the same values on load.
    // Order within each type — BG, Border, Text, then their Hover counterparts — is the order the
    // Themes editor renders them in (the registry preserves this key order), grouped resting-then-hover.
    confirmButtonBg: '#6aa3ff',
    confirmButtonBorder: '#6aa3ff',
    confirmButtonText: '#06101f',
    confirmButtonHoverBg: '#6aa3ff',
    confirmButtonHoverBorder: '#6aa3ff',
    confirmButtonHoverText: '#06101f',
    cancelButtonBg: '#222c3d',
    cancelButtonBorder: '#2a3344',
    cancelButtonText: '#e6ebf2',
    cancelButtonHoverBg: '#6aa3ff',
    cancelButtonHoverBorder: '#2a3344',
    cancelButtonHoverText: '#10131a',
    destroyButtonBg: '#e5534b',
    destroyButtonBorder: '#e5534b',
    destroyButtonText: '#ffffff',
    destroyButtonHoverBg: '#e5534b',
    destroyButtonHoverBorder: '#e5534b',
    destroyButtonHoverText: '#ffffff',
    /* 069 FR-061 — the file icon categories, derived to clear 4.5:1 on every background they sit on. */
    ...deriveFileIconColours(THRONG_FILE_ICON_BACKGROUNDS),
    /* 075 FR-022 — the seven callout roles, derived to clear body-text contrast on their own tint. */
    ...deriveCalloutColours('#0c0f16', '#d6deea'),
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
    // Weights ship EXPLICITLY on the roles that read bold (021): the headers, panel titles and project
    // names keep their 600 so the app looks exactly as before, but the control is now a weight slider,
    // resettable and adjustable, not a checkbox. `tab` and `editor` ship unset — they track the base
    // normal weight until an author moves their slider.
    paneTitle: { sizePx: 11, weight: 600, case: 'upper' },
    tab: {},
    panel: { weight: 600 },
    paneText: {},
    projectName: { weight: 600 },
    projectPath: { sizePx: 11 },
    button: {},
    // Editor + terminal default to a monospace face (006, FR-074). Overridable per
    // theme like any other role; sizes pin 14px intentionally.
    editor: { family: "Consolas, 'Courier New', monospace", sizePx: 14 },
    terminal: { family: "Consolas, 'Courier New', monospace", sizePx: 14 },
  },
  sizes: {
    iconPx: 16,
    scrollbarPx: 12,
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
 * Icons are not part of a theme (069). Every icon resolves through `resolveIcon` in
 * `icons/resolve-icon.ts`, from the theme's selected icon set or the default set.
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
  // 069 FR-054 (#638) — an icon button's RESTING background. Unset, an icon button is transparent, as every
  // one has always been, so no bundled theme changes the day it lands; set, every icon button in every window
  // sits on it. It is not a child of `surface` (TOKEN_PARENT): inheriting `surface` would paint a box behind
  // every icon in the application.
  'iconButtonSurface',
  // 069 FR-060 — the title bar's background. Unset, the bar is the app background mixed a tenth of the way
  // toward the text colour, so every theme's bar stands apart from the window beneath it — lighter on a dark
  // theme, darker on a light one — without any bundled theme carrying a value.
  'titleBarSurface',
  // 069 FR-061 — the file icon categories (file-icon-colours.ts), and FR-064's `other` for the unknown file.
  // Unset, a category's icons take the Icon Colour, as every icon did before; the bundled themes carry derived values.
  'fileIconCode',
  'fileIconMarkup',
  'fileIconData',
  'fileIconDocument',
  'fileIconMedia',
  'fileIconArchive',
  'fileIconScript',
  'fileIconOther',
  // 074 FR-027a, FR-027b (2026-11-19) — an Image or SVG preview's canvas, and the hatch drawn behind a picture's
  // transparent areas. Unset, both are mixed from the editor background and text colour (diagram.css), so every
  // theme gets a canvas apart from its editor and a hatch that reads against the canvas without a value of its own.
  'pictureCanvas',
  'pictureHatch',
]);

export const TOKEN_PARENT: Readonly<Record<string, string>> = Object.freeze({
  inputSurface: 'surface',
  hoverSurface: 'surface',
  // 045 FR-138 — the link underline. A theme authored before these tokens underlines its links in its
  // own accent, and one that sets only the at-rest colour gets it on hover too. The first chain two
  // deep, which is why `resolveSplitColour` walks rather than looking one step up.
  linkUnderline: 'accent',
  linkUnderlineHover: 'linkUnderline',
  // 045 FR-165g — the link hint popover. Each carved-out role follows the base token it stands in
  // for, so a theme authored before the hint existed draws one that already matches its palette.
  linkHintBackground: 'surfaceActive',
  linkHintText: 'text',
  linkHintBorder: 'border',
  // 046 iterate round 1 (FR-072) — the Projects pane's category header. Follows `surfaceActive`, the
  // same raised-surface role `linkHintBackground` already follows, so a theme authored before this
  // token existed draws a header strip visibly lifted off the sidebar body it sits on, rather than
  // painted the same colour as it (review finding IMPORTANT 5).
  categoryHeaderBackground: 'surfaceActive',
});

/**
 * Resolve one colour token, honouring the split's parent fallback:
 *
 *     theme.colours[token] ?? theme.colours[parent] ?? theme.colours[grandparent] ?? … ?? THRONG_THEME.colours[token]
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

  // Walk the chain: `linkUnderlineHover` → `linkUnderline` → `accent`. Bounded by the map's size, so
  // a cycle written into TOKEN_PARENT by mistake ends rather than spins.
  let parent = TOKEN_PARENT[token];
  for (let hops = 0; parent !== undefined && hops < Object.keys(TOKEN_PARENT).length; hops += 1) {
    const inherited = colours[parent];
    if (set(inherited)) return inherited;
    parent = TOKEN_PARENT[parent];
  }

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
  //   iconButtonSurface    unset ⇒ `transparent`   ⇒ an icon button shows only its icon until pointed at
  //   titleBarSurface      unset ⇒ the app background a tenth of the way toward the text ⇒ a bar apart from its window
  //   fileIcon*            unset ⇒ the Icon Colour ⇒ that category's file icons look like every other icon
  //   pictureCanvas        unset ⇒ the editor background a twentieth of the way toward the text ⇒ a canvas apart from it
  //   pictureHatch         unset ⇒ the editor background a fifth of the way toward the text ⇒ a hatch that reads on it
  //
  // Emptiness counts as unset, not as a colour: clearing the field in the Themes editor is exactly
  // how a user says "go back to inheriting", and the resolver already agrees (see resolveSplitColour).
  for (const token of OPTIONAL_THEME_COLOUR_TOKENS) {
    const own = theme.colours?.[token];
    if (typeof own !== 'string' || own.trim() === '') delete vars[`--throng-colour-${token}`];
  }
  // 057 FR-136 — the number inside the attention circle, DERIVED from its fill by 046 FR-072a's
  // black-or-white rule rather than given a token of its own, so a user's own `attentionMark` gets a
  // readable number too. Black when the fill is not a hex colour the rule can read.
  vars['--throng-attention-mark-text'] = readableTextOn(vars['--throng-colour-attentionMark'] ?? '') ?? '#000000';
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
    // The role's OWN weight if it pins one (a number, 100–900), else the base normal weight.
    vars[`--throng-font-${role}-weight`] = String(s.weight ?? baseWeight);
    vars[`--throng-font-${role}-transform`] = caseToTransform[s.case ?? fonts.case ?? 'original'];
    vars[`--throng-font-${role}-style`] = (s.italic ?? fonts.italic) ? 'italic' : 'normal';
    vars[`--throng-font-${role}-decoration`] = decoration(
      s.underline ?? fonts.underline,
      s.strikethrough ?? fonts.strikethrough,
    );
  }
  return vars;
}

/**
 * The relative luminance (WCAG) of a `#rgb` / `#rrggbb` colour — self-contained so `theme.ts` need
 * not import `theme-quality.ts`, which imports `theme.ts` back for `THRONG_THEME` (a runtime cycle).
 * An unparseable value returns 0 (treated as dark — the bundled default), never throws.
 */
function hexLuminance(hex: string): number {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.replace(/(.)/g, '$1$1') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 0;
  const chan = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = chan(parseInt(full.slice(0, 2), 16));
  const g = chan(parseInt(full.slice(2, 4), 16));
  const b = chan(parseInt(full.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whether a theme reads as LIGHT or DARK, from the luminance of its app background (issue 132).
 *
 * This drives the document's CSS `color-scheme`, and that property governs the colour Chromium
 * paints its viewport CANVAS BACKDROP — the layer BEHIND the (transparent-until-themed) `<html>`.
 * A hardcoded `color-scheme: dark` kept that backdrop near-black on a LIGHT theme, and the backdrop
 * composites OVER the window's native `backgroundColor` — so every window flashed black on load and
 * around any repaint, however correct the native background and the pre-paint token paint were.
 * Deriving the scheme from appBg makes the backdrop match the theme, which is what finally removes
 * the flash: the themed native bg and the preload token-paint were necessary but never sufficient
 * without it.
 */
export function themeColorScheme(theme: Theme): 'light' | 'dark' {
  return hexLuminance(resolveColour(theme, 'appBg')) > 0.5 ? 'light' : 'dark';
}

/** The resolved theme, ready to apply to a document root before its first paint. */
export interface ThemeBootstrap {
  /** The active theme's name, for `:root[data-theme="…"]` and test hooks. */
  name: string;
  /** The full `--throng-*` custom-property map (see {@link toCssVariables}). */
  vars: Record<string, string>;
  /** `light` | `dark`, for the document's `color-scheme` (issue 132; see {@link themeColorScheme}). */
  colorScheme: 'light' | 'dark';
}

/**
 * Build the pre-paint snapshot of a theme (issue 132). The main process hands this
 * to each window's preload SYNCHRONOUSLY, which applies it to `<html>` before the
 * renderer's first frame — so no window or modal ever flashes the default theme
 * before the saved one resolves over async config IPC.
 */
export function themeBootstrap(theme: Theme): ThemeBootstrap {
  return { name: theme.name, vars: toCssVariables(theme), colorScheme: themeColorScheme(theme) };
}
