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
import { THRONG_THEME, type Theme } from '../theme.js';
import { contrastRatio, hexToRgb, relativeLuminance } from '../theme-quality.js';

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
): { match: string; current: string; border: string } {
  let strongest = 0.05;
  for (let t = 0.7; t > 0.05; t -= 0.05) {
    if (contrastRatio(editorFg, blend(editorBg, accent, t)) >= 4.5) {
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
}

function makeTheme(name: string, p: Palette): Theme {
  const mono = p.monoFamily ?? MONO;
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
      // Search match highlights (013, FR-019 / SC-005): derived per palette so text
      // stays readable through a highlight on every bundled theme.
      searchMatch: searchHighlights(p.accent, p.editorBg ?? p.bg, p.editorFg ?? p.text).match,
      searchMatchCurrent: searchHighlights(p.accent, p.editorBg ?? p.bg, p.editorFg ?? p.text)
        .current,
      searchMatchCurrentBorder: searchHighlights(p.accent, p.editorBg ?? p.bg, p.editorFg ?? p.text)
        .border,
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
  Light: makeTheme('Light', {
    bg: '#f5f6f8', sidebar: '#eceef2', surface: '#ffffff', surfaceActive: '#e4e8ef',
    text: '#1a1d23', textMuted: '#5b6470', accent: '#2563eb', border: '#d5dae2',
    statusBar: '#e4e8ef', terminalBg: '#ffffff', terminalFg: '#1a1d23', editorBg: '#ffffff',
    editorFg: '#1a1d23', selection: '#cfe0ff',
  }),
  Snake: makeTheme('Snake', {
    bg: '#1a1e14', sidebar: '#141810', surface: '#242a1c', surfaceActive: '#323a28',
    text: '#c8d0b0', textMuted: '#8b936f', accent: '#8a9a5b', border: '#39412a',
    terminalBg: '#12160c', terminalFg: '#c8d0b0', selection: '#3a4426',
  }),
  Gothic: makeTheme('Gothic', {
    bg: '#140f16', sidebar: '#0e0a10', surface: '#211a24', surfaceActive: '#2f2434',
    text: '#d8c8d0', textMuted: '#8b7d86', accent: '#8b1a2f', danger: '#c0392b',
    border: '#332738', terminalBg: '#0f0b11', selection: '#3a2540',
  }),
  'Windows Terminal': makeTheme('Windows Terminal', {
    bg: '#0c0c0c', sidebar: '#0c0c0c', surface: '#1b1b1b', surfaceActive: '#2a2a2a',
    text: '#cccccc', textMuted: '#8a8a8a', accent: '#3a96dd', border: '#2a2a2a',
    terminalBg: '#0c0c0c', terminalFg: '#cccccc', selection: '#264f78', fontFamily: MONO,
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
    });
    // Neon Cyan is the second accent — placed on the cursors so both neons appear
    // as active-state accents alongside Neon Core Green (highlights / hover).
    t.colours.terminalCursor = '#00EFFF';
    t.colours.editorCursor = '#00EFFF';
    return t;
  })(),
  VSCode: makeTheme('VSCode', {
    bg: '#1e1e1e', sidebar: '#252526', surface: '#2d2d2d', surfaceActive: '#37373d',
    text: '#d4d4d4', textMuted: '#858585', accent: '#007acc', border: '#333333',
    terminalBg: '#1e1e1e', terminalFg: '#d4d4d4', editorBg: '#1e1e1e', selection: '#264f78',
  }),
  'VI-VIM': makeTheme('VI-VIM', {
    bg: '#1c1c1c', sidebar: '#161616', surface: '#262626', surfaceActive: '#303030',
    text: '#cccccc', textMuted: '#808080', accent: '#5f875f', border: '#303030',
    terminalBg: '#1c1c1c', selection: '#5f5f00', fontFamily: MONO,
  }),
  'English Garden': makeTheme('English Garden', {
    bg: '#f0f4e8', sidebar: '#e5ecd6', surface: '#ffffff', surfaceActive: '#dfe8cd',
    text: '#2a3a1a', textMuted: '#5f6f4a', accent: '#6a8a3a', danger: '#a3502f',
    border: '#cdd9b5', terminalBg: '#f7faf0', terminalFg: '#2a3a1a', selection: '#cfe0a8',
  }),
  Matrix: makeTheme('Matrix', {
    bg: '#000000', sidebar: '#020402', surface: '#031003', surfaceActive: '#052205',
    text: '#00ff41', textMuted: '#0aa028', accent: '#00ff41', border: '#0a3a0a',
    terminalBg: '#000000', terminalFg: '#00ff41', selection: '#0f4f0f', fontFamily: MONO,
  }),
  // Cyberpunk reference palette (009, FR-005): near-black base, crimson + deep
  // maroon structure, bright-yellow highlights, pale-teal accents.
  Cyberpunk: makeTheme('Cyberpunk', {
    bg: '#000000', sidebar: '#000000', surface: '#1a0209', surfaceActive: '#2a0410',
    text: '#f3e9ec', textMuted: '#b78a93', accent: '#55ead4', danger: '#c5003c',
    success: '#55ead4', border: '#880425', statusBar: '#000000',
    terminalBg: '#000000', terminalFg: '#f3e9ec', editorBg: '#000000', editorFg: '#f3e9ec',
    selection: '#3a0212', unsavedDot: '#f3e600', fontFamily: MONO,
  }),
  Claude: makeTheme('Claude', {
    bg: '#1a1613', sidebar: '#14100d', surface: '#262019', surfaceActive: '#332a20',
    text: '#e8e0d5', textMuted: '#a89b8a', accent: '#d97757', danger: '#c15f3c',
    border: '#332a20', terminalBg: '#161210', terminalFg: '#e8e0d5', selection: '#3d3020',
  }),
  Debian: makeTheme('Debian', {
    bg: '#1a1a1a', sidebar: '#141414', surface: '#242424', surfaceActive: '#2f2020',
    text: '#cccccc', textMuted: '#888888', accent: '#d70a53', danger: '#d70a53',
    border: '#2f2020', terminalBg: '#1a1a1a', selection: '#4a1226',
  }),
  Ubuntu: makeTheme('Ubuntu', {
    bg: '#2c001e', sidebar: '#24001a', surface: '#3d0a2c', surfaceActive: '#4d1339',
    text: '#eeeeec', textMuted: '#b8a0b0', accent: '#e95420', danger: '#e95420',
    border: '#4d1339', terminalBg: '#300a24', terminalFg: '#eeeeec', selection: '#5c1a44',
  }),
};

/** All installable default themes, including the built-in `throng` (restore source). */
export const ALL_DEFAULT_THEMES: Record<string, Theme> = {
  throng: THRONG_THEME,
  ...DEFAULT_THEMES,
};
