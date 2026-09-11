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
  knownContrastIssues,
  CONTRAST_PAIRINGS,
  IN_SCOPE_THEMES,
  BY_DESIGN_LOW_CONTRAST_THEMES,
  SYNTAX_BODY_MIN,
  MATCH_DISTINCTNESS_THRESHOLD,
  CLOSEST_MATCH_SURFACE_DELTA,
  closestMatchSurfacePair,
  assertMatchDistinctness,
} from '../../src/config/theme-quality.js';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { THRONG_THEME, type Theme } from '../../src/config/theme.js';

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

describe('contrast (WCAG 2.1 AA over enumerated pairings)', () => {
  const themes = Object.values(ALL_DEFAULT_THEMES);

  it('in-scope themes (Bash, SUBNET, Cyberpunk) all pass AA', () => {
    expect(() => assertInScopeContrast(themes)).not.toThrow();
    for (const name of IN_SCOPE_THEMES) {
      const theme = ALL_DEFAULT_THEMES[name];
      for (const r of measureContrast(theme)) {
        expect(r.pass, `${name}: ${r.label} = ${r.ratio.toFixed(2)} (needs ${r.min})`).toBe(true);
      }
    }
  });

  // 019 / #83: the syntax hues on the editor BODY — a pairing set of their own, hard-gated across
  // every bundled theme bar the by-design carve-out, so it neither touches nor blocks on the
  // IN_SCOPE_THEMES scope the pairings above are governed by.
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

  it('leaves the by-design low-contrast themes ungated', () => {
    for (const name of BY_DESIGN_LOW_CONTRAST_THEMES) {
      const dim: Theme = {
        ...ALL_DEFAULT_THEMES[name],
        name,
        colours: { ...ALL_DEFAULT_THEMES[name].colours, syntaxComment: '#0b0b0b', editorBg: '#000000' },
      };
      expect(() => assertSyntaxBodyContrast([dim]), name).not.toThrow();
    }
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

  it('reports out-of-scope shortfalls without throwing', () => {
    // A known-bad out-of-scope theme is reported, never build-blocking.
    const dim: Theme = {
      ...ALL_DEFAULT_THEMES.Snake,
      name: 'Snake',
      colours: { ...ALL_DEFAULT_THEMES.Snake.colours, textMuted: '#111111', appBg: '#000000' },
    };
    expect(() => assertInScopeContrast([dim])).not.toThrow();
    const issues = knownContrastIssues([dim]);
    expect(issues.some((i) => i.theme === 'Snake')).toBe(true);
  });

  it('measures every enumerated pairing', () => {
    expect(measureContrast(THRONG_THEME)).toHaveLength(CONTRAST_PAIRINGS.length);
  });
});
