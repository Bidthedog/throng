/**
 * The syntax palettes (016, FR-007/FR-007a/FR-007c).
 *
 * The contrast pairings in `theme-quality` already assert that every syntax colour is READABLE.
 * They are not enough, and this file exists because of how they failed: an early derivation
 * satisfied every contrast assertion by dragging each hue toward the foreground until it survived
 * a strongly-tinted match background — which turned Bash's magenta keywords, green strings and
 * grey comments into three shades of the same off-white, and collapsed Matrix's ten greens into
 * four. The build was green. The highlighting was useless.
 *
 * Legibility is necessary; DISTINCTNESS is what makes highlighting mean anything. So:
 *
 *   - within a theme, no two token types may share a colour;
 *   - across themes, no palette may be copy-pasted (which would also fail 009's distinctness gate);
 *   - and the search-match surfaces must stay VISIBLE, because the cheapest way to make code
 *     readable on a highlight is to erase the highlight.
 */
import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { SYNTAX_TOKENS, contrastRatio } from '../../src/config/theme-quality.js';

const THEMES = Object.values(ALL_DEFAULT_THEMES);
const STRIP_TOKENS = ['editorStatusStripBg', 'editorStatusStripFg', 'editorStatusStripHover'];

const syntaxOf = (theme: (typeof THEMES)[number]): string[] =>
  SYNTAX_TOKENS.map((t) => theme.colours[t]);

describe('every bundled theme ships the full syntax palette (FR-007b)', () => {
  it('declares all ten syntax tokens, as #rrggbb', () => {
    for (const theme of THEMES) {
      for (const token of SYNTAX_TOKENS) {
        expect(theme.colours[token], `${theme.name} is missing ${token}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('declares the three editor status-strip tokens (FR-010)', () => {
    for (const theme of THEMES) {
      for (const token of STRIP_TOKENS) {
        expect(theme.colours[token], `${theme.name} is missing ${token}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('keeps the strip distinct from the APPLICATION status bar — different surfaces, different tokens', () => {
    for (const theme of THEMES) {
      expect(theme.colours.statusBarBg, theme.name).toBeDefined();
      expect(theme.colours.editorStatusStripBg, theme.name).toBeDefined();
    }
  });
});

describe('a syntax palette must be able to TELL TOKEN TYPES APART', () => {
  it('gives every token type its own colour within a theme', () => {
    for (const theme of THEMES) {
      const byColour = new Map<string, string[]>();
      SYNTAX_TOKENS.forEach((token) => {
        const colour = theme.colours[token].toLowerCase();
        byColour.set(colour, [...(byColour.get(colour) ?? []), token]);
      });
      const collisions = [...byColour.entries()].filter(([, tokens]) => tokens.length > 1);
      expect(
        collisions,
        `${theme.name}: ${collisions.map(([c, t]) => `${t.join(' = ')} are both ${c}`).join('; ')}`,
      ).toEqual([]);
    }
  });

  it('does not copy-paste a palette between themes (FR-007c — it would fail the distinctness gate)', () => {
    const seen = new Map<string, string>();
    for (const theme of THEMES) {
      const fingerprint = syntaxOf(theme).join(',').toLowerCase();
      const twin = seen.get(fingerprint);
      expect(twin, `${theme.name} has the same syntax palette as ${twin}`).toBeUndefined();
      seen.set(fingerprint, theme.name);
    }
  });
});

describe('a search match must stay VISIBLE, not be erased to make code readable on it', () => {
  it('tints both match surfaces perceptibly against the editor background', () => {
    // The failure mode this catches is the easy way out of FR-007a: shrink the highlight until
    // nothing can be unreadable on it. 013 promises every occurrence is marked (SC-005), so the
    // surface has to remain something a person can actually see.
    for (const theme of THEMES) {
      const { editorBg, searchMatch, searchMatchCurrent } = theme.colours;
      expect(contrastRatio(searchMatch, editorBg), `${theme.name}: ordinary match is invisible`).toBeGreaterThan(1.04);
      expect(
        contrastRatio(searchMatchCurrent, editorBg),
        `${theme.name}: current match is invisible`,
      ).toBeGreaterThan(1.15);
    }
  });

  it('keeps the current match stronger than an ordinary one, so "the one you are on" still reads', () => {
    for (const theme of THEMES) {
      const { editorBg, searchMatch, searchMatchCurrent } = theme.colours;
      expect(
        contrastRatio(searchMatchCurrent, editorBg),
        theme.name,
      ).toBeGreaterThan(contrastRatio(searchMatch, editorBg));
    }
  });

  it('leaves EVERY syntax colour readable on both match surfaces, on every bundled theme (FR-007a)', () => {
    // The pairings gate this build-blockingly for the in-scope themes only (009's policy, reused
    // unchanged). Here it is measured for ALL fifteen — because this feature CREATED these colours,
    // and it is the only feature that can be held to them.
    for (const theme of THEMES) {
      for (const token of SYNTAX_TOKENS) {
        const colour = theme.colours[token];
        for (const surface of ['searchMatch', 'searchMatchCurrent'] as const) {
          expect(
            contrastRatio(colour, theme.colours[surface]),
            `${theme.name}: ${token} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
