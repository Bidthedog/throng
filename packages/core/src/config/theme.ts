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
  weight?: number;
  /** Letter casing: original | title (Capitalised Words) | lower | UPPER. */
  case?: TextCase;
  italic?: boolean;
  underline?: boolean;
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
  | 'button'; // buttons carry their own typography role (007, FR-046a)

/** An icon value: a glyph string, or an image referenced by a pack-relative filename (007). */
export type IconValue = { glyph: string } | { image: string };

export interface Theme {
  name: string;
  /** Colour tokens (hex/rgb strings). */
  colours: Record<string, string>;
  fonts: ThemeFonts;
  /** Per-section font overrides (each inherits `fonts` for unset fields). */
  typography?: Partial<Record<TypographyRole, ThemeFontRole>>;
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
    surface: '#1b2230',
    surfaceActive: '#222c3d',
    text: '#e6ebf2',
    textMuted: '#93a0b4',
    accent: '#6aa3ff',
    danger: '#e5534b',
    success: '#3fb950',
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
    // The shared unsaved-changes dot (Panel/Tab/project) + editor file/type pills (006).
    unsavedDot: '#e3b341',
    // The active Files & Folders pane highlight (006, FR-015/SC-006).
    activePaneHighlight: '#6aa3ff',
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
    paneTitle: { sizePx: 11, weight: 600, case: 'upper' },
    tab: { weight: 500 },
    panel: { weight: 600 },
    paneText: {},
    projectName: { weight: 600 },
    projectPath: { sizePx: 11 },
    // Buttons carry their own typography role (007, FR-046a); a touch bolder than body.
    button: { weight: 500 },
    // Editor + terminal default to a monospace face (006, FR-074). Overridable per
    // theme like any other role; sizes pin 14px intentionally.
    editor: { family: "Consolas, 'Courier New', monospace", sizePx: 14 },
    terminal: { family: "Consolas, 'Courier New', monospace", sizePx: 14 },
  },
  // Icon glyphs (themeable). Plain glyphs for now so they render without an icon
  // font; a future theme may map these tokens to an icon set.
  icons: {
    destroy: '✕',
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
    expandAll: '⊞',
    collapseAll: '⊟',
    newFolder: '📁',
    terminal: '▣',
  },
};

/** Resolve a colour token, falling back to the throng default, then to `#000`. */
export function resolveColour(theme: Theme, token: string): string {
  return theme.colours[token] ?? THRONG_THEME.colours[token] ?? '#000000';
}

/** Resolve an icon token, falling back to the throng default (or empty string). */
export function resolveIcon(theme: Theme, token: string): string {
  return theme.icons[token] ?? THRONG_THEME.icons[token] ?? '';
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
  const caseToTransform: Record<TextCase, string> = {
    original: 'none',
    title: 'capitalize',
    lower: 'lowercase',
    upper: 'uppercase',
  };

  const fonts = { ...THRONG_THEME.fonts, ...theme.fonts };
  const baseWeight = fonts.weights?.normal ?? THRONG_THEME.fonts.weights.normal;
  vars['--throng-font-family'] = fonts.family;
  vars['--throng-font-size'] = `${fonts.baseSizePx}px`;
  vars['--throng-font-weight-normal'] = String(baseWeight);
  vars['--throng-font-weight-bold'] = String(fonts.weights?.bold ?? THRONG_THEME.fonts.weights.bold);
  // App-wide default case/italic/underline (applied to the body; roles inherit).
  vars['--throng-font-transform'] = caseToTransform[fonts.case ?? 'original'];
  vars['--throng-font-style'] = fonts.italic ? 'italic' : 'normal';
  vars['--throng-font-decoration'] = fonts.underline ? 'underline' : 'none';

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
    vars[`--throng-font-${role}-weight`] = String(s.weight ?? baseWeight);
    vars[`--throng-font-${role}-transform`] = caseToTransform[s.case ?? fonts.case ?? 'original'];
    vars[`--throng-font-${role}-style`] = (s.italic ?? fonts.italic) ? 'italic' : 'normal';
    vars[`--throng-font-${role}-decoration`] = (s.underline ?? fonts.underline) ? 'underline' : 'none';
  }
  return vars;
}
