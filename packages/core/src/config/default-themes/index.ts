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

const MONO = "Consolas, 'Cascadia Mono', 'Courier New', monospace";

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
      unsavedDot: p.unsavedDot ?? '#e3b341',
      activePaneHighlight: p.accent,
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
  Bash: makeTheme('Bash', {
    bg: '#000000', sidebar: '#000000', surface: '#0f150f', surfaceActive: '#152115',
    text: '#19cb19', textMuted: '#0f8a0f', accent: '#19cb19', border: '#123212',
    terminalBg: '#000000', terminalFg: '#19cb19', selection: '#124512', fontFamily: MONO,
  }),
  SUBNET: makeTheme('SUBNET', {
    // Placeholder approximation pending the user's branding (spec Assumptions).
    bg: '#0f141a', sidebar: '#0b1015', surface: '#1a222c', surfaceActive: '#25303d',
    text: '#c4d0dc', textMuted: '#7a8794', accent: '#5a8aa8', border: '#28323d',
    selection: '#2a3a48',
  }),
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
  Cyberpunk: makeTheme('Cyberpunk', {
    bg: '#0d0221', sidebar: '#0a021a', surface: '#1a0b3a', surfaceActive: '#2a1155',
    text: '#d1f7ff', textMuted: '#7a86b8', accent: '#ff2a6d', success: '#05d9e8',
    danger: '#ff2a6d', border: '#2a1155', terminalBg: '#0d0221', selection: '#3a1a66',
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
