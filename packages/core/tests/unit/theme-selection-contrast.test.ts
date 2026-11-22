/**
 * #105 — code stays readable when it is selected: every syntax colour a bundled theme ships clears WCAG AA body text
 * (4.5:1) on that theme's editor selection, the other background code is painted on.
 *
 * Layer: unit — the shipped colours and a contrast ratio. The selection is an opaque background under the text
 * (`editor.css`), so the ratio is the whole question. Matrix, VI-VIM and Gothic keep #61's by-design carve-out.
 */
import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES, BY_DESIGN_LOW_CONTRAST_THEMES } from '../../src/index.js';
import { contrastRatio } from '../../src/config/colour-math.js';

describe('selected code is readable in every bundled theme (#105)', () => {
  for (const theme of Object.values(ALL_DEFAULT_THEMES)) {
    if (BY_DESIGN_LOW_CONTRAST_THEMES.includes(theme.name)) continue;
    it(`${theme.name}: every syntax colour on the editor selection`, () => {
      const selection = theme.colours.editorSelection;
      const illegible = Object.keys(theme.colours)
        .filter((token) => token.startsWith('syntax'))
        .map((token) => ({ token, ratio: contrastRatio(theme.colours[token]!, selection) }))
        .filter(({ ratio }) => ratio < 4.5)
        .map(({ token, ratio }) => `${token} ${ratio.toFixed(2)}:1`);
      expect(illegible, `on ${selection}`).toEqual([]);
    });
  }
});
