/**
 * 073 FR-007a — one look for every setting toggle (constitution, Action controls › Setting toggles). The terminal's
 * toggles, the preview status bar's four and Synchronise Scrolling on both bars all draw it from one class, so the
 * four surfaces cannot drift; the glyphs ship plain so the control's own struck line is the off state's alone.
 *
 * Layer: unit — reads the shared stylesheet, the toggle icons' art and the sources that draw a toggle. What a mounted
 * button carries is asserted in each surface's component test (`terminal-status-bar-toggles`, `preview-wrap-toggle`,
 * `preview-lock-toggles`, `preview-cell-dialog-toggle`, `preview-status-bar`, `status-strip-preview-button`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, 'utf8');

describe('the shared setting-toggle stylesheet', () => {
  const css = read('packages/ui/src/renderer/common/setting-toggle.css');

  it('draws on in the full-contrast text colour on the pressed background, off muted with a struck line', () => {
    expect(css).toMatch(/\.setting-toggle\[aria-pressed='true'\] \.icon \{[^}]*color: var\(--throng-colour-text\)/);
    expect(css).toMatch(/\.setting-toggle\[aria-pressed='false'\] \.icon \{[^}]*color: var\(--throng-colour-textMuted\)/);
    expect(css).toMatch(/\.setting-toggle\[aria-pressed='true'\][^{]*\{[^}]*background: var\(--throng-colour-editorStatusStripHover\)/);
    const line = /\.setting-toggle\[aria-pressed='false'\]::after \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(line).toMatch(/content: ''/);
    expect(line).toMatch(/rotate\(45deg\)/);
  });

  it('uses theme tokens only: no hex or rgb colour outside a token fallback', () => {
    const stripped = css.replace(/var\([^)]*\)/g, '');
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

describe('every setting toggle on a status bar is drawn by the shared button', () => {
  const surfaces: ReadonlyArray<readonly [string, string]> = [
    ['the terminal status bar', 'packages/ui/src/renderer/terminal/terminal-status-bar.tsx'],
    ['the preview status bar', 'packages/ui/src/renderer/preview/preview-status-bar.tsx'],
    ['Synchronise Scrolling', 'packages/ui/src/renderer/preview/sync-scroll-button.tsx'],
  ];
  for (const [name, file] of surfaces) {
    it(`${name} uses SettingToggleButton`, () => {
      expect(read(file)).toContain('SettingToggleButton');
    });
  }

  it('the preview bar draws its four toggles that way: cell dialog, Wrap, Lock first row, Lock first column', () => {
    const src = read('packages/ui/src/renderer/preview/preview-status-bar.tsx');
    expect(src.match(/<SettingToggleButton/g)?.length).toBe(4);
    for (const token of ['cellDialog', 'wrapCells', 'lockFirstRow', 'lockFirstColumn']) {
      expect(src).toMatch(new RegExp(`<SettingToggleButton\\s+token="${token}"`));
    }
  });

  it('the terminal no longer draws its own on/off colours', () => {
    expect(read('packages/ui/src/renderer/terminal/terminal.css')).not.toMatch(/terminal-status-bar__toggle\[aria-pressed/);
  });
});

describe('the toggle glyphs ship plain: no slash of their own', () => {
  const KEYS = ['syncScroll', 'cellDialog', 'wrapCells', 'lockFirstRow', 'lockFirstColumn', 'rememberCommand', 'rememberDirectory', 'terminalNotifications'];
  for (const key of KEYS) {
    it(`${key}.svg has no diagonal line across the whole glyph`, () => {
      const svg = read(`packages/core/src/icons/default-set/${key}.svg`);
      // A struck "-off" icon carries a path from one corner to the other, such as "m2 2 20 20" or "M2 2l20 20".
      expect(svg).not.toMatch(/[mM]\s*2\s*,?\s*2\s*[lL]?\s*,?\s*20\s*,?\s*20/);
      expect(svg).not.toMatch(/<line\b/);
    });
  }
});
