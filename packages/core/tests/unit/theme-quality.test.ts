import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  rgbToLab,
  ciede2000,
  themePairDistance,
  closestPair,
  assertDistinct,
  DISTINCTNESS_THRESHOLD,
  CLOSEST_LEGITIMATE_PAIR_DELTA,
  measureContrast,
  assertInScopeContrast,
  assertSyntaxBodyContrast,
  assertSyntaxSelectionContrast,
  SYNTAX_SELECTION_MIN,
  SYNTAX_TOKENS,
  contrastPairingsFor,
  CONTRAST_PAIRINGS,
  meetsWcagAa,
  WCAG_AA_BODY,
  SYNTAX_BODY_MIN,
  MATCH_DISTINCTNESS_THRESHOLD,
  CLOSEST_MATCH_SURFACE_DELTA,
  closestMatchSurfacePair,
  assertMatchDistinctness,
  blendOver,
  WCAG_AA_LARGE_UI,
} from '../../src/config/theme-quality.js';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { IGNORED_ENTRY_OPACITY_DEFAULT, THRONG_THEME, type Theme } from '../../src/config/theme.js';

describe('colour maths (theme-quality)', () => {
  it('hexToRgb parses #rrggbb case-insensitively', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#39ff14')).toEqual({ r: 0x39, g: 0xff, b: 0x14 });
  });

  it('relativeLuminance is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('contrastRatio of black on white is 21:1 and is symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('ciede2000 is zero for identical colours and symmetric', () => {
    const a = rgbToLab({ r: 100, g: 150, b: 200 });
    expect(ciede2000(a, a)).toBeCloseTo(0, 6);
    const b = rgbToLab({ r: 10, g: 220, b: 40 });
    expect(ciede2000(a, b)).toBeCloseTo(ciede2000(b, a), 6);
  });

  it('ciede2000 matches the Sharma reference pair (2.0425)', () => {
    // Sharma et al. CIEDE2000 test data, pair 1.
    const lab1 = { L: 50.0, a: 2.6772, b: -79.7751 };
    const lab2 = { L: 50.0, a: 0.0, b: -82.7485 };
    expect(ciede2000(lab1, lab2)).toBeCloseTo(2.0425, 3);
  });
});

describe('distinctness (CIEDE2000 mean token-pair)', () => {
  const themes = Object.values(ALL_DEFAULT_THEMES);

  it('is zero for a theme against a copy of itself', () => {
    const copy: Theme = { ...THRONG_THEME, name: 'copy' };
    expect(themePairDistance(THRONG_THEME, copy)).toBeCloseTo(0, 6);
  });

  it('all bundled themes are pairwise distinct above the calibrated threshold', () => {
    expect(() => assertDistinct(themes)).not.toThrow();
    const { a, b, delta } = closestPair(themes);
    // The closest legitimate pair is what the threshold is calibrated against.
    expect(delta, `closest legitimate pair: ${a} vs ${b} = ${delta}`).toBeGreaterThanOrEqual(
      DISTINCTNESS_THRESHOLD,
    );
    expect(CLOSEST_LEGITIMATE_PAIR_DELTA).toBeCloseTo(delta, 2);
  });

  it('fails when a theme is duplicated onto another (twins are rejected)', () => {
    const twin: Theme = { ...ALL_DEFAULT_THEMES.Matrix, name: 'MatrixTwin' };
    expect(() => assertDistinct([...themes, twin])).toThrow(/MatrixTwin|Matrix/);
  });

  it('the recoloured Bash is far from Matrix (was a twin before the recolour)', () => {
    const bash = ALL_DEFAULT_THEMES.Bash;
    const matrix = ALL_DEFAULT_THEMES.Matrix;
    expect(themePairDistance(bash, matrix)).toBeGreaterThanOrEqual(DISTINCTNESS_THRESHOLD);
  });
});

/**
 * M1 (043, plan §"Two measurements") — this file is the command the measurement is taken with, so
 * the measurement lives here beside `CLOSEST_LEGITIMATE_PAIR_DELTA`'s, in the same shape. The
 * BEHAVIOUR of the FR-067 gate is covered in `theme-match-distinctness.test.ts`; what is asserted
 * here is that the recorded constant still equals what the shipped themes actually measure.
 */
describe('search-match distinctness — the M1 measurement (FR-067)', () => {
  const themes = Object.values(ALL_DEFAULT_THEMES);

  it('every bundled theme clears the floor, and the recorded measurement is current', () => {
    expect(() => assertMatchDistinctness(themes)).not.toThrow();
    const { theme, a, b, delta } = closestMatchSurfacePair(themes);
    expect(delta, `closest match-surface pair: ${theme} ${a} vs ${b} = ${delta}`).toBeGreaterThan(
      MATCH_DISTINCTNESS_THRESHOLD,
    );
    expect(CLOSEST_MATCH_SURFACE_DELTA).toBeCloseTo(delta, 6);
  });

  it('the floor keeps real headroom under the measurement and stays above the JND', () => {
    // Both ends of the calibration, asserted rather than described: a floor that crept up to meet
    // the measurement would be a ratchet, and one that sank below ~2.3 ΔE00 would permit a pair the
    // metric itself calls one colour.
    expect(CLOSEST_MATCH_SURFACE_DELTA - MATCH_DISTINCTNESS_THRESHOLD).toBeGreaterThan(0.5);
    expect(MATCH_DISTINCTNESS_THRESHOLD).toBeGreaterThanOrEqual(2.3);
  });
});

/**
 * 047 FR-074 (MT-01) — every find match carries an outline, not only the current one. The ordinary
 * match's outline is `searchMatchBorder`: a non-text mark, so it must clear 3:1 against the page it
 * sits on — `editorBg` in an editor, and the preview body, which `markdown.css` also paints
 * `editorBg` — and it must not be mistakable for the current match's own outline.
 */
describe('searchMatchBorder — the ordinary match outline (047 FR-074)', () => {
  const themes: Record<string, Theme> = { throng: THRONG_THEME, ...ALL_DEFAULT_THEMES };

  it('every shipped theme sets it, at ≥ 3:1 against the editor and preview background', () => {
    const failing: string[] = [];
    for (const [name, theme] of Object.entries(themes)) {
      const outline = theme.colours.searchMatchBorder;
      if (!outline) {
        failing.push(`${name}: not set`);
        continue;
      }
      const ratio = contrastRatio(outline, theme.colours.editorBg);
      if (ratio < 3) failing.push(`${name}: ${ratio.toFixed(2)}:1`);
    }
    expect(failing).toEqual([]);
  });

  it('is distinct from the current match outline on every shipped theme', () => {
    const failing: string[] = [];
    for (const [name, theme] of Object.entries(themes)) {
      const outline = theme.colours.searchMatchBorder;
      const current = theme.colours.searchMatchCurrentBorder;
      if (!outline || !current) continue;
      const delta = ciede2000(rgbToLab(hexToRgb(outline)), rgbToLab(hexToRgb(current)));
      if (delta < MATCH_DISTINCTNESS_THRESHOLD) failing.push(`${name}: ΔE00 ${delta.toFixed(2)}`);
    }
    expect(failing).toEqual([]);
  });
});

describe('contrast (WCAG 2.1 AA over enumerated pairings)', () => {
  const themes = Object.values(ALL_DEFAULT_THEMES);

  // 078 FR-001 (supersedes 009 FR-017/FR-018 and 019 FR-028): every bundled theme is gated, with no exemption.
  it('every bundled theme passes AA', () => {
    expect(() => assertInScopeContrast(themes)).not.toThrow();
    for (const theme of themes) {
      const name = theme.name;
      for (const r of measureContrast(theme)) {
        expect(r.pass, `${name}: ${r.label} = ${r.ratio.toFixed(2)} (needs ${r.min})`).toBe(true);
      }
    }
  });

  // 019 / #83: the syntax hues on the editor BODY — a pairing set of their own at a stricter floor, gated across
  // every bundled theme (078 FR-001).
  it('every bundled theme passes the syntax-on-editor-body gate', () => {
    expect(() => assertSyntaxBodyContrast(themes)).not.toThrow();
  });

  it('throws for a gated theme whose syntax hue is illegible on its editor body', () => {
    const muddy: Theme = {
      ...ALL_DEFAULT_THEMES.Light,
      name: 'Light',
      colours: { ...ALL_DEFAULT_THEMES.Light.colours, syntaxComment: '#fdfdfd', editorBg: '#ffffff' },
    };
    expect(() => assertSyntaxBodyContrast([muddy])).toThrow(/Light.*syntaxComment/);
  });

  it('gates the themes 019 once carved out, too (078 FR-001)', () => {
    for (const name of ['Matrix', 'VI-VIM', 'Gothic']) {
      const dim: Theme = {
        ...ALL_DEFAULT_THEMES[name],
        name,
        colours: { ...ALL_DEFAULT_THEMES[name].colours, syntaxComment: '#0b0b0b', editorBg: '#000000' },
      };
      expect(() => assertSyntaxBodyContrast([dim]), name).toThrow(new RegExp(`${name}: syntaxComment on editorBg`));
    }
  });

  // #105: the selection is the other background code is painted on.
  it('every bundled theme passes the syntax-on-selection gate', () => {
    expect(() => assertSyntaxSelectionContrast(themes)).not.toThrow();
  });

  it('throws for a gated theme whose syntax hue vanishes into its selection', () => {
    const muddy: Theme = {
      ...ALL_DEFAULT_THEMES.Light,
      name: 'Light',
      colours: { ...ALL_DEFAULT_THEMES.Light.colours, editorSelection: ALL_DEFAULT_THEMES.Light.colours.syntaxComment },
    };
    expect(() => assertSyntaxSelectionContrast([muddy])).toThrow(/Light.*syntaxComment on editorSelection/);
  });

  it('gates the themes 019 once carved out on the selection, too (078 FR-001)', () => {
    for (const name of ['Matrix', 'VI-VIM', 'Gothic']) {
      const dim: Theme = {
        ...ALL_DEFAULT_THEMES[name],
        name,
        colours: { ...ALL_DEFAULT_THEMES[name].colours, editorSelection: ALL_DEFAULT_THEMES[name].colours.syntaxComment },
      };
      expect(() => assertSyntaxSelectionContrast([dim]), name).toThrow(
        new RegExp(`${name}: syntaxComment on editorSelection`),
      );
    }
  });

  it('measures every syntax token on the selection, derived from the token set, at WCAG AA body', () => {
    const onSelection = CONTRAST_PAIRINGS.filter((p) => p.bg === 'editorSelection').map((p) => p.fg);
    expect(onSelection.sort()).toEqual([...SYNTAX_TOKENS].sort());
    for (const p of CONTRAST_PAIRINGS.filter((x) => x.bg === 'editorSelection')) expect(p.min, p.label).toBe(SYNTAX_SELECTION_MIN);
    expect(SYNTAX_SELECTION_MIN).toBe(4.5);
    const extra: Theme = { ...ALL_DEFAULT_THEMES.Light, colours: { ...ALL_DEFAULT_THEMES.Light.colours, syntaxDecorator: '#123456' } };
    expect(contrastPairingsFor(extra).some((p) => p.fg === 'syntaxDecorator' && p.bg === 'editorSelection')).toBe(true);
  });

  it('gates the syntax body pairings above the WCAG AA body floor', () => {
    for (const p of CONTRAST_PAIRINGS.filter((x) => x.bg === 'editorBg' && x.fg.startsWith('syntax'))) {
      expect(p.min, p.label).toBe(SYNTAX_BODY_MIN);
    }
    expect(SYNTAX_BODY_MIN).toBeGreaterThanOrEqual(4.5);
  });

  it('throws for an in-scope theme with a deliberately low-contrast pairing', () => {
    const broken: Theme = {
      ...ALL_DEFAULT_THEMES.Bash,
      name: 'Bash',
      colours: { ...ALL_DEFAULT_THEMES.Bash.colours, text: '#050505', appBg: '#000000' },
    };
    expect(() => assertInScopeContrast([broken])).toThrow(/Bash|body text/);
  });

  it('gates every theme 009 left ungated, the once low-contrast-by-design three included (078 FR-001, FR-002)', () => {
    for (const name of ['throng', 'Light', 'Snake', 'Claude', 'VSCode', 'Debian', 'Matrix', 'VI-VIM', 'Gothic']) {
      const dim: Theme = {
        ...ALL_DEFAULT_THEMES[name],
        name,
        colours: { ...ALL_DEFAULT_THEMES[name].colours, textMuted: '#111111', appBg: '#000000' },
      };
      expect(() => assertInScopeContrast([dim]), name).toThrow(
        new RegExp(`${name}: muted text on app background = \\d+\\.\\d+:1 \\(needs 3:1\\)`),
      );
    }
  });

  it('gates a theme no list names (078 FR-003)', () => {
    const fresh: Theme = {
      ...ALL_DEFAULT_THEMES.throng,
      name: 'Some Future Theme',
      colours: { ...ALL_DEFAULT_THEMES.throng.colours, text: '#050505', appBg: '#000000' },
    };
    expect(() => assertInScopeContrast([fresh])).toThrow(/Some Future Theme: body text/);
  });

  it('measures accent text on the accent fill at the body-text threshold (078 FR-004)', () => {
    expect(CONTRAST_PAIRINGS).toContainEqual(
      expect.objectContaining({ fg: 'accentText', bg: 'accent', min: WCAG_AA_BODY }),
    );
  });

  it('measures the button and danger text pairs 009 FR-016 required, at 3:1 (078 FR-004a)', () => {
    const pairs = [
      ['confirmButtonText', 'confirmButtonBg'],
      ['confirmButtonHoverText', 'confirmButtonHoverBg'],
      ['cancelButtonText', 'cancelButtonBg'],
      ['cancelButtonHoverText', 'cancelButtonHoverBg'],
      ['destroyButtonText', 'destroyButtonBg'],
      ['destroyButtonHoverText', 'destroyButtonHoverBg'],
      ['dangerText', 'danger'],
    ];
    for (const [fg, bg] of pairs) {
      expect(CONTRAST_PAIRINGS, `${fg} on ${bg}`).toContainEqual(expect.objectContaining({ fg, bg, min: 3 }));
    }
  });

  it('meetsWcagAa is true exactly when no measured pairing fails (078 FR-007)', () => {
    expect(meetsWcagAa(ALL_DEFAULT_THEMES.throng)).toBe(true);
    const lowered: Theme = {
      ...ALL_DEFAULT_THEMES.throng,
      colours: { ...ALL_DEFAULT_THEMES.throng.colours, accentText: ALL_DEFAULT_THEMES.throng.colours.accent },
    };
    expect(meetsWcagAa(lowered)).toBe(false);
    expect(meetsWcagAa(ALL_DEFAULT_THEMES.Matrix)).toBe(true);
  });

  it('measures every enumerated pairing', () => {
    // 069 FR-061 — plus each file icon category the theme sets (FR-064's `other` among them), on each of the
    // four tree backgrounds.
    expect(measureContrast(THRONG_THEME)).toHaveLength(CONTRAST_PAIRINGS.length + 8 * 4);
  });
});

/**
 * 081 US8 (FR-071, R11) — an entry git ignores is drawn with its text and icon faded to the theme's
 * `sizes.ignoredEntryOpacity`, on a background that stays at full strength. The 078 gate measures the faded text,
 * blended over each background a tree row is drawn on, at 3:1.
 */
describe('faded ignored entries (081 FR-071)', () => {
  const themes = Object.values(ALL_DEFAULT_THEMES);

  it('blends a colour over a background at an opacity, as the browser composites it', () => {
    expect(blendOver('#ffffff', '#000000', 0.6)).toBe('#999999');
    expect(blendOver('#ffffff', '#000000', 1)).toBe('#ffffff');
    expect(blendOver('#204080', '#ffffff', 0)).toBe('#ffffff');
  });

  it('ships the default opacity in every bundled theme', () => {
    for (const theme of themes) {
      expect(theme.sizes?.ignoredEntryOpacity, theme.name).toBe(IGNORED_ENTRY_OPACITY_DEFAULT);
    }
  });

  it('measures faded tree text on the tree, a hovered row, a selected row, the active file and a drop target', () => {
    const faded = CONTRAST_PAIRINGS.filter((p) => p.fade === 'ignoredEntry');
    expect(faded.map((p) => p.fg)).toEqual(['text', 'text', 'text', 'text', 'text']);
    expect(faded.map((p) => p.bg)).toEqual(['sidebarBg', 'hoverSurface', 'surfaceActive', 'sidebarBg', 'sidebarBg']);
    expect(faded.every((p) => p.min === WCAG_AA_LARGE_UI)).toBe(true);
  });

  it('every bundled theme keeps faded tree text at 3:1 at the default opacity', () => {
    for (const theme of themes) {
      for (const r of measureContrast(theme).filter((m) => m.label.startsWith('faded'))) {
        expect(r.pass, `${theme.name}: ${r.label} = ${r.ratio.toFixed(2)} (needs ${r.min})`).toBe(true);
      }
    }
  });

  it("measures the theme's own opacity, so a theme that fades too far fails the gate", () => {
    const ghostly: Theme = { ...ALL_DEFAULT_THEMES.throng, name: 'Ghostly', sizes: { ...ALL_DEFAULT_THEMES.throng.sizes, ignoredEntryOpacity: 0.2 } };
    expect(() => assertInScopeContrast([ghostly])).toThrow(/Ghostly: faded ignored text on the tree/);
  });
});
