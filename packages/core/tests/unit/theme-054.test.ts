import { describe, expect, it } from 'vitest';
import { THRONG_THEME } from '../../src/config/theme.js';
import { THEME_TOKEN_COPY } from '../../src/config/theme-copy.js';
import { SHIPPED_DEFAULTS_VERSION } from '../../src/config/shipped-defaults.js';
import { migrateTheme } from '../../src/config/theme-ops.js';

/**
 * 054 (plan, Principle VI rules table) — five icon tokens: the panel maximise/restore pair (FR-071) and
 * the diagram view controls (FR-046b) that have no existing token. Diagram Zoom In / Zoom Out reuse
 * `zoomIn` / `zoomOut`. The MT-04 round retired `diagramFullSize` (the "Fill the panel" control) and added
 * `diagramZoomReset` (Zoom 100%, between Zoom Out and Zoom In) — the count of five holds.
 */
const TOKENS_054 = ['panelMaximise', 'panelRestore', 'diagramFit', 'diagramZoomReset', 'diagramFullPane'] as const;

describe('054 icon tokens', () => {
  it.each(TOKENS_054)('%s ships a glyph and editor copy', (token) => {
    const icons = THRONG_THEME.icons as Record<string, string>;
    expect(typeof icons[token]).toBe('string');
    expect(icons[token]!.length).toBeGreaterThan(0);
    const copy = THEME_TOKEN_COPY[`icons.${token}`];
    expect(copy?.label).toBeTruthy();
    expect(copy?.description).toBeTruthy();
  });

  it('bumps the shipped-defaults version so existing installs receive them', () => {
    // 21 for the first five; 22 for `diagramZoomReset` (MT-04), which an install holding a 21 marker lacks.
    expect(SHIPPED_DEFAULTS_VERSION).toBe(22);
  });

  it('retires diagramFullSize: no glyph, no editor copy, and a stray key is dropped on load', () => {
    expect((THRONG_THEME.icons as Record<string, string>).diagramFullSize).toBeUndefined();
    expect(THEME_TOKEN_COPY['icons.diagramFullSize']).toBeUndefined();
    const stray = { ...THRONG_THEME, icons: { ...THRONG_THEME.icons, diagramFullSize: '⛶' } };
    expect((migrateTheme(stray).icons as Record<string, string>).diagramFullSize).toBeUndefined();
  });
});
