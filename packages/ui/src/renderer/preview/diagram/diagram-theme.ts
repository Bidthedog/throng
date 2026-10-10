/**
 * A diagram's colours and font, from the active theme's tokens (054 FR-046, research R5).
 *
 * Concrete values, never `var(--throng-…)`: mermaid derives shades from the colours it is given, and a CSS
 * variable reference is not a colour it can compute with. A token the active theme leaves out is the
 * default theme's (`THRONG_THEME`, which every theme falls back to) — this file paints no colour of its own.
 * `key` identifies the set, so a body re-renders its diagrams exactly when the theme changes something a
 * diagram uses.
 */
import { THRONG_THEME, type Theme } from '@throng/core';

export interface DiagramTheme {
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly accent: string;
  readonly border: string;
  readonly surface: string;
  readonly selection: string;
  readonly fontFamily: string;
  /** Changes whenever any value above does. */
  readonly key: string;
}

/** `token` from the active theme, else the default theme's. */
function colour(theme: Theme, token: string): string {
  return theme.colours[token] ?? THRONG_THEME.colours[token] ?? '';
}

export function diagramThemeFrom(theme: Theme): DiagramTheme {
  const values = {
    // The diagram sits on the document page, so its ground is the page's.
    background: colour(theme, 'editorBg'),
    foreground: colour(theme, 'editorFg'),
    muted: colour(theme, 'textMuted'),
    accent: colour(theme, 'accent'),
    border: colour(theme, 'border'),
    surface: colour(theme, 'surfaceActive'),
    selection: colour(theme, 'editorSelection'),
    fontFamily: theme.fonts.family,
  };
  return { ...values, key: JSON.stringify(values) };
}
