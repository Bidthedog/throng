/**
 * 049 T029 — one vocabulary for "this text matches" (#325, FR-008–FR-012, FR-016, FR-018a, FR-025).
 *
 * The three new surfaces come from the SAME derivation as the search surfaces, and adding them must not
 * move a single shipped search colour: `fixtures/search-surfaces-pre-049.json` was generated from the
 * derivation BEFORE this feature touched it (T028), and every theme — `throng` included, which is
 * hand-authored — is compared to it byte for byte (FR-009, SC-003). The fixture holds FR-009's three
 * surfaces plus `searchMatchBorder` (047 FR-074), which is shipped too and pinned with them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import {
  CURRENT_MATCH_SEPARATION,
  INACTIVE_SELECTION_FROM_PAGE,
  MATCH_DISTINCTNESS_THRESHOLD,
  SYNTAX_TOKENS,
  ciede2000,
  contrastRatio,
  hexToRgb,
  rgbToLab,
} from '../../src/config/theme-quality.js';

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/search-surfaces-pre-049.json', import.meta.url)), 'utf8'),
) as Record<string, Record<string, string>>;

const THEMES = Object.entries(ALL_DEFAULT_THEMES);
const NEW_TOKENS = ['searchMatchOccurrence', 'searchMatchOccurrenceInactive', 'editorSelectionInactive'] as const;
const MATCH_SURFACES = ['searchMatch', 'searchMatchCurrent', 'searchMatchOccurrence', 'searchMatchOccurrenceInactive'] as const;

const c = (theme: (typeof THEMES)[number][1], token: string): string =>
  (theme.colours as Record<string, string>)[token]!;
const dE = (a: string, b: string): number => ciede2000(rgbToLab(hexToRgb(a)), rgbToLab(hexToRgb(b)));

/** FR-009a moved only the ordinary-match fill, and only where the shipped pair sat below the floor. */
const shippedClearsFloor = (name: string): boolean =>
  dE(FIXTURE[name]!['searchMatch']!, FIXTURE[name]!['searchMatchCurrent']!) >= CURRENT_MATCH_SEPARATION;

describe('the shipped search surfaces do not move (FR-009, SC-003; FR-009a supersedes one fill)', () => {
  it('covers every bundled theme', () => {
    expect(Object.keys(FIXTURE).sort()).toEqual(THEMES.map(([n]) => n).sort());
  });

  it.each(THEMES)('%s keeps its four search colours byte for byte, or all but the ordinary fill FR-009a moved', (name, theme) => {
    for (const [token, value] of Object.entries(FIXTURE[name]!)) {
      if (token === 'searchMatch' && !shippedClearsFloor(name)) continue;
      expect(c(theme, token), `${name}.${token}`).toBe(value);
    }
  });
});

describe('the current match stands apart (FR-009a, FR-009b, SC-003a)', () => {
  it.each(THEMES)('%s: the current-match fill sits at least the floor from the ordinary-match fill', (name, theme) => {
    expect(dE(c(theme, 'searchMatch'), c(theme, 'searchMatchCurrent')), name).toBeGreaterThanOrEqual(
      CURRENT_MATCH_SEPARATION,
    );
  });

  it.each(THEMES)('%s: the ordinary match still reads weaker than the current one, and is still a tint', (name, theme) => {
    const bg = c(theme, 'editorBg');
    expect(dE(c(theme, 'searchMatch'), bg), name).toBeLessThanOrEqual(dE(c(theme, 'searchMatchCurrent'), bg));
    expect(contrastRatio(c(theme, 'searchMatch'), bg), name).toBeLessThan(contrastRatio(c(theme, 'searchMatchCurrent'), bg));
    expect(dE(c(theme, 'searchMatch'), bg), name).toBeGreaterThanOrEqual(MATCH_DISTINCTNESS_THRESHOLD);
  });

  it.each(THEMES)('%s: syntax and editor text stay readable on the ordinary match (FR-011)', (name, theme) => {
    for (const fg of [...SYNTAX_TOKENS, 'editorFg']) {
      expect(contrastRatio(c(theme, fg), c(theme, 'searchMatch')), `${name}: ${fg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('%s: both outlines clear 3:1 against the page and the fill they frame', (name, theme) => {
    const bg = c(theme, 'editorBg');
    expect(contrastRatio(c(theme, 'searchMatchCurrentBorder'), bg), `${name}: current outline / page`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c(theme, 'searchMatchCurrentBorder'), c(theme, 'searchMatchCurrent')), `${name}: current outline / fill`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c(theme, 'searchMatchBorder'), bg), `${name}: outline / page`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c(theme, 'searchMatchBorder'), c(theme, 'searchMatch')), `${name}: outline / fill`).toBeGreaterThanOrEqual(3);
  });
});

describe('the three new surfaces (FR-012)', () => {
  it.each(THEMES)('%s declares each as #rrggbb', (_name, theme) => {
    for (const t of NEW_TOKENS) expect(c(theme, t), t).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(THEMES)('%s: an occurrence is tinted exactly as an ordinary match — one soft tint means another instance (FR-010)', (_n, theme) => {
    expect(c(theme, 'searchMatchOccurrence')).toBe(c(theme, 'searchMatch'));
  });
});

describe('syntax stays readable on every new surface (FR-011, SC-004)', () => {
  it.each(THEMES)('%s: every syntax colour and the editor text reach 4.5:1', (name, theme) => {
    for (const surface of NEW_TOKENS) {
      for (const fg of [...SYNTAX_TOKENS, 'editorFg']) {
        expect(contrastRatio(c(theme, fg), c(theme, surface)), `${name}: ${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('strength ordering (FR-016, FR-018a)', () => {
  it.each(THEMES)('%s: the inactive occurrence is weaker than the occurrence, yet still a tint', (name, theme) => {
    const bg = c(theme, 'editorBg');
    const occ = c(theme, 'searchMatchOccurrence');
    const inactive = c(theme, 'searchMatchOccurrenceInactive');
    expect(dE(inactive, bg), `${name}: nearer the page by ΔE00`).toBeLessThan(dE(occ, bg));
    expect(contrastRatio(inactive, bg), `${name}: weaker by contrast`).toBeLessThanOrEqual(contrastRatio(occ, bg));
    expect(dE(inactive, bg), `${name}: perceptibly tinted`).toBeGreaterThanOrEqual(MATCH_DISTINCTNESS_THRESHOLD / 2);
  });

  it.each(THEMES)('%s: an occurrence is weaker than the selection highlight', (name, theme) => {
    const bg = c(theme, 'editorBg');
    expect(dE(c(theme, 'searchMatchOccurrence'), bg), name).toBeLessThan(dE(c(theme, 'editorSelection'), bg));
  });
});

describe('the inactive selection (FR-025)', () => {
  it.each(THEMES)('%s: distinct from the active selection and from every match surface', (name, theme) => {
    const inactive = c(theme, 'editorSelectionInactive');
    for (const other of ['editorSelection', ...MATCH_SURFACES]) {
      expect(dE(inactive, c(theme, other)), `${name}: against ${other}`).toBeGreaterThanOrEqual(MATCH_DISTINCTNESS_THRESHOLD);
    }
  });

  it.each(THEMES)('%s: plainly visible on the page (FR-025a, SC-003a)', (name, theme) => {
    expect(dE(c(theme, 'editorSelectionInactive'), c(theme, 'editorBg')), name).toBeGreaterThanOrEqual(
      INACTIVE_SELECTION_FROM_PAGE,
    );
  });
});
