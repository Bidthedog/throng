import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPTIONAL_THEME_COLOUR_TOKENS } from '@throng/core';

/**
 * 069 FR-054 (#638, #639) — About, Preferences, the Project settings dialog and the Resource Monitor share one
 * look: the same window background, the same icon button, section heading and field, all from theme tokens.
 * Each surface used to style these for itself, and the Project settings dialog styled its buttons not at all, so
 * they drew the browser's grey that no theme could reach.
 *
 * Layer: unit — the stylesheets and the markup's class names read as text. jsdom resolves no cascade, so what is
 * claimed is that each surface names the shared rule and that the shared rule says what it should; the rendered
 * class names are the component tests' (project-settings-dialog.test.ts).
 */
const renderer = (path: string): string => readFileSync(resolve(__dirname, '../../src/renderer', path), 'utf8');
const theme = renderer('theme.css');

/** The body of the first `selector {` rule in `css`, at the start of a line. */
const rule = (css: string, selector: string): string => {
  const at = new RegExp(`(^|\\n)${selector.replace(/[.()[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!at) throw new Error(`no ${selector} rule`);
  return at[2] ?? '';
};

describe('one look for every secondary window (069 FR-054)', () => {
  it('paints About, Preferences and the Resource Monitor on the app background', () => {
    expect(rule(renderer('about/about.css'), '.about-root')).toMatch(/background:\s*var\(--bg\)/);
    expect(rule(renderer('preferences/preferences.css'), '.prefs-root')).toMatch(/background:\s*var\(--bg\)/);
    expect(rule(theme, '.resource-monitor')).toMatch(/background:\s*var\(--bg\)/);
  });

  it('gives About the same title bar height as the others', () => {
    expect(rule(renderer('about/about.css'), '.about-root')).toMatch(/--title-bar-height:\s*var\(--pane-header-height/);
  });

  it('defines the icon button once, on the optional Icon Button Background, centred, with a visible hover', () => {
    expect(OPTIONAL_THEME_COLOUR_TOKENS).toContain('iconButtonSurface');
    const body = rule(theme, '.icon-button');
    expect(body).toMatch(/background:\s*var\(--throng-colour-iconButtonSurface, transparent\)/);
    expect(body).toMatch(/align-items:\s*center/);
    expect(body).toMatch(/justify-content:\s*center/);
    // The border shows where `hoverSurface` equals the surface beneath, as it does in every bundled theme.
    expect(rule(theme, ':where(body:not([data-window-blurred])) .icon-button:hover:not(:disabled)')).toMatch(
      /border-color:\s*var\(--border\)/,
    );
    expect(renderer('preferences/preferences.css')).not.toMatch(/(^|\n)\.icon-button\s*\{/);
  });

  it.each([
    ['about/about-app.tsx', 'section-heading about-section-label'],
    ['resources/breakdown.tsx', 'section-heading breakdown__heading'],
    ['resources/line-graph.tsx', 'section-heading line-graphs__heading'],
    ['project-settings/project-settings-dialog.tsx', 'section-heading project-settings__section'],
  ])('%s headings its sections with the shared section heading', (file, classes) => {
    expect(renderer(file)).toContain(`className="${classes}"`);
  });

  it.each([
    ['project-settings/project-settings-dialog.tsx', 'icon-button hidden-path__remove'],
  ])('%s draws its icon controls as the shared icon button', (file, classes) => {
    expect(renderer(file)).toContain(`className="${classes}"`);
  });

  it('shows the arrow over the About licence box and its scrollbar, not the text cursor (069 FR-069)', () => {
    expect(rule(renderer('about/about.css'), '.about-licence-text')).toMatch(/cursor:\s*default/);
  });

  it('paints every window\'s title bar apart from the window: the Title Bar Background, or a shade off the app background (069 FR-060)', () => {
    expect(OPTIONAL_THEME_COLOUR_TOKENS).toContain('titleBarSurface');
    const bar = rule(renderer('title-bar/title-bar.css'), '.title-bar');
    expect(bar.replace(/\s+/g, ' ')).toContain(
      'background: var( --throng-colour-titleBarSurface, color-mix(in srgb, var(--throng-colour-appBg, var(--bg)) 90%, var(--throng-colour-text, var(--text))) );',
    );
    // No window paints its own bar over it.
    for (const css of [renderer('about/about.css'), renderer('preferences/preferences.css'), theme]) {
      for (const m of css.matchAll(/\.title-bar\s*\{([^}]*)\}/g)) expect(m[1]).not.toMatch(/background/);
    }
  });

  it.each(['code', 'markup', 'data', 'document', 'media', 'archive', 'script'])(
    'colours a %s file icon from its category token, falling back to the Icon Colour (069 FR-061)',
    (category) => {
      const token = `fileIcon${category[0]!.toUpperCase()}${category.slice(1)}`;
      expect(rule(theme, `[data-icon-category='${category}'] .icon`)).toMatch(
        new RegExp(`color:\\s*var\\(--throng-colour-${token}, var\\(--throng-colour-iconColour, inherit\\)\\)`),
      );
    },
  );

  it('draws About\'s Close as every dialog\'s text button: the button role\'s type, the same padding and radius', () => {
    expect(theme).toMatch(/\.capture-modal__btn,\s*\.about-close\s*\{/);
    const close = rule(renderer('about/about.css'), '.about-close');
    expect(close).toMatch(/padding:\s*6px 14px/);
    expect(close).toMatch(/border-radius:\s*5px/);
  });
});
