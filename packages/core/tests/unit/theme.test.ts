import { describe, it, expect } from 'vitest';
import { THRONG_THEME, resolveColour, resolveIconAsset, toCssVariables, type Theme } from '@throng/core';

describe('Theme token resolution (FR-030)', () => {
  it('resolves a present colour token', () => {
    expect(resolveColour(THRONG_THEME, 'surfaceActive')).toBe(THRONG_THEME.colours.surfaceActive);
  });

  it('falls back to the throng default for a missing token', () => {
    const sparse: Theme = { name: 'Sparse', colours: { surface: '#fff' }, fonts: THRONG_THEME.fonts, icons: {} };
    // present in sparse
    expect(resolveColour(sparse, 'surface')).toBe('#fff');
    // missing in sparse → throng default
    expect(resolveColour(sparse, 'danger')).toBe(THRONG_THEME.colours.danger);
    // 017: `resolveIcon` is deleted — it was the pack-BLIND resolver, and the reason the user's
    // icon-pack choice was ignored everywhere in the app (#54). The same fallback is now asserted
    // through the single pack-aware resolver, which also honours the selected pack.
    expect(resolveIconAsset(sparse, {}, 'destroy')).toEqual({
      kind: 'glyph',
      glyph: THRONG_THEME.icons.destroy,
    });
  });

  it('emits per-section typography vars; unset role sizes track baseSizePx', () => {
    const vars = toCssVariables(THRONG_THEME);
    // paneTitle pins 11px; tab/panel/paneText track baseSizePx (13).
    expect(vars['--throng-font-paneTitle-size']).toBe('11px');
    expect(vars['--throng-font-paneTitle-weight']).toBe('600');
    expect(vars['--throng-font-tab-size']).toBe('13px');
    // `tab` no longer asks for 500 — a two-weight font renders 500 as regular, so the "touch bolder"
    // it was asking for was never drawn. A role now says bold or not, and unbold means the base weight.
    expect(vars['--throng-font-tab-weight']).toBe('400');
    expect(vars['--throng-font-panel-size']).toBe('13px');
    expect(vars['--throng-font-paneText-size']).toBe('13px');
    expect(vars['--throng-font-projectPath-size']).toBe('11px');
  });

  it('rescales unset role sizes when baseSizePx changes (#8)', () => {
    const bigger: Theme = { ...THRONG_THEME, fonts: { ...THRONG_THEME.fonts, baseSizePx: 20 } };
    const vars = toCssVariables(bigger);
    expect(vars['--throng-font-tab-size']).toBe('20px'); // unset → tracks base
    expect(vars['--throng-font-panel-size']).toBe('20px');
    expect(vars['--throng-font-paneText-size']).toBe('20px');
    expect(vars['--throng-font-paneTitle-size']).toBe('11px'); // pinned, unchanged
  });

  it('lets a role override family/size/weight independently (#5/#7)', () => {
    const t: Theme = {
      ...THRONG_THEME,
      typography: { projectName: { family: 'Comic Sans', sizePx: 19, weight: 700 } },
    };
    const vars = toCssVariables(t);
    expect(vars['--throng-font-projectName-family']).toBe('Comic Sans');
    expect(vars['--throng-font-projectName-size']).toBe('19px');
    // WEIGHT is the role's own explicit number (100–900); unset would track fonts.weights.normal.
    expect(vars['--throng-font-projectName-weight']).toBe('700');
  });

  it('an unset role weight tracks the base normal weight', () => {
    const vars = toCssVariables(THRONG_THEME);
    // `tab` pins no weight → base normal (400); `paneTitle` ships 600.
    expect(vars['--throng-font-tab-weight']).toBe(String(THRONG_THEME.fonts.weights.normal));
    expect(vars['--throng-font-paneTitle-weight']).toBe('600');
  });

  it('emits case/italic/underline per role; paneTitle defaults to UPPER', () => {
    const vars = toCssVariables(THRONG_THEME);
    expect(vars['--throng-font-paneTitle-transform']).toBe('uppercase');
    expect(vars['--throng-font-tab-transform']).toBe('none');
    expect(vars['--throng-font-tab-style']).toBe('normal');
    expect(vars['--throng-font-tab-decoration']).toBe('none');
  });

  it('maps case overrides and italic/underline flags', () => {
    const t: Theme = {
      ...THRONG_THEME,
      typography: {
        tab: { case: 'title', italic: true },
        panel: { case: 'lower', underline: true },
        paneText: { case: 'upper' },
      },
    };
    const vars = toCssVariables(t);
    expect(vars['--throng-font-tab-transform']).toBe('capitalize');
    expect(vars['--throng-font-tab-style']).toBe('italic');
    expect(vars['--throng-font-panel-transform']).toBe('lowercase');
    expect(vars['--throng-font-panel-decoration']).toBe('underline');
    expect(vars['--throng-font-paneText-transform']).toBe('uppercase');
  });

  it('base fonts case/italic/underline apply app-wide and roles inherit them', () => {
    const t: Theme = {
      ...THRONG_THEME,
      fonts: { ...THRONG_THEME.fonts, case: 'upper', italic: true, underline: true },
    };
    const vars = toCssVariables(t);
    expect(vars['--throng-font-transform']).toBe('uppercase');
    expect(vars['--throng-font-style']).toBe('italic');
    expect(vars['--throng-font-decoration']).toBe('underline');
    // A role without its own case/italic inherits the base.
    expect(vars['--throng-font-tab-transform']).toBe('uppercase');
    expect(vars['--throng-font-tab-style']).toBe('italic');
  });

  it('a role override beats the base default for case/italic', () => {
    const t: Theme = {
      ...THRONG_THEME,
      fonts: { ...THRONG_THEME.fonts, case: 'upper', italic: true },
      typography: { tab: { case: 'lower', italic: false } },
    };
    const vars = toCssVariables(t);
    expect(vars['--throng-font-tab-transform']).toBe('lowercase');
    expect(vars['--throng-font-tab-style']).toBe('normal');
  });

  it('exposes a green success colour token', () => {
    expect(toCssVariables(THRONG_THEME)['--throng-colour-success']).toBe('#3fb950');
  });

  it('treats a blank role family as "use the base family" (#6)', () => {
    const base = THRONG_THEME.fonts.family;
    const t: Theme = {
      ...THRONG_THEME,
      typography: { tab: { family: '   ' }, panel: { family: 'Courier New' } },
    };
    const vars = toCssVariables(t);
    expect(vars['--throng-font-tab-family']).toBe(base); // blank → base
    expect(vars['--throng-font-panel-family']).toBe('Courier New');
  });

  it('defines the 18 typed button tokens + emits their CSS vars (021, US7, FR-027)', () => {
    const types = ['confirm', 'cancel', 'destroy'];
    const variants = ['Bg', 'HoverBg', 'Border', 'HoverBorder', 'Text', 'HoverText'];
    const vars = toCssVariables(THRONG_THEME);
    for (const type of types) {
      for (const variant of variants) {
        const token = `${type}Button${variant}`;
        expect(THRONG_THEME.colours[token], token).toBeTruthy();
        expect(vars[`--throng-colour-${token}`], token).toBe(THRONG_THEME.colours[token]);
      }
    }
    // The four legacy button tokens are gone (021, US7).
    for (const legacy of ['buttonBg', 'buttonText', 'buttonHoverBg', 'buttonHoverText']) {
      expect(THRONG_THEME.colours[legacy], legacy).toBeUndefined();
    }
    expect(THRONG_THEME.typography?.button, 'button role').toBeDefined();
    expect(vars['--throng-font-button-family']).toBeTruthy();
    expect(vars['--throng-font-button-size']).toBeTruthy();
    expect(vars['--throng-font-button-weight']).toBeTruthy();
  });

  it('emits a complete CSS custom-property map merged over defaults', () => {
    const sparse: Theme = {
      name: 'Sparse',
      colours: { accent: '#123456' },
      fonts: { family: 'Mono', baseSizePx: 15, weights: { normal: 300, bold: 700 } },
      icons: {},
    };
    const vars = toCssVariables(sparse);
    expect(vars['--throng-colour-accent']).toBe('#123456'); // overridden
    expect(vars['--throng-colour-danger']).toBe(THRONG_THEME.colours.danger); // default-filled
    expect(vars['--throng-font-family']).toBe('Mono');
    expect(vars['--throng-font-size']).toBe('15px');
    expect(vars['--throng-font-weight-bold']).toBe('700');
  });
});
