/**
 * A diagram's colours and font, from the active theme's tokens (054 FR-046, research R5).
 *
 * Concrete values, never `var(--throng-…)`: mermaid derives shades from the colours it is given, and a CSS
 * variable reference is not a colour it can compute with. `key` identifies the set, so a body re-renders
 * its diagrams exactly when the theme changes something a diagram uses.
 */
import type { Theme } from '@throng/core';

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

export function diagramThemeFrom(theme: Theme): DiagramTheme {
  const c = theme.colours;
  const background = c.surface ?? c.appBg ?? '#1e1f23';
  const values = {
    background,
    foreground: c.text ?? '#e6e6e6',
    muted: c.textMuted ?? c.text ?? '#9aa0aa',
    accent: c.accent ?? '#6aa3ff',
    border: c.border ?? '#34363c',
    surface: c.surfaceActive ?? background,
    selection: c.editorSelection ?? c.surfaceActive ?? background,
    fontFamily: theme.fonts.family,
  };
  return { ...values, key: JSON.stringify(values) };
}
