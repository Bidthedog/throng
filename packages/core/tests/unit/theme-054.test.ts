import { describe, expect, it } from 'vitest';
import { THRONG_THEME } from '../../src/config/theme.js';
import { THEME_TOKEN_COPY } from '../../src/config/theme-copy.js';
import { SHIPPED_DEFAULTS_VERSION } from '../../src/config/shipped-defaults.js';

/**
 * 054 (plan, Principle VI rules table) — five icon tokens: the panel maximise/restore pair (FR-071) and
 * the three diagram view controls (FR-046b) that have no existing token. Diagram Zoom In / Zoom Out
 * reuse `zoomIn` / `zoomOut`.
 */
const TOKENS_054 = ['panelMaximise', 'panelRestore', 'diagramFit', 'diagramFullSize', 'diagramFullPane'] as const;

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
    expect(SHIPPED_DEFAULTS_VERSION).toBe(21);
  });
});
