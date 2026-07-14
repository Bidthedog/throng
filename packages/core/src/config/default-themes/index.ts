/**
 * Bundled default themes (feature 007, FR-044/045/046). 14 themes in addition to
 * the built-in `throng`, each styling the full token set (so no UI surface is left
 * unstyled) and pairwise-distinct. Brand-derived themes are best-effort colour
 * approximations, not official assets; **SUBNET is an explicit placeholder** until
 * the user supplies its branding. Pure data. No OS/DOM.
 *
 * Authored via {@link makeTheme}, which expands a compact palette into the full
 * colour token set, so each theme is complete without hand-listing 22 colours.
 */
import { THRONG_THEME, TOKEN_PARENT, type Theme } from '../theme.js';
import { contrastRatio, hexToRgb, relativeLuminance } from '../theme-quality.js';

/**
 * Derive every carved-out surface role from its parent, reading the parentage from the ONE place it
 * is stated (`TOKEN_PARENT`).
 *
 * A bundled theme supplies the parents (`surface`, `accent`); this expands them into the children.
 * The result is that every bundled theme is visually IDENTICAL after the split — the roles exist so
 * that an author *can* differentiate them, not so that throng does.
 */
function splitRolesFrom(parents: Record<string, string>): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const [token, parent] of Object.entries(TOKEN_PARENT)) {
    const value = parents[parent];
    if (value !== undefined) roles[token] = value;
  }
  return roles;
}

const MONO = "Consolas, 'Cascadia Mono', 'Courier New', monospace";

/** Mix a hex colour toward white (amount>0) or black (amount<0) by |amount|. */
function mixToward(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const target = amount >= 0 ? 255 : 0;
  const f = Math.abs(amount);
  const mix = (c: number): number => Math.round(c + (target - c) * f);
  const to2 = (c: number): string => mix(c).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/**
 * Default editor-gutter background: a subtle offset from the editor body — lighter
 * on dark themes, darker on light themes — so the gutter reads as a distinct strip
 * (009, FR-012). Dark themes lift ~9% toward white; light themes drop ~6% to black.
 */
function gutterBgFor(editorBg: string): string {
  const light = relativeLuminance(hexToRgb(editorBg)) > 0.5;
  return mixToward(editorBg, light ? -0.06 : 0.09);
}

/** Linear blend between two hex colours (`t` = 0 → `a`, 1 → `b`). */
function blend(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * t);
  const to2 = (c: number): string => c.toString(16).padStart(2, '0');
  return `#${to2(mix(ca.r, cb.r))}${to2(mix(ca.g, cb.g))}${to2(mix(ca.b, cb.b))}`;
}

/**
 * Active-panel focus-context indicator colours (012, FR-002 / SC-001), derived so
 * every bundled theme is legible without hand-listing them. The FOREGROUND border
 * keeps the theme accent where it already clears the WCAG AA non-text floor (≥3:1
 * against the panel surface); where the accent is too dark/low-contrast (some dark
 * themes), it is pulled toward the theme's own text colour — which is designed to
 * contrast the surface — until it clears the floor. The dimmed BACKGROUND border is
 * the foreground one pulled back toward the surface so it reads as de-emphasised,
 * but never below the identifiable floor (≥1.6:1).
 */
function activePanelBorders(accent: string, surface: string, text: string): {
  active: string;
  inactive: string;
} {
  let active = accent;
  for (let t = 0; t <= 1 && contrastRatio(active, surface) < 3.2; t += 0.1) {
    active = blend(accent, text, t);
  }
  let inactive = blend(active, surface, 0.55);
  for (let t = 0.5; t > 0 && contrastRatio(inactive, surface) < 1.6; t -= 0.1) {
    inactive = blend(active, surface, t);
  }
  return { active, inactive };
}

/**
 * Search match-highlight surfaces (013, FR-019 / SC-005), derived so every bundled
 * theme is legible without hand-listing them. Both surfaces tint the editor background
 * toward the theme accent — the current match more strongly than an ordinary one — but
 * only as far as keeps the editor's OWN text readable on top (WCAG AA text floor,
 * 4.5:1), because a highlight you cannot read through is worse than none. The outline
 * is the accent pulled toward the text until it clears the non-text floor (3:1) against
 * the current-match fill, so the match you are on stays identifiable on any palette.
 */
function searchHighlights(
  accent: string,
  editorBg: string,
  editorFg: string,
  overlaid: readonly string[] = [],
): { match: string; current: string; border: string } {
  // What is drawn ON a match is not editorFg — it is SYNTAX-COLOURED CODE (016, FR-007a). So the
  // tint must be weak enough that every one of those colours stays readable through it, not just
  // the plain body text. Constraining the SURFACE is what preserves the code's colours; the
  // alternative — lifting each syntax colour until it survives a strong tint — drags a whole
  // palette toward the foreground and flattens a theme's ten hues into four near-identical ones.
  // The current match stays identifiable regardless, because it also carries an outline.
  const readable = (surface: string): boolean =>
    contrastRatio(editorFg, surface) >= 4.5 &&
    overlaid.every((c) => contrastRatio(c, surface) >= 4.5);

  let strongest = 0.05;
  for (let t = 0.7; t > 0.05; t -= 0.05) {
    if (readable(blend(editorBg, accent, t))) {
      strongest = t;
      break;
    }
  }
  const current = blend(editorBg, accent, strongest);
  // An ordinary match is the same hue at ~45% of the strength, so it always reads as
  // weaker than the current one and is at least as legible (it sits nearer the surface).
  const match = blend(editorBg, accent, strongest * 0.45);
  let border = accent;
  for (let t = 0; t <= 1 && contrastRatio(border, current) < 3; t += 0.1) {
    border = blend(accent, editorFg, t);
  }
  return { match, current, border };
}

/**
 * A theme's syntax hues (016, FR-007/FR-007c) — the ten colours code is painted with.
 *
 * REQUIRED, not optional, and that is deliberate: a copy-pasted palette provably fails the
 * distinctness build gate (identical tokens contribute ΔE00 = 0 across a theme pair, dragging the
 * mean below the threshold), so every theme must draw these from its OWN character. Making the
 * field required means a theme that forgets to is a COMPILE error rather than a runtime surprise.
 *
 * These are SEEDS. {@link syntaxColours} lifts any that would be illegible on the theme's own
 * editor or search-match surfaces — a highlight you cannot read through is worse than none.
 */
interface SyntaxSeeds {
  keyword: string;
  string: string;
  comment: string;
  number: string;
  type: string;
  function: string;
  variable: string;
  operator: string;
  punctuation: string;
  invalid: string;
}

/**
 * Lift `colour` toward `text` until it clears `min` against EVERY background it will be seen on —
 * the editor body and both search-match surfaces (FR-007a). The hue is preserved as far as
 * legibility allows; the walk terminates at `text` itself, which the contrast pairings already
 * guarantee is legible on all three.
 */
function legibleOn(colour: string, backgrounds: readonly string[], text: string, min = 4.5): string {
  let out = colour;
  for (let t = 0.05; t <= 1.001; t += 0.05) {
    if (backgrounds.every((bg) => contrastRatio(out, bg) >= min)) break;
    out = blend(colour, text, t);
  }
  return out;
}

/**
 * The theme's ten syntax colours AND the search surfaces they will be seen on — derived together,
 * because they constrain each other (016, FR-007/FR-007a).
 *
 * Order matters. The hues are lifted to clear the EDITOR BODY first, preserving each theme's
 * character; the match surfaces are then tinted only as far as those hues survive. Doing it the
 * other way — fixing the surfaces, then lifting the code to cope — is what flattens a palette:
 * measured on the real themes it turned Bash's magenta keywords, green strings and grey comments
 * into three shades of the same off-white, and collapsed Matrix's ten greens into four. Every
 * contrast assertion still passed, and the highlighting was useless. The gate is not the goal.
 */
function syntaxAndSearch(
  seeds: SyntaxSeeds,
  editorBg: string,
  editorFg: string,
  accent: string,
): { syntax: Record<string, string>; match: string; current: string; border: string } {
  // Lifted to 6:1 on the body, not the bare 4.5:1 floor. The extra 1.5 is HEADROOM, and it is what
  // pays for a visible search highlight: a match surface can only be tinted as far as the weakest
  // syntax colour still clears 4.5:1 on it, so a comment authored at exactly 4.5 on the body leaves
  // NO budget and forces the match tint to collapse to invisibility. Comments are the binding
  // constraint here — they are deliberately the quietest hue — and a readable comment is not a
  // regression.
  const onBody = Object.fromEntries(
    Object.entries(seeds).map(([k, c]) => [k, legibleOn(c, [editorBg], editorFg, 6)]),
  ) as Record<keyof SyntaxSeeds, string>;

  const { match, current, border } = searchHighlights(
    accent,
    editorBg,
    editorFg,
    Object.values(onBody),
  );

  // A final pass against the (now code-aware) match surfaces. Ordinarily a no-op — it only bites
  // where even the weakest usable tint cannot carry a particular hue, and then it moves that ONE
  // colour rather than the whole palette.
  const lift = (c: string): string => legibleOn(c, [editorBg, match, current], editorFg);
  return {
    syntax: {
      syntaxKeyword: lift(onBody.keyword),
      syntaxString: lift(onBody.string),
      syntaxComment: lift(onBody.comment),
      syntaxNumber: lift(onBody.number),
      syntaxType: lift(onBody.type),
      syntaxFunction: lift(onBody.function),
      syntaxVariable: lift(onBody.variable),
      syntaxOperator: lift(onBody.operator),
      syntaxPunctuation: lift(onBody.punctuation),
      syntaxInvalid: lift(onBody.invalid),
    },
    match,
    current,
    border,
  };
}

/**
 * The editor status strip (016, FR-010) — the band along the bottom of an editor panel. It offsets
 * from the editor body exactly as the gutter does, so the two read as the same family of chrome,
 * and its label is lifted to the body-text floor because SC-007 promises the language indicator is
 * readable on every bundled theme. The hover surface tints toward the accent: the indicator is a
 * CLICKABLE control, and it has to look like one.
 */
function statusStrip(
  editorBg: string,
  textMuted: string,
  text: string,
  accent: string,
): { bg: string; fg: string; hover: string } {
  const bg = gutterBgFor(editorBg);
  return {
    bg,
    fg: legibleOn(textMuted, [bg], text),
    hover: blend(bg, accent, 0.22),
  };
}

interface Palette {
  bg: string;
  sidebar?: string;
  surface: string;
  surfaceActive?: string;
  text: string;
  textMuted?: string;
  accent: string;
  danger?: string;
  success?: string;
  border?: string;
  statusBar?: string;
  terminalBg?: string;
  terminalFg?: string;
  editorBg?: string;
  editorFg?: string;
  editorGutterBg?: string;
  editorGutterFg?: string;
  selection?: string;
  unsavedDot?: string;
  fontFamily?: string;
  monoFamily?: string;
  /** The theme's own ten syntax hues (016) — required; see {@link SyntaxSeeds}. */
  syntax: SyntaxSeeds;
}

function makeTheme(name: string, p: Palette): Theme {
  const mono = p.monoFamily ?? MONO;
  const editorBg = p.editorBg ?? p.bg;
  const editorFg = p.editorFg ?? p.text;
  const strip = statusStrip(editorBg, p.textMuted ?? p.text, p.text, p.accent);
  // The syntax hues and the search-match surfaces are derived TOGETHER: code is what gets drawn on
  // a match, so the surfaces are tinted only as far as the code stays readable on them (FR-007a).
  const code = syntaxAndSearch(p.syntax, editorBg, editorFg, p.accent);
  return {
    name,
    colours: {
      appBg: p.bg,
      sidebarBg: p.sidebar ?? p.bg,
      surface: p.surface,
      surfaceActive: p.surfaceActive ?? p.surface,
      text: p.text,
      textMuted: p.textMuted ?? p.text,
      accent: p.accent,
      danger: p.danger ?? '#e5534b',
      /*
       * The ERROR NOTICE's own surface — DERIVED per theme, not copied from one.
       *
       * Blending the theme's danger colour into its own background gives a card that is unmistakably
       * an error AND unmistakably part of THIS theme: dark and wine-coloured on a dark theme, pale and
       * pink on a light one, without fifteen hand-picked values to keep in step. The foreground is
       * then chosen for CONTRAST against that surface rather than assumed, so the message is readable
       * on every one of them — which the previous three-pixel red edge on the ordinary card was not.
       */
      errorSurface: mix(p.danger ?? '#e5534b', p.bg, 0.18),
      errorText: readableOn(mix(p.danger ?? '#e5534b', p.bg, 0.18), p.text),
      success: p.success ?? '#3fb950',
      railBg: p.sidebar ?? p.bg,
      border: p.border ?? p.surface,
      statusBarBg: p.statusBar ?? p.bg,
      terminalBg: p.terminalBg ?? p.bg,
      terminalFg: p.terminalFg ?? p.text,
      terminalCursor: p.accent,
      terminalSelection: p.selection ?? p.surfaceActive ?? p.surface,
      editorBg: p.editorBg ?? p.bg,
      editorFg: p.editorFg ?? p.text,
      editorCursor: p.accent,
      editorSelection: p.selection ?? p.surfaceActive ?? p.surface,
      // Editor gutter (009): a subtle offset from the editor body; line numbers
      // reuse the theme's muted foreground (≥3:1 on the gutter background).
      editorGutterBg: p.editorGutterBg ?? gutterBgFor(p.editorBg ?? p.bg),
      editorGutterFg: p.editorGutterFg ?? p.textMuted ?? p.text,
      unsavedDot: p.unsavedDot ?? '#e3b341',
      // Search match highlights (013, FR-019 / SC-005): derived per palette so text stays readable
      // through a highlight on every bundled theme — and, since 016, so does the SYNTAX-COLOURED
      // code that is what a match is actually drawn over (FR-007a).
      searchMatch: code.match,
      searchMatchCurrent: code.current,
      searchMatchCurrentBorder: code.border,
      activePaneHighlight: p.accent,
      // Active-panel focus context (012, FR-002 / SC-001): a contrast-guaranteed
      // accent marks the active panel when the window is foreground; a dimmed
      // variant marks it when the window is background — still identifiable but
      // visibly de-emphasised. Derived per theme so every palette stays legible.
      activePanelBorder: activePanelBorders(p.accent, p.surface, p.text).active,
      activePanelBorderInactive: activePanelBorders(p.accent, p.surface, p.text).inactive,
      // Button style tokens (007, FR-046a): a raised surface with the theme accent
      // on hover, hover text flipping to the app background for contrast against it.
      buttonBg: p.surfaceActive ?? p.surface,
      buttonText: p.text,
      buttonHoverBg: p.accent,
      buttonHoverText: p.bg,
      // Syntax highlighting (016): the theme's own hues, guaranteed readable on the editor body
      // and through a search-match highlight alike (FR-007a).
      ...code.syntax,
      // The editor status strip (016, FR-010) — its own surface, not the app's status bar.
      editorStatusStripBg: strip.bg,
      editorStatusStripFg: strip.fg,
      editorStatusStripHover: strip.hover,
      // 018 / FR-001. The roles carved out of the overloaded surface token, each DERIVED from its
      // parent so every bundled theme looks EXACTLY as it did before the split. That is the point:
      // the split does not restyle throng, it gives a theme author the second dial they never had.
      //
      // The parentage is READ FROM `TOKEN_PARENT`, not restated here. It is one piece of knowledge,
      // and the resolver and this derivation are the two things that must agree about it — so
      // writing it out twice is precisely how they would come to disagree.
      ...splitRolesFrom({ surface: p.surface, accent: p.accent }),
      // The foreground ON the accent colour — hard-coded as a near-black literal in several places
      // before 018. `p.bg` is what the button tokens already use for text on accent, so it is the
      // value that keeps every theme looking the same.
      accentText: p.bg,
      // White on the danger red in every palette — which is what all three call sites hard-coded,
      // so the token preserves every theme's appearance exactly while making it themeable.
      dangerText: '#ffffff',
      // 018 / FR-009. Before this, only the terminal's scrollbar was styled at all — it borrowed
      // `border` for the thumb and `textMuted` for the hover, and hard-coded `transparent` for the
      // track. Every other scrollable surface rendered the browser engine's default: a light-grey
      // bar in an otherwise dark application. These keep the terminal's existing colours and give
      // every other surface the same ones.
      scrollbarTrack: p.bg,
      scrollbarThumb: p.border ?? THRONG_THEME.colours.border,
    },
    fonts: {
      family: p.fontFamily ?? THRONG_THEME.fonts.family,
      baseSizePx: 13,
      weights: { normal: 400, bold: 600 },
    },
    typography: {
      ...THRONG_THEME.typography,
      editor: { family: mono, sizePx: 14 },
      terminal: { family: mono, sizePx: 14 },
    },
    icons: { ...THRONG_THEME.icons },
  };
}

/**
 * The 14 bundled default themes. `VI/VIM` is stored as `VI-VIM` because a `/` is
 * not a valid file-name segment (themes are one file per name).
 */
export const DEFAULT_THEMES: Record<string, Theme> = {
  // A light theme needs DARK syntax hues — the one place a dark theme's palette cannot simply be
  // reused, and the reason no single built-in highlight style could ever serve both.
  Light: makeTheme('Light', {
    bg: '#f5f6f8', sidebar: '#eceef2', surface: '#ffffff', surfaceActive: '#e4e8ef',
    text: '#1a1d23', textMuted: '#5b6470', accent: '#2563eb', border: '#d5dae2',
    statusBar: '#e4e8ef', terminalBg: '#ffffff', terminalFg: '#1a1d23', editorBg: '#ffffff',
    editorFg: '#1a1d23', selection: '#cfe0ff',
    syntax: {
      keyword: '#8250df', string: '#0a6b2e', comment: '#5b6470', number: '#8a4b00',
      type: '#0550ae', function: '#7c2d91', variable: '#1a1d23', operator: '#374151',
      punctuation: '#57606a', invalid: '#b91c1c',
    },
  }),
  // Snake's olive/moss character: greens against a warm khaki, kept apart by warmth not hue.
  Snake: makeTheme('Snake', {
    bg: '#1a1e14', sidebar: '#141810', surface: '#242a1c', surfaceActive: '#323a28',
    text: '#c8d0b0', textMuted: '#8b936f', accent: '#8a9a5b', border: '#39412a',
    terminalBg: '#12160c', terminalFg: '#c8d0b0', selection: '#3a4426',
    syntax: {
      keyword: '#b3c66a', string: '#d3c98a', comment: '#7b8560', number: '#e0b070',
      type: '#9fd0a0', function: '#d8dfa8', variable: '#c8d0b0', operator: '#a8b48a',
      punctuation: '#8b936f', invalid: '#d9705a',
    },
  }),
  // Gothic: crimson and dusty violet on near-black plum.
  Gothic: makeTheme('Gothic', {
    bg: '#140f16', sidebar: '#0e0a10', surface: '#211a24', surfaceActive: '#2f2434',
    text: '#d8c8d0', textMuted: '#8b7d86', accent: '#8b1a2f', danger: '#c0392b',
    border: '#332738', terminalBg: '#0f0b11', selection: '#3a2540',
    syntax: {
      keyword: '#c96a86', string: '#b9a2c9', comment: '#7d6c78', number: '#d29a6a',
      type: '#9ec5c9', function: '#e0b7c6', variable: '#d8c8d0', operator: '#a893a0',
      punctuation: '#8b7d86', invalid: '#e05252',
    },
  }),
  // Windows Terminal: the classic console 16-colour family — steel blue, olive, brick.
  'Windows Terminal': makeTheme('Windows Terminal', {
    bg: '#0c0c0c', sidebar: '#0c0c0c', surface: '#1b1b1b', surfaceActive: '#2a2a2a',
    text: '#cccccc', textMuted: '#8a8a8a', accent: '#3a96dd', border: '#2a2a2a',
    terminalBg: '#0c0c0c', terminalFg: '#cccccc', selection: '#264f78', fontFamily: MONO,
    syntax: {
      keyword: '#61afef', string: '#98c379', comment: '#7f7f7f', number: '#d19a66',
      type: '#56b6c2', function: '#c8a2e0', variable: '#cccccc', operator: '#abb2bf',
      punctuation: '#9a9a9a', invalid: '#e06c75',
    },
  }),
  // Multi-hue Git Bash prompt on black (009, FR-001): light-grey text with green
  // (user@host), magenta (shell tag), yellow (path), teal and cyan (git branch)
  // accents — deliberately far from Matrix's mono-green identity.
  Bash: makeTheme('Bash', {
    bg: '#000000', sidebar: '#000000', surface: '#101010', surfaceActive: '#1c1c1c',
    text: '#d7d7d7', textMuted: '#8a8a8a', accent: '#2bd4ee', danger: '#d160c9',
    success: '#2ecc71', border: '#1aa08a', statusBar: '#000000',
    terminalBg: '#000000', terminalFg: '#d7d7d7', editorBg: '#000000', editorFg: '#d7d7d7',
    selection: '#264f4a', unsavedDot: '#e5c07b', fontFamily: MONO,
    // Bash's identity is the multi-hue prompt itself: green user@host, magenta shell tag, yellow
    // path, teal/cyan git branch. The syntax palette is drawn straight from those five.
    syntax: {
      keyword: '#d160c9', string: '#2ecc71', comment: '#7a7a7a', number: '#e5c07b',
      type: '#2bd4ee', function: '#5fd7ff', variable: '#d7d7d7', operator: '#b0b0b0',
      punctuation: '#9a9a9a', invalid: '#ff5f5f',
    },
  }),
  // SUBNET brand palette (009, FR-003/004): Deep Space Blue base, Neon Core Green
  // + Neon Cyan reserved for accents/active states (never large blocks), Burnt
  // Amber callouts, Gunmetal Grey chrome, Midnight Slate as the secondary surface.
  SUBNET: ((): Theme => {
    const t = makeTheme('SUBNET', {
      bg: '#001B40', sidebar: '#001330', surface: '#303841', surfaceActive: '#3b4753',
      text: '#d6e6f5', textMuted: '#9fb0c2', accent: '#39FF14', danger: '#FF6F32',
      success: '#39FF14', border: '#4C4C4C', statusBar: '#001330',
      terminalBg: '#001B40', terminalFg: '#d6e6f5', editorBg: '#001B40', editorFg: '#d6e6f5',
      selection: '#0a3350', unsavedDot: '#FFE600',
      // The brand's own vocabulary: Neon Core Green and Neon Cyan as the two accents, Burnt Amber
      // for callouts, Electric Yellow for values — on Deep Space Blue.
      syntax: {
        keyword: '#39FF14', string: '#FFE600', comment: '#7d92a8', number: '#FF6F32',
        type: '#00EFFF', function: '#8CFF6B', variable: '#d6e6f5', operator: '#a8c4dc',
        // Burnt Amber is the brand's callout and belongs to NUMBERS here, so broken code takes a
        // distinct red. Two token types sharing one colour is two token types you cannot tell apart.
        punctuation: '#9fb0c2', invalid: '#FF3B4E',
      },
    });
    // Neon Cyan is the second accent — placed on the cursors so both neons appear
    // as active-state accents alongside Neon Core Green (highlights / hover).
    t.colours.terminalCursor = '#00EFFF';
    t.colours.editorCursor = '#00EFFF';
    return t;
  })(),
  // The Dark+ family it is named for: blue keywords, terracotta strings, olive comments.
  VSCode: makeTheme('VSCode', {
    bg: '#1e1e1e', sidebar: '#252526', surface: '#2d2d2d', surfaceActive: '#37373d',
    text: '#d4d4d4', textMuted: '#858585', accent: '#007acc', border: '#333333',
    terminalBg: '#1e1e1e', terminalFg: '#d4d4d4', editorBg: '#1e1e1e', selection: '#264f78',
    syntax: {
      keyword: '#569cd6', string: '#ce9178', comment: '#6a9955', number: '#b5cea8',
      type: '#4ec9b0', function: '#dcdcaa', variable: '#9cdcfe', operator: '#d4d4d4',
      punctuation: '#a0a0a0', invalid: '#f44747',
    },
  }),
  // VI/VIM's muted terminal palette: moss green, mustard, and a restrained slate.
  'VI-VIM': makeTheme('VI-VIM', {
    bg: '#1c1c1c', sidebar: '#161616', surface: '#262626', surfaceActive: '#303030',
    text: '#cccccc', textMuted: '#808080', accent: '#5f875f', border: '#303030',
    terminalBg: '#1c1c1c', selection: '#5f5f00', fontFamily: MONO,
    syntax: {
      keyword: '#87afd7', string: '#87af87', comment: '#6c6c6c', number: '#d7af5f',
      type: '#5fafaf', function: '#d7d7af', variable: '#cccccc', operator: '#afafaf',
      punctuation: '#949494', invalid: '#d75f5f',
    },
  }),
  // A light theme: dark, botanical hues on a pale green ground.
  'English Garden': makeTheme('English Garden', {
    bg: '#f0f4e8', sidebar: '#e5ecd6', surface: '#ffffff', surfaceActive: '#dfe8cd',
    text: '#2a3a1a', textMuted: '#5f6f4a', accent: '#6a8a3a', danger: '#a3502f',
    border: '#cdd9b5', terminalBg: '#f7faf0', terminalFg: '#2a3a1a', selection: '#cfe0a8',
    syntax: {
      keyword: '#7a2f6a', string: '#3a6b2a', comment: '#5f6f4a', number: '#8a4b1a',
      type: '#1f5f6a', function: '#6a4a1a', variable: '#2a3a1a', operator: '#44563a',
      // Distinct from the comment hue: the body lift converges them if they start this close, and
      // brackets that read as comments are brackets you stop seeing.
      punctuation: '#6b6152', invalid: '#a3231a',
    },
  }),
  // Matrix is mono-green ON PURPOSE, and that is the hardest case: the palette has to stay
  // recognisably one hue while still telling ten token types apart. It does it with LUMINANCE
  // — bright phosphor for keywords down to dim green for punctuation — plus a single amber
  // for what is broken, because an error that is also green is an error you do not see.
  Matrix: makeTheme('Matrix', {
    bg: '#000000', sidebar: '#020402', surface: '#031003', surfaceActive: '#052205',
    text: '#00ff41', textMuted: '#0aa028', accent: '#00ff41', border: '#0a3a0a',
    terminalBg: '#000000', terminalFg: '#00ff41', selection: '#0f4f0f', fontFamily: MONO,
    syntax: {
      keyword: '#7dff9a', string: '#00e07a', comment: '#0a8a2a', number: '#b8ff6b',
      type: '#3affc0', function: '#c8ffd0', variable: '#00ff41', operator: '#4ade80',
      punctuation: '#28a745', invalid: '#ffb000',
    },
  }),
  // Cyberpunk reference palette (009, FR-005): near-black base, crimson + deep
  // maroon structure, bright-yellow highlights, pale-teal accents.
  // Cyberpunk: bright yellow highlights and pale teal against crimson-on-black.
  Cyberpunk: makeTheme('Cyberpunk', {
    bg: '#000000', sidebar: '#000000', surface: '#1a0209', surfaceActive: '#2a0410',
    text: '#f3e9ec', textMuted: '#b78a93', accent: '#55ead4', danger: '#c5003c',
    success: '#55ead4', border: '#880425', statusBar: '#000000',
    terminalBg: '#000000', terminalFg: '#f3e9ec', editorBg: '#000000', editorFg: '#f3e9ec',
    selection: '#3a0212', unsavedDot: '#f3e600', fontFamily: MONO,
    syntax: {
      keyword: '#ff2e63', string: '#f3e600', comment: '#a06070', number: '#ff9f1c',
      type: '#55ead4', function: '#7df9ff', variable: '#f3e9ec', operator: '#d0a8b4',
      punctuation: '#b78a93', invalid: '#ff3860',
    },
  }),
  // Claude: warm terracotta on toasted brown — earthy, low-glare, no neon anywhere.
  Claude: makeTheme('Claude', {
    bg: '#1a1613', sidebar: '#14100d', surface: '#262019', surfaceActive: '#332a20',
    text: '#e8e0d5', textMuted: '#a89b8a', accent: '#d97757', danger: '#c15f3c',
    border: '#332a20', terminalBg: '#161210', terminalFg: '#e8e0d5', selection: '#3d3020',
    syntax: {
      keyword: '#d97757', string: '#a3b18a', comment: '#8c8074', number: '#e0b070',
      type: '#89b4b8', function: '#e8c07d', variable: '#e8e0d5', operator: '#bfb3a4',
      punctuation: '#a89b8a', invalid: '#e05c4a',
    },
  }),
  // Debian: its crimson-swirl red, with cool complements so code does not read as all-error.
  Debian: makeTheme('Debian', {
    bg: '#1a1a1a', sidebar: '#141414', surface: '#242424', surfaceActive: '#2f2020',
    text: '#cccccc', textMuted: '#888888', accent: '#d70a53', danger: '#d70a53',
    border: '#2f2020', terminalBg: '#1a1a1a', selection: '#4a1226',
    syntax: {
      keyword: '#ee5396', string: '#a2c4a0', comment: '#7a7a7a', number: '#e8a05c',
      type: '#79b8ca', function: '#d8b4dd', variable: '#cccccc', operator: '#b0b0b0',
      punctuation: '#949494', invalid: '#ff5c5c',
    },
  }),
  // Ubuntu: the aubergine-and-orange house palette.
  Ubuntu: makeTheme('Ubuntu', {
    bg: '#2c001e', sidebar: '#24001a', surface: '#3d0a2c', surfaceActive: '#4d1339',
    text: '#eeeeec', textMuted: '#b8a0b0', accent: '#e95420', danger: '#e95420',
    border: '#4d1339', terminalBg: '#300a24', terminalFg: '#eeeeec', selection: '#5c1a44',
    syntax: {
      keyword: '#e95420', string: '#aed581', comment: '#a08090', number: '#f0c674',
      type: '#77c4d3', function: '#dfbde0', variable: '#eeeeec', operator: '#c8b0bc',
      punctuation: '#b8a0b0', invalid: '#ff6f5e',
    },
  }),
};

/** All installable default themes, including the built-in `throng` (restore source). */

/** Blend `a` into `b` by `t` (0 = all b, 1 = all a). Both are `#rrggbb`. */
function mix(a: string, b: string, t: number): string {
  const parse = (h: string): [number, number, number] => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const ch = (x: number, y: number): string =>
    Math.round(x * t + y * (1 - t))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/**
 * `preferred` if it reads on `surface`; otherwise white or black, whichever does.
 *
 * A theme's ordinary text colour usually works on a surface derived from its own background — but
 * "usually" is not a guarantee, and the one case it fails is the one where the user cannot read the
 * message telling them what went wrong.
 */
function readableOn(surface: string, preferred: string): string {
  const lum = (h: string): number => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const f = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
  };
  const ratio = (x: string, y: string): number => {
    const [a, b] = [lum(x), lum(y)].sort((m, n) => n - m) as [number, number];
    return (a + 0.05) / (b + 0.05);
  };
  if (ratio(surface, preferred) >= 4.5) return preferred;
  return ratio(surface, '#ffffff') >= ratio(surface, '#000000') ? '#ffffff' : '#000000';
}

export const ALL_DEFAULT_THEMES: Record<string, Theme> = {
  throng: THRONG_THEME,
  ...DEFAULT_THEMES,
};
